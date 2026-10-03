"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

const STORAGE_KEY = "wage-odometer-v1";
const HISTORY_KEY = "shift_history";
const MS_PER_HOUR = 3_600_000;

type Multiplier = 1 | 1.5 | 2;

type CompletedSegment = {
  multiplier: Multiplier;
  durationMs: number;
  earned: number;
};

type Goal = { id: number; name: string; cost: number };

type RateBreakdown = { multiplier: Multiplier; durationMs: number; earned: number };

type ShiftSummary = {
  id: number;
  shiftStart: number | null;
  endedAt: number;
  totalMs: number;
  totalEarned: number;
  averageHourly: number;
  byRate: RateBreakdown[];
  goalsUnlocked: string[];
};

type Ledger = {
  baseWage: number;
  multiplier: Multiplier;
  currentSegmentStartTime: number | null;
  bankedEarnings: number;
  bankedElapsedMs: number;
  completedSegments: CompletedSegment[];
  shiftStart: number | null;
  isPaused: boolean;
  archivedAt: number | null;
};

const DEFAULT_LEDGER: Ledger = {
  baseWage: 23.75,
  multiplier: 1,
  currentSegmentStartTime: null,
  bankedEarnings: 0,
  bankedElapsedMs: 0,
  completedSegments: [],
  shiftStart: null,
  isPaused: false,
  archivedAt: null,
};

const GOALS: Goal[] = [
  { id: 1, name: "Groceries", cost: 150 },
  { id: 2, name: "Electric Bill", cost: 220 },
  { id: 3, name: "Filament", cost: 310 },
];

const START_OFFSETS: { minutes: number; label: string }[] = [
  { minutes: 0, label: "Start Now" },
  { minutes: 15, label: "-15 Min" },
  { minutes: 30, label: "-30 Min" },
  { minutes: 60, label: "-1 Hour" },
];

const RATES: { multiplier: Multiplier; label: string; hint: string }[] = [
  { multiplier: 1, label: "Base", hint: "1x" },
  { multiplier: 1.5, label: "OT", hint: "1.5x" },
  { multiplier: 2, label: "DT", hint: "2x" },
];

function isMultiplier(value: unknown): value is Multiplier {
  return value === 1 || value === 1.5 || value === 2;
}

function segmentPay(start: number, now: number, baseWage: number, multiplier: number) {
  const elapsedHours = Math.max(0, now - start) / MS_PER_HOUR;
  return elapsedHours * baseWage * multiplier;
}

function formatUsd(amount: number) {
  const safe = Number.isFinite(amount) ? Math.max(0, amount) : 0;
  return `$${safe.toFixed(4)}`;
}

function segmentElapsedMs(start: number, now: number) {
  return Math.max(0, now - start);
}

function elapsedOnClock(ledger: Ledger, now: number) {
  const open =
    ledger.currentSegmentStartTime == null
      ? 0
      : segmentElapsedMs(ledger.currentSegmentStartTime, now);
  return ledger.bankedElapsedMs + open;
}

function formatHms(ms: number) {
  const totalSeconds = Math.floor(Math.max(0, ms) / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return [hours, minutes, seconds].map((part) => String(part).padStart(2, "0")).join(":");
}

function closeSegment(current: Ledger, now: number): Ledger {
  if (current.currentSegmentStartTime == null) return current;
  const durationMs = segmentElapsedMs(current.currentSegmentStartTime, now);
  const earned = segmentPay(
    current.currentSegmentStartTime,
    now,
    current.baseWage,
    current.multiplier,
  );
  const completedSegments =
    durationMs === 0
      ? current.completedSegments
      : [...current.completedSegments, { multiplier: current.multiplier, durationMs, earned }];
  return {
    ...current,
    completedSegments,
    bankedEarnings: current.bankedEarnings + earned,
    bankedElapsedMs: current.bankedElapsedMs + durationMs,
  };
}

function goalProgress(totalEarned: number) {
  let remaining = Math.max(0, totalEarned);
  const funded = GOALS.map(() => false);
  for (let index = 0; index < GOALS.length; index++) {
    const goal = GOALS[index];
    if (remaining >= goal.cost) {
      funded[index] = true;
      remaining -= goal.cost;
      continue;
    }
    return {
      funded,
      scale: Math.min(1, remaining / goal.cost),
      label: goal.name,
      price: `$${goal.cost}`,
    };
  }
  return { funded, scale: 1, label: "All goals funded", price: "" };
}

function summarizeShift(segments: CompletedSegment[], shiftStart: number | null, endedAt: number): ShiftSummary {
  const byRate = RATES.map((rate) => {
    const rows = segments.filter((segment) => segment.multiplier === rate.multiplier);
    return {
      multiplier: rate.multiplier,
      durationMs: rows.reduce((sum, row) => sum + row.durationMs, 0),
      earned: rows.reduce((sum, row) => sum + row.earned, 0),
    };
  });
  const totalMs = byRate.reduce((sum, row) => sum + row.durationMs, 0);
  const totalEarned = byRate.reduce((sum, row) => sum + row.earned, 0);
  let remaining = totalEarned;
  const goalsUnlocked: string[] = [];
  for (const goal of GOALS) {
    if (remaining < goal.cost) break;
    goalsUnlocked.push(goal.name);
    remaining -= goal.cost;
  }
  return {
    id: endedAt,
    shiftStart,
    endedAt,
    totalMs,
    totalEarned,
    averageHourly: totalMs > 0 ? totalEarned / (totalMs / MS_PER_HOUR) : 0,
    byRate,
    goalsUnlocked,
  };
}

function parseSegments(value: unknown): CompletedSegment[] | null {
  if (!Array.isArray(value)) return null;
  const segments: CompletedSegment[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const row = item as Partial<CompletedSegment>;
    const earned = Number(row.earned);
    const durationMs = Number(row.durationMs);
    if (!isMultiplier(row.multiplier)) continue;
    if (!Number.isFinite(earned) || earned < 0) continue;
    if (!Number.isFinite(durationMs) || durationMs < 0) continue;
    segments.push({ multiplier: row.multiplier, durationMs, earned });
  }
  return segments;
}

function readHistory(): ShiftSummary[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is ShiftSummary => {
      if (!item || typeof item !== "object") return false;
      const row = item as Partial<ShiftSummary>;
      return typeof row.id === "number" && Number.isFinite(Number(row.totalEarned));
    });
  } catch {
    return [];
  }
}

function appendHistory(summary: ShiftSummary) {
  const history = readHistory();
  history.push(summary);
  localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
}

function readLedger(): Ledger | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw) as Partial<Ledger>;
    const baseWage = Number(data.baseWage);
    const bankedEarnings = Number(data.bankedEarnings);
    const start = data.currentSegmentStartTime;
    if (!Number.isFinite(baseWage) || baseWage <= 0) return null;
    if (!Number.isFinite(bankedEarnings) || bankedEarnings < 0) return null;
    if (!isMultiplier(data.multiplier)) return null;
    if (start != null && (typeof start !== "number" || !Number.isFinite(start))) return null;

    const isPaused = data.isPaused === true || (start == null && bankedEarnings > 0);
    const currentSegmentStartTime = isPaused ? null : (start ?? null);
    const bankedElapsedRaw = Number(data.bankedElapsedMs);
    const bankedElapsedMs =
      Number.isFinite(bankedElapsedRaw) && bankedElapsedRaw >= 0 ? bankedElapsedRaw : 0;
    const shiftStart =
      typeof data.shiftStart === "number" && Number.isFinite(data.shiftStart)
        ? data.shiftStart
        : currentSegmentStartTime;
    const parsedSegments = parseSegments(data.completedSegments);
    const completedSegments =
      parsedSegments ??
      (bankedEarnings > 0 || bankedElapsedMs > 0
        ? [{ multiplier: data.multiplier, durationMs: bankedElapsedMs, earned: bankedEarnings }]
        : []);
    const archivedAt =
      typeof data.archivedAt === "number" && Number.isFinite(data.archivedAt) ? data.archivedAt : null;
    return {
      baseWage,
      multiplier: data.multiplier,
      bankedEarnings,
      bankedElapsedMs,
      completedSegments,
      shiftStart,
      isPaused,
      archivedAt,
      currentSegmentStartTime,
    };
  } catch {
    return null;
  }
}

export function WageOdometer() {
  const [ledger, setLedger] = useState<Ledger>(DEFAULT_LEDGER);
  const [wageDraft, setWageDraft] = useState(DEFAULT_LEDGER.baseWage.toFixed(2));
  const [hydrated, setHydrated] = useState(false);
  const [epilogue, setEpilogue] = useState<ShiftSummary | null>(null);

  const wageRef = useRef<HTMLSpanElement>(null);
  const timeRef = useRef<HTMLSpanElement>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const goalNameRef = useRef<HTMLSpanElement>(null);
  const goalPriceRef = useRef<HTMLSpanElement>(null);
  const fundedRefs = useRef<(HTMLSpanElement | null)[]>([]);
  const paramsRef = useRef<Ledger>(DEFAULT_LEDGER);

  const setBarRef = useCallback((node: HTMLDivElement | null) => {
    barRef.current = node;
    if (node && node.style.transform === "") node.style.transform = "scaleX(0)";
  }, []);

  const { baseWage, multiplier, currentSegmentStartTime, bankedEarnings, completedSegments, isPaused } =
    ledger;
  const onClock = currentSegmentStartTime != null;
  const perMinute = (baseWage * multiplier) / 60;
  const shiftStarted = onClock || isPaused || bankedEarnings > 0 || completedSegments.length > 0;

  const paint = useCallback((totalEarned: number, elapsedMs?: number) => {
    const earned = Number.isFinite(totalEarned) ? Math.max(0, totalEarned) : 0;
    const progress = goalProgress(earned);
    if (wageRef.current) wageRef.current.innerText = formatUsd(earned);
    if (timeRef.current) {
      timeRef.current.innerText = formatHms(elapsedMs ?? elapsedOnClock(paramsRef.current, Date.now()));
    }
    if (barRef.current) barRef.current.style.transform = `scaleX(${progress.scale})`;
    if (goalNameRef.current) goalNameRef.current.innerText = progress.label;
    if (goalPriceRef.current) goalPriceRef.current.innerText = progress.price;
    for (let index = 0; index < GOALS.length; index++) {
      const badge = fundedRefs.current[index];
      if (!badge) continue;
      badge.classList.toggle("hidden", !progress.funded[index]);
    }
  }, []);

  const publish = useCallback((next: Ledger) => {
    paramsRef.current = next;
    setLedger(next);
  }, []);

  useLayoutEffect(() => {
    paramsRef.current = ledger;
  }, [ledger]);

  useLayoutEffect(() => {
    if (!hydrated) return;
    const current = paramsRef.current;
    const total =
      current.currentSegmentStartTime == null
        ? current.bankedEarnings
        : current.bankedEarnings +
          segmentPay(
            current.currentSegmentStartTime,
            Date.now(),
            current.baseWage,
            current.multiplier,
          );
    paint(total);
  }, [hydrated, ledger, wageDraft, paint]);

  useEffect(() => {
    const stored = readLedger();
    if (stored) {
      paramsRef.current = stored;
      setLedger(stored);
      setWageDraft(stored.baseWage.toFixed(2));
    }
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(ledger));
  }, [hydrated, ledger]);

  useEffect(() => {
    if (!hydrated || currentSegmentStartTime == null) return;

    let frame = 0;

    const tick = () => {
      const current = paramsRef.current;
      if (current.currentSegmentStartTime == null) return;
      const now = Date.now();
      const totalEarned =
        current.bankedEarnings +
        segmentPay(current.currentSegmentStartTime, now, current.baseWage, current.multiplier);
      const elapsedMs =
        current.bankedElapsedMs +
        (current.currentSegmentStartTime == null
          ? 0
          : Math.max(0, now - current.currentSegmentStartTime));
      paint(totalEarned, elapsedMs);
      frame = requestAnimationFrame(tick);
    };

    const onVisibility = () => {
      if (document.hidden) {
        cancelAnimationFrame(frame);
        frame = 0;
        return;
      }
      if (frame === 0) frame = requestAnimationFrame(tick);
    };

    document.addEventListener("visibilitychange", onVisibility);
    if (!document.hidden) frame = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [hydrated, currentSegmentStartTime, paint]);

  function selectMultiplier(next: Multiplier) {
    const current = paramsRef.current;
    if (next === current.multiplier) return;
    if (current.currentSegmentStartTime == null) {
      publish({ ...current, multiplier: next });
      return;
    }
    const now = Date.now();
    publish({
      ...closeSegment(current, now),
      multiplier: next,
      currentSegmentStartTime: now,
    });
  }

  function commitWage() {
    const nextWage = Math.round(Number.parseFloat(wageDraft) * 100) / 100;
    const current = paramsRef.current;
    if (!Number.isFinite(nextWage) || nextWage <= 0) {
      setWageDraft(current.baseWage.toFixed(2));
      return;
    }
    setWageDraft(nextWage.toFixed(2));
    if (nextWage === current.baseWage) return;
    if (current.currentSegmentStartTime == null) {
      publish({ ...current, baseWage: nextWage });
      return;
    }
    const now = Date.now();
    publish({
      ...closeSegment(current, now),
      baseWage: nextWage,
      currentSegmentStartTime: now,
    });
  }

  function startShift(offsetMinutes: number) {
    const current = paramsRef.current;
    if (current.currentSegmentStartTime != null || current.isPaused) return;
    const punchedAt = Date.now() - offsetMinutes * 60_000;
    if (current.completedSegments.length > 0 || current.bankedEarnings > 0 || current.archivedAt != null) return;
    publish({
      ...current,
      bankedEarnings: 0,
      bankedElapsedMs: 0,
      completedSegments: [],
      isPaused: false,
      archivedAt: null,
      shiftStart: punchedAt,
      currentSegmentStartTime: punchedAt,
    });
  }

  function toggleBreak() {
    const current = paramsRef.current;
    if (current.currentSegmentStartTime != null) {
      const now = Date.now();
      publish({
        ...closeSegment(current, now),
        currentSegmentStartTime: null,
        isPaused: true,
      });
      return;
    }
    if (!current.isPaused) return;
    publish({
      ...current,
      isPaused: false,
      currentSegmentStartTime: Date.now(),
    });
  }

  function freshBoard(current: Ledger): Ledger {
    return {
      ...current,
      bankedEarnings: 0,
      bankedElapsedMs: 0,
      completedSegments: [],
      shiftStart: null,
      isPaused: false,
      archivedAt: null,
      currentSegmentStartTime: null,
    };
  }

  function clockOut() {
    const current = paramsRef.current;
    if (current.archivedAt != null) {
      setEpilogue(summarizeShift(current.completedSegments, current.shiftStart, current.archivedAt));
      return;
    }
    const now = Date.now();
    const closed = closeSegment(current, now);
    const finished: Ledger = {
      ...closed,
      currentSegmentStartTime: null,
      isPaused: false,
      archivedAt: now,
    };
    publish(finished);
    const summary = summarizeShift(finished.completedSegments, finished.shiftStart, now);
    appendHistory(summary);
    setEpilogue(summary);
  }

  function startFresh() {
    publish(freshBoard(paramsRef.current));
    setEpilogue(null);
  }

  const auraClass = !onClock
    ? isPaused
      ? "text-gray-500"
      : "text-gray-600"
    : multiplier === 1
      ? "text-sky-300 drop-shadow-[0_0_12px_rgba(56,189,248,0.8)]"
      : multiplier === 1.5
        ? "text-amber-300 animate-aura-slow [--aura:#fbbf24] [--aura-near:8px] [--aura-far:22px]"
        : "text-fuchsia-300 animate-aura-fast [--aura:#e879f9] [--aura-near:16px] [--aura-far:48px]";

  return (
    <>
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col gap-6 px-5 pt-[max(1.5rem,env(safe-area-inset-top))] pb-[max(1.5rem,env(safe-area-inset-bottom))]">
      <header className="space-y-3">
        <p className="text-xs tracking-[0.28em] text-zinc-500 uppercase">Shift earnings</p>
        <p
          className={`min-w-[12ch] text-[clamp(2.75rem,12vw,4.25rem)] leading-none font-semibold tabular-nums transition-colors duration-500 ${auraClass}`}
        >
          <span ref={wageRef}>$0.0000</span>
        </p>
        <p className="text-sm text-gray-400 tabular-nums">+${perMinute.toFixed(2)} / min</p>
        <p className="text-sm text-zinc-400 tabular-nums">
          Time on the clock <span ref={timeRef}>00:00:00</span>
        </p>
        <p className={`text-sm tracking-wide ${isPaused ? "text-amber-600" : onClock ? "text-amber-200/80" : "text-zinc-600"}`}>
          {isPaused ? "Off the clock" : onClock ? "On the clock" : "Not started"}
        </p>
      </header>

      <section className="space-y-2" aria-label="Wishlist goals">
        <div className="flex items-baseline justify-between text-sm">
          <span ref={goalNameRef} className="text-zinc-300">
            Groceries
          </span>
          <span ref={goalPriceRef} className="text-zinc-500 tabular-nums">
            $150
          </span>
        </div>
        <div className="h-3 overflow-hidden rounded-full bg-zinc-800">
          <div
            ref={setBarRef}
            className={`h-full w-full origin-left will-change-transform ${isPaused ? "bg-zinc-600" : "bg-amber-400"}`}
          />
        </div>
        <ul className="space-y-1">
          {GOALS.map((goal, index) => (
            <li key={goal.id} className="flex items-center justify-between gap-3 text-sm text-zinc-400">
              <span>{goal.name}</span>
              <span className="tabular-nums">${goal.cost}</span>
              <span
                ref={(node) => {
                  fundedRefs.current[index] = node;
                }}
                className="hidden min-w-16 text-right text-emerald-300"
              >
                Funded!
              </span>
            </li>
          ))}
        </ul>
      </section>

      <section className="grid grid-cols-3 gap-2" aria-label="Pay rate">
        {RATES.map((rate) => {
          const active = multiplier === rate.multiplier;
          return (
            <button
              key={rate.multiplier}
              type="button"
              aria-pressed={active}
              onClick={() => selectMultiplier(rate.multiplier)}
              className={`min-h-14 rounded-2xl border text-base font-semibold ${
                active
                  ? "border-amber-300 bg-amber-300/15 text-amber-200 shadow-[0_0_22px_rgba(251,191,36,0.35)]"
                  : "border-zinc-800 bg-zinc-900 text-zinc-400"
              }`}
            >
              {rate.label}
              <span className="mt-0.5 block text-xs font-medium tracking-wide">{rate.hint}</span>
            </button>
          );
        })}
      </section>

      {onClock || isPaused ? (
        <button
          type="button"
          aria-pressed={isPaused}
          onClick={toggleBreak}
          className={`min-h-16 rounded-2xl border text-lg font-semibold ${
            isPaused
              ? "border-emerald-400/80 bg-emerald-400/10 text-emerald-200 shadow-[0_0_22px_rgba(52,211,153,0.28)]"
              : "border-orange-400/80 bg-orange-500/10 text-orange-200 shadow-[0_0_22px_rgba(251,146,60,0.28)]"
          }`}
        >
          {isPaused ? "Resume" : "Pause / Lunch"}
        </button>
      ) : null}

      <label className="block space-y-2 text-sm text-zinc-400">
        Base wage
        <span className="flex min-h-14 items-center rounded-2xl border border-zinc-800 bg-zinc-900 px-4">
          <span className="text-zinc-500">$</span>
          <input
            value={wageDraft}
            onChange={(event) => setWageDraft(event.target.value)}
            onBlur={commitWage}
            onKeyDown={(event) => {
              if (event.key === "Enter") event.currentTarget.blur();
            }}
            inputMode="decimal"
            enterKeyHint="done"
            aria-label="Base hourly wage"
            className="w-full bg-transparent px-2 text-lg text-zinc-100 tabular-nums outline-none"
          />
          <span className="text-zinc-500">/hr</span>
        </span>
      </label>

      {!shiftStarted ? (
        <div className="mt-auto grid grid-cols-2 gap-2" aria-label="Start shift">
          {START_OFFSETS.map((offset) => (
            <button
              key={offset.minutes}
              type="button"
              onClick={() => startShift(offset.minutes)}
              className="min-h-14 rounded-2xl bg-amber-300 text-base font-semibold text-zinc-950"
            >
              {offset.label}
            </button>
          ))}
        </div>
      ) : (
        <div className="mt-auto">
          <button
            type="button"
            onClick={clockOut}
            className="min-h-14 w-full rounded-2xl border border-amber-300/80 text-base font-semibold text-amber-200"
          >
            Clock Out
          </button>
        </div>
      )}
    </main>
    {epilogue ? (
      <div className="fixed inset-0 z-50 overflow-y-auto bg-zinc-950 px-5 pt-[max(1.5rem,env(safe-area-inset-top))] pb-[max(1.5rem,env(safe-area-inset-bottom))]">
        <div className="mx-auto flex min-h-full w-full max-w-md flex-col gap-6">
          <div className="space-y-2">
            <p className="text-xs tracking-[0.28em] text-zinc-500 uppercase">Shift complete</p>
            <h1 className="text-3xl font-semibold text-zinc-50">Clocked out</h1>
            <p className="text-zinc-300">
              Total shift time{" "}
              <span className="text-amber-200 tabular-nums">{formatHms(epilogue.totalMs)}</span>
            </p>
          </div>
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="text-zinc-500">
                <th className="py-2 font-medium">Rate</th>
                <th className="py-2 font-medium">Time</th>
                <th className="py-2 text-right font-medium">Earned</th>
              </tr>
            </thead>
            <tbody>
              {epilogue.byRate.map((row) => (
                <tr key={row.multiplier} className="border-t border-zinc-800 text-zinc-100">
                  <td className="py-3">{row.multiplier}x</td>
                  <td className="py-3 tabular-nums">{formatHms(row.durationMs)}</td>
                  <td className="py-3 text-right tabular-nums">{formatUsd(row.earned)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="space-y-1 text-zinc-100">
            <p className="flex justify-between">
              <span>Total gross</span>
              <span className="tabular-nums">{formatUsd(epilogue.totalEarned)}</span>
            </p>
            <p className="flex justify-between">
              <span>Effective hourly</span>
              <span className="tabular-nums">${epilogue.averageHourly.toFixed(2)} / hr</span>
            </p>
          </div>
          <div className="space-y-2">
            <p className="text-sm text-zinc-400">Goals unlocked</p>
            {epilogue.goalsUnlocked.length === 0 ? (
              <p className="text-zinc-500">None this shift</p>
            ) : (
              <ul className="space-y-1">
                {epilogue.goalsUnlocked.map((name) => (
                  <li key={name} className="text-emerald-300">
                    {name}
                  </li>
                ))}
              </ul>
            )}
          </div>
          <button
            type="button"
            onClick={startFresh}
            className="mt-auto min-h-14 rounded-2xl bg-amber-300 text-base font-semibold text-zinc-950"
          >
            Start Fresh Tomorrow
          </button>
        </div>
      </div>
    ) : null}
    </>
  );
}

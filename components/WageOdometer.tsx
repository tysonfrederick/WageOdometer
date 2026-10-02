"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

const STORAGE_KEY = "wage-odometer-v1";
const GOAL_DOLLARS = 150;
const MS_PER_HOUR = 3_600_000;

type Multiplier = 1 | 1.5 | 2;

type Ledger = {
  baseWage: number;
  multiplier: Multiplier;
  currentSegmentStartTime: number | null;
  bankedEarnings: number;
  isPaused: boolean;
};

const DEFAULT_LEDGER: Ledger = {
  baseWage: 23.75,
  multiplier: 1,
  currentSegmentStartTime: null,
  bankedEarnings: 0,
  isPaused: false,
};

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
    return {
      baseWage,
      multiplier: data.multiplier,
      bankedEarnings,
      isPaused,
      currentSegmentStartTime: isPaused ? null : (start ?? null),
    };
  } catch {
    return null;
  }
}

export function WageOdometer() {
  const [ledger, setLedger] = useState<Ledger>(DEFAULT_LEDGER);
  const [wageDraft, setWageDraft] = useState(DEFAULT_LEDGER.baseWage.toFixed(2));
  const [hydrated, setHydrated] = useState(false);

  const wageRef = useRef<HTMLSpanElement>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const paramsRef = useRef<Ledger>(DEFAULT_LEDGER);

  const setBarRef = useCallback((node: HTMLDivElement | null) => {
    barRef.current = node;
    if (node && node.style.transform === "") node.style.transform = "scaleX(0)";
  }, []);

  const { multiplier, currentSegmentStartTime, bankedEarnings, isPaused } = ledger;
  const onClock = currentSegmentStartTime != null;

  const paint = useCallback((totalEarned: number, percent?: number) => {
    const earned = Number.isFinite(totalEarned) ? Math.max(0, totalEarned) : 0;
    const completion = percent ?? Math.min(100, (earned / GOAL_DOLLARS) * 100);
    if (wageRef.current) wageRef.current.innerText = formatUsd(earned);
    if (barRef.current) {
      barRef.current.style.transform = `scaleX(${completion / 100})`;
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
      const totalEarned =
        current.bankedEarnings +
        segmentPay(
          current.currentSegmentStartTime,
          Date.now(),
          current.baseWage,
          current.multiplier,
        );
      const percent = Math.min(100, (totalEarned / GOAL_DOLLARS) * 100);
      paint(totalEarned, percent);
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
      ...current,
      multiplier: next,
      bankedEarnings:
        current.bankedEarnings +
        segmentPay(current.currentSegmentStartTime, now, current.baseWage, current.multiplier),
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
      ...current,
      baseWage: nextWage,
      bankedEarnings:
        current.bankedEarnings +
        segmentPay(current.currentSegmentStartTime, now, current.baseWage, current.multiplier),
      currentSegmentStartTime: now,
    });
  }

  function startShift() {
    const current = paramsRef.current;
    if (current.currentSegmentStartTime != null || current.isPaused) return;
    publish({
      ...current,
      bankedEarnings: 0,
      isPaused: false,
      currentSegmentStartTime: Date.now(),
    });
  }

  function toggleBreak() {
    const current = paramsRef.current;
    if (current.currentSegmentStartTime != null) {
      const now = Date.now();
      const banked =
        current.bankedEarnings +
        segmentPay(current.currentSegmentStartTime, now, current.baseWage, current.multiplier);
      publish({
        ...current,
        bankedEarnings: banked,
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

  function resetShift() {
    publish({
      ...paramsRef.current,
      bankedEarnings: 0,
      isPaused: false,
      currentSegmentStartTime: null,
    });
  }

  const shiftStarted = onClock || isPaused || bankedEarnings > 0;
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
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col gap-6 px-5 pt-[max(1.5rem,env(safe-area-inset-top))] pb-[max(1.5rem,env(safe-area-inset-bottom))]">
      <header className="space-y-3">
        <p className="text-xs tracking-[0.28em] text-zinc-500 uppercase">Shift earnings</p>
        <p
          className={`min-w-[12ch] text-[clamp(2.75rem,12vw,4.25rem)] leading-none font-semibold tabular-nums transition-colors duration-500 ${auraClass}`}
        >
          <span ref={wageRef}>$0.0000</span>
        </p>
        <p className={`text-sm tracking-wide ${isPaused ? "text-amber-600" : onClock ? "text-amber-200/80" : "text-zinc-600"}`}>
          {isPaused ? "Off the clock" : onClock ? "On the clock" : "Not started"}
        </p>
      </header>

      <section className="space-y-2" aria-label="Household Groceries goal">
        <div className="flex items-baseline justify-between text-sm">
          <span className="text-zinc-300">Household Groceries</span>
          <span className="text-zinc-500 tabular-nums">$150</span>
        </div>
        <div className="h-3 overflow-hidden rounded-full bg-zinc-800">
          <div
            ref={setBarRef}
            className={`h-full w-full origin-left will-change-transform ${isPaused ? "bg-zinc-600" : "bg-amber-400"}`}
          />
        </div>
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

      {shiftStarted ? (
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

      <div className="mt-auto grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={startShift}
          disabled={onClock || isPaused}
          className="min-h-14 rounded-2xl bg-amber-300 text-base font-semibold text-zinc-950 disabled:bg-zinc-800 disabled:text-zinc-500"
        >
          Start Shift
        </button>
        <button
          type="button"
          onClick={resetShift}
          disabled={!shiftStarted}
          className="min-h-14 rounded-2xl border border-zinc-700 text-base font-semibold text-zinc-300 disabled:border-zinc-800 disabled:text-zinc-600"
        >
          Reset
        </button>
      </div>
    </main>
  );
}

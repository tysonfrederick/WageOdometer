# Wage Odometer: Kinetic Earning Prototype

## The Problem
In physical logistics and warehouse operations, there is a profound psychological disconnect between grueling physical labor and delayed financial gratification. Traditional bi-weekly paychecks are abstract. During a 10-hour shift—especially during Overtime or Double Time—workers lack immediate, visceral feedback linking their kinetic effort to their financial momentum. 

## The Solution
Wage Odometer is an Experience Prototype designed to engineer motivation. It acts as a real-time, gamified dashboard that visualizes earning velocity down to the micro-cent. By translating abstract hourly wages into a ticking, interactive "slot machine" UI, it provides immediate psychological fuel and maps earnings directly against real-world financial goals (Wishlists).

## Engineering Architecture & Constraints
This prototype was built with strict hardware and performance constraints in mind, targeting a mobile-first Progressive Web App (PWA) environment running continuously for 10+ hours.

*   **The DOM-Bypass Method:** To prevent device thermal throttling and battery drain, this app strictly avoids using React state (`setState`) for the rolling numbers. Instead, it utilizes a pure JavaScript `requestAnimationFrame` loop to directly mutate the DOM (`ref.current.innerText`), achieving a flawless 60fps without triggering React render cycles.
*   **GPU-Accelerated Visuals:** The Wishlist progress bars scale using CSS `transform: scaleX` and `will-change-transform`, ensuring the rendering is offloaded to the GPU rather than forcing expensive layout repaints on the CPU.
*   **"Banked Earnings" Ledger:** To accurately reflect real-world wage laws, transitioning between Base Pay (1x), Overtime (1.5x), and Double Time (2x) uses a ledger system. Prior earnings are "banked," and the new multiplier is only applied to the time moving forward, preventing retroactive calculation errors.
*   **Kinetic UI Feedback:** The UI utilizes dynamic Tailwind CSS text-shadows and pulse animations to visually communicate the velocity of the active multiplier (e.g., shifting to a glowing, pulsing gold during Overtime).

## Tech Stack
*   Next.js (App Router)
*   TypeScript
*   Tailwind CSS (Zero external animation libraries used)
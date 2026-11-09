// Public surface of the butterfly module.
//
// Spark pick-up (contract note, A3). `Butterfly.spark(from): void` is fire-and-forget, so the delay is automatic:
//  - near source (<= 200px from the butterfly): a short puff, no delay;
//  - far source (> 200px): a thin bright streak is drawn from the source to the butterfly over SPARK_STREAK_MS (180ms)
//    and the butterfly turns toward it. A `flyTo()` started within 250ms after that spark holds its take-off
//    until the streak arrives. The hold counts inside the flight's own timeline: `onApproach` fires when the
//    time left (hold + flight) is <= 300ms, and the returned promise resolves at hold + duration.
//    A flyTo that starts later, or home(), never waits. `sparkEta()` tells how many ms of streak are left.
//  - reduced motion: no spark, no hold.
//
// Guide cancel. `createGuide(...)` returns the Guide plus `cancel()` (not part of the shared interface): it
// invalidates every pending continuation of focus() (reveal, underline, pulse) and clears the pulse and the
// underline, without moving the butterfly. Bind it to the app's operation token.
export { createButterfly } from './butterfly';
export type { ButterflyOptions, ButterflyFx, TargetPhase } from './butterfly';
export { createGuide } from './guide';
export type { GuideOptions, CancellableGuide } from './guide';
export { perchPoint, PERCH_GUTTER_MIN, SAFE_MARGIN, WITHIN_MARGIN } from './perch';
export type { PerchView } from './perch';
export { SPARK_STREAK_MS, SPARK_FAR_PX } from './butterfly';

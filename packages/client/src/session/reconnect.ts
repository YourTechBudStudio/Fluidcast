import { Duration, Effect, Schedule } from 'effect';

/** Reconnect delays: 250 ms doubling up to 5 s, retrying indefinitely. */
export const reconnectSchedule = Schedule.exponential('250 millis').pipe(
  Schedule.modifyDelay(({ duration }) =>
    Effect.succeed(Duration.min(duration, Duration.seconds(5))),
  ),
);

export const MESSAGE_FLOOD_COUNT = 10;
export const MESSAGE_FLOOD_WINDOW_MS = 30_000;

interface FloodOptions {
  count?: number;
  windowMs?: number;
}

export interface FloodCheck {
  isFlood: boolean;
  seenAt: Date[];
}

export function isFlood(
  seenAt: readonly Date[],
  count = MESSAGE_FLOOD_COUNT,
): boolean {
  return seenAt.length >= count;
}

export function checkFlood(
  seenAt: readonly Date[],
  now: Date,
  options: FloodOptions = {},
): FloodCheck {
  const count = options.count ?? MESSAGE_FLOOD_COUNT;
  const windowMs =
    options.windowMs ?? MESSAGE_FLOOD_WINDOW_MS;
  const windowStart = now.getTime() - windowMs;
  const retained = seenAt.filter(
    (timestamp) => timestamp.getTime() >= windowStart,
  );
  retained.push(now);

  return {
    isFlood: isFlood(retained, count),
    seenAt: retained,
  };
}

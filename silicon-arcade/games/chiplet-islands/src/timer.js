/**
 * Settle a game clock against a monotonic timestamp.
 * `remaining` is in seconds; `tickAt` and `now` are in milliseconds.
 * Calling this while paused advances the baseline without charging paused time.
 */
export function settleClock({ remaining, tickAt, running }, now) {
  if (!Number.isFinite(remaining) || !Number.isFinite(tickAt) || !Number.isFinite(now) || typeof running !== 'boolean') {
    throw new TypeError('Clock values must be finite numbers and running must be boolean');
  }
  const available = Math.max(0, remaining);
  const elapsed = Math.max(0, now - tickAt);
  // Keep subtraction in timestamp units. This also avoids accumulating decimal
  // second fragments at ordinary millisecond pause and deadline boundaries.
  const next = running ? Math.max(0, (available * 1000 - elapsed) / 1000) : available;
  return { remaining: next, tickAt: now, expired: next === 0 };
}

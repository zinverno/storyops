/**
 * Injectable time source. Everything that stamps artifacts or computes article
 * age takes a Clock so that fixture scenarios are deterministic.
 */
export interface Clock {
  now(): Date;
}

export const systemClock: Clock = { now: () => new Date() };

export function fixedClock(iso: string): Clock {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) throw new Error(`Invalid fixed clock date: ${iso}`);
  return { now: () => new Date(date.getTime()) };
}

export function toISODate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function hoursBetween(from: Date, to: Date): number {
  return (to.getTime() - from.getTime()) / 3_600_000;
}

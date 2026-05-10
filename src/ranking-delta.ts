import type { Ranking } from "./ranking.js";

export type RankDelta = number | null;

export function computeRankDeltas<U>(
  current: Ranking<U>,
  previous: Ranking<U> | null,
  getKey: (user: U) => string,
): Map<string, RankDelta> {
  const result = new Map<string, RankDelta>();
  if (!previous) {
    for (const row of current.rows) {
      result.set(getKey(row.user), null);
    }
    return result;
  }

  const prevRanks = new Map<string, number>();
  for (const row of previous.rows) {
    prevRanks.set(getKey(row.user), row.rank);
  }

  for (const row of current.rows) {
    const key = getKey(row.user);
    const prev = prevRanks.get(key);
    result.set(key, prev === undefined ? null : prev - row.rank);
  }
  return result;
}

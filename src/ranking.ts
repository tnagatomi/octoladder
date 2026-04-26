export interface RankingEntry<U = unknown> {
  user: U;
  count: number;
  buckets?: readonly number[];
}

export interface RankingRow<U = unknown> {
  rank: number;
  user: U;
  count: number;
  buckets: readonly number[];
}

export class Ranking<U = unknown> {
  private readonly _rows: readonly RankingRow<U>[];

  constructor(entries: readonly RankingEntry<U>[]) {
    const sorted = entries.filter((e) => e.count !== 0).sort((a, b) => b.count - a.count);

    const ranked: RankingRow<U>[] = [];
    sorted.forEach((entry, idx) => {
      const tied = ranked.length > 0 && entry.count === ranked[ranked.length - 1]!.count;
      const rank = tied ? ranked[ranked.length - 1]!.rank : idx + 1;
      ranked.push({ rank, user: entry.user, count: entry.count, buckets: entry.buckets ?? [] });
    });

    this._rows = ranked;
  }

  get rows(): readonly RankingRow<U>[] {
    return this._rows;
  }

  get totalCount(): number {
    return this._rows.reduce((sum, row) => sum + row.count, 0);
  }

  get contributorCount(): number {
    return this._rows.length;
  }

  get isEmpty(): boolean {
    return this._rows.length === 0;
  }
}

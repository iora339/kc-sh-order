import { zendQsort } from './qsort';

/** 同射程のタイブレークが引く乱数。移植元の `Math.random() < .5 ? 1 : -1` の true = 1 側 */
export interface TieOracle {
  next(): boolean;
}

export const randomOracle: TieOracle = {
  next: () => Math.random() < 0.5,
};

/**
 * orderByRange (js/kcsim.js:3345) の並べ替え部分。
 * ranges は艦隊の並び順(1番艦から)の射程で、戻り値は撃つ順に並んだ「艦隊内の位置」。
 */
export function orderByRange(ranges: readonly number[], tie: TieOracle): number[] {
  const idx = ranges.map((_, i) => i);
  zendQsort(idx, (i, j) => (ranges[i] !== ranges[j] ? ranges[j] - ranges[i] : tie.next() ? 1 : -1));
  return idx;
}

/** orderByRangeOld 相当: 一様シャッフル → 射程降順に安定ソート。 */
export function orderByRangeUniform(ranges: readonly number[], rand: () => number = Math.random): number[] {
  const idx = ranges.map((_, i) => i);
  for (let i = idx.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    const t = idx[i];
    idx[i] = idx[j];
    idx[j] = t;
  }
  // Array.prototype.sort は安定ソート(ES2019 以降)
  idx.sort((i, j) => ranges[j] - ranges[i]);
  return idx;
}

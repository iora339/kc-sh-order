import { orderByRange, type TieOracle } from './order';

export type TieMode = 'source' | 'uniform';

export interface RangeDist {
  /** "撃つ順に並んだ位置" をキーにした確率。キーは order.join(',') */
  orders: Map<string, number>;
  /** marginal[position][rank] = その位置の艦が rank 番目に撃つ確率 */
  marginal: number[][];
}

const NEED_DECISION = Symbol('need-decision');

class PrefixOracle implements TieOracle {
  private i = 0;
  private readonly bits: boolean[];
  constructor(bits: boolean[]) {
    this.bits = bits;
  }
  next(): boolean {
    if (this.i >= this.bits.length) throw NEED_DECISION;
    return this.bits[this.i++];
  }
}

/**
 * zendQsort が消費する乱数の分岐をすべて展開して、行動順の厳密な確率分布を出す。
 * 乱数を引くのは同射程の比較だけなので、分岐の深さは同射程の比較回数(6隻で最悪 2^15 程度)。
 */
export function exactDist(ranges: readonly number[]): RangeDist {
  const n = ranges.length;
  const orders = new Map<string, number>();
  const marginal = zeros(n);
  if (n === 0) return { orders, marginal };

  const stack: boolean[][] = [[]];
  while (stack.length) {
    const bits = stack.pop()!;
    if (bits.length > 40) throw new Error('tie branching too deep');
    let order: number[] | null = null;
    try {
      order = orderByRange(ranges, new PrefixOracle(bits));
    } catch (e) {
      if (e !== NEED_DECISION) throw e;
    }
    if (order === null) {
      stack.push([...bits, true], [...bits, false]);
      continue;
    }
    const p = Math.pow(0.5, bits.length);
    const key = order.join(',');
    orders.set(key, (orders.get(key) ?? 0) + p);
    for (let rank = 0; rank < n; rank++) marginal[order[rank]][rank] += p;
  }
  return { orders, marginal };
}

/** 一様シャッフル版の厳密分布。射程降順に矛盾しない並びが等確率で、艦隊内の位置に依存しない */
export function uniformDist(ranges: readonly number[]): RangeDist {
  const n = ranges.length;
  const orders = new Map<string, number>();
  const marginal = zeros(n);
  if (n === 0) return { orders, marginal };

  const valid: number[][] = [];
  for (const order of permutations(n)) {
    let ok = true;
    for (let r = 1; r < n; r++) {
      if (ranges[order[r - 1]] < ranges[order[r]]) {
        ok = false;
        break;
      }
    }
    if (ok) valid.push(order);
  }
  const p = 1 / valid.length;
  for (const order of valid) {
    orders.set(order.join(','), p);
    for (let rank = 0; rank < n; rank++) marginal[order[rank]][rank] += p;
  }
  return { orders, marginal };
}

const cache = new Map<string, RangeDist>();

/** 射程の並びをキーにキャッシュした分布。同じ射程列なら艦が違っても分布は同じ。 */
export function distFor(ranges: readonly number[], mode: TieMode): RangeDist {
  const key = mode + '|' + ranges.join(',');
  let d = cache.get(key);
  if (!d) {
    d = mode === 'uniform' ? uniformDist(ranges) : exactDist(ranges);
    cache.set(key, d);
  }
  return d;
}

const entriesCache = new WeakMap<RangeDist, Array<{ order: number[]; p: number }>>();

/** orders のキーを配列に直したもの。走査のたびに parse し直さないようキャッシュする。 */
export function orderEntries(d: RangeDist): Array<{ order: number[]; p: number }> {
  let list = entriesCache.get(d);
  if (!list) {
    list = [...d.orders].map(([key, p]) => ({ order: key.split(',').map(Number), p }));
    entriesCache.set(d, list);
  }
  return list;
}

function zeros(n: number): number[][] {
  return Array.from({ length: n }, () => new Array<number>(n).fill(0));
}

export function* permutations(n: number): Generator<number[]> {
  const a = Array.from({ length: n }, (_, i) => i);
  yield* rec(a, 0);
  function* rec(arr: number[], k: number): Generator<number[]> {
    if (k === arr.length) {
      yield arr.slice();
      return;
    }
    for (let i = k; i < arr.length; i++) {
      [arr[k], arr[i]] = [arr[i], arr[k]];
      yield* rec(arr, k + 1);
      [arr[k], arr[i]] = [arr[i], arr[k]];
    }
  }
}

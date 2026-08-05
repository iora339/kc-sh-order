import { describe, expect, it } from 'vitest';
import { zendQsort } from '../src/qsort';
import { orderByRange, orderByRangeUniform, randomOracle } from '../src/order';
import { exactDist, uniformDist } from '../src/distribution';

describe('zendQsort', () => {
  it('全順序の比較関数なら普通にソートでき、要素が失われない', () => {
    for (let n = 0; n <= 11; n++) {
      for (let trial = 0; trial < 20; trial++) {
        const src = Array.from({ length: n }, () => Math.floor(Math.random() * 10));
        const a = src.slice();
        zendQsort(a, (x, y) => y - x); // 射程降順を模した全順序
        expect(a).toEqual(src.slice().sort((x, y) => y - x));
      }
    }
  });
});

describe('exactDist', () => {
  // 仕様書 3.2 の実測値
  const RANGES = [2, 4, 2, 3, 2, 1];

  it('確率の総和が 1、各位置・各順位の周辺確率も 1', () => {
    const d = exactDist(RANGES);
    const total = [...d.orders.values()].reduce((a, b) => a + b, 0);
    expect(total).toBeCloseTo(1, 10);
    for (let i = 0; i < RANGES.length; i++) {
      expect(d.marginal[i].reduce((a, b) => a + b, 0)).toBeCloseTo(1, 10);
      expect(d.marginal.reduce((a, row) => a + row[i], 0)).toBeCloseTo(1, 10);
    }
  });

  it('同射程3隻のうち最初に撃つ枠(添字2)の分布が kancolle-replay と一致する', () => {
    const d = exactDist(RANGES);
    expect(d.marginal[0][2]).toBeCloseTo(0.311, 2); // 1番艦
    expect(d.marginal[2][2]).toBeCloseTo(0.2494, 2); // 3番艦
    expect(d.marginal[4][2]).toBeCloseTo(0.4396, 2); // 5番艦
    // 艦隊の後ろのタイほど前に出やすい
    expect(d.marginal[4][2]).toBeGreaterThan(d.marginal[0][2]);
    expect(d.marginal[0][2]).toBeGreaterThan(d.marginal[2][2]);
  });

  it('厳密列挙とモンテカルロが一致する', () => {
    const N = 100_000;
    const count = new Map<string, number>();
    for (let i = 0; i < N; i++) {
      const key = orderByRange(RANGES, randomOracle).join(',');
      count.set(key, (count.get(key) ?? 0) + 1);
    }
    const d = exactDist(RANGES);
    expect(new Set(count.keys())).toEqual(new Set(d.orders.keys()));
    for (const [key, p] of d.orders) {
      expect((count.get(key) ?? 0) / N).toBeCloseTo(p, 2);
    }
  });

  it('7隻(遊撃部隊)でも分布が破綻しない', () => {
    for (const ranges of [
      [2, 2, 2, 2, 2, 2, 2], // 最悪ケース: 全艦同射程
      [4, 3, 2, 2, 2, 1, 1],
    ]) {
      const d = exactDist(ranges);
      expect([...d.orders.values()].reduce((a, b) => a + b, 0)).toBeCloseTo(1, 10);
      for (let i = 0; i < ranges.length; i++) {
        expect(d.marginal[i].reduce((a, b) => a + b, 0)).toBeCloseTo(1, 10);
      }
    }
  });

  it('射程がすべて異なるなら順序は一意に決まる', () => {
    const d = exactDist([1, 4, 2, 3]);
    expect(d.orders.size).toBe(1);
    expect([...d.orders.entries()][0]).toEqual(['1,3,2,0', 1]);
  });
});

describe('uniformDist', () => {
  it('同射程3隻なら 6 通りが等確率', () => {
    const d = uniformDist([2, 2, 2]);
    expect(d.orders.size).toBe(6);
    for (const p of d.orders.values()) expect(p).toBeCloseTo(1 / 6, 10);
  });

  it('並び順を変えても分布が変わらない(位置ごとの確率が一様)', () => {
    const d = uniformDist([2, 4, 2, 3, 2, 1]);
    for (const pos of [0, 2, 4]) expect(d.marginal[pos][2]).toBeCloseTo(1 / 3, 10);
  });

  it('シャッフル→安定ソートの実測と一致する', () => {
    const ranges = [2, 4, 2, 3, 2, 1];
    const N = 60_000;
    const count = new Map<string, number>();
    for (let i = 0; i < N; i++) {
      const key = orderByRangeUniform(ranges).join(',');
      count.set(key, (count.get(key) ?? 0) + 1);
    }
    const d = uniformDist(ranges);
    expect(new Set(count.keys())).toEqual(new Set(d.orders.keys()));
    for (const [key, p] of d.orders) {
      expect((count.get(key) ?? 0) / N).toBeCloseTo(p, 2);
    }
  });
});

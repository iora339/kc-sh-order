import { describe, expect, it } from 'vitest';
import type { TieMode } from '../src/distribution';
import {
  allowedPositions,
  attackerGroups,
  evennessOf,
  findMixedRangeGroups,
  findPairConstraintIssues,
  findRangeConflicts,
  groupsFromMerged,
  hasPriority,
  isConstraintAvailable,
  mergedFromGroups,
  search,
  syncGroupPriorities,
  vanguardSplit,
  type PosConstraint,
  type Priority,
  type Ship,
  type SortKey,
} from '../src/search';

const ships = (...specs: Array<[string, number, PosConstraint?, Priority?, boolean?]>): Ship[] =>
  specs.map(([name, range, constraint, priority, shells]) => ({
    name,
    range,
    constraint: constraint ?? 'any',
    priority: priority ?? 'normal',
    shells: shells ?? true,
  }));

/** merged 省略時はグループ無し(全艦を個別に順序指定) */
const groupsOf = (fleet: Ship[], merged?: boolean[]): number[][] =>
  groupsFromMerged(merged ?? new Array<boolean>(fleet.length - 1).fill(false), fleet.length);

const run = (fleet: Ship[], mode: TieMode, key: SortKey, merged?: boolean[]) =>
  search(fleet, groupsOf(fleet, merged), mode, key);

describe('search', () => {
  it('射程がすべて異なるなら並び順に関係なく 100%', () => {
    const fleet = ships(['A', 4], ['B', 3], ['C', 2], ['D', 1]);
    const r = run(fleet, 'source', 'exact');
    expect(r).toHaveLength(24);
    for (const c of r) expect(c.exact).toBeCloseTo(1, 10);
  });

  it('同射程2隻なら「後ろのタイほど前に出やすい」ぶんだけ差がつく', () => {
    const fleet = ships(['A', 2], ['B', 2]);
    const r = run(fleet, 'source', 'exact');
    // 2隻とも同射程 → どちらの並びでも確率の和は 1、かつ 50/50 ではない側が有利
    expect(r[0].exact + r[1].exact).toBeCloseTo(1, 10);
    expect(r[0].exact).toBeGreaterThanOrEqual(r[1].exact);
  });

  it('uniform ではどの並び順も同じ確率になる', () => {
    const fleet = ships(['A', 3], ['B', 2], ['C', 2], ['D', 2]);
    const r = run(fleet, 'uniform', 'exact');
    for (const c of r) expect(c.exact).toBeCloseTo(1 / 6, 10);
  });

  it('射程降順に反する希望順は完全一致確率が 0', () => {
    const fleet = ships(['A', 1], ['B', 4]);
    expect(findRangeConflicts(fleet, groupsOf(fleet))).toEqual([{ before: 0, after: 1 }]);
    for (const c of run(fleet, 'source', 'exact')) expect(c.exact).toBe(0);
  });

  it('7隻(遊撃部隊)でも全 5040 通りを評価できる', () => {
    const fleet = ships(['A', 4], ['B', 3], ['C', 2], ['D', 2], ['E', 2], ['F', 1], ['G', 1]);
    const r = run(fleet, 'source', 'exact');
    expect(r).toHaveLength(5040);
    // 一様シャッフルなら 1/(3! * 2!) = 8.33%。source では並びを選ぶことでそれを上回れる
    expect(r[0].exact).toBeGreaterThan(1 / 12);
    expect(r[0].exact).toBeGreaterThan(r[r.length - 1].exact);
  });

  it('位置指定を満たす並びだけが候補になる', () => {
    const fleet = ships(['A', 2, 'flagship'], ['B', 2], ['C', 2, 'third-or-fifth'], ['D', 2]);
    const r = run(fleet, 'source', 'exact');
    for (const c of r) {
      expect(c.assign[0]).toBe(0); // A は必ず旗艦
      expect(c.assign[2]).toBe(2); // C は3番艦(4隻編成なので5番艦は存在しない)
    }
    expect(r).toHaveLength(2); // 残る B・D の 2 通り
  });

  it('矛盾する位置指定では候補が 0 件になる', () => {
    const fleet = ships(['A', 2, 'flagship'], ['B', 2, 'flagship'], ['C', 2]);
    expect(run(fleet, 'source', 'exact')).toHaveLength(0);
  });

  it('ネルソンタッチの3隻を固定しても他の艦は自由に並べられる', () => {
    const fleet = ships(
      ['N', 3, 'flagship'],
      ['X', 2, 'third-or-fifth'],
      ['Y', 2, 'third-or-fifth'],
      ['P', 2],
      ['Q', 2],
      ['R', 2],
    );
    const r = run(fleet, 'source', 'exact');
    // 3番艦・5番艦に X/Y が入る 2 通り × 残り3隻の並び 3! = 12 通り
    expect(r).toHaveLength(12);
    for (const c of r) {
      expect(c.assign[0]).toBe(0);
      expect([c.assign[2], c.assign[4]].sort()).toEqual([1, 2]);
    }
  });

  it('艦数が足りないと指定位置が落ちる', () => {
    expect(allowedPositions('third-or-fifth', 6)).toEqual([false, false, true, false, true, false]);
    expect(allowedPositions('third-or-fifth', 4)).toEqual([false, false, true, false]);
    expect(allowedPositions('any', 3)).toEqual([true, true, true]);
  });

  it('1〜7番艦の固定指定がそれぞれ1箇所だけを許す', () => {
    const fixed: PosConstraint[] = ['flagship', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh'];
    fixed.forEach((c, i) => {
      const mask = allowedPositions(c, 7);
      expect(mask.filter(Boolean)).toHaveLength(1);
      expect(mask[i]).toBe(true);
    });
    // 隻数を超える指定は置ける位置が無くなる
    expect(allowedPositions('seventh', 6).some(Boolean)).toBe(false);
    expect(allowedPositions('sixth', 6).some(Boolean)).toBe(true);
  });

  it('隻数で選べる指定が変わる', () => {
    // タッチ(2 or 3番艦 / 3 or 5番艦)は6隻編成から
    for (const c of ['second-or-third', 'third-or-fifth'] as PosConstraint[]) {
      expect(isConstraintAvailable(c, 5)).toBe(false);
      expect(isConstraintAvailable(c, 6)).toBe(true);
    }
    // 警戒陣は4隻から
    expect(isConstraintAvailable('vanguard-front', 3)).toBe(false);
    expect(isConstraintAvailable('vanguard-front', 4)).toBe(true);
    // 番艦の固定は隻数まで
    expect(isConstraintAvailable('seventh', 6)).toBe(false);
    expect(isConstraintAvailable('seventh', 7)).toBe(true);
    expect(isConstraintAvailable('any', 2)).toBe(true);
  });

  it('中間位置の固定でも候補が正しく絞られる', () => {
    const fleet = ships(['A', 2], ['B', 2, 'fourth'], ['C', 2], ['D', 2]);
    const r = run(fleet, 'source', 'exact');
    expect(r).toHaveLength(6); // B が4番艦に固定、残り3隻で 3! = 6
    for (const c of r) expect(c.assign[3]).toBe(1);
  });

  it('警戒陣の区切りが隻数で変わる', () => {
    const f = (n: number) => allowedPositions('vanguard-front', n);
    const r = (n: number) => allowedPositions('vanguard-rear', n);
    // 5隻: 1〜2番艦 / 3〜5番艦
    expect(f(5)).toEqual([true, true, false, false, false]);
    expect(r(5)).toEqual([false, false, true, true, true]);
    // 6隻: 1〜3番艦 / 4〜6番艦
    expect(f(6)).toEqual([true, true, true, false, false, false]);
    expect(r(6)).toEqual([false, false, false, true, true, true]);
    // 7隻: 1〜3番艦 / 4〜7番艦
    expect(f(7)).toEqual([true, true, true, false, false, false, false]);
    expect(r(7)).toEqual([false, false, false, true, true, true, true]);
    // 4隻: 1〜2番艦 / 3〜4番艦
    expect(f(4)).toEqual([true, true, false, false]);
    expect(r(4)).toEqual([false, false, true, true]);
    // 区切りは floor(隻数 / 2)
    expect([4, 5, 6, 7].map(vanguardSplit)).toEqual([2, 2, 3, 3]);
    // 3隻以下は警戒陣を組めない
    expect(vanguardSplit(3)).toBeNull();
    expect(f(3)).toEqual([false, false, false]);
  });

  it('警戒陣の指定で候補が絞られる', () => {
    const fleet = ships(
      ['A', 2, 'vanguard-rear'],
      ['B', 2],
      ['C', 2],
      ['D', 2],
      ['E', 2],
      ['F', 2, 'vanguard-front'],
    );
    const r = run(fleet, 'source', 'exact');
    // A は 4〜6番艦、F は 1〜3番艦。残り4隻は自由 → 3 * 3 * 4! = 216 通り
    expect(r).toHaveLength(216);
    for (const c of r) {
      expect(c.assign.indexOf(0)).toBeGreaterThanOrEqual(3);
      expect(c.assign.indexOf(5)).toBeLessThan(3);
    }
  });

  it('「2 or 3番艦」「3 or 5番艦」は2隻ちょうどでないと警告対象', () => {
    const two = ships(['A', 2, 'third-or-fifth'], ['B', 2, 'third-or-fifth'], ['C', 2]);
    expect(findPairConstraintIssues(two)).toEqual([]);
    expect(findPairConstraintIssues(ships(['A', 2], ['B', 2]))).toEqual([]);

    const one = ships(['A', 2, 'third-or-fifth'], ['B', 2], ['C', 2]);
    expect(findPairConstraintIssues(one)).toEqual([{ constraint: 'third-or-fifth', count: 1 }]);

    const three = ships(['A', 2, 'second-or-third'], ['B', 2, 'second-or-third'], ['C', 2, 'second-or-third']);
    expect(findPairConstraintIssues(three)).toEqual([{ constraint: 'second-or-third', count: 3 }]);

    const both = ships(['A', 2, 'second-or-third'], ['B', 2, 'third-or-fifth'], ['C', 2]);
    expect(findPairConstraintIssues(both)).toEqual([
      { constraint: 'second-or-third', count: 1 },
      { constraint: 'third-or-fifth', count: 1 },
    ]);
  });

  it('4隻未満で警戒陣を指定すると候補が 0 件になる', () => {
    const fleet = ships(['A', 2, 'vanguard-front'], ['B', 2], ['C', 2]);
    expect(run(fleet, 'source', 'exact')).toHaveLength(0);
    // 4隻なら成立する
    const four = ships(['A', 2, 'vanguard-front'], ['B', 2], ['C', 2], ['D', 2]);
    const r = run(four, 'source', 'exact');
    expect(r).toHaveLength(12); // A は1〜2番艦 → 2通り × 残り3隻 3! = 12
    for (const c of r) expect(c.assign.indexOf(0)).toBeLessThan(2);
  });

  it('部分点は各艦の希望位置到達確率の平均に一致する', () => {
    const fleet = ships(['A', 2], ['B', 2], ['C', 2]);
    for (const c of run(fleet, 'source', 'partial')) {
      const avg = c.hit.reduce((a, b) => a + b, 0) / c.hit.length;
      expect(c.partial).toBeCloseTo(avg, 12);
    }
  });
});

describe('砲撃に参加しない艦', () => {
  it('行動順リストに載らず、後続の砲撃順が繰り上がる', () => {
    // B は不参加。残る A(長) C(中) D(中) の3隻で砲撃順が決まる
    const fleet = ships(['A', 3], ['B', 2, 'any', 'normal', false], ['C', 2], ['D', 2]);
    const r = run(fleet, 'source', 'exact');
    for (const c of r) {
      expect(c.hit[1]).toBe(0); // 不参加艦は評価に入らない
      expect(c.slotOf[1]).toBe(-1);
      expect(c.hit[0]).toBeCloseTo(1, 10); // A は射程が長いので必ず1番目
    }
    // 不参加艦を編成から外した3隻編成と、取りうる確率が一致する
    const without = run(ships(['A', 3], ['C', 2], ['D', 2]), 'source', 'exact');
    const values = (cs: typeof r) => [...new Set(cs.map((c) => c.exact.toFixed(10)))].sort();
    expect(values(r)).toEqual(values(without));
  });

  it('不参加艦がいても配置は総当たりする(艦隊の枠は占める)', () => {
    const fleet = ships(['A', 2], ['B', 2, 'any', 'normal', false], ['C', 2]);
    expect(run(fleet, 'source', 'exact')).toHaveLength(6);
  });

  it('不参加艦は順不同グループからも外れる', () => {
    const fleet = ships(['A', 3], ['B', 2], ['C', 2, 'any', 'normal', false], ['D', 2]);
    // 希望順 2-4番目(B/C/D)を束ねても、評価対象は B と D の2隻
    const groups = groupsOf(fleet, [false, true, true]);
    expect(attackerGroups(fleet, groups)).toEqual([[0], [1, 3]]);
    const r = search(fleet, groups, 'source', 'even');
    expect(r[0].groups?.matrix[1]).not.toBeNull();
    expect(r[0].even).toBeGreaterThan(0);
  });

  it('全艦が不参加なら評価は退化する', () => {
    const fleet = ships(['A', 2, 'any', 'normal', false], ['B', 2, 'any', 'normal', false]);
    for (const c of run(fleet, 'source', 'exact')) {
      expect(c.exact).toBe(1);
      expect(c.partial).toBe(1);
      expect(c.hit).toEqual([0, 0]);
    }
  });

  it('射程矛盾の判定でも不参加艦は無視する', () => {
    // 不参加の B は射程が長いが、砲撃順に関係しないので矛盾ではない
    const fleet = ships(['A', 2], ['B', 4, 'any', 'normal', false], ['C', 2]);
    expect(findRangeConflicts(fleet, groupsOf(fleet))).toEqual([]);
  });
});

describe('優先度', () => {
  // 中3隻が同射程。希望順は A(超長) B(中) C(中) D(中) E(短)
  const fleet = (...priorities: Priority[]) =>
    ships(
      ['A', 4, 'any', priorities[0]],
      ['B', 2, 'any', priorities[1]],
      ['C', 2, 'any', priorities[2]],
      ['D', 2, 'any', priorities[3]],
      ['E', 1, 'any', priorities[4]],
    );

  it('2番目を最優先にすると、その艦が2番目に撃つ確率が最大の並びが先頭に来る', () => {
    const f = fleet('normal', 'top', 'normal', 'normal', 'normal');
    const r = run(f, 'source', 'priority');
    const best = Math.max(...r.map((c) => c.hit[1]));
    expect(r[0].hit[1]).toBeCloseTo(best, 12);
    // 完全一致確率で並べたときの先頭より、B の実現確率は高い(か同じ)
    const byExact = run(f, 'source', 'exact');
    expect(r[0].hit[1]).toBeGreaterThanOrEqual(byExact[0].hit[1]);
  });

  it('優先度は辞書式: 最優先が同率のときだけ次の層で決まる', () => {
    const f = fleet('normal', 'top', 'high', 'normal', 'normal');
    const r = run(f, 'source', 'priority');
    const top = r[0].hit[1];
    const tiedHead = r.filter((c) => Math.abs(c.hit[1] - top) < 1e-12);
    const bestSecond = Math.max(...tiedHead.map((c) => c.hit[2]));
    expect(r[0].hit[2]).toBeCloseTo(bestSecond, 12);
    // 最優先層の確率は必ず単調に落ちていく
    for (let i = 1; i < r.length; i++) expect(r[i].hit[1]).toBeLessThanOrEqual(r[i - 1].hit[1] + 1e-12);
  });

  it('全艦が標準なら層が1つになり、一致率で並ぶ', () => {
    const f = fleet('normal', 'normal', 'normal', 'normal', 'normal');
    expect(hasPriority(f)).toBe(false);
    const r = run(f, 'source', 'priority');
    for (const c of r) {
      expect(c.tiers).toHaveLength(1);
      expect(c.tiers[0]).toBeCloseTo(c.partial, 12);
    }
    // 層が1つのときは層の比較を飛ばすので、完全一致ソートと同じ並びになる
    expect(r.map((c) => c.assign.join(''))).toEqual(run(f, 'source', 'exact').map((c) => c.assign.join('')));
  });

  it('順不同グループの優先度はグループ内で1つに揃う(最も高いものを採用)', () => {
    const f = fleet('normal', 'normal', 'top', 'low', 'normal');
    // 希望順 2-4番目(B/C/D)を1グループにする
    const groups = groupsOf(f, [false, true, true, false]);
    syncGroupPriorities(f, groups);
    expect(f.map((s) => s.priority)).toEqual(['normal', 'top', 'top', 'top', 'normal']);
    // グループ外は影響を受けない
    const g2 = ships(['A', 2, 'any', 'low'], ['B', 2, 'any', 'high']);
    syncGroupPriorities(g2, groupsOf(g2, [false]));
    expect(g2.map((s) => s.priority)).toEqual(['low', 'high']);
  });

  it('順不同グループの優先度を上げると、そのグループの均等度が最優先になる', () => {
    // 6隻すべて同射程。3-5番目をグループにして最優先にする
    const fleet = ships(
      ['A', 2],
      ['B', 2, 'any', 'top'],
      ['C', 2, 'any', 'top'],
      ['D', 2, 'any', 'top'],
      ['E', 2],
      ['F', 2],
    );
    const merged = [false, true, true, false, false];
    const r = run(fleet, 'source', 'priority', merged);
    const best = r[0];
    // 層のスコア = 順位帯を占める度合い × 均等度 が最大
    const score = (c: (typeof r)[number]) => {
      const meanHit = (c.hit[1] + c.hit[2] + c.hit[3]) / 3;
      return meanHit * (c.groups?.evenPerGroup[1] ?? 1);
    };
    expect(score(best)).toBeCloseTo(Math.max(...r.map(score)), 12);
    // 一致率だけで並べた場合より均等度が高い
    const byExact = run(fleet, 'source', 'exact', merged);
    expect(best.even).toBeGreaterThan(byExact[0].even);
  });

  it('低優先の艦はタイブレークにしか使われない', () => {
    const f = fleet('normal', 'top', 'low', 'low', 'normal');
    const r = run(f, 'source', 'priority');
    // 層は 最優先 / 標準 / 低 の3つ
    expect(r[0].tiers).toHaveLength(3);
    expect(r[0].hit[1]).toBeCloseTo(Math.max(...r.map((c) => c.hit[1])), 12);
  });
});

describe('順不同グループ', () => {
  it('groupsFromMerged が連続した行を束ねる', () => {
    expect(groupsFromMerged([false, false, false], 4)).toEqual([[0], [1], [2], [3]]);
    expect(groupsFromMerged([true, true, true], 4)).toEqual([[0, 1, 2, 3]]);
    expect(groupsFromMerged([false, true, false], 4)).toEqual([[0], [1, 2], [3]]);
  });

  it('mergedFromGroups が groupsFromMerged の逆になる', () => {
    // UI はグループごと並べ替えるので、動かしたあとに区切りを組み直せる必要がある
    for (const merged of [
      [false, false, false],
      [true, true, true],
      [false, true, false],
      [true, false, true],
    ]) {
      expect(mergedFromGroups(groupsFromMerged(merged, 4))).toEqual(merged);
    }
    // グループの並べ替えは区切りも一緒に動かす
    expect(mergedFromGroups([[2, 3], [0], [1]])).toEqual([true, false, false]);
  });

  it('均等度の定義: 完全に均等なら 1、順番が固定なら 0', () => {
    expect(evennessOf([[1 / 3, 1 / 3, 1 / 3], [1 / 3, 1 / 3, 1 / 3], [1 / 3, 1 / 3, 1 / 3]])).toBeCloseTo(1, 12);
    expect(evennessOf([[1, 0, 0], [0, 1, 0], [0, 0, 1]])).toBeCloseTo(0, 12);
    expect(evennessOf([[1]])).toBe(1);
  });

  it('グループが無ければ従来の評価と完全に一致する', () => {
    const fleet = ships(['A', 4], ['B', 2], ['C', 2], ['D', 2], ['E', 1]);
    const plain = run(fleet, 'source', 'exact');
    // 「全艦を1グループずつ」に明示しても同じ結果になる
    const same = run(fleet, 'source', 'exact', [false, false, false, false]);
    expect(same.map((c) => [c.assign.join(''), c.exact, c.partial])).toEqual(
      plain.map((c) => [c.assign.join(''), c.exact, c.partial]),
    );
    for (const c of plain) expect(c.even).toBe(1);
  });

  it('同射程3隻を束ねると、順序ではなく均等さで評価される', () => {
    const fleet = ships(['A', 4], ['B', 2], ['C', 2], ['D', 2], ['E', 1]);
    const r = run(fleet, 'source', 'even', [false, true, true, false]);
    // グループの順位帯は必ず埋まるので、一致率は 100%
    for (const c of r) expect(c.exact).toBeCloseTo(1, 10);
    // 並び順(グループが入る位置)によって均等度に差が出る
    expect(r[0].even).toBeGreaterThan(r[r.length - 1].even);
    // 条件付き分布は二重確率行列になる
    const m = r[0].groups!.matrix[1]!;
    const rows = [1, 2, 3].map((rank) => m[r[0].assign.indexOf(rank)]);
    for (const row of rows) expect(row.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 10);
    for (let j = 0; j < 3; j++) expect(rows.reduce((a, row) => a + row[j], 0)).toBeCloseTo(1, 10);
  });

  it('グループの位置集合が固定されると均等度は変えられない', () => {
    // 中3隻を警戒側(4〜6番艦)に固定 → 3隻の位置集合が動かない
    const fleet = ships(
      ['A', 4],
      ['B', 2, 'vanguard-rear'],
      ['C', 2, 'vanguard-rear'],
      ['D', 2, 'vanguard-rear'],
      ['E', 3],
      ['F', 1],
    );
    const r = run(fleet, 'source', 'even', [false, true, true, false, false]);
    expect(r.length).toBeGreaterThan(1);
    const evens = new Set(r.map((c) => c.even.toFixed(12)));
    expect(evens.size).toBe(1);
  });

  it('グループ内は順序を問わないので射程矛盾に数えない', () => {
    const fleet = ships(['A', 1], ['B', 4]);
    expect(findRangeConflicts(fleet, groupsOf(fleet, [true]))).toEqual([]);
    expect(findMixedRangeGroups(fleet, groupsOf(fleet, [true]))).toEqual([0]);
    // 射程が揃っていれば注意は出ない
    const same = ships(['A', 2], ['B', 2]);
    expect(findMixedRangeGroups(same, groupsOf(same, [true]))).toEqual([]);
  });

  it('グループ間の射程矛盾は検出する', () => {
    const fleet = ships(['A', 2], ['B', 2], ['C', 4]);
    expect(findRangeConflicts(fleet, groupsOf(fleet, [true, false]))).toEqual([{ before: 0, after: 2 }]);
  });
});

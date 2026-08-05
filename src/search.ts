import { distFor, orderEntries, permutations, type RangeDist, type TieMode } from './distribution';

/** 配置を縛る指定。flagship〜third-or-fifth は特殊砲撃用、vanguard-* は警戒陣の主力/警戒 */
export type PosConstraint =
  | 'any'
  | 'flagship'
  | 'second'
  | 'third'
  | 'fourth'
  | 'fifth'
  | 'sixth'
  | 'seventh'
  | 'second-or-third'
  | 'third-or-fifth'
  | 'vanguard-front'
  | 'vanguard-rear';

export const CONSTRAINTS: PosConstraint[] = [
  'any',
  'flagship',
  'second',
  'third',
  'fourth',
  'fifth',
  'sixth',
  'seventh',
  'second-or-third',
  'third-or-fifth',
  'vanguard-front',
  'vanguard-rear',
];

/** 艦数によらず固定の指定。許可される配置(0 始まり)、null は指定なし */
const FIXED_ALLOWED: Partial<Record<PosConstraint, number[] | null>> = {
  any: null,
  flagship: [0],
  second: [1],
  third: [2],
  fourth: [3],
  fifth: [4],
  sixth: [5],
  seventh: [6],
  'second-or-third': [1, 2],
  'third-or-fifth': [2, 4],
};

/** 警戒陣で主力側になる隻数 = floor(隻数 / 2)。4隻未満は組めないので null */
export function vanguardSplit(n: number): number | null {
  return n >= 4 ? Math.floor(n / 2) : null;
}

function isVanguard(c: PosConstraint): boolean {
  return c === 'vanguard-front' || c === 'vanguard-rear';
}

/** 希望順を守る優先度。高い順に辞書式で効かせる */
export type Priority = 'top' | 'high' | 'normal' | 'low';

export const PRIORITIES: Priority[] = ['top', 'high', 'normal', 'low'];

const PRIORITY_LEVEL: Record<Priority, number> = { top: 3, high: 2, normal: 1, low: 0 };

export function hasPriority(ships: readonly Ship[]): boolean {
  return ships.some((s) => s.shells && s.priority !== 'normal');
}

/** 順不同グループの優先度は1つ。束ねたときに設定が消えないよう最も高い値に揃える */
export function syncGroupPriorities(ships: Ship[], groups: readonly number[][]): void {
  for (const g of groups) {
    if (g.length < 2) continue;
    const best = g.reduce((a, r) => (PRIORITY_LEVEL[ships[r].priority] > PRIORITY_LEVEL[ships[a].priority] ? r : a), g[0]);
    for (const r of g) ships[r].priority = ships[best].priority;
  }
}

export interface Ship {
  name: string;
  /** 1=短 2=中 3=長 4=超長 5=超長+ */
  range: number;
  constraint: PosConstraint;
  priority: Priority;
  /**
   * 行動順リストに載るか(仕様書4章の canShell)。false = 潜水艦・攻撃機なしの空母。
   * 中破空母のように「載るが撃たない」ケースは順番が変わらないので区別しない。
   */
  shells: boolean;
}

/** 希望順のグループから、砲撃に参加する艦だけを残したもの */
export function attackerGroups(ships: readonly Ship[], groups: readonly number[][]): number[][] {
  return groups.map((g) => g.filter((r) => ships[r].shells)).filter((g) => g.length > 0);
}

export interface Candidate {
  /** assign[position] = ships の添字。position 0 が1番艦 */
  assign: number[];
  /** 全グループが希望どおりの順位帯を占める確率(全グループ1隻なら従来の完全一致確率) */
  exact: number;
  /** 各艦が自分のグループの順位帯に入る確率の平均 */
  partial: number;
  /** 均等度。2隻以上のグループが無ければ 1 */
  even: number;
  /** hit[shipIndex] = その艦が自分のグループの順位帯に入る確率。砲撃しない艦は 0 */
  hit: number[];
  /** slotOf[shipIndex] = 行動順リスト内の位置。砲撃しない艦は -1 */
  slotOf: number[];
  /** グループごとの内訳(2隻以上のグループのみ。無い場合は null) */
  groups: GroupStats | null;
  /** tiers[i] = i 番目に優先度が高い層のスコア(辞書式に比較)。中身は tierScore を参照 */
  tiers: number[];
}

export type SortKey = 'exact' | 'partial' | 'even' | 'priority';

/** 順不同グループの評価。射程の並びとグループの位置割りだけで決まるのでキャッシュできる。 */
export interface GroupStats {
  /** 全グループが順位帯を占める確率 */
  allMatch: number;
  /** 隻数で重み付けした均等度(2隻以上のグループのみ) */
  even: number;
  /** evenPerGroup[gi] = そのグループの均等度。1隻のグループは 1 */
  evenPerGroup: number[];
  /** matrix[gi][行動順リスト内の位置][グループ内順位] = 順位帯を占めたときの条件付き確率 */
  matrix: Array<number[][] | null>;
}

/** merged[i] が true なら希望順 i 番目と i+1 番目が同じグループ */
export function groupsFromMerged(merged: readonly boolean[], n: number): number[][] {
  const groups: number[][] = [];
  let cur: number[] = [];
  for (let i = 0; i < n; i++) {
    cur.push(i);
    if (i === n - 1 || !merged[i]) {
      groups.push(cur);
      cur = [];
    }
  }
  return groups;
}

export function hasOrderFreeGroup(groups: readonly number[][]): boolean {
  return groups.some((g) => g.length >= 2);
}

/** 均等度。行=艦・列=グループ内順位 の二重確率行列が、一様なら 1・順番固定なら 0 */
export function evennessOf(rows: readonly number[][]): number {
  const k = rows.length;
  if (k < 2) return 1;
  const ideal = 1 / k;
  let d = 0;
  for (const row of rows) for (const v of row) d += Math.abs(v - ideal);
  return Math.max(0, 1 - d / (2 * (k - 1)));
}

/**
 * ships は「希望する砲撃順」で並んでいる前提(ships[0] が最初に撃ってほしい艦)。
 * 全並び順(6隻なら 720 通り、遊撃部隊7隻なら 5040 通り)を総当たりして評価する。
 */
export function search(
  ships: readonly Ship[],
  groups: readonly number[][],
  mode: TieMode,
  sortKey: SortKey,
): Candidate[] {
  const n = ships.length;
  if (n === 0) return [];

  const allowed = ships.map((s) => allowedPositions(s.constraint, n));
  const evaluate = makeEvaluator(ships, groups, mode);

  const out: Candidate[] = [];
  for (const assign of permutations(n)) {
    let ok = true;
    for (let pos = 0; pos < n && ok; pos++) ok = allowed[assign[pos]][pos];
    if (ok) out.push(evaluate(assign));
  }
  out.sort(comparator(sortKey));
  return out;
}

/**
 * 1つの並び順を評価する関数を作る。前計算とキャッシュを閉じ込めてあるので、
 * 同じ編成なら作った関数を使い回すこと。位置指定は見ないので任意の並びを渡せる。
 */
export function makeEvaluator(
  ships: readonly Ship[],
  groups: readonly number[][],
  mode: TieMode,
): (assign: readonly number[]) => Candidate {
  const n = ships.length;

  // 評価対象は砲撃に参加する艦だけ。行動順リストもこの艦だけで組む
  const shooters: number[] = [];
  for (let i = 0; i < n; i++) if (ships[i].shells) shooters.push(i);
  const m = shooters.length;
  const rankOf = new Array<number>(n).fill(-1); // ships の添字 -> 砲撃に参加する艦の中での希望順
  shooters.forEach((s, r) => (rankOf[s] = r));

  const evalGroups = attackerGroups(ships, groups);
  const grouped = hasOrderFreeGroup(evalGroups);

  // rank -> そのグループの順位帯 [from, to)
  const bandOf = new Array<[number, number]>(m);
  const groupIdOfRank = new Array<number>(m);
  evalGroups.forEach((g, gi) => {
    const from = rankOf[g[0]];
    const band: [number, number] = [from, from + g.length];
    for (const s of g) {
      bandOf[rankOf[s]] = band;
      groupIdOfRank[rankOf[s]] = gi;
    }
  });

  const statsCache = new Map<string, GroupStats>();
  const groupIdOfSlot = new Array<number>(m);
  const slotOf = new Array<number>(n); // ships の添字 -> 行動順リスト内の位置
  const ranges = new Array<number>(m);

  // 優先度の層は「艦」ではなく「グループ」単位。優先度はメンバー共通なので先頭の値を代表にする
  const unitLevel = evalGroups.map((g) => PRIORITY_LEVEL[ships[g[0]].priority]);
  const levels = [...new Set(unitLevel)].sort((a, b) => b - a);
  const tierUnits = levels.map((lv) => evalGroups.map((_, gi) => gi).filter((gi) => unitLevel[gi] === lv));

  /** 層のスコア。1隻なら希望位置に来る確率、順不同グループなら「順位帯を占める度合い × 均等度」 */
  const tierScore = (hit: number[], stats: GroupStats | null): number[] =>
    tierUnits.map((gis) => {
      let total = 0;
      for (const gi of gis) {
        const g = evalGroups[gi];
        const meanHit = g.reduce((a, s) => a + hit[s], 0) / g.length;
        total += g.length >= 2 ? meanHit * (stats ? stats.evenPerGroup[gi] : 1) : meanHit;
      }
      return total / gis.length;
    });

  return (assign) => {
    const hit = new Array<number>(n).fill(0);
    if (m === 0) {
      // 誰も撃たないなら評価しようが無いので、すべて同点として返す
      const none = new Array<number>(n).fill(-1);
      return { assign: [...assign], exact: 1, partial: 1, even: 1, hit, groups: null, tiers: [1], slotOf: none };
    }

    // 砲撃しない艦を飛ばして行動順リストを組む(飛ばした分は後続が繰り上がる)
    let slot = 0;
    for (let pos = 0; pos < n; pos++) {
      const s = assign[pos];
      if (!ships[s].shells) {
        slotOf[s] = -1;
        continue;
      }
      slotOf[s] = slot;
      ranges[slot] = ships[s].range;
      slot++;
    }
    const dist = distFor(ranges, mode);

    // 各艦が自分のグループの順位帯に入る確率
    let sum = 0;
    for (const s of shooters) {
      const [from, to] = bandOf[rankOf[s]];
      let p = 0;
      for (let rank = from; rank < to; rank++) p += dist.marginal[slotOf[s]][rank];
      hit[s] = p;
      sum += p;
    }

    let stats: GroupStats | null = null;
    let exact: number;
    if (grouped) {
      // グループがあると順位帯の占有を数える必要がある。結果は射程列とグループ割りだけで決まる
      for (const s of shooters) groupIdOfSlot[slotOf[s]] = groupIdOfRank[rankOf[s]];
      const key = ranges.join(',') + '|' + groupIdOfSlot.join(',');
      stats = statsCache.get(key) ?? null;
      if (!stats) {
        stats = computeGroupStats(dist, evalGroups, groupIdOfRank, groupIdOfSlot, m);
        statsCache.set(key, stats);
      }
      exact = stats.allMatch;
    } else {
      // 全グループ1隻なら、順位列そのものの確率を引くだけで済む
      exact = dist.orders.get(shooters.map((s) => slotOf[s]).join(',')) ?? 0;
    }

    return {
      assign: [...assign],
      exact,
      partial: sum / m,
      even: stats ? stats.even : 1,
      hit,
      groups: stats,
      tiers: tierScore(hit, stats),
      slotOf: slotOf.slice(),
    };
  };
}

/** 確率どうしの比較に使う許容誤差 */
const EPS = 1e-12;

/** 1位と全指標が同点の候補数。「どれを選んでも同じ」ことを示すために使う */
export function countBestTies(results: readonly Candidate[]): number {
  const best = results[0];
  if (!best) return 0;
  const same = (x: number, y: number): boolean => Math.abs(x - y) < EPS;
  return results.filter(
    (c) =>
      c.tiers.every((v, i) => same(v, best.tiers[i])) &&
      same(c.exact, best.exact) &&
      same(c.even, best.even) &&
      same(c.partial, best.partial),
  ).length;
}

/** 指定した基準を先頭に、残りの指標を決まった順で見る比較関数 */
function comparator(sortKey: SortKey): (a: Candidate, b: Candidate) => number {
  const value = (c: Candidate, k: SortKey): number => (k === 'exact' ? c.exact : k === 'partial' ? c.partial : c.even);
  const after: Record<Exclude<SortKey, 'priority'>, SortKey[]> = {
    exact: ['exact', 'even', 'partial'],
    even: ['even', 'exact', 'partial'],
    partial: ['partial', 'exact', 'even'],
  };
  const order = sortKey === 'priority' ? after.exact : after[sortKey];

  return (a, b) => {
    // 優先度の高い層から順に見て、先に差がついたところで決める(層が1つなら比較の意味が無い)
    if (sortKey === 'priority' && a.tiers.length > 1) {
      for (let t = 0; t < a.tiers.length; t++) {
        const d = b.tiers[t] - a.tiers[t];
        if (Math.abs(d) > EPS) return d;
      }
    }
    for (const k of order) {
      const d = value(b, k) - value(a, k);
      if (Math.abs(d) > EPS) return d;
    }
    // 完全に同点なら、希望順に近い並びを先に出して表示を安定させる
    return compareArrays(a.assign, b.assign);
  };
}

/** 行動順を全部走査し、グループが順位帯を占めた確率と、占めたときの条件付き分布を作る */
function computeGroupStats(
  dist: RangeDist,
  groups: readonly number[][],
  groupIdOfRank: readonly number[],
  groupIdOfSlot: readonly number[],
  m: number,
): GroupStats {
  // 各グループの順位帯の先頭(rank 空間)。groups は希望順に並んでいる
  const bandStart: number[] = [];
  let acc = 0;
  for (const g of groups) {
    bandStart.push(acc);
    acc += g.length;
  }

  const matrix: Array<number[][] | null> = groups.map((g) =>
    g.length >= 2 ? Array.from({ length: m }, () => new Array<number>(g.length).fill(0)) : null,
  );
  const bandProb = new Array<number>(groups.length).fill(0);
  const holds = new Array<boolean>(groups.length);
  let allMatch = 0;

  for (const { order, p } of orderEntries(dist)) {
    holds.fill(true);
    for (let rank = 0; rank < m; rank++) {
      if (groupIdOfSlot[order[rank]] !== groupIdOfRank[rank]) holds[groupIdOfRank[rank]] = false;
    }
    let all = true;
    for (let gi = 0; gi < groups.length; gi++) {
      if (!holds[gi]) {
        all = false;
        continue;
      }
      bandProb[gi] += p;
      const mat = matrix[gi];
      if (!mat) continue;
      const from = bandStart[gi];
      for (let j = 0; j < groups[gi].length; j++) mat[order[from + j]][j] += p;
    }
    if (all) allMatch += p;
  }

  const evenPerGroup = groups.map((_, gi) => {
    const mat = matrix[gi];
    if (!mat) return 1;
    if (bandProb[gi] <= 0) return 0; // 順位帯を占めることが有り得ない = 均等以前の問題
    // 条件付き確率に正規化する(表示側でもこの値をそのまま使う)
    const rows: number[][] = [];
    for (let slot = 0; slot < m; slot++) {
      if (groupIdOfSlot[slot] !== gi) continue;
      mat[slot] = mat[slot].map((v) => v / bandProb[gi]);
      rows.push(mat[slot]);
    }
    return evennessOf(rows);
  });

  let weighted = 0;
  let weight = 0;
  groups.forEach((g, gi) => {
    if (g.length < 2) return;
    weighted += evenPerGroup[gi] * g.length;
    weight += g.length;
  });

  return { allMatch, even: weight ? weighted / weight : 1, evenPerGroup, matrix };
}

/** 艦数 n の艦隊で、その指定が許す配置。allowedPositions()[pos] が true なら置ける。 */
export function allowedPositions(constraint: PosConstraint, n: number): boolean[] {
  if (isVanguard(constraint)) {
    const split = vanguardSplit(n);
    // 4隻未満では警戒陣を組めないので、置ける位置が無い
    if (split === null) return new Array<boolean>(n).fill(false);
    return Array.from({ length: n }, (_, p) => (constraint === 'vanguard-front' ? p < split : p >= split));
  }
  const list = FIXED_ALLOWED[constraint] ?? null;
  if (list === null) return new Array<boolean>(n).fill(true);
  const mask = new Array<boolean>(n).fill(false);
  for (const p of list) if (p < n) mask[p] = true;
  return mask;
}

/** 希望順が射程の降順と矛盾していないか(グループ内は順不同なので隣接グループ間だけ見る) */
export function findRangeConflicts(
  ships: readonly Ship[],
  groups: readonly number[][],
): Array<{ before: number; after: number }> {
  const conflicts: Array<{ before: number; after: number }> = [];
  const shooting = attackerGroups(ships, groups);
  for (let gi = 1; gi < shooting.length; gi++) {
    const prev = shooting[gi - 1].reduce((a, r) => (ships[r].range < ships[a].range ? r : a));
    const next = shooting[gi].reduce((a, r) => (ships[r].range > ships[a].range ? r : a));
    if (ships[prev].range < ships[next].range) conflicts.push({ before: prev, after: next });
  }
  return conflicts;
}

/** 2つの枠を2隻で埋める指定。ちょうど2隻に設定しないと特殊砲撃が成立しない */
export const PAIR_CONSTRAINTS: PosConstraint[] = ['second-or-third', 'third-or-fifth'];

/**
 * その隻数で選べる指定か。
 * コロラドタッチ・ネルソンタッチは6隻編成が前提なので、5隻以下では選ばせない。
 */
export function isConstraintAvailable(c: PosConstraint, n: number): boolean {
  if (PAIR_CONSTRAINTS.includes(c)) return n >= 6;
  return allowedPositions(c, n).some(Boolean);
}

/** 「2 or 3番艦」「3 or 5番艦」が2隻ちょうどになっていない指定を返す。 */
export function findPairConstraintIssues(
  ships: readonly Ship[],
): Array<{ constraint: PosConstraint; count: number }> {
  return PAIR_CONSTRAINTS.map((c) => ({
    constraint: c,
    count: ships.filter((s) => s.constraint === c).length,
  })).filter((x) => x.count > 0 && x.count !== 2);
}

/** 射程が揃っていない順不同グループ。均等にはできないので注意を出す。 */
export function findMixedRangeGroups(ships: readonly Ship[], groups: readonly number[][]): number[] {
  return attackerGroups(ships, groups)
    .map((g, gi) => (g.length >= 2 && g.some((r) => ships[r].range !== ships[g[0]].range) ? gi : -1))
    .filter((gi) => gi >= 0);
}

function compareArrays(a: number[], b: number[]): number {
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return a[i] - b[i];
  }
  return 0;
}

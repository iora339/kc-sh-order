import './style.css';
// HTML から直接 link すると別ファイルになるので、JS 経由で data URI として埋め込む
import faviconUrl from './favicon.svg';
import { distFor, type TieMode } from './distribution';
import {
  attackerGroups,
  CONSTRAINTS,
  countBestTies,
  isConstraintAvailable,
  findMixedRangeGroups,
  findPairConstraintIssues,
  findRangeConflicts,
  groupsFromMerged,
  hasOrderFreeGroup,
  hasPriority,
  makeEvaluator,
  PRIORITIES,
  search,
  syncGroupPriorities,
  vanguardSplit,
  type Candidate,
  type PosConstraint,
  type Priority,
  type Ship,
  type SortKey,
} from './search';

const RANGE_LABEL: Record<number, string> = { 1: '短', 2: '中', 3: '長', 4: '超長', 5: '超長+' };
/** 射程の選択肢はよく使う順に並べる */
const RANGE_ORDER = [4, 3, 2, 1, 5];

/** 位置指定の表示名。警戒陣の区切りは隻数で変わるので艦数から作る */
function constraintLabel(c: PosConstraint, n: number): string {
  const split = vanguardSplit(n);
  switch (c) {
    case 'any':
      return '自由';
    case 'flagship':
      return '1番艦';
    case 'second':
      return '2番艦';
    case 'third':
      return '3番艦';
    case 'fourth':
      return '4番艦';
    case 'fifth':
      return '5番艦';
    case 'sixth':
      return '6番艦';
    case 'seventh':
      return '7番艦';
    case 'second-or-third':
      return '2 or 3番艦';
    case 'third-or-fifth':
      return '3 or 5番艦';
    case 'vanguard-front':
      return split === null ? '警戒陣 主力(4隻〜)' : `主力1〜${split}番艦`;
    case 'vanguard-rear':
      return split === null ? '警戒陣 警戒(4隻〜)' : `警戒${split + 1}〜${n}番艦`;
  }
}
/** 通常艦隊6隻 + 遊撃部隊(艦隊司令部施設)の7隻 */
const MAX_SHIPS = 7;
const LIMIT_OPTIONS = [10, 20, 50, 100, 5040];
const STORAGE_KEY = 'kc-sh-order/state';

/** 同射程のタイブレークは移植元の zendQsort 再現に固定(比較用に 'uniform' も残してある) */
const TIE_MODE: TieMode = 'source';

/** 並べ替えは優先度の辞書式。優先度が全艦同じなら 一致率 → 均等度 → 部分点 で比較される */
const SORT_KEY: SortKey = 'priority';

interface State {
  ships: Ship[];
  /** merged[i] が true なら希望順 i 番目と i+1 番目が同じ順不同グループ(長さ ships.length - 1) */
  merged: boolean[];
  limit: number;
}

const PRIORITY_LABEL: Record<Priority, string> = {
  top: '最優先',
  high: '高',
  normal: '標準',
  low: '低',
};

/** 初期状態。大和型は主砲で超長まで伸びている想定 */
const DEFAULT_SHIPS: Ship[] = [
  { name: '大和', range: 4, constraint: 'flagship', priority: 'top', shells: true },
  { name: '武蔵', range: 4, constraint: 'second', priority: 'normal', shells: true },
  { name: '赤城', range: 2, constraint: 'any', priority: 'normal', shells: true },
  { name: '矢矧', range: 2, constraint: 'any', priority: 'normal', shells: true },
  { name: '吹雪', range: 1, constraint: 'any', priority: 'normal', shells: true },
  { name: '時雨', range: 1, constraint: 'any', priority: 'normal', shells: true },
];

const favicon = document.createElement('link');
favicon.rel = 'icon';
favicon.type = 'image/svg+xml';
favicon.href = faviconUrl;
document.head.append(favicon);

const state: State = loadState();
/** 確認モード: 入力欄を「艦隊の並び順」として読み、その砲撃順だけを出す */
let verify = false;
/** 確認モードでの並び順(state.ships の添字の順列)。null なら最良候補を読み込む */
let verifyOrder: number[] | null = null;
let results: Candidate[] = [];
/** 前回 search を回したときの入力の指紋。艦名は含めない */
let lastSig: string | null = null;
/** 表示中のページ(0 始まり)。1ページの件数は表示件数の設定 */
let page = 0;
let selected = 0;

const shipList = byId<HTMLDivElement>('ship-list');
const warnBox = byId<HTMLDivElement>('warn');
const summary = byId<HTMLDivElement>('summary');
const tbody = byId<HTMLTableElement>('result').tBodies[0];
const pager = byId<HTMLDivElement>('pager');
const detail = byId<HTMLDivElement>('detail');
const limitSel = byId<HTMLSelectElement>('limit');

byId<HTMLButtonElement>('add-ship').addEventListener('click', () => {
  if (state.ships.length >= MAX_SHIPS) return;
  // 末尾に追加されるので、射程は既定で最短にしておく(希望順は射程降順である必要がある)
  state.ships.push({ name: `艦${state.ships.length + 1}`, range: 1, constraint: 'any', priority: 'normal', shells: true });
  state.merged.push(false);
  // 確認モードの並びも末尾に足す。作り直すと組んだ並びが失われる
  verifyOrder?.push(state.ships.length - 1);
  refreshAll();
});

byId<HTMLButtonElement>('reset').addEventListener('click', () => {
  state.ships = DEFAULT_SHIPS.map((s) => ({ ...s }));
  state.merged = new Array<boolean>(state.ships.length - 1).fill(false);
  // 艦隊の並びも初期化する(次の描画で最良候補を読み込み直す)
  verifyOrder = null;
  refreshAll();
});

limitSel.value = String(state.limit);
limitSel.addEventListener('change', () => {
  state.limit = Number(limitSel.value);
  refreshResults();
});

const verifyBox = byId<HTMLInputElement>('verify');
// ブラウザがフォームの状態を復元することがあるので、読み込み時に必ず揃える
verifyBox.checked = verify;
verifyBox.addEventListener('change', () => {
  verify = verifyBox.checked;
  refreshAll();
});

refreshAll();

function refreshAll(): void {
  renderShips();
  refreshResults();
}

function refreshResults(): void {
  page = 0;
  selected = 0;
  renderResults();
  saveState();
}

/* ---- 希望の砲撃順(入力欄)の描画 --------------------------------------- */

function renderShips(): void {
  shipList.replaceChildren();
  renderModeLabels();

  const groups = groupsFromMerged(state.merged, state.ships.length);
  syncGroupPriorities(state.ships, groups);
  const groupOfRank = new Array<number[]>(state.ships.length);
  for (const g of groups) for (const rank of g) groupOfRank[rank] = g;

  // 確認モードでは「艦隊の並び順」で行を出す。希望順(state.ships の並び)は触らない
  const order = verify ? fleetOrder() : state.ships.map((_, i) => i);

  order.forEach((shipIdx, i) => {
    const ship = state.ships[shipIdx];
    if (i > 0 && !verify) shipList.append(divider(i - 1));

    const row = document.createElement('div');
    row.className = 'ship-row';
    const g = groupOfRank[shipIdx];
    if (!verify && g.length >= 2) {
      row.classList.add('grouped');
      if (shipIdx === g[0]) row.classList.add('group-head');
      if (shipIdx === g[g.length - 1]) row.classList.add('group-tail');
    }

    row.append(verify ? rankCell(i, [i]) : rankCell(i, g));
    row.addEventListener('pointerdown', (e) => onRowPointerDown(e, i, row));

    const name = document.createElement('input');
    name.type = 'text';
    name.value = ship.name;
    name.addEventListener('input', () => {
      ship.name = name.value;
      refreshResults();
    });
    row.append(name);

    row.append(
      selectEl(
        RANGE_ORDER.map((r) => [String(r), `${RANGE_LABEL[r]} (${r})`] as Option<string>),
        String(ship.range),
        (v) => {
          ship.range = Number(v);
          refreshResults();
        },
      ),
    );

    // 不参加(潜水艦・攻撃機を積んでいない空母)は行動順リストに載らず、後続が繰り上がる
    row.append(
      selectEl(
        [
          ['yes', '参加'],
          ['no', '不参加'],
        ] as const,
        ship.shells ? 'yes' : 'no',
        (v) => {
          ship.shells = v === 'yes';
          refreshAll();
        },
      ),
    );

    // 並びが確定している確認モードでは、位置指定と優先度は意味を持たない
    if (verify) {
      row.append(unusedCell(), unusedCell());
    } else {
      // その隻数で使えない指定(6隻での「7番艦」、3隻での警戒陣、5隻でのタッチ など)は出さない
      const n = state.ships.length;
      const usable = CONSTRAINTS.filter((c) => isConstraintAvailable(c, n));
      if (!usable.includes(ship.constraint)) ship.constraint = 'any';
      row.append(
        selectEl(
          usable.map((c) => [c, constraintLabel(c, n)] as Option<PosConstraint>),
          ship.constraint,
          (v) => {
            ship.constraint = v;
            refreshResults();
          },
        ),
        priorityCell(ship, shipIdx, g),
      );
    }

    row.append(
      iconButton('↑', i === 0, () => move(i, -1)),
      iconButton('↓', i === order.length - 1, () => move(i, 1)),
      iconButton('✕', state.ships.length <= 2, () => {
        state.ships.splice(shipIdx, 1);
        state.merged.splice(Math.max(0, shipIdx - 1), 1);
        // 確認モードの並びは添字がずれるだけなので詰め直す
        verifyOrder = verifyOrder?.filter((i) => i !== shipIdx).map((i) => (i > shipIdx ? i - 1 : i)) ?? null;
        refreshAll();
      }),
    );
    shipList.append(row);
  });

  byId<HTMLButtonElement>('add-ship').disabled = state.ships.length >= MAX_SHIPS;
}

/** 確認モードでの艦隊の並び順。初回は最良候補を読み込む */
function fleetOrder(): number[] {
  if (!verifyOrder || verifyOrder.length !== state.ships.length) {
    verifyOrder = results[0] ? [...results[0].assign] : state.ships.map((_, i) => i);
  }
  return verifyOrder;
}

/** そのモードでは使わない項目 */
function unusedCell(): HTMLElement {
  const el = document.createElement('div');
  el.className = 'ditto';
  el.textContent = '—';
  return el;
}

/** モードに応じて見出しと説明文を差し替える */
function renderModeLabels(): void {
  byId('order-title').textContent = verify ? '艦隊の並び順' : '希望の砲撃順';
  byId('wish-hints').hidden = verify;
  byId('verify-hint').hidden = !verify;
  const labels = verify
    ? ['並び順', '艦名メモ', '射程', '砲撃戦参加', '', '']
    : ['希望順', '艦名メモ', '射程', '砲撃戦参加', '位置指定', '優先度'];
  [...byId('ship-head').children].forEach((el, i) => (el.textContent = labels[i]));
}

/** 希望順の番号とドラッグハンドル。グループは先頭行にだけ「4-6.」と範囲を出す */
function rankCell(i: number, g: number[]): HTMLDivElement {
  const cell = document.createElement('div');
  cell.className = 'rank';

  const handle = document.createElement('span');
  handle.className = 'drag-handle';
  handle.textContent = '⠿';
  handle.title = '長押ししたまま動かすと並べ替えられます';

  const num = document.createElement('span');
  const isGroup = g.length >= 2;
  num.textContent = isGroup ? (i === g[0] ? `${g[0] + 1}-${g[g.length - 1] + 1}.` : '') : `${i + 1}.`;

  cell.append(handle, num);
  return cell;
}

/** 優先度はグループ単位。2隻目以降は先頭に従うので「〃」を出す */
function priorityCell(ship: Ship, i: number, g: number[]): HTMLElement {
  if (g.length >= 2 && i !== g[0]) {
    const ditto = document.createElement('div');
    ditto.className = 'ditto';
    ditto.textContent = '〃';
    ditto.title = 'グループの優先度に従う';
    return ditto;
  }
  const prio = selectEl(
    PRIORITIES.map((p) => [p, PRIORITY_LABEL[p]] as Option<Priority>),
    ship.priority,
    (v) => {
      for (const rank of g) state.ships[rank].priority = v;
      refreshAll();
    },
  );
  // 砲撃しない艦しかいないグループでは優先度が効かない
  prio.disabled = !g.some((rank) => state.ships[rank].shells);
  return prio;
}

/** 行と行の間の区切り。クリックで「順不同グループ」に束ねる */
function divider(gap: number): HTMLElement {
  const el = document.createElement('button');
  el.type = 'button';
  el.className = state.merged[gap] ? 'divider merged' : 'divider';
  el.title = state.merged[gap] ? 'グループを分ける' : '上下の艦を順不同グループにまとめる';
  const label = document.createElement('span');
  label.textContent = state.merged[gap] ? '順不同(均等に)' : 'まとめる';
  el.append(label);
  el.addEventListener('click', () => {
    state.merged[gap] = !state.merged[gap];
    refreshAll();
  });
  return el;
}

function move(i: number, d: number): void {
  const list: unknown[] = verify ? fleetOrder() : state.ships;
  const j = i + d;
  if (j < 0 || j >= list.length) return;
  [list[i], list[j]] = [list[j], list[i]];
  refreshAll();
}

/** ドラッグやボタンでの並べ替えを確定する。確認モードは艦隊の並びだけを動かす */
function moveTo(from: number, to: number): void {
  const list: unknown[] = verify ? fleetOrder() : state.ships;
  const [moved] = list.splice(from, 1);
  list.splice(to, 0, moved);
  refreshAll();
}

/* ---- 長押しで持ち上げて並べ替え ---------------------------------------- */

const LONG_PRESS_MS = 50;
const MOVE_TOLERANCE = 8;

interface Drag {
  pointerId: number;
  from: number;
  to: number;
  row: HTMLElement;
  rows: HTMLElement[];
  rowH: number;
  startY: number;
}

let drag: Drag | null = null;

function onRowPointerDown(e: PointerEvent, index: number, row: HTMLElement): void {
  if (e.button !== 0 || drag) return;
  // 入力欄・ボタンの上では通常操作を優先する
  if ((e.target as HTMLElement).closest('input, select, button')) return;

  const startX = e.clientX;
  const startY = e.clientY;
  const pointerId = e.pointerId;

  const cancel = (): void => {
    window.clearTimeout(timer);
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', cancel);
    window.removeEventListener('pointercancel', cancel);
  };
  // 押したまま動かしたらスクロール操作とみなして長押しを取り消す
  const onMove = (ev: PointerEvent): void => {
    if (Math.hypot(ev.clientX - startX, ev.clientY - startY) > MOVE_TOLERANCE) cancel();
  };
  const timer = window.setTimeout(() => {
    cancel();
    beginDrag(pointerId, index, row, startY);
  }, LONG_PRESS_MS);

  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', cancel);
  window.addEventListener('pointercancel', cancel);
}

function beginDrag(pointerId: number, index: number, row: HTMLElement, startY: number): void {
  const rows = [...shipList.querySelectorAll<HTMLElement>('.ship-row')];
  if (rows.length < 2) return;
  const rowH = rows[1].getBoundingClientRect().top - rows[0].getBoundingClientRect().top;

  drag = { pointerId, from: index, to: index, row, rows, rowH, startY };
  document.body.classList.add('dragging');
  row.classList.add('lift');
  try {
    row.setPointerCapture(pointerId);
  } catch {
    /* 既にポインタが離れている場合は無視 */
  }
  navigator.vibrate?.(10);

  window.addEventListener('pointermove', onDragMove);
  window.addEventListener('pointerup', endDrag);
  window.addEventListener('pointercancel', endDrag);
  window.addEventListener('contextmenu', suppressContextMenu);
}

function onDragMove(e: PointerEvent): void {
  if (!drag || e.pointerId !== drag.pointerId) return;
  const dy = e.clientY - drag.startY;
  drag.row.style.transform = `translateY(${dy}px)`;
  drag.to = clamp(drag.from + Math.round(dy / drag.rowH), 0, drag.rows.length - 1);

  // 持ち上げた行が入る隙間を空ける
  drag.rows.forEach((el, j) => {
    if (j === drag!.from) return;
    let shift = 0;
    if (drag!.from < drag!.to && j > drag!.from && j <= drag!.to) shift = -drag!.rowH;
    if (drag!.to < drag!.from && j >= drag!.to && j < drag!.from) shift = drag!.rowH;
    el.style.transform = shift ? `translateY(${shift}px)` : '';
  });
}

function endDrag(e: PointerEvent): void {
  if (!drag || e.pointerId !== drag.pointerId) return;
  const { from, to, row, rows } = drag;
  drag = null;

  window.removeEventListener('pointermove', onDragMove);
  window.removeEventListener('pointerup', endDrag);
  window.removeEventListener('pointercancel', endDrag);
  window.removeEventListener('contextmenu', suppressContextMenu);

  document.body.classList.remove('dragging');
  row.classList.remove('lift');
  for (const el of rows) el.style.transform = '';

  if (from !== to) moveTo(from, to);
}

function suppressContextMenu(e: Event): void {
  e.preventDefault();
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/* ---- 汎用の DOM ヘルパー ----------------------------------------------- */

/** 未選択の select 上でホイールを回すと値が勝手に変わるので、スクロールに振り替える */
function guardWheel(el: HTMLSelectElement): void {
  el.addEventListener(
    'wheel',
    (e) => {
      if (document.activeElement === el) return;
      e.preventDefault();
      window.scrollBy(0, e.deltaY);
    },
    { passive: false },
  );
}

function iconButton(label: string, disabled: boolean, onClick: () => void): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'icon';
  b.textContent = label;
  b.disabled = disabled;
  b.addEventListener('click', onClick);
  return b;
}

type Option<T extends string> = readonly [value: T, label: string];

/** [値, 表示名] の並びから select を作る。ホイール誤操作対策込み */
function selectEl<T extends string>(
  options: ReadonlyArray<Option<T>>,
  current: T,
  onChange: (value: T) => void,
): HTMLSelectElement {
  const el = document.createElement('select');
  for (const [value, label] of options) {
    const opt = document.createElement('option');
    opt.value = value;
    opt.textContent = label;
    el.append(opt);
  }
  el.value = current;
  el.addEventListener('change', () => onChange(el.value as T));
  guardWheel(el);
  return el;
}

/* ---- 並び順の候補(結果一覧)の描画 ------------------------------------- */

function renderResults(): void {
  const groups = groupsFromMerged(state.merged, state.ships.length);
  syncGroupPriorities(state.ships, groups);
  const grouped = hasOrderFreeGroup(attackerGroups(state.ships, groups));
  const warnings = collectWarnings(groups);

  byId('results-title').textContent = verify ? 'この並びの砲撃順' : '並び順の候補';
  byId('limit-ctl').hidden = verify;
  byId('result-wrap').hidden = verify;
  pager.hidden = verify;

  // 艦名は確率に影響しないので、名前を打ち替えただけなら前回の結果を使い回す
  const sig = JSON.stringify([
    state.ships.map((s) => [s.range, s.constraint, s.priority, s.shells]),
    state.merged,
    TIE_MODE,
  ]);
  if (sig !== lastSig) {
    results = search(state.ships, groups, TIE_MODE, SORT_KEY);
    lastSig = sig;
  }

  if (verify) {
    // 並びが決まっているので順位付けは行わず、その並びの砲撃順だけを出す
    warnBox.hidden = warnings.length === 0;
    warnBox.textContent = warnings.join('\n');
    summary.textContent = '';
    renderDetail(makeEvaluator(state.ships, groups, TIE_MODE)(fleetOrder()), groups);
    return;
  }

  if (results.length === 0) {
    warnings.push('位置指定を同時に満たす並び順がありません。指定を見直してください。');
    warnBox.hidden = false;
    warnBox.textContent = warnings.join('\n');
    summary.textContent = '';
    renderResultHead(grouped);
    tbody.replaceChildren();
    pager.replaceChildren();
    detail.replaceChildren();
    return;
  }

  warnBox.hidden = warnings.length === 0;
  warnBox.textContent = warnings.join('\n');

  const pageCount = Math.max(1, Math.ceil(results.length / state.limit));
  if (page >= pageCount) page = pageCount - 1;
  const start = page * state.limit;
  const top = results.slice(start, start + state.limit);
  // 表の選択行と下の詳細が食い違わないようにする
  if (selected >= top.length) selected = 0;

  // 最良の数値は1位の行に出ているので、ここでは件数だけを伝える。
  // 誰も撃たないときは候補を数えても意味が無いので出さない
  const total = factorial(state.ships.length);
  const scope = results.length < total ? `位置指定を満たす ${results.length} 通り` : `全 ${results.length} 通り`;
  summary.textContent = state.ships.some((s) => s.shells)
    ? `${scope}中 ${start + 1}-${start + top.length} 件を表示 ・ 同率 ${countBestTies(results)} 通り`
    : '';

  renderResultHead(grouped);
  renderResultRows(top, start, metricColumns(grouped));
  renderPager(pageCount);
  renderDetail(top[selected], groups);
}

function renderResultRows(top: Candidate[], start: number, metrics: MetricColumn[]): void {
  tbody.replaceChildren();
  top.forEach((cand, i) => {
    const tr = document.createElement('tr');
    if (i === selected) tr.classList.add('selected');
    if (start + i === 0) tr.classList.add('best');

    tr.append(td(String(start + i + 1)));
    for (const shipIdx of cand.assign) tr.append(td(state.ships[shipIdx].name));
    for (const col of metrics) tr.append(tdNum(pct(col.of(cand))));

    tr.addEventListener('click', () => {
      selected = i;
      renderResults();
    });
    tbody.append(tr);
  });
}

/** << < 1 > >> のページ送り。>> で最後のページへ飛ぶ */
function renderPager(pageCount: number): void {
  pager.replaceChildren();
  const jump = (to: number, label: string, disabled: boolean): HTMLButtonElement => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'page-btn';
    b.textContent = label;
    b.disabled = disabled;
    b.addEventListener('click', () => {
      page = to;
      selected = 0;
      renderResults();
    });
    return b;
  };

  const current = document.createElement('span');
  current.className = 'page-current';
  current.textContent = `${page + 1} / ${pageCount}`;

  pager.append(
    jump(0, '<<', page === 0),
    jump(page - 1, '<', page === 0),
    current,
    jump(page + 1, '>', page >= pageCount - 1),
    jump(pageCount - 1, '>>', page >= pageCount - 1),
  );
}

/** 入力の矛盾を警告文にまとめる。候補が0件になる原因もここで説明する */
function collectWarnings(groups: number[][]): string[] {
  const warnings: string[] = [];
  const label = (i: number): string => `${state.ships[i].name}(${RANGE_LABEL[state.ships[i].range]})`;
  const bandLabel = (gi: number): string => `${groups[gi][0] + 1}-${groups[gi][groups[gi].length - 1] + 1}番目`;

  if (!state.ships.some((s) => s.shells)) {
    warnings.push('砲撃に参加する艦がいません。どれか1隻は「参加」にしてください。');
  }
  // 確認モードは並びが決まっているので、希望順まわりの矛盾は問題にならない
  if (verify) return warnings;

  const conflicts = findRangeConflicts(state.ships, groups);
  if (conflicts.length) {
    const list = conflicts.map((c) => `${label(c.before)} より ${label(c.after)} が先に撃つ`).join(' / ');
    warnings.push(`この希望順は射程の降順に反しているため実現できません(一致率は 0%)。${list}`);
  }

  const mixed = findMixedRangeGroups(state.ships, groups);
  if (mixed.length) {
    warnings.push(
      `順不同グループ(${mixed.map(bandLabel).join(' / ')})の射程が揃っていません。` +
        '射程が違う艦は必ず先に撃つので均等にはできません。',
    );
  }

  for (const { constraint, count } of findPairConstraintIssues(state.ships)) {
    warnings.push(
      `「${constraintLabel(constraint, state.ships.length)}」は2隻に設定してください(現在 ${count} 隻)。` +
        '特殊砲撃は2つの枠を2隻で埋める必要があります。',
    );
  }
  return warnings;
}

interface MetricColumn {
  label: string;
  of: (c: Candidate) => number;
}

/** 順位の根拠になる指標だけを出す。優先度・グループが無ければその列は出さない */
function metricColumns(grouped: boolean): MetricColumn[] {
  const cols: MetricColumn[] = [];
  if (hasPriority(state.ships)) cols.push({ label: '優先', of: (c) => c.tiers[0] });
  cols.push({ label: '一致率', of: (c) => c.exact });
  if (grouped) cols.push({ label: '均等度', of: (c) => c.even });
  return cols;
}

/** 結果テーブルの見出し。艦数で列数が変わるので毎回作り直す */
function renderResultHead(grouped: boolean): void {
  const head = byId<HTMLTableRowElement>('result-head');
  head.replaceChildren();
  const names = state.ships.map((_, pos) => `${pos + 1}番艦`);
  const headers = ['順位', ...names, ...metricColumns(grouped).map((c) => c.label)];
  headers.forEach((label, i) => {
    const th = document.createElement('th');
    th.textContent = label;
    if (i > names.length) th.className = 'num';
    head.append(th);
  });
}

/* ---- 選択した並び順の詳細 ----------------------------------------------- */

function renderDetail(cand: Candidate | undefined, groups: number[][]): void {
  detail.replaceChildren();
  if (!cand) return;
  // 確認モードはパネル見出しが「この並びの砲撃順」なので、ここでは重ねない
  if (!verify) detail.append(heading('選択した並び順の詳細'));

  // 行動順リスト(砲撃しない艦は載らない)
  const shipOfSlot = cand.assign.filter((shipIdx) => state.ships[shipIdx].shells);
  if (shipOfSlot.length === 0) {
    const p = document.createElement('p');
    p.className = 'hint';
    p.textContent = '砲撃に参加する艦がいません。';
    detail.append(p);
    return;
  }

  const dist = distFor(
    shipOfSlot.map((shipIdx) => state.ships[shipIdx].range),
    TIE_MODE,
  );
  detail.append(scrollable(shellingOrderTable(cand, shipOfSlot.length, dist.marginal)));
  for (const el of groupEvennessTables(cand, groups)) detail.append(el);

  detail.append(heading('この並びで起きやすい砲撃順'));
  detail.append(scrollable(likelyOrdersTable(dist.orders, shipOfSlot)));
}

/** 並び順どおり(1番艦から)に、各艦が何番目に撃つかの確率を並べる */
function shellingOrderTable(cand: Candidate, m: number, marginal: number[][]): HTMLTableElement {
  const t = matrixTable(
    '艦',
    '砲撃順',
    Array.from({ length: m }, (_, r) => `${r + 1}番目`),
  );
  cand.assign.forEach((shipIdx, pos) => {
    const ship = state.ships[shipIdx];
    const slot = cand.slotOf[shipIdx];
    const tr = document.createElement('tr');
    if (slot < 0) tr.classList.add('no-shell');
    tr.append(td(`${pos + 1}番艦 ${ship.name}(${RANGE_LABEL[ship.range]})`));
    for (let r = 0; r < m; r++) tr.append(slot < 0 ? tdNum('—') : probCell(marginal[slot][r]));
    t.tBodies[0].append(tr);
  });
  return t;
}

/** 順不同グループごとの偏り。見出しと表を交互に返す */
function groupEvennessTables(cand: Candidate, groups: number[][]): HTMLElement[] {
  const stats = cand.groups;
  if (!stats) return [];

  const posOf = new Array<number>(state.ships.length);
  cand.assign.forEach((shipIdx, pos) => (posOf[shipIdx] = pos));

  const out: HTMLElement[] = [];
  let bandStart = 0;
  attackerGroups(state.ships, groups).forEach((g, gi) => {
    const from = bandStart;
    bandStart += g.length;
    if (g.length < 2) return;

    out.push(heading(`砲撃順 ${from + 1}-${from + g.length}番目のばらつき(均等度 ${pct(stats.evenPerGroup[gi])})`));
    const matrix = stats.matrix[gi];
    const t = matrixTable(
      '艦',
      'グループ内の砲撃順',
      g.map((_, j) => `${j + 1}番目`),
    );
    // ここも並び順(配置)の順に並べる
    for (const rank of [...g].sort((a, b) => posOf[a] - posOf[b])) {
      const row = matrix ? matrix[cand.slotOf[rank]] : null;
      const tr = document.createElement('tr');
      tr.append(td(`${posOf[rank] + 1}番艦 ${state.ships[rank].name}`));
      g.forEach((_, j) => tr.append(heatCell(row ? row[j] : 0, g.length)));
      t.tBodies[0].append(tr);
    }
    out.push(scrollable(t));
  });
  return out;
}

/** 起きやすい砲撃順の上位5件 */
function likelyOrdersTable(orders: Map<string, number>, shipOfSlot: number[]): HTMLTableElement {
  const t = table(['砲撃順', '確率']);
  for (const [orderKey, p] of [...orders].sort((a, b) => b[1] - a[1]).slice(0, 5)) {
    const names = orderKey
      .split(',')
      .map((slot) => state.ships[shipOfSlot[Number(slot)]].name)
      .join(' → ');
    const tr = document.createElement('tr');
    tr.append(td(names), tdNum(pct(p)));
    t.tBodies[0].append(tr);
  }
  return t;
}

function heading(text: string): HTMLHeadingElement {
  const h = document.createElement('h3');
  h.textContent = text;
  return h;
}

/* ---- 表まわりのヘルパー ------------------------------------------------- */

/** 最終列だけ数値列(右寄せ)にした表 */
function table(headers: string[]): HTMLTableElement {
  const t = document.createElement('table');
  const tr = t.createTHead().insertRow();
  headers.forEach((label, i) => {
    const th = document.createElement('th');
    th.textContent = label;
    if (i === headers.length - 1) th.className = 'num';
    tr.append(th);
  });
  t.createTBody();
  return t;
}

/** 幅が足りないときに枠内で横スクロールさせる */
function scrollable(table: HTMLTableElement): HTMLDivElement {
  const wrap = document.createElement('div');
  wrap.className = 'table-wrap';
  wrap.append(table);
  return wrap;
}

/** 「艦 × 砲撃順」の確率表。見出しを2段にして列が何かを示す */
function matrixTable(corner: string, spanLabel: string, cols: string[]): HTMLTableElement {
  const t = document.createElement('table');
  const thead = t.createTHead();

  const r1 = thead.insertRow();
  const th0 = document.createElement('th');
  th0.textContent = corner;
  th0.rowSpan = 2;
  const thSpan = document.createElement('th');
  thSpan.textContent = spanLabel;
  thSpan.colSpan = cols.length;
  thSpan.className = 'span';
  r1.append(th0, thSpan);

  const r2 = thead.insertRow();
  for (const label of cols) {
    const th = document.createElement('th');
    th.textContent = label;
    th.className = 'num';
    r2.append(th);
  }

  t.createTBody();
  return t;
}

/** 確率の大きさで濃淡を付けたセル。0% は塗らない */
function probCell(p: number): HTMLTableCellElement {
  const cell = tdNum(pct(p));
  cell.classList.add('heat', 'over');
  cell.style.setProperty('--heat', String(p));
  if (p <= 0) cell.classList.add('zero');
  return cell;
}

/** 均等(1/k)からの乖離で濃淡を付けた確率セル */
function heatCell(p: number, k: number): HTMLTableCellElement {
  const cell = tdNum(pct(p));
  cell.classList.add('heat');
  const dev = (p - 1 / k) * k;
  cell.style.setProperty('--heat', String(Math.min(1, Math.abs(dev))));
  cell.classList.add(dev >= 0 ? 'over' : 'under');
  return cell;
}

function td(text: string): HTMLTableCellElement {
  const cell = document.createElement('td');
  cell.textContent = text;
  return cell;
}

function tdNum(text: string): HTMLTableCellElement {
  const cell = td(text);
  cell.className = 'num';
  return cell;
}

function factorial(n: number): number {
  let f = 1;
  for (let i = 2; i <= n; i++) f *= i;
  return f;
}

function pct(p: number): string {
  return `${(p * 100).toFixed(2)}%`;
}

function byId<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`#${id} not found`);
  return el as T;
}

/* ---- 保存(希望の砲撃順は保存せず、画面の設定だけ残す) ------------------ */

function loadState(): State {
  const state: State = {
    ships: DEFAULT_SHIPS.map((s) => ({ ...s })),
    merged: new Array<boolean>(DEFAULT_SHIPS.length - 1).fill(false),
    limit: 20,
  };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return state;
    const p = JSON.parse(raw) as Partial<State>;
    if (LIMIT_OPTIONS.includes(Number(p.limit))) state.limit = Number(p.limit);
  } catch {
    /* 壊れていたら初期状態のまま */
  }
  return state;
}

function saveState(): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ limit: state.limit }));
  } catch {
    /* localStorage が使えない環境では保存しない */
  }
}

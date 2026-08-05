export type Compare<T> = (a: T, b: T) => number;

/**
 * kancolle-replay の COMMON.zendQsort (js/simulator-ui/common.js:190) の移植。
 * 比較関数が矛盾していても移植元と同じ並びになる必要があるので、標準の sort で置き換えないこと。
 */
export function zendQsort<T>(a: T[], cmp: Compare<T>): void {
  if (a.length < 2) return;
  const stack: Array<[number, number]> = [[0, a.length - 1]];
  while (stack.length) {
    const frame = stack.pop()!;
    let begin = frame[0];
    let end = frame[1];
    while (begin < end) {
      const mid = begin + ((end - begin) >> 1);
      swap(a, begin, mid); // 枢軸を begin へ
      let seg1 = begin + 1;
      let seg2 = end;
      for (;;) {
        while (seg1 < seg2 && cmp(a[begin], a[seg1]) > 0) seg1++;
        while (seg2 >= seg1 && cmp(a[seg2], a[begin]) > 0) seg2--;
        if (seg1 >= seg2) break;
        swap(a, seg1, seg2);
        seg1++;
        seg2--;
      }
      swap(a, begin, seg2); // 枢軸を確定位置へ
      if (seg2 - begin <= end - seg2) {
        if (seg2 + 1 < end) stack.push([seg2 + 1, end]);
        if (seg2 === begin) break;
        end = seg2 - 1;
      } else {
        if (begin + 1 < seg2) stack.push([begin, seg2 - 1]);
        begin = seg2 + 1;
      }
    }
  }
}

function swap<T>(a: T[], i: number, j: number): void {
  const t = a[i];
  a[i] = a[j];
  a[j] = t;
}

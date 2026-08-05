# サードパーティの表示

このプロジェクトは以下のソフトウェアのコードを移植して利用しています。

## KC3Kai/kancolle-replay

<https://github.com/KC3Kai/kancolle-replay>

砲撃戦の行動順を決めるロジックを移植しています。具体的には次の2つです。

- `COMMON.zendQsort`(`js/simulator-ui/common.js`)→ [src/qsort.ts](src/qsort.ts)
- `orderByRange` の並べ替え部分(`js/kcsim.js`)→ [src/order.ts](src/order.ts)

命中・ダメージ・目標選択などの計算は移植していません。

```
The MIT License (MIT)
Copyright (c) 2016 fourinone41

Permission is hereby granted, free of charge, to any person obtaining a copy of this
software and associated documentation files (the "Software"), to deal in the Software
without restriction, including without limitation the rights to use, copy, modify, merge,
publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons
to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or
substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED,
INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR
PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE
FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER
DEALINGS IN THE SOFTWARE.
```

## dube116/kancolle-shelling-order

<https://github.com/dube116/kancolle-shelling-order>

`zendQsort` のアルゴリズムの出典として、kancolle-replay のソース(`js/simulator-ui/common.js`)に
明記されているものです。本プロジェクトは kancolle-replay 経由で移植しています。

# 艦これ　砲撃順シミュレータ

射程と希望の砲撃順を入力すると、**砲撃戦1巡目**がなるべく希望どおりになる艦隊の並び順を探すツール。
実際の編成を指定して、その並びの砲撃順を確認することもできる。

公開先: <https://iora339.github.io/kc-sh-order/>

## コマンド

```bash
npm install     # 初回のみ
```

```bash
npm run dev     # 開発サーバ
```

```bash
npm run build   # 型チェック → dist/index.html の1枚に出力
```

```bash
npm test        # テスト
```

## 出典

砲撃戦の行動順を決めるロジックは [KC3Kai/kancolle-replay](https://github.com/KC3Kai/kancolle-replay)(MIT)から移植しています。
移植したのは並べ替え(`zendQsort` と `orderByRange`)のみで、命中・ダメージ計算は含みません。
`zendQsort` のアルゴリズムは、移植元が出典として挙げている
[dube116/kancolle-shelling-order](https://github.com/dube116/kancolle-shelling-order) に由来します。

著作権表示とライセンス全文は [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md) を参照してください。

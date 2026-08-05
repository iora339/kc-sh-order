# kc-sh-order — 艦これ　砲撃順シミュレータ

射程と希望の砲撃順から、砲撃戦1巡目がなるべく希望どおりになる艦隊の並び順を探す静的サイト。編成を指定してその並びの砲撃順を確認することもできる。TypeScript + Vite 構成（フレームワークなし）。

## コマンド

```sh
npm run dev      # 開発サーバ（http://localhost:5173）
npm run build    # 型チェック + 本番ビルド（tsc --noEmit && vite build）
npm run preview  # ビルド結果のプレビュー
npm test         # テスト（vitest）
```

## 出典

砲撃戦の行動順を決めるロジックは [KC3Kai/kancolle-replay](https://github.com/KC3Kai/kancolle-replay)（MIT）から移植している。移植したのは並べ替え（`zendQsort` と `orderByRange`）のみで、命中・ダメージ計算は含まない。アルゴリズムの出典は移植元が挙げている [dube116/kancolle-shelling-order](https://github.com/dube116/kancolle-shelling-order)。著作権表示とライセンス全文は [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md) を参照。

## デプロイ

公開URL: https://iora339.github.io/kc-sh-order/

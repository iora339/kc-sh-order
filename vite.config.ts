import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

// ビルド結果を 1 枚の HTML に固める(file:// でも GitHub Pages でも動かすため)
export default defineConfig({
  base: './',
  plugins: [viteSingleFile()],
  build: {
    target: 'es2022',
    assetsInlineLimit: 100_000_000,
    cssCodeSplit: false,
  },
});

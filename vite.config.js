import { defineConfig } from 'vite';

// base: './' 让 dist/index.html 可以直接双击用浏览器打开（file://），
// 同时也兼容 Cloudflare Pages / 任意静态托管的子路径部署。
export default defineConfig({
  base: './',
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
  },
});

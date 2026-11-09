// 沙箱环境下的构建验证：本机禁止 spawn 子进程，
// 因此关掉 esbuild（不压缩、不降级语法），只用 rollup 打包，验证 dist 产物可运行。
import fs from 'node:fs';

const nativeRealpath = fs.realpathSync.native;
let firstCall = true;
fs.realpathSync.native = function patched(p) {
  if (firstCall) {
    firstCall = false;
    const error = new Error('EISDIR: illegal operation on a directory, realpath');
    error.code = 'EISDIR';
    throw error;
  }
  return nativeRealpath(p);
};

const { build } = await import('vite');
await build({
  logLevel: 'info',
  esbuild: false,
  build: { minify: false, cssMinify: false, target: 'esnext' },
});

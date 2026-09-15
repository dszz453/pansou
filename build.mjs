/**
 * 构建脚本
 *
 * 1) 把 vendor/ 下的第三方前端资源（Vue、预编译 Tailwind CSS）打包成 TS 常量，
 *    由 Worker 自身在同域下提供，彻底去掉 unpkg / cdnjs / cdn.tailwindcss.com 等
 *    海外 CDN 依赖（国内网络访问这些域名经常失败，会导致页面 JS 完全不工作）。
 * 2) 用 esbuild 打包 Worker。
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.dirname(fileURLToPath(import.meta.url));
process.chdir(root);

// ---------- 1. 生成 vendor 资源模块 ----------
const vuePath = 'vendor/vue.global.prod.js';
const cssPath = 'vendor/tailwind.css';

if (!existsSync(vuePath)) {
  console.error(`[build] 缺少 ${vuePath}，请先执行: npm run fetch-vendor`);
  process.exit(1);
}
if (!existsSync(cssPath)) {
  console.error(`[build] 缺少 ${cssPath}，请先执行: npm run build:css`);
  process.exit(1);
}

const vueJs = readFileSync(vuePath, 'utf8');
const tailwindCss = readFileSync(cssPath, 'utf8');

const out = `// 本文件由 build.mjs 自动生成，请勿手动修改
/* eslint-disable */
export const VUE_JS: string = ${JSON.stringify(vueJs)};
export const TAILWIND_CSS: string = ${JSON.stringify(tailwindCss)};
export const VENDOR_VERSION: string = ${JSON.stringify(
  `${vueJs.length.toString(36)}-${tailwindCss.length.toString(36)}`
)};
`;

if (!existsSync('src')) mkdirSync('src');
writeFileSync('src/vendor.generated.ts', out, 'utf8');
console.log(
  `[build] vendor.generated.ts 已生成  vue=${(vueJs.length / 1024).toFixed(0)}KB  css=${(
    tailwindCss.length / 1024
  ).toFixed(0)}KB`
);

// ---------- 2. 打包 Worker（走 esbuild 的 Node API，避免 Windows 下 npx.cmd 调用问题） ----------
const esbuild = await import('esbuild');

await esbuild.build({
  entryPoints: ['src/index.ts'],
  bundle: true,
  format: 'esm',
  outfile: 'dist/worker.js',
  target: 'es2022',
  minify: true,
  legalComments: 'none',
  logLevel: 'info',
});

const { size } = statSync('dist/worker.js');
console.log(`[build] dist/worker.js 打包完成 (${(size / 1024).toFixed(0)}KB)`);

// ---------- 3. 构建后校验：内联前端脚本必须是合法 JS ----------
// 血泪教训：src/ui.html.ts 里的 HTML 是普通模板字符串，
// 脚本中的正则 `\/`、`\.`、字符串 `\n` 等**单反斜杠转义会被模板字符串吃掉**，
// 生成出 `/^https?://t.me/(s/)?/` 这种非法正则 + 断行字符串，
// 整个 <script> 语法错误 → Vue 完全不挂载 → 页面变成一堆关不掉的「死弹窗」。
// 所以每次构建后必须把内联脚本抽出来做一次语法检查。
await esbuild.build({
  entryPoints: ['src/ui.html.ts'],
  bundle: true,
  format: 'esm',
  outfile: 'dist/_ui_check.mjs',
  platform: 'neutral',
  target: 'es2022',
  logLevel: 'error',
});

const { HTML_TEMPLATE } = await import('./dist/_ui_check.mjs');
const scriptBlocks = [...HTML_TEMPLATE.matchAll(/<script>([\s\S]*?)<\/script>/g)];

if (scriptBlocks.length === 0) {
  console.error('[build] ❌ 未在 HTML 模板中找到内联脚本，校验失败');
  process.exit(1);
}

let scriptOk = true;
scriptBlocks.forEach((blk, idx) => {
  const inline = blk[1];
  try {
    new Function(inline);
  } catch (err) {
    scriptOk = false;
    console.error(`[build] ❌ 第 ${idx + 1} 段内联脚本存在语法错误，前端会整体瘫痪：`);
    console.error('        ' + err.message);
    // 尽量定位到出错行
    const lines = inline.split('\n');
    const suspect = lines.findIndex(l => /\(\/\^?https\?:?\/\//.test(l) || /t\.me\/\(/.test(l));
    const at = suspect >= 0 ? suspect : 0;
    for (let i = Math.max(0, at - 2); i < Math.min(lines.length, at + 3); i++) {
      console.error(`        ${i + 1}| ${lines[i]}`);
    }
  }
});

if (!scriptOk) process.exit(1);
console.log(`[build] ✅ 内联前端脚本语法校验通过（${scriptBlocks.length} 段）`);

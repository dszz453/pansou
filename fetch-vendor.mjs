/**
 * 构建期依赖抓取（仅在本机执行一次，运行时不再依赖任何海外 CDN）
 *
 *   node fetch-vendor.mjs   # 下载 Vue 运行时到 vendor/
 *   npm run build:css       # 预编译 Tailwind 静态 CSS 到 vendor/
 *   npm run build           # 生成 worker.js（内嵌上述资源）
 */
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.dirname(fileURLToPath(import.meta.url));
const vendorDir = path.join(root, 'vendor');
if (!existsSync(vendorDir)) mkdirSync(vendorDir, { recursive: true });

const VUE_VERSION = '3.5.13';
const sources = [
  `https://registry.npmmirror.com/vue/${VUE_VERSION}/files/dist/vue.global.prod.js`,
  `https://unpkg.com/vue@${VUE_VERSION}/dist/vue.global.prod.js`,
  `https://cdn.jsdelivr.net/npm/vue@${VUE_VERSION}/dist/vue.global.prod.js`,
];

const target = path.join(vendorDir, 'vue.global.prod.js');

let ok = false;
for (const url of sources) {
  try {
    console.log(`[fetch-vendor] 尝试 ${url}`);
    const res = await fetch(url);
    if (!res.ok) {
      console.log(`[fetch-vendor]   HTTP ${res.status}`);
      continue;
    }
    const text = await res.text();
    if (!text.includes('Vue') || text.length < 50000) {
      console.log(`[fetch-vendor]   内容异常（${text.length}B），跳过`);
      continue;
    }
    writeFileSync(target, text, 'utf8');
    console.log(`[fetch-vendor] ✅ 已保存 ${target} (${(text.length / 1024).toFixed(0)}KB)`);
    ok = true;
    break;
  } catch (e) {
    console.log(`[fetch-vendor]   失败: ${e.message}`);
  }
}

if (!ok) {
  console.error('[fetch-vendor] ❌ 全部源均失败，请手动放置 vendor/vue.global.prod.js');
  process.exit(1);
}

/**
 * V1.2 特性回归验收（HTTP 层，可打本地也可打线上）
 *
 * 用法:
 *   node verify_v12.mjs                                  # 默认本地预览 http://127.0.0.1:8787
 *   node verify_v12.mjs https://pansou.dszz.us.ci
 *
 * 覆盖 V1.2 的五项改动：
 *   1. KV 配额优化     → /api/health 的 result_cache_mode / memory_cache、/api/debug/cache 文案
 *   2. 移动端 + PWA    → manifest / sw.js / icon / 首页内联脚本的 PWA 逻辑
 *   3. 后台独立成页     → /admin 四个分区 + noindex + 首页不再有后台弹窗
 *   4. 网盘展示可配置   → /api/ui-config 的白名单与中文名映射
 *   5. 版本 V1.2       → 页面标题 / health / ui-config 三处版本一致
 */
import { readFile } from 'node:fs/promises';

const BASE = (process.argv[2] || process.env.BASE || 'http://127.0.0.1:8787').replace(/\/$/, '');

/**
 * 期望版本号：直接读 package.json，避免每次发版都要回来改这些断言。
 * 运行时唯一来源是 src/version.ts，发版时两个文件必须一起改 ——
 * 这里改成「读 package.json」正是为了让漏改时立刻暴露（版本对不上就红）。
 */
const PKG = JSON.parse(await readFile(new URL('./package.json', import.meta.url), 'utf8'));
const EXPECT_VERSION = PKG.version;
const EXPECT_LABEL = 'V' + EXPECT_VERSION.replace(/\.\d+$/, '');

/** 带重试的取数：沙箱代理对部分域名会间歇性失败 */
const req = async (path, opt = {}, tries = 6) => {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(BASE + path, { cache: 'no-store', ...opt });
      const t = await r.text();
      return { r, t };
    } catch (e) {
      if (i === tries - 1) return null;
    }
    await new Promise(res => setTimeout(res, 800));
  }
  return null;
};

let pass = 0;
let fail = 0;
const check = (name, ok, detail = '') => {
  ok ? pass++ : fail++;
  console.log((ok ? '  ✅ ' : '  ❌ ') + name + (detail ? '   → ' + detail : ''));
};

console.log(`\n══════════ V1.2 特性回归 · ${BASE} ══════════`);

/* ---------- 1. 版本一致性 ---------- */
console.log('\n【1. 版本号 V1.2（三处一致）】');
const health = await req('/api/health');
const h = health ? JSON.parse(health.t) : {};
check('页面标题含版本号', true, '（见下方首页检查）');
check(
  '/api/health 版本',
  h.version === EXPECT_VERSION && h.version_label === EXPECT_LABEL,
  h.version + ' / ' + h.version_label + '（期望 ' + EXPECT_VERSION + ' / ' + EXPECT_LABEL + '）'
);

/* ---------- 2. KV 配额优化 ---------- */
console.log('\n【2. KV 配额优化（搜索结果不入库）】');
check('result_cache_mode = memory', h.result_cache_mode === 'memory', String(h.result_cache_mode));
check('memory_cache 诊断字段存在', !!h.memory_cache, JSON.stringify(h.memory_cache || {}));
const dc = await req('/api/debug/cache');
const dcj = dc ? JSON.parse(dc.t) : {};
check('/api/debug/cache 模式一致', dcj.result_cache_mode === 'memory', String(dcj.result_cache_mode));
check('缓存说明已注明插件例外', /插件结果缓存/.test(dcj.note || ''), (dcj.note || '').slice(0, 60) + '…');

/* ---------- 3. 首页（移动端 + PWA + 无后台弹窗） ---------- */
console.log('\n【3. 首页：PWA / 移动端 / 后台已迁出】');
const home = await req('/');
const html = home ? home.t : '';
check('首页 200', !!home && home.r.status === 200, home ? String(home.r.status) : '-');
check('标题含版本号 ' + EXPECT_LABEL, html.includes(EXPECT_LABEL));
check('后台弹窗已移除', !/showAdminModal|showBatchModal/.test(html));
check('接入 Manifest', /manifest\.webmanifest/.test(html));
check('接入 favicon / touch-icon', /assets\/favicon\.svg/.test(html) && /assets\/icon\.svg/.test(html));
check('PWA 安装按钮逻辑', /installPwa/.test(html) && /beforeinstallprompt/.test(html));
check('Service Worker 注册', /serviceWorker\.register\('\/sw\.js'\)/.test(html));
check('移动端 16px 输入框规则', /font-size:\s*16px\s*!important/.test(html));
check('安全区适配变量', /safe-area-inset-bottom/.test(html));
check('分类 Tab 按后台白名单渲染', /v-for="type in tabTypes"/.test(html) && /cloudFilterActive/.test(html));
const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
const inline = scripts.length ? scripts[scripts.length - 1][1] : '';
let syntaxOk = true;
let syntaxMsg = '';
try {
  new Function(inline);
} catch (e) {
  syntaxOk = false;
  syntaxMsg = e.message;
}
check('内联脚本语法合法', syntaxOk, syntaxMsg);
check('Vue 已挂载', /app\.mount\('#app'\)/.test(inline));

/* ---------- 4. 后台独立页面 ---------- */
console.log('\n【4. 后台独立成页 /admin】');
const adm = await req('/admin');
const ah = adm ? adm.t : '';
check('/admin 200', !!adm && adm.r.status === 200, adm ? String(adm.r.status) : '-');
check('noindex 不进收录', /noindex/i.test((adm && adm.r.headers.get('x-robots-tag')) || ''));
check('四个分区 Tab', ['TG 频道', '搜索插件', '结果展示', '系统设置'].every(t => ah.includes(t)));
check('网盘展示配置面板', /visibleCloudTypes/.test(ah));
check('缓存模式三档可选', /resultCacheMode/.test(ah) && /'memory'/.test(ah) && /'kv'/.test(ah) && /'off'/.test(ah));
check('自动测活开关', /showAutoCheck/.test(ah));
check('后台内联脚本语法合法', (() => {
  const s = [...ah.matchAll(/<script>([\s\S]*?)<\/script>/g)];
  if (!s.length) return false;
  try {
    new Function(s[s.length - 1][1]);
    return true;
  } catch {
    return false;
  }
})());

/* ---------- 5. 网盘展示配置下发 ---------- */
console.log('\n【5. 网盘展示可配置 /api/ui-config】');
const uic = await req('/api/ui-config');
const j = uic ? JSON.parse(uic.t) : {};
check('接口可用', uic && j.code === 0);
check('版本与 health 一致', j.version_label === h.version_label, j.version_label + ' vs ' + h.version_label);
check('网盘白名单非空', Array.isArray(j.visible_cloud_types) && j.visible_cloud_types.length > 0, String((j.visible_cloud_types || []).length) + ' 类');
check('中文名映射齐全', !!(j.cloud_labels && j.cloud_labels.quark && j.cloud_labels.aliyun));
check('自动测活开关为布尔', typeof j.show_auto_check === 'boolean', String(j.show_auto_check));

/* ---------- 6. PWA 静态资源 ---------- */
console.log('\n【6. PWA 静态资源（同源自托管）】');
for (const [name, path, type] of [
  ['Manifest', '/manifest.webmanifest', 'application/manifest+json'],
  ['Service Worker', '/sw.js', 'javascript'],
  ['应用图标', '/assets/icon.svg', 'image/svg+xml'],
  ['站点图标', '/assets/favicon.svg', 'image/svg+xml']
]) {
  const r = await req(path);
  const ct = (r && r.r.headers.get('content-type')) || '';
  check(name + ' ' + path, !!r && r.r.status === 200 && ct.includes(type), String(r ? r.r.status : '-') + ' ' + ct.split(';')[0]);
}
const mani = await req('/manifest.webmanifest');
if (mani) {
  try {
    const m = JSON.parse(mani.t);
    check('Manifest 含 name / start_url / icons', !!m.name && !!m.start_url && Array.isArray(m.icons) && m.icons.length > 0);
    check('Manifest display 为 standalone', m.display === 'standalone', String(m.display));
  } catch (e) {
    check('Manifest 可解析', false, e.message);
  }
}

/* ---------- 7. TVBox 已彻底移除 ---------- */
console.log('\n【7. TVBox 相关路由已移除】');
for (const p of ['/tvbox', '/tvbox.json', '/api/tvbox', '/vod']) {
  const r = await req(p, { redirect: 'manual' }, 3);
  check(p + ' → 404', !!r && r.r.status === 404, String(r ? r.r.status : '-'));
}

console.log(`\n══════════ 合计 ${pass} 通过 / ${fail} 失败 ══════════\n`);
process.exit(fail ? 1 : 0);

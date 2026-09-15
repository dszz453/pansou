/**
 * 最终端到端验收：页面 / 接口 / 插件 / 搜索 四项全查。
 * 用法: node final_check.mjs <域名>
 */
const BASE = process.argv[2] || 'https://pansou.dszz.us.ci';

/** 带重试的取数（沙箱代理对部分域名间歇性失败） */
const get = async (path, opt = {}, tries = 6) => {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(BASE + path, { cache: 'no-store', ...opt });
      const t = await r.text();
      if (t) return { r, t };
    } catch (e) {}
    await new Promise((res) => setTimeout(res, 900));
  }
  return null;
};

const line = (k, v) => console.log('  ' + k.padEnd(16) + ': ' + v);

console.log(`\n══════════ ${BASE} ══════════`);

// 1. 首页
const home = await get('/');
if (!home) {
  console.log('  ❌ 首页取不到');
  process.exit(1);
}
const html = home.t;
const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
const code = scripts.length ? scripts[scripts.length - 1][1] : '';
let syntaxOk = true,
  syntaxMsg = '';
try {
  new Function(code);
} catch (e) {
  syntaxOk = false;
  syntaxMsg = e.message;
}
console.log('【1. 首页】');
line('HTTP', home.r.status);
line('页面大小', html.length + ' 字符');
line('内联脚本语法', syntaxOk ? '✅ 通过' : '❌ ' + syntaxMsg);
line('Vue 自托管', /assets\/vue\.js/.test(html) ? '✅' : '❌');
// 注意：页面里有一句注释写着「无 unpkg / cdnjs / cdn.tailwindcss.com 等海外 CDN 依赖」，
// 所以不能直接搜关键词，必须看是否真的作为 <script src> / <link href> 引用。
const cdnRefs =
  html.match(/<(?:script|link)[^>]*(?:unpkg|cdnjs|cdn\.tailwindcss)[^>]*>/gi) || [];
line('无外部 CDN', cdnRefs.length ? '❌ ' + cdnRefs.join(' ') : '✅');
line('插件管理 Tab', /搜索插件 \(/.test(html) ? '✅' : '❌');
line('新增插件按钮', /新增插件/.test(html) ? '✅' : '❌');

// 2. 健康检查
console.log('\n【2. 健康检查 /api/health】');
const h = await get('/api/health');
if (h) {
  const j = JSON.parse(h.t);
  line('状态', j.status);
  line('引擎', j.engine);
  line('KV', j.kv_bound ? '已绑定' : '未绑定');
  line('频道', `${j.channels_enabled}/${j.channels_total} 启用`);
  line('插件', `${j.plugins_enabled}/${j.plugins_total} 启用（单次上限 ${j.max_plugins_per_call}）`);
} else {
  line('结果', '❌ 取不到');
}

// 3. 插件清单
console.log('\n【3. 插件清单 /api/plugins】');
const pl = await get('/api/plugins');
if (pl) {
  const j = JSON.parse(pl.t);
  line('总数/启用', `${j.total} / ${j.enabled}`);
  for (const p of j.plugins) {
    line('· ' + p.name, `${p.type} | 子源 ${p.pluginIds.length} 个 | ${p.apiEndpoint}`);
  }
} else {
  line('结果', '❌ 取不到');
}

// 4. 真实搜索（频道 + 插件一起）
console.log('\n【4. 搜索「流浪地球」/api/search】');
const s = await get(
  '/api/search?kw=' + encodeURIComponent('流浪地球') + '&res=merge&refresh=true',
  {},
  2
);
if (s) {
  const j = JSON.parse(s.t);
  line('总条数', j.total);
  line('meta', JSON.stringify(j._meta));
  const byType = Object.entries(j.merged_by_type || {})
    .filter(([, v]) => v.length)
    .map(([k, v]) => `${k}:${v.length}`)
    .join('  ');
  line('网盘分布', byType || '(空)');
  const all = [];
  for (const [t, list] of Object.entries(j.merged_by_type || {})) for (const it of list) all.push(it);
  const bySrc = {};
  all.forEach((it) => (bySrc[it.source] = (bySrc[it.source] || 0) + 1));
  line('来源 TOP8', Object.entries(bySrc).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k, v]) => `${k}(${v})`).join(', '));
  const pluginSrc = Object.keys(bySrc).filter((k) => String(k).startsWith('plugin:'));
  line('插件独有来源', pluginSrc.length ? pluginSrc.join(', ') : '(无)');
  console.log('  示例结果:');
  all.slice(0, 4).forEach((it) =>
    console.log(`    [${it.type || ''}] 「${String(it.note || '').slice(0, 44)}」 ← ${it.source}`)
  );
} else {
  line('结果', '❌ 取不到');
}
console.log('');

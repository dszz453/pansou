/**
 * 验证插件的「过期缓存兜底」：用全新关键词连续强制刷新，
 * 只要中途成功过一次，后续即便节点被 WAF 拦，也应该返回旧数据而不是 0 条。
 * 用法: node verify_plugin_stale.mjs <关键词> [域名] [次数]
 * 未指定域名时默认验证本地预览（node serve-local.mjs）。
 */
const kw = process.argv[2] || '星际穿越';
const BASE = process.argv[3] || process.env.BASE || 'http://127.0.0.1:8787';
const rounds = Number(process.argv[4] || 8);

const call = async () => {
  const t0 = Date.now();
  const r = await fetch(`${BASE}/api/search`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ kw, plugins_only: true, res: 'merge', refresh: true })
  });
  const j = await r.json().catch(() => null);
  return { ms: Date.now() - t0, j };
};

console.log(`关键词「${kw}」 @ ${BASE}  —— 连续 ${rounds} 次强制刷新\n`);
let everOk = false;
let zeros = 0;
for (let i = 1; i <= rounds; i++) {
  let out;
  try {
    out = await call();
  } catch (e) {
    console.log(`  第${i}次: 请求失败 ${e.message}`);
    continue;
  }
  const total = out.j ? out.j.total : -1;
  const m = (out.j && out.j._meta) || {};
  const flag = total > 0 ? (everOk && m.plugins_stale === 0 ? '缓存命中' : '抓到') : total === 0 ? '空 ❌' : '?';
  if (total > 0) everOk = true;
  if (total === 0) zeros++;
  const parts = [
    `第${String(i).padStart(2)}次`,
    `total=${String(total).padStart(4)}`,
    `${String(out.ms).padStart(6)}ms`,
    `ok=${m.plugins_ok} cache=${m.plugins_from_cache} stale=${m.plugins_stale} fail=${m.plugins_failed}`,
    flag
  ];
  console.log('  ' + parts.join('  '));
}
console.log(`\n  → ${rounds} 次中出现空结果 ${zeros} 次 ${zeros === 0 ? '✅' : '❌'}`);

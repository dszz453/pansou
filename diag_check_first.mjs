/**
 * 诊断：把某关键词搜索结果里靠前的链接逐条送 /api/check，
 * 核对「已失效」是真失效还是误报。
 * 用法: node diag_check_first.mjs <域名> [关键词] [条数]
 */
const BASE = (process.argv[2] || 'https://pansou.dszz.us.ci').replace(/\/$/, '');
const KW = process.argv[3] || '庆余年';
const N = parseInt(process.argv[4] || '16', 10);

const post = async (path, body) => {
  for (let i = 0; i < 4; i++) {
    try {
      const r = await fetch(BASE + path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      return await r.json();
    } catch (e) {
      if (i === 3) throw e;
      await new Promise(s => setTimeout(s, 1200));
    }
  }
};

const search = await post('/api/search', { kw: KW, res: 'merge', refresh: true });
const merged = search.data?.merged_by_type || search.merged_by_type || {};

// 复现前端的「全部网盘」顺序：按 merged_by_type 的对象键顺序拼接
const list = [];
for (const [type, arr] of Object.entries(merged)) {
  for (const it of arr) list.push({ type, ...it });
}

console.log(`\n关键词「${KW}」共 ${list.length} 条，检查前 ${N} 条（与前端自动测活的范围一致）\n`);
console.log('序号 分类      状态      耗时    通道    链接');
console.log('-'.repeat(104));

const tally = {};
for (let i = 0; i < Math.min(N, list.length); i++) {
  const it = list[i];
  let d = {};
  try {
    d = await post('/api/check', { url: it.url, password: it.password || '', type: it.type });
  } catch (e) {
    d = { status: 'ERR', message: String(e.message || e) };
  }
  tally[d.status] = (tally[d.status] || 0) + 1;
  console.log(
    String(i + 1).padStart(3),
    String(it.type).padEnd(9),
    String(d.status).padEnd(9),
    String(d.latency_ms ?? '-').padStart(6) + 'ms',
    String(d.method || '-').padEnd(7),
    String(it.url).slice(0, 54)
  );
  console.log(`    └─ ${String(d.message || '').slice(0, 70)}`);
}

console.log('-'.repeat(104));
console.log('统计:', JSON.stringify(tally));
console.log('分类分布(前N条):', JSON.stringify(list.slice(0, N).reduce((a, x) => ((a[x.type] = (a[x.type] || 0) + 1), a), {})));
console.log('');

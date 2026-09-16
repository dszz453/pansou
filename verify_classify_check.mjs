/**
 * 验收脚本：网盘分类精准度 + 自动测活
 * 用法: node verify_classify_check.mjs https://你的域名 [关键词]
 */
const BASE = (process.argv[2] || 'http://127.0.0.1:8787').replace(/\/$/, '');
const KW = process.argv[3] || '现在不是出轨的问题';

const LABEL = {
  baidu: '百度网盘', aliyun: '阿里云盘', quark: '夸克网盘', uc: 'UC网盘',
  tianyi: '天翼云盘', mobile: '移动云盘', '115': '115网盘', pikpak: 'PikPak',
  xunlei: '迅雷云盘', '123': '123网盘', guangya: '光鸭网盘', magnet: '磁力',
  ed2k: '电驴', others: '其他网盘', other: '其他网盘'
};

const get = async (path, opt = {}) => {
  for (let i = 0; i < 5; i++) {
    try {
      const r = await fetch(BASE + path, { ...opt, redirect: 'follow' });
      const t = await r.text();
      return { status: r.status, text: t };
    } catch (e) {
      if (i === 4) return { status: 0, text: '', err: String(e.message || e) };
      await new Promise(s => setTimeout(s, 1500));
    }
  }
};

console.log(`\n########## ${BASE} ##########\n`);

/* 1. 页面标题 */
const home = await get('/');
const title = (home.text.match(/<title>([^<]*)<\/title>/) || [])[1] || '(未取到)';
console.log('【1】首页      :', home.status, '| title =', title);

/* 2. 健康检查 */
const health = await get('/api/health');
let h = {};
try { h = JSON.parse(health.text); } catch {}
console.log('【2】健康检查  :', health.status,
  '| 频道', `${h.channels_enabled ?? '-'}/${h.channels_total ?? '-'}`,
  '| 插件', `${h.plugins_enabled ?? '-'}/${h.plugins_total ?? '-'}`);

/* 3. 搜索并统计分类 */
const body = JSON.stringify({
  kw: KW, refresh: false, res: 'merge', src: 'all',
  cloud_types: ['baidu', 'uc', 'quark'], filter: { include: [''], exclude: [] }
});
const s = await get('/api/search', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body
});
let j = {};
try { j = JSON.parse(s.text); } catch {}
const merged = j.data?.merged_by_type || j.merged_by_type || {};

const rows = Object.entries(merged)
  .map(([k, v]) => [k, LABEL[k] || k, v.length])
  .sort((a, b) => b[2] - a[2]);

const total = rows.reduce((n, r) => n + r[2], 0);
const otherCnt = rows.filter(r => r[0] === 'others' || r[0] === 'other').reduce((n, r) => n + r[2], 0);

console.log(`【3】搜索「${KW}」: HTTP ${s.status} | total=${j.data?.total ?? j.total} | 桶内合计=${total}`);
console.log('      分类分布  :', rows.map(r => `${r[1]}×${r[2]}`).join('  '));
console.log(`      其他网盘占比: ${total ? ((otherCnt / total) * 100).toFixed(1) : 0}%  ${otherCnt === 0 ? '✅ 全部识别成功' : otherCnt / total < 0.1 ? '✅ 占比很低' : '⚠️ 仍有较多未识别'}`);

// 打印「其他网盘」里的实际 URL，看是否真的无法识别
const othersArr = merged.others || merged.other || [];
if (othersArr.length) {
  console.log('      其他网盘样例:');
  othersArr.slice(0, 6).forEach(it => console.log('        -', String(it.url).slice(0, 78)));
} else {
  console.log('      其他网盘样例: (无)');
}

/* 4. 测活接口验证：挑各分类的第一条做探测 */
console.log('\n【4】自动测活（每类取 1 条）');
const probes = [];
for (const [k, list] of Object.entries(merged)) {
  if (probes.length >= 5) break;
  if (Array.isArray(list) && list.length) probes.push([k, list[0]]);
}

for (const [k, item] of probes) {
  const c = await get('/api/check', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url: item.url, password: item.password || '', type: k })
  });
  let d = {};
  try { d = JSON.parse(c.text); } catch {}
  console.log(`  ${(LABEL[k] || k).padEnd(8)} ${String(d.status).padEnd(8)} ${String(d.label || '').padEnd(12)} ${String(d.latency_ms ?? '-').padStart(6)}ms  [${d.method || '-'}] ${String(d.message || '').slice(0, 40)}`);
  console.log(`           ${String(item.url).slice(0, 76)}`);
}

console.log('');

/**
 * 验证 /api/search 是否返回 fish2018/pansou 标准的 { code, message, data } 结构。
 * 用法: node verify_data_field.mjs [域名] [关键词]
 */
const BASE = process.argv[2] || 'http://127.0.0.1:8787';
const kw = process.argv[3] || '现在不是出轨的问题';

const body = {
  kw,
  refresh: false,
  res: 'merge',
  src: 'all',
  cloud_types: ['baidu', 'uc', 'quark'],
  filter: { include: [''], exclude: [] }
};

const call = async (path, opt) => {
  for (let i = 0; i < 6; i++) {
    try {
      const r = await fetch(BASE + path, opt);
      const t = await r.text();
      try { return { status: r.status, json: JSON.parse(t) }; }
      catch { return { status: r.status, raw: t.slice(0, 120) }; }
    } catch (e) {
      if (i === 5) throw e;
      await new Promise(s => setTimeout(s, 1500));
    }
  }
};

const res = await call('/api/search', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body)
});

const j = res.json || {};
const counted = Object.entries(j.merged_by_type || {}).reduce((n, [, v]) => n + v.length, 0);
const inData = Object.entries(j.data?.merged_by_type || {}).reduce((n, [, v]) => n + v.length, 0);

console.log('状态码            :', res.status);
console.log('顶层 code/message :', j.code, '/', j.message);
console.log('是否有 data 字段  :', !!j.data, j.data ? '✅' : '❌');
console.log('data.total        :', j.data?.total);
console.log('顶层 total        :', j.total);
console.log('data 内链接数     :', inData);
console.log('顶层链接数        :', counted);
console.log('网盘分类          :', Object.keys(j.data?.merged_by_type || {}).join(', '));
console.log('data 与顶层一致   :', inData === counted ? '✅' : '❌');
console.log('样例              :', JSON.stringify(j.data?.merged_by_type?.baidu?.[0] || {}).slice(0, 160));

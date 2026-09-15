import worker from './dist/worker.mjs';

const env = { ADMIN_PASSWORD: 'admin', DEFAULT_CONCURRENCY: '8', CACHE_TTL: '300', TG_PROXY_URL: '' };
const ctx = { waitUntil() {}, passThroughOnException() {} };

const t0 = Date.now();
const req = new Request('https://example.com/api/search', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ keyword: '三体', result_type: 'merge' })
});
const res = await worker.fetch(req, env, ctx);
const data = await res.json();
console.log('状态:', res.status, '| 耗时:', ((Date.now() - t0) / 1000).toFixed(1) + 's');
console.log('总结果数:', data.total);
const merged = data.merged_by_type || {};
for (const [type, list] of Object.entries(merged)) {
  console.log(`\n== ${type} (${list.length}) ==`);
  list.slice(0, 3).forEach(it => console.log('  -', it.note.slice(0, 50), '|', it.url.slice(0, 60), it.password ? '| 码:' + it.password : ''));
}

import worker from './dist/worker.mjs';

const env = {
  ADMIN_PASSWORD: 'admin',
  DEFAULT_CONCURRENCY: '8',
  CACHE_TTL: '300',
  TG_PROXY_URL: ''
};
const ctx = { waitUntil() {}, passThroughOnException() {} };

async function hit(label, path, init) {
  try {
    const req = new Request('https://example.com' + path, init);
    const res = await worker.fetch(req, env, ctx);
    const text = await res.text();
    console.log(`[${res.status}] ${label}`);
    console.log('     ' + text.slice(0, 220).replace(/\n/g, ' '));
  } catch (e) {
    console.log(`[ERR] ${label} -> ${e.message}`);
  }
}

await hit('健康检查', '/api/health');
await hit('热门搜索', '/api/hot');
await hit('空关键词搜索(应400)', '/api/search');
await hit('管理接口-无密码(应401)', '/api/admin/settings');
await hit('管理接口-正确密码(应200)', '/api/admin/settings', { headers: { Authorization: 'Bearer admin' } });
await hit('首页UI', '/');
await hit('404', '/not-exist');

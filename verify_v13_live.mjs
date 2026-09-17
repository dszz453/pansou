/**
 * V1.3 线上验收
 * ============================================================
 * 覆盖用户能直接感知的六项改动 + 本轮修复的「结果展示选网盘不起作用」。
 *
 * 用法: node verify_v13_live.mjs [站点]
 *   默认 https://pansou.dszz.us.ci
 *
 * ⚠️ 会真实登录一次后台（用当前密码），触发「旧明文密码自动升级为哈希」。
 *    这是 V1.3 设计的迁移路径，不会改变密码本身的值。
 */
const BASE = (process.argv[2] || 'https://pansou.dszz.us.ci').replace(/\/$/, '');
const PWD = process.argv[3] || 'admin';
const H = { Authorization: 'Bearer ' + PWD, 'Content-Type': 'application/json' };

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`PASS  ${name}${extra ? '  -> ' + extra : ''}`); }
  else { fail++; console.log(`FAIL  ${name}${extra ? '  -> ' + extra : ''}`); }
};

const get = async (p, init) => {
  const r = await fetch(BASE + p, init);
  const text = await r.text();
  let json = null;
  try { json = JSON.parse(text); } catch {}
  return { status: r.status, headers: r.headers, text, json };
};

console.log(`\n站点: ${BASE}\n`);

/* ---------- 1. 版本与健康 ---------- */
console.log('──── 1 · 版本号与健康检查 ────');
const health = await get('/api/health');
ok('健康检查可用', health.status === 200 && health.json?.status === 'ok', `HTTP ${health.status}`);
ok('版本号为 1.3.0', health.json?.version === '1.3.0', String(health.json?.version));
ok('健康检查暴露 credentials_hashed 字段', 'credentials_hashed' in (health.json || {}),
  'credentials_hashed=' + health.json?.credentials_hashed);
ok('健康检查暴露 frontend_auth_enabled 字段', 'frontend_auth_enabled' in (health.json || {}),
  'frontend_auth_enabled=' + health.json?.frontend_auth_enabled);
console.log(`       频道 ${health.json?.channels_enabled}/${health.json?.channels_total}，插件 ${health.json?.plugins_enabled}/${health.json?.plugins_total}`);

/* ---------- 2. 配置接口不再被缓存（本次 bug 的根因） ---------- */
console.log('\n──── 2 · 配置类接口必须禁止中间层缓存 ────');
const uiCfg = await get('/api/ui-config');
ok('/api/ui-config 带 cache-control: no-store',
  /no-store/.test(uiCfg.headers.get('cache-control') || ''), uiCfg.headers.get('cache-control'));
ok('/api/ui-config 返回 1.3.0', uiCfg.json?.version === '1.3.0', String(uiCfg.json?.version));
ok('ui-config 下发网盘白名单',
  Array.isArray(uiCfg.json?.visible_cloud_types) && uiCfg.json.visible_cloud_types.length > 0,
  JSON.stringify(uiCfg.json?.visible_cloud_types));
ok('ui-config 下发网盘中文名映射',
  uiCfg.json?.cloud_labels && typeof uiCfg.json.cloud_labels === 'object',
  Object.keys(uiCfg.json?.cloud_labels || {}).length + ' 类');

const ch = await get('/api/channels');
ok('/api/channels 带 no-store', /no-store/.test(ch.headers.get('cache-control') || ''), ch.headers.get('cache-control'));
const pl = await get('/api/plugins');
ok('/api/plugins 带 no-store', /no-store/.test(pl.headers.get('cache-control') || ''), pl.headers.get('cache-control'));

/* ---------- 3. 首页结构（本次改动 2/3） ---------- */
console.log('\n──── 3 · 首页：去掉后台入口与 API 接口弹窗 ────');
const home = await get('/');
ok('首页可访问', home.status === 200, `HTTP ${home.status}`);
ok('首页不再有「管理后台」入口', home.text.indexOf('管理后台') < 0);
ok('首页不再有「API 接口」弹窗', home.text.indexOf('showApiModal') < 0);
ok('首页带 no-store（避免旧页面缓存）',
  /no-store/.test(home.headers.get('cache-control') || ''), home.headers.get('cache-control'));
ok('首页保留了搜索框', home.text.indexOf('search-box') >= 0);

/* ---------- 4. 后台结构（本次改动 3/4/5/6） ---------- */
console.log('\n──── 4 · 后台：API 接口页 / 插件逐源 / 前台密码 ────');
const admin = await get('/admin');
ok('后台页面可访问', admin.status === 200, `HTTP ${admin.status}`);
ok('后台带 noindex（不参与收录）', /noindex/.test(admin.headers.get('x-robots-tag') || ''),
  admin.headers.get('x-robots-tag'));
ok('后台有独立「API 接口」分区', admin.text.indexOf("key: 'api'") >= 0);
ok('后台「结果展示」分区仍在', admin.text.indexOf("key: 'display'") >= 0);
ok('插件区已改为按源逐行（含 pluginSources 状态）', admin.text.indexOf('pluginSources') >= 0);
ok('插件区已无「接口地址」输入项', admin.text.indexOf('接口地址') < 0);
ok('后台有「后台管理密码」设置项', admin.text.indexOf('后台管理密码') >= 0);
ok('后台有「前台访问密码」设置项', admin.text.indexOf('前台访问密码') >= 0);

/* ---------- 5. 后台密码哈希（本次改动 1） ---------- */
console.log('\n──── 5 · 后台密码：明文已升级为哈希 ────');
const before = health.json?.credentials_hashed;
const login = await get('/api/admin/settings', { headers: H });
// 注意：GET /api/admin/settings 直接返回配置对象本身（不包 code 字段），
// 所以判据是「拿得到 channels 数组」，而不是 code === 0。
ok('用当前密码可登录后台', login.status === 200 && Array.isArray(login.json?.channels),
  `HTTP ${login.status}, channels=${Array.isArray(login.json?.channels) ? login.json.channels.length : 'n/a'}`);
ok('后台配置不回传密码哈希',
  JSON.stringify(login.json || {}).indexOf('pbkdf2$') < 0);
ok('后台配置不回传明文密码字段',
  !('adminPassword' in (login.json || {})) || !login.json.adminPassword);
ok('后台暴露 admin_password_hashed 状态位', 'admin_password_hashed' in (login.json || {}),
  'admin_password_hashed=' + login.json?.admin_password_hashed);

const after = await get('/api/health');
ok('登录后密码已升级为哈希（credentials_hashed 转 true）',
  after.json?.credentials_hashed === true,
  `${before} -> ${after.json?.credentials_hashed}`);

/* ---------- 6. 结果展示：改完立刻生效（本次 bug） ---------- */
console.log('\n──── 6 · 结果展示：保存后必须立刻生效 ────');
const orig = (await get('/api/admin/settings', { headers: H })).json.visibleCloudTypes;
const TARGET = ['quark', 'aliyun'];

await fetch(BASE + '/api/admin/settings', {
  method: 'POST', headers: H, body: JSON.stringify({ visibleCloudTypes: TARGET })
});

const now = await get('/api/ui-config');
ok('保存后立刻读 ui-config 即为新值',
  JSON.stringify(now.json?.visible_cloud_types) === JSON.stringify(TARGET),
  JSON.stringify(now.json?.visible_cloud_types));
ok('绕过缓存再读一次，两边一致（确认不是「只有绕缓存才对」）',
  JSON.stringify((await get('/api/ui-config?fresh=' + Date.now())).json?.visible_cloud_types) === JSON.stringify(TARGET));

// 再读一次（模拟第二个 isolate / 第二次访问），确认不是偶然
await new Promise(s => setTimeout(s, 800));
const again = await get('/api/ui-config');
ok('延时复读仍为新值（多 isolate 内存缓存已不干扰）',
  JSON.stringify(again.json?.visible_cloud_types) === JSON.stringify(TARGET),
  JSON.stringify(again.json?.visible_cloud_types));

// 还原
await fetch(BASE + '/api/admin/settings', {
  method: 'POST', headers: H, body: JSON.stringify({ visibleCloudTypes: orig })
});
const restored = (await get('/api/ui-config')).json?.visible_cloud_types;
ok('还原成功', JSON.stringify(restored) === JSON.stringify(orig),
  `${restored?.length} 类 / 原始 ${orig?.length} 类`);

/* ---------- 7. 插件逐源开关 ---------- */
console.log('\n──── 7 · 插件源逐行开关可写回 ────');
const cfg = (await get('/api/admin/settings', { headers: H })).json;
const plugins = cfg.plugins || [];
ok('存在聚合节点配置', plugins.some(p => p.id === 'pansou_aggregate'),
  plugins.map(p => p.id).join(','));
const agg = plugins.find(p => p.id === 'pansou_aggregate');
ok('聚合节点内含 89 个子插件源', (agg?.pluginIds || []).length === 89,
  (agg?.pluginIds || []).length + ' 个');
ok('插件源备注字段可下发', cfg.pluginSourceLabels === undefined || typeof cfg.pluginSourceLabels === 'object');

/* ---------- 8. KV 里是否真的不再有明文密码（可选：需要 CF_TOKEN） ---------- */
const CF_TOKEN = process.env.CF_TOKEN;
const CF_ACCOUNT = process.env.CF_ACCOUNT;
const CF_KV_NS = process.env.CF_KV_NS;
if (CF_TOKEN && CF_ACCOUNT && CF_KV_NS) {
  console.log('\n──── 8 · KV 存储：明文密码确已清除 ────');
  try {
    const r = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT}/storage/kv/namespaces/${CF_KV_NS}/values/pansou_system_settings`,
      { headers: { Authorization: 'Bearer ' + CF_TOKEN } }
    );
    const raw = await r.text();
    const kv = JSON.parse(raw);
    ok('KV 中已无明文 adminPassword 字段', !kv.adminPassword, JSON.stringify(kv.adminPassword));
    ok('KV 中存在 PBKDF2 哈希', String(kv.adminPasswordHash || '').startsWith('pbkdf2$sha256$'),
      String(kv.adminPasswordHash || '').slice(0, 30) + '...');
    ok('整份配置里搜不到明文 "admin" 密码串',
      raw.indexOf('"adminPassword":"admin"') < 0);
    const parts = String(kv.adminPasswordHash || '').split('$');
    ok('哈希串自描述迭代次数与随机盐', parts.length === 5 && Number(parts[2]) > 0 && parts[3].length === 32,
      `iter=${parts[2]} salt=${parts[3]?.length}字节`);
  } catch (e) {
    fail++;
    console.log('FAIL  读取 KV 失败（不影响其余结论） ->', e.message);
  }
} else {
  console.log('\n（跳过 KV 明文核查：未提供 CF_TOKEN / CF_ACCOUNT / CF_KV_NS）');
}

console.log('\n========================================================');
console.log(fail === 0 ? `==== ${pass}/${pass} passed ====` : `==== ${pass} passed, ${fail} FAILED ====`);
console.log('========================================================');
process.exit(fail === 0 ? 0 : 1);

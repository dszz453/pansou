/**
 * V1.3 特性回归（离线运行，零网络依赖）
 * ============================================================
 * 覆盖本次发版的六项改动：
 *   1. 后台密码改为 PBKDF2-SHA256 加盐哈希存储（含旧明文自动升级）
 *   2. 首页移除「管理后台」入口
 *   3. API 文档迁到后台独立 Tab
 *   4. 插件区删掉「接口地址」字段
 *   5. 插件改为「按源逐行开关」
 *   6. 前台访问密码开关（可复用后台密码 / 独立密码）
 *
 * 用法:
 *   node verify_v13.mjs
 *
 * 实现要点：每个场景都用一个**全新的 worker 模块实例 + 空 KV**，
 * 靠 `import('./dist/worker.js?case=N')` 拿到新的模块作用域，
 * 否则模块内的 settingsCache（60 秒 TTL）会把上一个场景的配置带过来。
 */

import { readFile } from 'node:fs/promises';

const BASE = 'https://pansou.dszz.us.ci';

/** 期望版本号读 package.json，发版时不用回来改断言（version.ts 是运行时唯一来源） */
const PKG = JSON.parse(await readFile(new URL('./package.json', import.meta.url), 'utf8'));
const EXPECT_VERSION = PKG.version;
const EXPECT_LABEL = 'V' + EXPECT_VERSION.replace(/\.\d+$/, '');
let seq = 0;

const loadWorker = async () => (await import('./dist/worker.js?case=' + ++seq)).default;

/** 最小可用 KV 实现（只需要 get / put / delete） */
function makeKV(seed) {
  const store = new Map();
  if (seed) for (const [k, v] of Object.entries(seed)) store.set(k, v);
  return {
    store,
    async get(k) {
      return store.has(k) ? store.get(k) : null;
    },
    async put(k, v) {
      store.set(k, String(v));
    },
    async delete(k) {
      store.delete(k);
    }
  };
}

const CTX = {
  waitUntil(p) {
    try {
      if (p && typeof p.catch === 'function') p.catch(() => {});
    } catch (e) {}
  },
  passThroughOnException() {}
};

const results = [];
function check(name, ok, detail) {
  results.push({ name, ok, detail });
  console.log((ok ? 'PASS  ' : 'FAIL  ') + name + (detail ? '  -> ' + detail : ''));
}

function scenario(title) {
  console.log('\n──── ' + title + ' ────');
}

const json = (body, token) =>
  Object.assign(
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) },
    token ? { headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token } } : {}
  );

async function get(worker, env, path, token, extraHeaders) {
  const headers = Object.assign({}, extraHeaders || {});
  if (token) headers.Authorization = 'Bearer ' + token;
  return worker.fetch(new Request(BASE + path, { headers }), env, CTX);
}

async function post(worker, env, path, body, opts) {
  const o = opts || {};
  const headers = { 'Content-Type': 'application/json' };
  if (o.token) headers.Authorization = 'Bearer ' + o.token;
  if (o.feToken) headers['X-Frontend-Token'] = o.feToken;
  return worker.fetch(
    new Request(BASE + path, { method: 'POST', headers, body: JSON.stringify(body) }),
    env,
    CTX
  );
}

const SETTINGS_KEY = 'pansou_system_settings';

/* ============================================================
 * 场景 1：页面结构（入口位置调整）
 * ============================================================ */
async function scenePages() {
  scenario('场景 1 · 首页与后台的入口/内容位置');
  const worker = await loadWorker();
  const env = { PANSOU_KV: makeKV() };

  const home = await (await get(worker, env, '/')).text();
  check('首页 200 且挂载点存在', home.includes('<div id="app"'));
  check('首页版本号已是 V1.3', home.includes('V1.3'));
  check('首页已移除「管理后台」入口', !home.includes('管理后台'), 'grep 管理后台');
  check('首页已移除 /admin 链接', !home.includes('href="/admin"'));
  check('首页已移除 API 弹窗状态', !home.includes('showApiModal'));
  check('首页已移除旧后台弹窗', !home.includes('showAdminModal'));
  check('首页含前台登录门', home.includes('unlock') && home.includes('需要访问密码'));

  const admin = await (await get(worker, env, '/admin')).text();
  check('后台 200', admin.length > 1000);
  check('后台含版本号 ' + EXPECT_LABEL, admin.includes(EXPECT_LABEL));
  check('后台新增「API 接口」Tab', admin.includes("key: 'api'") && admin.includes('API 接口'));
  check('后台含接口文档数据', admin.includes('apiGroups') && admin.includes('/api/frontend/auth'));
  check('后台插件区已删除接口地址字段', !admin.includes('v-model="pl.apiEndpoint"'));
  check('后台插件区已删除展开编辑区', !admin.includes('expandedPlugin'));
  check('后台插件区改为按源一行', admin.includes('v-model="src.enabled"') && admin.includes('pluginSources'));
  check('后台含前台访问密码开关', admin.includes('frontendAuthEnabled'));
  check('后台含密码哈希说明', admin.includes('PBKDF2'));

  const health = await (await get(worker, env, '/api/health')).json();
  check(
    'health 版本与 package.json 一致',
    health.version_label === EXPECT_LABEL && health.version === EXPECT_VERSION,
    health.version + ' / ' + health.version_label
  );
  check('health 暴露前台开关状态', health.frontend_auth_enabled === false);
  check('health 暴露凭据存储方式', health.credentials_hashed === false, String(health.credentials_hashed));
}

/* ============================================================
 * 场景 2：后台密码哈希化
 * ============================================================ */
async function scenePassword() {
  scenario('场景 2 · 后台密码哈希存储');
  const worker = await loadWorker();
  const kv = makeKV();
  const env = { PANSOU_KV: kv };

  // 默认密码 admin 可登录
  let r = await get(worker, env, '/api/admin/settings', 'admin');
  check('默认密码 admin 可登录', r.status === 200, 'status=' + r.status);

  const body = await r.json();
  check('接口不回传明文密码字段', !('adminPassword' in body), Object.keys(body).join(','));
  check('接口不回传密码哈希', !('adminPasswordHash' in body));
  check(
    '接口只回传状态位',
    typeof body.admin_password_set === 'boolean' && typeof body.admin_password_hashed === 'boolean'
  );
  check('出厂状态被标记为「默认密码」', body.admin_password_is_default === true);

  // 只用内置默认密码登录时，不应该往 KV 里写哈希
  check('默认密码登录后 KV 仍为空（不产生假配置）', (kv.store.get(SETTINGS_KEY) || '') === '');

  // 修改密码
  r = await post(worker, env, '/api/admin/settings', { adminPassword: 'S3cret!Pass' }, { token: 'admin' });
  check('修改密码请求成功', r.status === 200 && (await r.json()).code === 0);

  // KV 里必须是哈希，不是明文
  const raw = kv.store.get(SETTINGS_KEY) || '';
  check('KV 中不再出现明文密码', !raw.includes('S3cret!Pass'), '明文泄漏');
  check('KV 中存的是 pbkdf2 哈希串', /"adminPasswordHash":"pbkdf2\$sha256\$\d+\$[0-9a-f]+\$[0-9a-f]+"/.test(raw));
  check('KV 中旧明文字段已清空', !/"adminPassword":"[^"]+"/.test(raw));
  check('哈希串带迭代次数', /pbkdf2\$sha256\$10000\$/.test(raw), '迭代次数');

  // 旧密码失效 / 新密码可用
  check('旧密码 admin 已失效', (await get(worker, env, '/api/admin/settings', 'admin')).status === 401);
  check('新密码可登录', (await get(worker, env, '/api/admin/settings', 'S3cret!Pass')).status === 200);
  check('错误密码被拒', (await get(worker, env, '/api/admin/settings', 'wrong-pwd')).status === 401);

  // 同一密码两次哈希结果必须不同（盐随机）
  const rawAgain = JSON.parse(kv.store.get(SETTINGS_KEY));
  const firstHash = rawAgain.adminPasswordHash;
  await post(worker, env, '/api/admin/settings', { adminPassword: 'S3cret!Pass' }, { token: 'S3cret!Pass' });
  const secondHash = JSON.parse(kv.store.get(SETTINGS_KEY)).adminPasswordHash;
  check('相同密码两次哈希不同（随机盐生效）', firstHash !== secondHash);
  check('旧哈希仍可校验通过（迭代次数随串存储）', (await get(worker, env, '/api/admin/settings', 'S3cret!Pass')).status === 200);

  // 历史明文自动升级
  scenario('场景 2b · 历史明文密码自动升级为哈希');
  const worker2 = await loadWorker();
  const kv2 = makeKV({
    [SETTINGS_KEY]: JSON.stringify({ adminPassword: 'legacy-123', concurrency: 6, cacheTtl: 300, channels: [], plugins: [] })
  });
  const env2 = { PANSOU_KV: kv2 };
  check('旧明文密码可登录', (await get(worker2, env2, '/api/admin/settings', 'legacy-123')).status === 200);
  const raw2 = kv2.store.get(SETTINGS_KEY) || '';
  check('登录后自动升级为哈希', /"adminPasswordHash":"pbkdf2\$sha256\$/.test(raw2));
  check('升级后明文被擦除', !raw2.includes('legacy-123'));
  check('升级后新密码仍可用', (await get(worker2, env2, '/api/admin/settings', 'legacy-123')).status === 200);
}

/* ============================================================
 * 场景 3：插件按源逐行开关
 * ============================================================ */
async function scenePlugins() {
  scenario('场景 3 · 插件按源逐行开关');
  const worker = await loadWorker();
  const kv = makeKV();
  const env = { PANSOU_KV: kv };

  // 保存：两个原生源启用 + 一个第三方节点停用 + 一条备注
  let r = await post(
    worker,
    env,
    '/api/admin/settings',
    {
      plugins: [
        { id: 'melost', name: '影盘社', enabled: true, type: 'native' },
        { id: 'ouge', name: '欧格资源', enabled: true, type: 'native' },
        {
          id: 'pansou_aggregate',
          name: 'PanSou 聚合节点',
          enabled: false,
          type: 'pansou',
          apiEndpoint: 'https://example.com/api/search',
          pluginIds: ['hunhepan', 'clxiong']
        }
      ],
      pluginSourceLabels: { clxiong: '磁力熊' }
    },
    { token: 'admin' }
  );
  check('保存插件源配置成功', r.status === 200 && (await r.json()).code === 0);

  const saved = JSON.parse(kv.store.get(SETTINGS_KEY));
  // V1.4：原生源各自独立成条；第三方节点保留自己的 apiEndpoint / pluginIds。
  // 提交顺序与落盘顺序必须一致 —— 若迁移在保存路径上又跑了一次，
  // 这里会看到原生源被补齐、聚合节点被强制停用，用户的显式选择被覆盖。
  check(
    '插件提交顺序原样落盘（迁移未在保存路径重跑）',
    JSON.stringify(saved.plugins.map(p => p.id)) === '["melost","ouge","pansou_aggregate"]',
    JSON.stringify(saved.plugins.map(p => p.id))
  );
  check('原生源按条目独立落盘', saved.plugins.filter(p => p.type === 'native').length === 2);
  check('第三方节点保留 pluginIds', JSON.stringify(saved.plugins[2].pluginIds) === '["hunhepan","clxiong"]');
  check('源备注写入 pluginSourceLabels', saved.pluginSourceLabels.clxiong === '磁力熊');

  const plugins = await (await get(worker, env, '/api/plugins')).json();
  // 原生源没有 apiEndpoint，判定「启用」时不能只看 endpoint
  check(
    '/api/plugins 返回启用的原生源',
    plugins.enabled === 2 && plugins.plugins.filter(p => p.type === 'native').length === 2,
    'enabled=' + plugins.enabled
  );
  check('/api/plugins 带出备注映射', plugins.plugins[0].pluginLabels.clxiong === '磁力熊');
  check('/api/plugins 不再外泄节点地址', !('apiEndpoint' in plugins.plugins[0]), Object.keys(plugins.plugins[0]).join(','));

  // 全部关闭 → 没有任何启用源
  await post(
    worker,
    env,
    '/api/admin/settings',
    {
      plugins: [
        { id: 'melost', name: '影盘社', enabled: false, type: 'native' },
        {
          id: 'pansou_aggregate',
          name: 'PanSou 聚合节点',
          enabled: false,
          type: 'pansou',
          apiEndpoint: 'https://example.com/api/search',
          pluginIds: []
        }
      ]
    },
    { token: 'admin' }
  );
  const plugins2 = await (await get(worker, env, '/api/plugins')).json();
  check('源全部关闭后节点停用（enabled=0）', plugins2.enabled === 0, 'enabled=' + plugins2.enabled);

  // 备注被清空（后台每次都会整份提交备注对象，显式传空对象即可清空）
  await post(
    worker,
    env,
    '/api/admin/settings',
    { pluginSourceLabels: {} },
    { token: 'admin' }
  );
  const saved2 = JSON.parse(kv.store.get(SETTINGS_KEY));
  check('提交空备注对象可清空备注', !saved2.pluginSourceLabels || !saved2.pluginSourceLabels.clxiong,
    JSON.stringify(saved2.pluginSourceLabels));

  // 不提交该字段时应当保持原值（部分更新语义）
  await post(worker, env, '/api/admin/settings', { pluginSourceLabels: { clxiong: '磁力熊' } }, { token: 'admin' });
  await post(worker, env, '/api/admin/settings', { concurrency: 7 }, { token: 'admin' });
  const saved3 = JSON.parse(kv.store.get(SETTINGS_KEY));
  check('缺省字段保持原值（部分更新）', saved3.pluginSourceLabels.clxiong === '磁力熊' && saved3.concurrency === 7);
}

/* ============================================================
 * 场景 4：前台访问密码
 * ============================================================ */
async function sceneFrontendAuth() {
  scenario('场景 4 · 前台访问密码（独立密码）');
  const worker = await loadWorker();
  const kv = makeKV();
  const env = { PANSOU_KV: kv };

  // 关闭状态下数据接口公开
  check('未开启时 /api/channels 公开', (await get(worker, env, '/api/channels')).status === 200);
  let cfg = await (await get(worker, env, '/api/ui-config')).json();
  check('ui-config 默认关闭前台密码', cfg.frontend_auth_enabled === false);

  // 设置独立前台密码
  let r = await post(
    worker,
    env,
    '/api/admin/settings',
    { frontendAuthEnabled: true, frontendPasswordMode: 'custom', frontendPassword: 'guest-888' },
    { token: 'admin' }
  );
  check('保存前台密码成功', r.status === 200 && (await r.json()).code === 0);

  const raw = kv.store.get(SETTINGS_KEY);
  check('前台密码同样只存哈希', /"frontendPasswordHash":"pbkdf2\$sha256\$/.test(raw) && !raw.includes('guest-888'));

  cfg = await (await get(worker, env, '/api/ui-config')).json();
  check('ui-config 反映已开启', cfg.frontend_auth_enabled === true);
  const settings = await (await get(worker, env, '/api/admin/settings', 'admin')).json();
  check('后台可见「已设置独立密码」', settings.frontend_password_set === true);
  check('后台不回传前台密码哈希', !('frontendPasswordHash' in settings));

  // 数据接口开始拦截
  check('无令牌 /api/channels 被拦 (401)', (await get(worker, env, '/api/channels')).status === 401);
  check('无令牌 /api/search 被拦 (401)', (await post(worker, env, '/api/search', { kw: '三体' })).status === 401);
  check('无令牌 /api/check 被拦 (401)', (await get(worker, env, '/api/check?url=https://pan.quark.cn/s/x')).status === 401);
  check('无令牌 /api/debug/tg 被拦 (401)', (await get(worker, env, '/api/debug/tg')).status === 401);

  // 公开接口不受影响
  check('公开接口 /api/hot 仍可用', (await get(worker, env, '/api/hot')).status === 200);
  check('公开接口 /api/ui-config 仍可用', (await get(worker, env, '/api/ui-config')).status === 200);
  check('公开接口 /api/health 仍可用', (await get(worker, env, '/api/health')).status === 200);
  check('公开接口 /api/debug/cache 仍可用', (await get(worker, env, '/api/debug/cache')).status === 200);

  // 换令牌
  check('错误前台密码被拒 (401)', (await post(worker, env, '/api/frontend/auth', { password: 'nope' })).status === 401);
  r = await post(worker, env, '/api/frontend/auth', { password: 'guest-888' });
  const auth = await r.json();
  check('正确前台密码换取令牌', r.status === 200 && typeof auth.token === 'string' && auth.token.length === 40, auth.token);
  check('令牌内不含明文密码', !String(auth.token).includes('guest'));

  check(
    '携带令牌可访问数据接口',
    (await get(worker, env, '/api/channels', null, { 'X-Frontend-Token': auth.token })).status === 200
  );
  check(
    '伪造令牌被拒',
    (await get(worker, env, '/api/channels', null, { 'X-Frontend-Token': 'deadbeef' })).status === 401
  );
  check(
    '管理员密码可直接穿透前台门禁',
    (await get(worker, env, '/api/channels', 'admin')).status === 200
  );

  // 改前台密码 → 旧令牌立即失效
  await post(
    worker,
    env,
    '/api/admin/settings',
    { frontendPassword: 'guest-999' },
    { token: 'admin' }
  );
  check(
    '改密码后旧令牌立即失效',
    (await get(worker, env, '/api/channels', null, { 'X-Frontend-Token': auth.token })).status === 401
  );
  const newAuth = await (await post(worker, env, '/api/frontend/auth', { password: 'guest-999' })).json();
  check('新密码换到新令牌', typeof newAuth.token === 'string' && newAuth.token !== auth.token);

  /* ---- 复用后台密码模式 ---- */
  scenario('场景 4b · 前台密码复用后台密码');
  const worker2 = await loadWorker();
  const kv2 = makeKV();
  const env2 = { PANSOU_KV: kv2 };
  await post(worker2, env2, '/api/admin/settings', { adminPassword: 'boss-pwd-1' }, { token: 'admin' });
  await post(
    worker2,
    env2,
    '/api/admin/settings',
    { frontendAuthEnabled: true, frontendPasswordMode: 'reuse' },
    { token: 'boss-pwd-1' }
  );
  check('复用模式下前台可用后台密码换取令牌', (await post(worker2, env2, '/api/frontend/auth', { password: 'boss-pwd-1' })).status === 200);

  const token2 = (await (await post(worker2, env2, '/api/frontend/auth', { password: 'boss-pwd-1' })).json()).token;
  await post(worker2, env2, '/api/admin/settings', { adminPassword: 'boss-pwd-2' }, { token: 'boss-pwd-1' });
  check(
    '复用模式下改后台密码，前台旧令牌同步失效',
    (await get(worker2, env2, '/api/channels', null, { 'X-Frontend-Token': token2 })).status === 401
  );
  check('复用模式下新后台密码可换前台令牌', (await post(worker2, env2, '/api/frontend/auth', { password: 'boss-pwd-2' })).status === 200);

  /* ---- 清除独立密码 ---- */
  scenario('场景 4c · 清除独立密码后自动退回复用');
  const worker3 = await loadWorker();
  const kv3 = makeKV();
  const env3 = { PANSOU_KV: kv3 };
  await post(
    worker3,
    env3,
    '/api/admin/settings',
    { frontendAuthEnabled: true, frontendPasswordMode: 'custom', frontendPassword: 'tmp-123' },
    { token: 'admin' }
  );
  await post(
    worker3,
    env3,
    '/api/admin/settings',
    { clearFrontendPassword: true, frontendPasswordMode: 'custom' },
    { token: 'admin' }
  );
  const s3 = await (await get(worker3, env3, '/api/admin/settings', 'admin')).json();
  check('清除后不再标记「已设置独立密码」', s3.frontend_password_set !== true);
  check('模式自动退回 reuse', s3.frontendPasswordMode === 'reuse', s3.frontendPasswordMode);
  check('退回复用时后台密码即可解锁前台', (await post(worker3, env3, '/api/frontend/auth', { password: 'admin' })).status === 200);
}

/* ============================================================
 * 场景 5：旧配置兼容
 * ============================================================ */
async function sceneCompat() {
  scenario('场景 5 · 旧版 KV 配置兼容');
  const worker = await loadWorker();
  const kv = makeKV({
    [SETTINGS_KEY]: JSON.stringify({
      adminPassword: 'old-plain',
      channels: [{ name: 'PanjClub', enabled: true, priority: 1 }],
      plugins: [
        {
          id: 'pansou_aggregate',
          name: 'PanSou 聚合节点（89 个插件源）',
          enabled: true,
          type: 'pansou',
          apiEndpoint: 'https://so.252035.xyz/api/search',
          pluginIds: ['hunhepan', 'jikepan', 'panwiki']
        }
      ],
      resultCacheMode: 'memory',
      visibleCloudTypes: ['quark', 'aliyun'],
      showAutoCheck: true
    })
  });
  const env = { PANSOU_KV: kv };

  // 注意：health 必须在登录**之前**读 —— 用旧明文登录成功会自动触发哈希升级
  const healthBefore = await (await get(worker, env, '/api/health')).json();
  check('升级前 health 标记为未哈希', healthBefore.credentials_hashed === false);
  check('升级前 health 前台开关为关', healthBefore.frontend_auth_enabled === false);

  const s = await (await get(worker, env, '/api/admin/settings', 'old-plain')).json();
  // V1.4 迁移：老配置（只有第三方聚合节点）读出来时会补入原生源，并把聚合节点停用。
  // 只在「KV 里真的存着老配置」时触发一次 —— 保存路径不会重跑（出厂默认值已带版本号）。
  const agg = (s.plugins || []).find(p => p.id === 'pansou_aggregate') || {};
  const natives = (s.plugins || []).filter(p => p.type === 'native');
  check(
    '旧配置补入 3 个原生源且默认启用',
    natives.length === 3 && natives.every(p => p.enabled !== false),
    JSON.stringify((s.plugins || []).map(p => p.id))
  );
  check('旧配置的聚合节点被停用（搜索不再依赖第三方）', agg.enabled === false);
  check('聚合节点原有 pluginIds 未被丢弃', (agg.pluginIds || []).length === 3);
  check('旧配置缺省字段补全', s.frontendAuthEnabled === false && s.frontendPasswordMode === 'reuse');
  check('节点地址仍在（后台不展示但保存时保留）', agg.apiEndpoint === 'https://so.252035.xyz/api/search');

  const plugins = await (await get(worker, env, '/api/plugins')).json();
  check(
    '旧配置的插件源正常暴露（只剩 3 个原生源）',
    plugins.enabled === 3 && plugins.plugins.every(p => p.type === 'native'),
    'enabled=' + plugins.enabled
  );
  const health = await (await get(worker, env, '/api/health')).json();
  check('登录一次后 health 转为「已哈希」', health.credentials_hashed === true);
  check('旧配置健康检查正常', health.status === 'ok' && health.channels_enabled === 1);
}

/* ============================================================
 * 场景 6：多 isolate 下的配置可见性
 *
 * 真实事故：用户反馈「后台结果展示选网盘不起作用」。
 * 根因是后台读取走的是 isolate 内存缓存，而 Cloudflare 会同时跑多个 isolate ——
 * 保存完立刻刷新，请求落到另一个还抱着旧配置的实例上，看到的就是保存前的值。
 * ============================================================ */
async function sceneIsolateStaleness() {
  scenario('场景 6 · 保存后立刻读取必须拿到最新配置');
  const kv = makeKV();
  const envA = { PANSOU_KV: kv };
  const envB = { PANSOU_KV: kv };
  const workerA = await loadWorker();
  const workerB = await loadWorker();

  // A 先把初始配置读进自己的内存缓存
  const before = await (await get(workerA, envA, '/api/ui-config')).json();
  check('A 读到初始配置（14 类）', before.visible_cloud_types.length === 14, String(before.visible_cloud_types.length));

  // B 保存一份新配置（模拟处理保存请求的那台实例）
  await post(workerB, envB, '/api/admin/settings', { visibleCloudTypes: ['quark', 'aliyun'] }, { token: 'admin' });

  // A 再读后台配置：必须跳过内存缓存，拿到最新值
  const after = await (await get(workerA, envA, '/api/admin/settings', 'admin')).json();
  check(
    'A 读后台配置拿到最新值（已跳过内存缓存）',
    JSON.stringify(after.visibleCloudTypes) === '["quark","aliyun"]',
    JSON.stringify(after.visibleCloudTypes)
  );

  // A 再读前台配置：这条才是「结果展示选网盘」真正走的那条路，
  // 也必须跳过内存缓存 —— 否则用户看到的就是「后台选了没用」。
  const afterUi = await (await get(workerA, envA, '/api/ui-config')).json();
  check(
    'A 读 /api/ui-config 也拿到最新值（前台展示同一份数据）',
    JSON.stringify(afterUi.visible_cloud_types) === '["quark","aliyun"]',
    JSON.stringify(afterUi.visible_cloud_types)
  );

  // 再来一轮「写入 → 立刻读」，确认不是只有第一次巧合命中
  await post(workerB, envB, '/api/admin/settings', { visibleCloudTypes: ['baidu'] }, { token: 'admin' });
  const round2 = await (await get(workerA, envA, '/api/ui-config')).json();
  check(
    '第二轮回写后立刻读仍是最新值',
    JSON.stringify(round2.visible_cloud_types) === '["baidu"]',
    JSON.stringify(round2.visible_cloud_types)
  );
  await post(workerB, envB, '/api/admin/settings', { visibleCloudTypes: ['quark', 'aliyun'] }, { token: 'admin' });

  // 配置类接口不能被中间层缓存住
  for (const p of ['/api/ui-config', '/api/channels', '/api/plugins']) {
    const res = await get(workerA, envA, p);
    check(`${p} 带 no-store（不被边缘缓存）`, res.headers.get('Cache-Control') === 'no-store', res.headers.get('Cache-Control'));
  }

  // 配置改动要在很短时间内跨 isolate 可见（内存缓存 TTL 上限）
  const workerC = await loadWorker();
  const envC = { PANSOU_KV: kv };
  const cached = await (await get(workerC, envC, '/api/ui-config')).json();
  check('新 isolate 立即看到新配置', cached.visible_cloud_types.length === 2, String(cached.visible_cloud_types.length));
}

/* ============================================================
 * 主流程
 * ============================================================ */
console.log('PanSou Edge · V1.3 特性回归（离线）\n' + '='.repeat(56));

await scenePages();
await scenePassword();
await scenePlugins();
await sceneFrontendAuth();
await sceneCompat();
await sceneIsolateStaleness();

const failed = results.filter(x => !x.ok);
console.log('\n' + '='.repeat(56));
console.log(`==== ${results.length - failed.length}/${results.length} passed ====`);
if (failed.length) {
  console.log('FAILED:');
  failed.forEach(f => console.log(' - ' + f.name + ' :: ' + (f.detail || '')));
  process.exit(1);
}

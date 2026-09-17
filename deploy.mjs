#!/usr/bin/env node
/**
 * 一键部署 PanSou Edge 到 Cloudflare Workers
 *
 * 用法：
 *   node deploy.mjs <API_TOKEN> [ACCOUNT_ID] [WORKER_NAME]
 *
 * 或使用环境变量：
 *   CLOUDFLARE_API_TOKEN=xxx CLOUDFLARE_ACCOUNT_ID=yyy node deploy.mjs
 *
 * 需要的 Token 权限（Account 级）：
 *   - Workers Scripts : Edit
 *   - Workers KV Storage : Edit   （可选，用于后台配置持久化）
 *
 * 说明：即使没有 KV 权限，脚本也会自动降级为「无 KV 模式」继续部署，
 *      此时后台配置保存在内存中（重启后恢复默认值），功能仍可正常使用。
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const API = 'https://api.cloudflare.com/client/v4';

const token = process.argv[2] || process.env.CLOUDFLARE_API_TOKEN || '';
const accountId = process.argv[3] || process.env.CLOUDFLARE_ACCOUNT_ID || '';
const workerName = process.argv[4] || process.env.WORKER_NAME || 'pansou';

// 后台默认变量（可在 CF 控制台或此处修改）
const VARS = {
  ADMIN_PASSWORD: process.env.ADMIN_PASSWORD || 'admin',
  DEFAULT_CONCURRENCY: process.env.DEFAULT_CONCURRENCY || '8',
  CACHE_TTL: process.env.CACHE_TTL || '300',
  TG_PROXY_URL: process.env.TG_PROXY_URL || ''
};

const COMPAT_DATE = '2024-09-23';
const COMPAT_FLAGS = ['nodejs_compat'];

if (!token) {
  console.error('❌ 缺少 API Token。用法: node deploy.mjs <API_TOKEN> [ACCOUNT_ID]');
  process.exit(1);
}
if (!accountId) {
  console.error('❌ 缺少 Account ID。用法: node deploy.mjs <API_TOKEN> <ACCOUNT_ID>');
  process.exit(1);
}

const auth = { Authorization: `Bearer ${token}` };

async function api(method, url, { json, form } = {}) {
  const res = await fetch(`${API}${url}`, {
    method,
    headers: json ? { ...auth, 'Content-Type': 'application/json' } : auth,
    body: json ? JSON.stringify(json) : form
  });
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = { raw: text };
  }
  return { ok: res.ok, status: res.status, data };
}

function die(msg, data) {
  console.error(`❌ ${msg}`);
  if (data) console.error(JSON.stringify(data, null, 2).slice(0, 1200));
  process.exit(1);
}

(async () => {
  console.log('=== PanSou Edge 部署开始 ===\n');

  // ---------- 0. 校验 Token 与账号 ----------
  const acc = await api('GET', `/accounts/${accountId}`);
  if (!acc.ok) die('Token 无效或无该账号的读取权限', acc.data);
  console.log(`✅ 账号: ${acc.data.result?.name || accountId}`);

  // ---------- 1. 读取构建产物 ----------
  const bundlePath = path.join(__dirname, 'dist', 'worker.js');
  if (!fs.existsSync(bundlePath)) {
    die('未找到 dist/worker.js，请先执行: npm run build');
  }
  const code = fs.readFileSync(bundlePath, 'utf8');
  console.log(`✅ 构建产物: dist/worker.js (${(code.length / 1024).toFixed(1)} KB)`);

  // ---------- 2. 准备/复用 KV 命名空间（可选） ----------
  let kvId = null;
  try {
    const list = await api('GET', `/accounts/${accountId}/storage/kv/namespaces?per_page=100`);
    if (list.ok && Array.isArray(list.data.result)) {
      const found = list.data.result.find((n) => n.title === 'PANSOU_KV');
      if (found) {
        kvId = found.id;
        console.log(`✅ 复用已有 KV: PANSOU_KV (${kvId})`);
      }
    }
    if (!kvId) {
      const created = await api('POST', `/accounts/${accountId}/storage/kv/namespaces`, {
        json: { title: 'PANSOU_KV' }
      });
      if (created.ok && created.data.result?.id) {
        kvId = created.data.result.id;
        console.log(`✅ 新建 KV: PANSOU_KV (${kvId})`);
      } else {
        console.warn('⚠️  KV 创建失败（可能缺少 KV 权限），将以「无 KV 模式」继续部署');
        console.warn(`    ${created.data?.errors?.[0]?.message || ''}`);
      }
    }
  } catch (e) {
    console.warn('⚠️  KV 步骤异常，跳过:', e.message);
  }

  // ---------- 3. 组装 metadata 与绑定 ----------
  const bindings = Object.entries(VARS)
    .filter(([, v]) => v !== '')
    .map(([name, text]) => ({ type: 'plain_text', name, text }));

  if (kvId) {
    bindings.push({ type: 'kv_namespace', name: 'PANSOU_KV', namespace_id: kvId });
  }

  const metadata = {
    main_module: 'worker.js',
    compatibility_date: COMPAT_DATE,
    compatibility_flags: COMPAT_FLAGS,
    bindings,
    observability: { enabled: true }
  };

  // ---------- 4. 上传 Worker 脚本 (multipart/form-data) ----------
  const form = new FormData();
  form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
  form.append(
    'worker.js',
    new Blob([code], { type: 'application/javascript+module' }),
    'worker.js'
  );

  const up = await api('PUT', `/accounts/${accountId}/workers/scripts/${workerName}`, { form });
  if (!up.ok) {
    die(
      'Worker 上传失败。请确认 Token 具备 Account → Workers Scripts → Edit 权限',
      up.data
    );
  }
  console.log(`✅ Worker 已上传: ${workerName}${kvId ? ' (含 KV 绑定)' : ' (无 KV 绑定)'}`);

  // ---------- 5. 开启 workers.dev 访问 ----------
  let subdomain = acc.data.result?.subdomain || '';
  const sub = await api('GET', `/accounts/${accountId}/workers/subdomain`);
  if (sub.ok && sub.data.result?.subdomain) {
    subdomain = sub.data.result.subdomain;
  }

  const enable = await api('POST', `/accounts/${accountId}/workers/scripts/${workerName}/subdomain`, {
    json: { enabled: true, previews_enabled: true }
  });
  if (enable.ok) {
    console.log('✅ 已开启 workers.dev 公网访问');
  } else {
    console.warn(`⚠️  开启访问失败: ${enable.data?.errors?.[0]?.message || '未知错误'}`);
  }

  // ---------- 6. 输出结果 ----------
  const url = subdomain
    ? `https://${workerName}.${subdomain}.workers.dev`
    : `https://${workerName}.<你的子域>.workers.dev`;

  console.log('\n=== 🎉 部署完成 ===\n');
  console.log(`  站点首页 : ${url}`);
  console.log(`  后台管理 : ${url}/admin  (独立页面，首页右上角也有入口)`);
  console.log(`  管理密码 : ${VARS.ADMIN_PASSWORD}`);
  console.log(`  健康检查 : ${url}/api/health`);
  console.log(`  搜索接口 : ${url}/api/search?kw=三体&res=merge`);
  console.log('\n  兼容 pansou-web / fish2018/pansou 接口规范：');
  console.log('    GET  /api/search?kw=<关键词>&res=merge|all|results');
  console.log('    POST /api/search  {"keyword":"...","res":"merge","cloud_types":[]}');
  console.log('    GET  /api/health');
  console.log('    GET  /api/hot\n');
})();

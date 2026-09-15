/**
 * 把 Cloudflare KV 中保存的系统设置重置为「干净默认值」：
 *   - 全部 143 个 TG 频道启用（保留默认优先级：前 24 个 priority=1，其余 priority=2）
 *   - 移除已废弃的第三方聚合节点 plugins（代码里已无插件引擎，属死数据）
 *   - 保留原有的 adminPassword / hotSearches（若存在）
 *
 * 用法: node reset_settings.mjs <API_TOKEN> <ACCOUNT_ID> <KV_NAMESPACE_ID>
 */
import { execSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const [, , token, accountId, kvId] = process.argv;
if (!token || !accountId || !kvId) {
  console.error('用法: node reset_settings.mjs <API_TOKEN> <ACCOUNT_ID> <KV_NAMESPACE_ID>');
  process.exit(1);
}

// 1. 用 esbuild 把 src/defaults.ts 单独打包，拿到权威的默认频道清单
writeFileSync(
  'build_defaults.mjs',
  `import * as esbuild from 'esbuild';
await esbuild.build({
  entryPoints: ['src/defaults.ts'],
  bundle: true, format: 'esm', outfile: 'dist/_defaults.mjs',
  platform: 'neutral', target: 'es2022', logLevel: 'error'
});
`
);
execSync('node build_defaults.mjs', { stdio: 'inherit' });
const { DEFAULT_CHANNELS, ALL_CHANNELS } = await import('./dist/_defaults.mjs');

const API = 'https://api.cloudflare.com/client/v4';
const H = { Authorization: `Bearer ${token}` };
const base = `${API}/accounts/${accountId}/storage/kv/namespaces/${kvId}/values`;

// 2. 读取现有设置（可能不存在）
let current = null;
const curRes = await fetch(`${base}/pansou_system_settings`, { headers: H });
if (curRes.ok) {
  const txt = await curRes.text();
  if (txt) {
    try {
      current = JSON.parse(txt);
    } catch {
      console.warn('⚠️ 现有设置不是合法 JSON，将整体覆盖');
    }
  }
}

const next = {
  adminPassword: current?.adminPassword || 'admin',
  concurrency: current?.concurrency || 8,
  cacheTtl: current?.cacheTtl || 300,
  tgProxyUrl: current?.tgProxyUrl || '',
  maxChannelsPerSearch: Math.min(current?.maxChannelsPerSearch || 8, 10),
  channels: DEFAULT_CHANNELS,
  hotSearches:
    Array.isArray(current?.hotSearches) && current.hotSearches.length
      ? current.hotSearches
      : ['庆余年', '繁花', '流浪地球', '沙丘', '黑神话悟空', '三体']
};

console.log('频道总数:', next.channels.length, '| 全部启用:', next.channels.every((c) => c.enabled));
console.log('priority=1:', next.channels.filter((c) => c.priority === 1).length);
console.log('保留 adminPassword:', next.adminPassword === 'admin' ? 'admin(默认)' : '(自定义，已保留)');
console.log('移除 plugins 字段:', current?.plugins ? `是（原 ${current.plugins.length} 个）` : '无此字段');

// 3. 写回 KV
const put = await fetch(`${base}/pansou_system_settings`, {
  method: 'PUT',
  headers: { ...H, 'Content-Type': 'text/plain' },
  body: JSON.stringify(next)
});
const putJson = await put.json();
if (!put.ok || putJson.success === false) {
  console.error('❌ 写入失败:', put.status, JSON.stringify(putJson.errors || putJson));
  process.exit(1);
}
console.log(`✅ 已写入 KV（${ALL_CHANNELS.length} 个频道全部启用）`);

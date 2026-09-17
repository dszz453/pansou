/**
 * 线上实战验收：第三方聚合节点的「子源开关」到底有没有真的生效
 * ------------------------------------------------------------------
 * 用法:
 *   node verify_plugin_switch_live.mjs before            # 只读基线（不改配置）
 *   node verify_plugin_switch_live.mjs apply             # 启用 8 个实测有产出的第三方源（不含原生的 melost）
 *   node verify_plugin_switch_live.mjs revert            # 还原为「聚合节点停用、子源全恢复启用」
 *   node verify_plugin_switch_live.mjs single <srcId>    # 只放行一个子源，验证 plugins= 过滤是真生效
 *
 * 只打 us.ci（qzz.io 的 node fetch 在沙箱里不通，要验得改用 curl）。
 * `single` 是最有说服力的一档：把 89 个子源关到只剩 1 个，
 * 若返回的插件来源只有那 1 个源，就说明 `plugins=` 查询参数真的在过滤
 * （V1.5 之前清单走的是 `X-Plugins` 请求头，被节点完全忽略，开关形同虚设）。
 *
 * ⚠️ 每档都会改线上配置。跑完 `revert` 收尾；读回配置要**轮询**，
 *    写完立刻读可能命中另一个 isolate 的 15s 内存缓存，拿到上一轮的值。
 */
import { writeFileSync } from 'node:fs';

const SITE = 'https://pansou.dszz.us.ci';
const H = { 'Content-Type': 'application/json', Authorization: 'Bearer admin' };
const MODE = process.argv[2] || 'before';

/** 实测有产出的 9 个（melost 已是本站原生源，不重复挂到节点上） */
const ALIVE = ['melost', 'lingjisp', 'wanou', 'ouge', 'nyaa', 'huban', 'clxiong', 'xiaozhang', 'mizixing'];
const ALIVE_NON_NATIVE = ALIVE.filter(x => x !== 'melost');

const sleep = ms => new Promise(s => setTimeout(s, ms));
const getSettings = async () => (await (await fetch(SITE + '/api/admin/settings', { headers: H })).json());

/** 写配置 + 轮询直到读回一致（isolate 内存缓存最长滞后一个 TTL，不轮询会把旧值当成失败） */
async function saveAndConfirm(body, fields) {
  await fetch(SITE + '/api/admin/settings', { method: 'POST', headers: H, body: JSON.stringify(body) });
  const keys = Object.keys(fields);
  for (let i = 0; i < 12; i++) {
    await sleep(1500);
    const s = await getSettings();
    const node = (s.plugins || []).find(p => p.id === 'pansou_aggregate');
    if (!node) continue;
    if (keys.every(k => JSON.stringify(node[k]) === JSON.stringify(fields[k]))) return { ok: true, node, tries: i + 1 };
  }
  const last = await getSettings();
  return { ok: false, node: (last.plugins || []).find(p => p.id === 'pansou_aggregate') };
}

async function search(kw) {
  const r = await fetch(SITE + '/api/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ kw, plugins_only: true, res: 'merge', refresh: true })
  });
  const j = await r.json();
  const merged = j.merged_by_type || {};
  let total = 0;
  const sources = {};
  for (const type of Object.keys(merged)) {
    for (const item of merged[type] || []) {
      total++;
      const s = String(item.source || '(unknown)');
      sources[s] = (sources[s] || 0) + 1;
    }
  }
  const pluginSources = Object.keys(sources).filter(k => k.startsWith('plugin:')).sort((a, b) => sources[b] - sources[a]);
  const tgSources = Object.keys(sources).filter(k => k.startsWith('tg:')).sort((a, b) => sources[b] - sources[a]);
  return {
    total,
    meta: j.meta || {},
    pluginSources: pluginSources.map(k => k + '=' + sources[k]),
    tgCount: tgSources.reduce((n, k) => n + sources[k], 0),
    tgSample: tgSources.slice(0, 3).map(k => k + '=' + sources[k])
  };
}

const health = await (await fetch(SITE + '/api/health')).json();
console.log(`站点 ${SITE}  版本 ${health.version} / ${health.version_label}`);

const settings = await getSettings();
const node = (settings.plugins || []).find(p => p.id === 'pansou_aggregate');
console.log(`聚合节点：enabled=${node.enabled} · pluginIds=${(node.pluginIds || []).length} · ` +
  `disabledPluginIds=${(node.disabledPluginIds || []).length}`);

if (MODE === 'apply') {
  const disabled = (node.pluginIds || []).filter(id => !ALIVE_NON_NATIVE.includes(id));
  const r = await saveAndConfirm(
    {
      plugins: (settings.plugins || []).map(p =>
        p.id === 'pansou_aggregate'
          ? { ...p, enabled: true, disabledPluginIds: disabled }
          : p
      )
    },
    { enabled: true, disabledPluginIds: disabled }
  );
  console.log(`启用第三方源 ${ALIVE_NON_NATIVE.length} 个 / 停用 ${disabled.length} 个 → 配置确认 ${r.ok ? '一致（第 ' + r.tries + ' 次读到）' : '未生效'}`);
} else if (MODE === 'revert') {
  const r = await saveAndConfirm(
    {
      plugins: (settings.plugins || []).map(p =>
        p.id === 'pansou_aggregate' ? { ...p, enabled: false, disabledPluginIds: [] } : p
      )
    },
    { enabled: false, disabledPluginIds: [] }
  );
  console.log(`聚合节点已停用、子源状态复位 → 配置确认 ${r.ok ? '一致（第 ' + r.tries + ' 次读到）' : '未生效'}`);
} else if (MODE === 'single') {
  // 只放行一个子源：剩下的全部写进 disabledPluginIds。
  // 若节点只回这一个源（且不带 tg: 频道），就证明子源过滤走的是 plugins= 查询参数。
  const only = process.argv[3];
  if (!only) throw new Error('single 模式需要指定一个子源 id，例如：single clxiong');
  const all = node.pluginIds || [];
  const disabled = all.filter(id => id !== only);
  const r = await saveAndConfirm(
    {
      plugins: (settings.plugins || []).map(p =>
        p.id === 'pansou_aggregate'
          ? { ...p, enabled: true, disabledPluginIds: disabled }
          : p
      )
    },
    { enabled: true, disabledPluginIds: disabled }
  );
  console.log(`只放行 ${only}（其余 ${disabled.length} 个停用）→ 配置确认 ${r.ok ? '一致（第 ' + r.tries + ' 次读到）' : '未生效'}`);
}

const rows = [];
for (const kw of ['西游记', '流浪地球', '庆余年']) {
  const r = await search(kw);
  rows.push({ kw, ...r });
  console.log(
    `\n「${kw}」总 ${r.total} 条 · 插件相关 meta=${JSON.stringify({
      plugins_queried: r.meta.plugins_queried,
      plugins_ok: r.meta.plugins_ok,
      plugins_failed: r.meta.plugins_failed
    })}`
  );
  console.log('  插件来源：' + (r.pluginSources.join('  ') || '（无）'));
  console.log('  节点自带 TG 频道条数：' + r.tgCount + (r.tgSample.length ? '  ' + r.tgSample.join(' ') : ''));
}

writeFileSync(`_live_${MODE}.json`, JSON.stringify({ health, node, rows }, null, 2), 'utf8');
console.log(`\n已写出 _live_${MODE}.json`);

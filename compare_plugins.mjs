/**
 * 对比「纯频道」「纯插件」「合并」三种模式的结果，量化插件增益。
 * 用法: BASE=https://域名 node compare_plugins.mjs <关键词...>
 */
const BASE = process.env.BASE || 'https://pansou.dszz.us.ci';
const kws = process.argv.slice(2);
if (kws.length === 0) kws.push('流浪地球');

const { channels, shard_size } = await (await fetch(BASE + '/api/channels')).json();
const plInfo = await (await fetch(BASE + '/api/plugins')).json();
console.log('频道 ' + channels.length + ' 个（分片 ' + shard_size + '）| 插件 ' + plInfo.enabled + '/' + plInfo.total + '\n');

/** 并发跑完全部请求，返回 url -> item 的去重表 */
const collect = async (count, body) => {
  const seen = new Map();
  let cursor = 0;
  const CONC = 4;
  const worker = async () => {
    while (true) {
      const i = cursor++;
      if (i >= count) return;
      try {
        const r = await fetch(BASE + '/api/search', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body(i))
        });
        const d = await r.json();
        for (const [t, list] of Object.entries(d.merged_by_type || {})) {
          for (const it of list) if (!seen.has(it.url)) seen.set(it.url, { type: t, ...it });
        }
      } catch (e) {}
    }
  };
  await Promise.all(new Array(CONC).fill(0).map(worker));
  return seen;
};

const shards = [];
for (let i = 0; i < channels.length; i += shard_size) {
  shards.push(channels.slice(i, i + shard_size));
}

for (const kw of kws) {
  const t0 = Date.now();
  const ch = await collect(shards.length, (i) => ({ kw, channels: shards[i], res: 'merge' }));
  const tCh = ((Date.now() - t0) / 1000).toFixed(1);

  const t1 = Date.now();
  const pl = await collect(1, () => ({ kw, plugins_only: true, res: 'merge' }));
  const tPl = ((Date.now() - t1) / 1000).toFixed(1);

  const union = new Map(ch);
  let added = 0;
  for (const [url, it] of pl) {
    if (!union.has(url)) {
      union.set(url, it);
      added++;
    }
  }

  const src = {};
  for (const it of pl.values()) src[it.source] = (src[it.source] || 0) + 1;
  const plOnly = Object.keys(src).filter((s) => s.startsWith('plugin:'));

  console.log('「' + kw + '」');
  console.log('   纯频道       : ' + String(ch.size).padStart(4) + ' 条  (' + tCh + 's)');
  console.log('   纯插件       : ' + String(pl.size).padStart(4) + ' 条  (' + tPl + 's)');
  console.log('   合并去重后   : ' + String(union.size).padStart(4) + ' 条   ← 插件新增 ' + added + ' 条');
  console.log('   插件独有来源 : ' + (plOnly.map((s) => s.replace('plugin:', '') + '(' + src[s] + ')').join(', ') || '(无)'));
  console.log('');
}

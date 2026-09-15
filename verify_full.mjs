/**
 * 端到端验证：模拟前端「分片并发」调度，跑全量 143 个频道
 * 用法: node verify_full.mjs <关键词...>
 */
const BASE = 'https://pansou.dszz.us.ci';
const CONCURRENCY = 4;

const keywords = process.argv.slice(2);
if (keywords.length === 0) keywords.push('流浪地球');

const { channels, shard_size } = await (await fetch(`${BASE}/api/channels`)).json();
console.log(`频道总数 ${channels.length}，分片大小 ${shard_size}\n`);

for (const kw of keywords) {
  const t0 = Date.now();
  const shards = [];
  for (let i = 0; i < channels.length; i += shard_size) shards.push(channels.slice(i, i + shard_size));

  const merged = {};
  const seen = new Set();
  let cursor = 0;
  let okShards = 0;

  const worker = async () => {
    while (true) {
      const idx = cursor++;
      if (idx >= shards.length) return;
      try {
        const r = await fetch(`${BASE}/api/search`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ kw, channels: shards[idx], res: 'merge' })
        });
        const d = await r.json();
        if (d._meta && d._meta.channels_ok > 0) okShards++;
        const byType = d.merged_by_type || {};
        for (const t in byType) {
          if (!merged[t]) merged[t] = [];
          for (const it of byType[t]) {
            if (seen.has(it.url)) continue;
            seen.add(it.url);
            merged[t].push(it);
          }
        }
      } catch (e) {
        /* 忽略单片失败 */
      }
    }
  };

  await Promise.all(new Array(Math.min(CONCURRENCY, shards.length)).fill(0).map(worker));

  const types = Object.entries(merged)
    .sort((a, b) => b[1].length - a[1].length)
    .map(([k, v]) => `${k}:${v.length}`)
    .join('  ');

  console.log(`「${kw}」 总计 ${seen.size} 条 | 有效分片 ${okShards}/${shards.length} | ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  console.log(`   分类: ${types || '(空)'}`);
  const all = [];
  for (const [t, l] of Object.entries(merged)) for (const it of l) all.push([t, it]);
  all.slice(0, 5).forEach(([t, it]) => console.log(`   [${t}] 「${String(it.note).slice(0, 50)}」`));
  console.log('');
}

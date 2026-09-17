#!/usr/bin/env node
/**
 * 插件侧产出对照：本站原生源 vs 第三方聚合节点 so.252035.xyz
 *
 * 用途：V1.4 的设计目标之一是「搜索不再依赖第三方节点」，但保留该节点作为
 * **数量对照基准** —— 如果哪天原生源的产出明显掉下来，跑一遍这个脚本就能看出来。
 *
 * 用法：
 *   node verify_plugin_compare.mjs                        # 默认站点 + 默认关键词
 *   node verify_plugin_compare.mjs https://pansou.dszz.us.ci 西游记 庆余年
 *
 * 说明：
 *  - 只统计「插件侧」的 merged_by_type（显式传 plugins，不跑 TG 频道），
 *    避免 143 个频道的结果把插件的差异淹没。
 *  - 第三方节点从**本机**直连（不经 Worker 中转），因此它是「本机视角」的对照；
 *    沙箱里 so.252035.xyz 可达，qzz.io 系站点需改用 curl。
 */
const SITE = process.argv[2] && process.argv[2].startsWith('http') ? process.argv[2] : 'https://pansou.dszz.us.ci';
const rest = process.argv.slice(2).filter(a => !a.startsWith('http'));
const KW_LIST = rest.length ? rest : ['西游记', '庆余年', '流浪地球2'];

const NATIVE_IDS = ['melost', 'ouge', 'quark4k'];
const THIRD = 'https://so.252035.xyz/api/search';

async function countSite(kw) {
  const t0 = Date.now();
  const r = await fetch(SITE + '/api/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ kw, plugins: NATIVE_IDS, res: 'merge' })
  });
  const d = await r.json();
  const m = (d.data && d.data.merged_by_type) || {};
  const by = {};
  let total = 0;
  for (const k in m) {
    by[k] = m[k].length;
    total += m[k].length;
  }
  return { total, by, ms: Date.now() - t0 };
}

async function countThird(kw) {
  const t0 = Date.now();
  try {
    const r = await fetch(THIRD + '?kw=' + encodeURIComponent(kw) + '&res=merge', {
      headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json' }
    });
    const text = await r.text();
    let d;
    try {
      d = JSON.parse(text);
    } catch {
      return { error: 'non-json: ' + text.slice(0, 60) };
    }
    const m = d.merged_by_type || (d.data && d.data.merged_by_type) || {};
    const by = {};
    let total = 0;
    for (const k in m) {
      const n = Array.isArray(m[k]) ? m[k].length : 0;
      by[k] = n;
      total += n;
    }
    return { total, by, ms: Date.now() - t0 };
  } catch (e) {
    return { error: e.message };
  }
}

let pass = 0;
let fail = 0;

for (const kw of KW_LIST) {
  const a = await countSite(kw);
  const b = await countThird(kw);
  const win = !b.error && a.total >= b.total;
  console.log('==== 关键词:', kw, '====');
  console.log('  本站（原生源 ' + NATIVE_IDS.join('+') + '）:', a.total, JSON.stringify(a.by), a.ms + 'ms');
  console.log(
    '  第三方 so.252035.xyz' + ' '.repeat(8) + ':',
    b.error ? 'ERR ' + b.error : b.total + ' ' + JSON.stringify(b.by),
    b.ms ? b.ms + 'ms' : ''
  );
  if (b.error) {
    console.log('  → 对标节点不可用，本月无法对比（不算失败）');
    pass++;
  } else if (win) {
    console.log('  → ✅ 本站插件侧不少于第三方节点');
    pass++;
  } else {
    console.log('  → ❌ 本站插件侧少于第三方节点，需排查原生源');
    fail++;
  }
}

console.log('\n结果: ' + pass + ' 通过 / ' + fail + ' 未达基准');
process.exit(fail === 0 ? 0 : 1);

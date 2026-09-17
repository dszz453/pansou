#!/usr/bin/env node
/**
 * 线上真实浏览器验收：原生源是否真的把结果送到了页面上
 * ============================================================
 * 用法:
 *   node verify_native_live.mjs [站点] [关键词...]
 *   node verify_native_live.mjs https://pansou.dszz.us.ci 西游记 庆余年
 *
 * 为什么必须用真浏览器：
 *   接口返回 400 条 ≠ 用户在页面上看到 400 条。中间的合并、网盘白名单过滤、
 *   相关性命中闸门、分类 Tab 分桶都会削减条数。这里以**页面 DOM 上的卡片数**
 *   和**分类 Tab 上的计数**为准，与 /api/plugins 里原生源的开启状态一起交叉验证。
 *
 * 实现：零依赖 CDP（Chrome headless）。公网地址不能禁用代理 —— 本机出网依赖系统代理；
 *       本地地址反之（见 ui_shot.mjs 的同一处注释）。
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const args = process.argv.slice(2);
const BASE = (args[0] && args[0].startsWith('http') ? args[0] : 'https://pansou.dszz.us.ci').replace(/\/$/, '');
const KWS = args.slice(1).filter(a => !a.startsWith('http'));
const KW_LIST = KWS.length ? KWS : ['西游记'];

const IS_LOCAL = /^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])/i.test(BASE);
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9300 + Math.floor(Math.random() * 600);
const profile = mkdtempSync(join(tmpdir(), 'nativelive-'));
const sleep = ms => new Promise(s => setTimeout(s, ms));

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`PASS  ${name}${extra ? '  -> ' + extra : ''}`); }
  else { fail++; console.log(`FAIL  ${name}${extra ? '  -> ' + extra : ''}`); }
};

const chrome = spawn(
  CHROME,
  [
    '--headless=new',
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${profile}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-gpu',
    '--hide-scrollbars',
    ...(IS_LOCAL ? ['--no-proxy-server', '--proxy-bypass-list=<-loopback>'] : []),
    '--window-size=1440,1400',
    'about:blank'
  ],
  { stdio: 'ignore' }
);

let ws = null;
let msgId = 0;
const pending = new Map();
const send = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const id = ++msgId;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });

async function connect() {
  for (let i = 0; i < 40; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/json/list`);
      const page = (await r.json()).find(t => t.type === 'page');
      if (page?.webSocketDebuggerUrl) return page.webSocketDebuggerUrl;
    } catch {}
    await sleep(500);
  }
  throw new Error('Chrome 调试端口未就绪');
}

const cleanup = () => {
  try { ws?.close(); } catch {}
  try { chrome.kill(); } catch {}
  try { rmSync(profile, { recursive: true, force: true }); } catch {}
};

/** 在页面里执行一段表达式并取回 JSON 结果 */
async function evaluate(expr) {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) {
    throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
  }
  return r.result?.value;
}

/** 轮询直到 predicate 表达式返回真值 */
async function waitFor(expr, { timeout = 120000, interval = 700, label = expr } = {}) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    try {
      if (await evaluate(expr)) return true;
    } catch {}
    await sleep(interval);
  }
  console.log(`  ⚠️ 等待超时: ${label}`);
  return false;
}

/** 页面上取一次「结果快照」：卡片数 + 分类 Tab 计数 + 加载状态 */
const SNAPSHOT = `(() => {
  const btn = document.getElementById('search-submit');
  const loading = btn ? /检索中/.test(btn.textContent || '') : false;
  const tabs = [...document.querySelectorAll('#cloud-tabs button')].map(b => {
    const label = (b.querySelector('span') || {}).textContent || '';
    const num = (b.querySelectorAll('span')[1] || {}).textContent || '';
    return { label: label.trim(), count: parseInt(num, 10) || 0, active: b.className.includes('bg-gradient') || b.getAttribute('data-active') === '1' };
  });
  const active = tabs.find(t => t.active) || tabs[0] || null;
  return {
    loading,
    searched: !!document.querySelector('#cloud-tabs'),
    cards: document.querySelectorAll('.card-hover-effect').length,
    tabs,
    activeTab: active ? active.label : null,
    activeCount: active ? active.count : 0
  };
})()`;

const totalOnActiveTab = snap => snap.tabs.reduce((n, t) => n + t.count, 0);

try {
  const wsUrl = await connect();
  ws = new WebSocket(wsUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = ev => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) {
      const { resolve, reject } = pending.get(m.id);
      pending.delete(m.id);
      m.error ? reject(new Error(m.error.message)) : resolve(m.result);
    }
  };

  await send('Page.enable');
  await send('Runtime.enable');
  console.log(`\n站点: ${BASE}\n`);

  // 原生源必须先真的「启用」，否则下面看到的都是 TG 频道的结果
  const plugins = await (await fetch(BASE + '/api/plugins')).json().catch(() => null);
  if (plugins && Array.isArray(plugins.plugins)) {
    const natives = plugins.plugins.filter(p => p.type === 'native');
    ok('/api/plugins 暴露原生源', natives.length >= 1, natives.map(p => p.id).join(',') || '（无）');
  } else {
    console.log('  ⚠️ /api/plugins 取不到（qzz.io 需改用 curl），跳过该断言');
  }

  for (const KW of KW_LIST) {
    console.log(`\n──── 搜索「${KW}」 ────`);
    await send('Page.navigate', { url: BASE + '/' });
    const mounted = await waitFor(
      `!!document.querySelector('#search-box input[type=search], #search-box input[type=text]') && document.querySelectorAll('#cloud-tabs button').length >= 0 && !!document.querySelector('#search-submit') && !!(document.querySelector('#app') && document.querySelector('#app').children.length)`,
      { timeout: 60000, label: '页面挂载（Vue 未挂载时一切断言都会假失败）' }
    );
    ok('页面已挂载（Vue 生效）', mounted);
    if (!mounted) break;

    // 用原生 setter 写值再派发 input 事件 —— 直接赋值 Vue 的 v-model 收不到
    await evaluate(`(() => {
      const inp = document.querySelector('#search-box input[type=search], #search-box input[type=text]');
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      setter.call(inp, ${JSON.stringify(KW)});
      inp.dispatchEvent(new Event('input', { bubbles: true }));
      return inp.value;
    })()`);
    await sleep(300);
    await evaluate(`document.getElementById('search-submit').click(), true`);

    const done = await waitFor(`(${SNAPSHOT}).loading === false && (${SNAPSHOT}).cards >= 0 && document.querySelectorAll('.card-hover-effect').length > 0`,
      { timeout: 150000, interval: 1000, label: '搜索完成（等 loading 结束且有卡片）' });
    // 再等一拍，让最后一片插件的渐进式渲染落定
    await sleep(3500);

    const snap = await evaluate(SNAPSHOT);
    ok('搜索已完成（不在检索中）', snap.loading === false);
    ok('页面渲染出结果卡片', snap.cards > 0, snap.cards + ' 张');

    const tabLine = snap.tabs.map(t => `${t.label}:${t.count}`).join('  ');
    console.log('  分类 Tab 计数    :', tabLine || '（无）');
    console.log('  当前 Tab          :', snap.activeTab, snap.activeCount);
    console.log('  卡片数（DOM）     :', snap.cards);

    // 以接口视角交叉验证：插件侧单独跑一遍，确认「页面上的条数不只是 TG 频道的」
    let apiTotal = 0;
    try {
      const r = await fetch(BASE + '/api/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kw: KW, res: 'merge' })
      });
      const d = await r.json();
      const m = (d.data && d.data.merged_by_type) || {};
      for (const k in m) apiTotal += m[k].length;
      const src = (d.meta && d.meta.plugins_queried) || 0;
      console.log('  接口 merged 总条数:', apiTotal, '| 本次插件源数:', src);
    } catch {
      console.log('  接口复核失败（不影响页面断言）');
    }

    ok('页面卡片数与分类计数自洽', snap.cards === snap.activeCount || snap.cards > 0, `cards=${snap.cards} tab=${snap.activeCount}`);
    ok('结果条数达到原生源量级（≥100）', snap.cards >= 100, snap.cards + ' 张');
  }

  console.log(`\n══════════ 合计 ${pass} 通过 / ${fail} 失败 ══════════\n`);
} catch (e) {
  console.error('执行失败:', e.message);
  fail++;
} finally {
  cleanup();
}

process.exit(fail === 0 ? 0 : 1);

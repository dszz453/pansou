/**
 * 「后台结果展示选网盘不起作用」端到端回归
 * ============================================================
 * 真实链路：后台保存白名单 → /api/ui-config → 浏览器首屏 → 真实搜索 → DOM 上的分类 Tab
 *
 * 关键点：搜索本身要联网打 TG 频道，沙箱里不可靠，所以只把 /api/search 与 /api/check
 * 换成桩响应，其余（/api/ui-config、/api/channels、/api/plugins、首页 HTML）全部走真服务，
 * 确保被测的是真实的配置下发 + 真实的前端过滤逻辑。
 *
 * 用法: node verify_display_e2e.mjs
 */
import { spawn } from 'node:child_process';
import { writeFileSync, mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 8900 + Math.floor(Math.random() * 300);
const CDP_PORT = 9500 + Math.floor(Math.random() * 400);
const BASE = `http://127.0.0.1:${PORT}`;

const sleep = ms => new Promise(s => setTimeout(s, ms));

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`PASS  ${name}${extra ? '  -> ' + extra : ''}`); }
  else { fail++; console.log(`FAIL  ${name}${extra ? '  -> ' + extra : ''}`); }
};

/* ---------------- 1. 本地真服务 ---------------- */
const server = spawn(process.execPath, ['serve-local.mjs', String(PORT)], {
  cwd: process.cwd(),
  stdio: 'ignore'
});

let ws = null;
const profile = mkdtempSync(join(tmpdir(), 'disp-e2e-'));
let chrome = null;

const cleanup = () => {
  try { ws?.close(); } catch {}
  try { chrome?.kill(); } catch {}
  try { server.kill(); } catch {}
  try { rmSync(profile, { recursive: true, force: true }); } catch {}
};

/* ---------------- CDP 小工具 ---------------- */
let msgId = 0;
const pending = new Map();
const send = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const id = ++msgId;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });

async function connectCDP() {
  for (let i = 0; i < 50; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`);
      const page = (await r.json()).find(t => t.type === 'page');
      if (page?.webSocketDebuggerUrl) return page.webSocketDebuggerUrl;
    } catch {}
    await sleep(400);
  }
  throw new Error('Chrome 调试端口未就绪');
}

/* ---------------- 搜索结果桩：故意包含「未勾选」的网盘 ---------------- */
const SEARCH_STUB = `
(() => {
  const mk = (t, i) => ({
    url: 'https://example.com/' + t + '/' + i,
    note: '测试资源 ' + t + ' 第 ' + i + ' 条',
    password: '', datetime: new Date().toISOString(),
    source: 'tg:stub', cloudType: t
  });
  const body = {
    code: 0,
    merged_by_type: {
      quark:  [mk('quark', 1), mk('quark', 2)],
      aliyun: [mk('aliyun', 1)],
      magnet: [mk('magnet', 1), mk('magnet', 2), mk('magnet', 3)],
      ed2k:   [mk('ed2k', 1)]
    }
  };
  const jsonRes = (obj) => new Response(JSON.stringify(obj), {
    status: 200, headers: { 'Content-Type': 'application/json' }
  });
  const orig = window.fetch;
  window.fetch = function (input, init) {
    const url = typeof input === 'string' ? input : (input && input.url) || '';
    if (url.indexOf('/api/search') >= 0) return Promise.resolve(jsonRes(body));
    if (url.indexOf('/api/check') >= 0) return Promise.resolve(jsonRes({ code: 0, results: {} }));
    if (url.indexOf('/api/hot') >= 0) return Promise.resolve(jsonRes({ code: 0, hot: [] }));
    return orig.apply(this, arguments);
  };
})();
`;

try {
  // 等服务起来
  let up = false;
  for (let i = 0; i < 40; i++) {
    try { const r = await fetch(BASE + '/api/health'); if (r.ok) { up = true; break; } } catch {}
    await sleep(400);
  }
  if (!up) throw new Error('本地服务未启动');
  console.log(`\n本地服务已就绪: ${BASE}\n`);

  const H = { Authorization: 'Bearer admin', 'Content-Type': 'application/json' };

  /* ============ 场景 A：配置下发链路 ============ */
  console.log('──── 场景 A · 后台保存后配置必须立刻下发 ────');

  // 先读一份完整默认，便于之后还原
  const full = await (await fetch(BASE + '/api/admin/settings', { headers: H })).json();
  const FULL_VISIBLE = full.visibleCloudTypes;

  const TARGET = ['quark'];
  await fetch(BASE + '/api/admin/settings', {
    method: 'POST', headers: H, body: JSON.stringify({ visibleCloudTypes: TARGET })
  });

  const cfg = await (await fetch(BASE + '/api/ui-config')).json();
  ok('保存后 /api/ui-config 立刻反映新白名单',
    JSON.stringify(cfg.visible_cloud_types) === JSON.stringify(TARGET),
    JSON.stringify(cfg.visible_cloud_types));
  ok('ui-config 不再带边缘缓存头（cache-control: no-store）',
    /no-store/.test((await fetch(BASE + '/api/ui-config')).headers.get('cache-control') || ''),
    (await fetch(BASE + '/api/ui-config')).headers.get('cache-control'));

  /* ============ 场景 B：浏览器里的真实渲染 ============ */
  console.log('\n──── 场景 B · 浏览器端只应展示勾选的网盘 ────');

  chrome = spawn(CHROME, [
    '--headless=new',
    `--remote-debugging-port=${CDP_PORT}`,
    `--user-data-dir=${profile}`,
    '--no-first-run', '--no-default-browser-check', '--disable-gpu', '--hide-scrollbars',
    '--no-proxy-server', '--proxy-bypass-list=<-loopback>',
    '--window-size=1440,1200',
    'about:blank'
  ], { stdio: 'ignore' });

  ws = new WebSocket(await connectCDP());
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = ev => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) {
      const { resolve, reject } = pending.get(m.id);
      pending.delete(m.id);
      m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result);
    }
  };

  await send('Page.enable');
  await send('Runtime.enable');
  const evaluate = async (expression, awaitPromise = false) => {
    const res = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise });
    if (res.exceptionDetails) {
      throw new Error(res.exceptionDetails.text + ' :: ' + (res.exceptionDetails.exception?.description || ''));
    }
    return res.result?.value;
  };

  // 在页面任何脚本之前装好搜索桩
  await send('Page.addScriptToEvaluateOnNewDocument', { source: SEARCH_STUB });

  await send('Page.navigate', { url: BASE + '/?debug=1' });
  await sleep(3500);

  const boot = await evaluate(`({
    landed: location.href,
    hasApp: !!window.__pansouApp,
    hasSearchBox: !!document.getElementById('search-box')
  })`);
  ok('页面已在目标地址挂载', String(boot.landed).startsWith(BASE) && boot.hasSearchBox, boot.landed);

  // 注：visibleCloudTypes / cloudFilterActive 是 setup 内部变量，没有挂到返回对象上，
  //     所以只能从行为侧验证 —— 直接看真实请求打到哪个接口、返回了什么。
  const cfgSeen = await evaluate(`(async () => {
    const r = await fetch('/api/ui-config');
    return await r.json();
  })()`, true);
  ok('页面同源拉到的 ui-config 已是受限白名单',
    JSON.stringify(cfgSeen.visible_cloud_types) === JSON.stringify(TARGET),
    JSON.stringify(cfgSeen.visible_cloud_types));

  // 触发真实搜索流程（只有 /api/search 是桩，其余走真服务）
  await evaluate(`(() => {
    const inp = document.querySelector('#search-box input[type=search], #search-box input[type=text]');
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(inp, '测试关键词');
    inp.dispatchEvent(new Event('input', { bubbles: true }));
    document.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    return true;
  })()`);
  await sleep(6000);

  const dom = await evaluate(`(() => {
    const tabs = document.getElementById('cloud-tabs');
    const labels = tabs ? [...tabs.children].map(el => el.textContent.trim().replace(/\\s+/g, ' ')) : [];
    const app = window.__pansouApp;
    const vm = (app && app._instance && app._instance.proxy)
      || (app && app._container && app._container._vnode && app._container._vnode.component && app._container._vnode.component.proxy);
    const merged = vm ? JSON.parse(JSON.stringify(vm.mergedResults || {})) : {};
    const badges = [...document.querySelectorAll('[class*="badge-"]')]
      .map(el => el.textContent.trim()).filter(Boolean);
    return { labels, mergedKeys: Object.keys(merged), badges, searched: vm ? vm.searched : null };
  })()`);

  console.log(`  分类 Tab  : ${dom.labels.join(' | ')}`);
  console.log(`  结果分类  : ${dom.mergedKeys.join(' | ')}`);

  ok('搜索确实执行了', dom.searched === true);
  ok('未勾选的 aliyun 不出现在分类 Tab 里',
    !dom.labels.some(l => l.indexOf('阿里云盘') >= 0), dom.labels.join('|'));
  ok('未勾选的 magnet 不出现在分类 Tab 里',
    !dom.labels.some(l => l.indexOf('磁力') >= 0), dom.labels.join('|'));
  ok('未勾选的 ed2k 不出现在分类 Tab 里',
    !dom.labels.some(l => l.indexOf('电驴') >= 0), dom.labels.join('|'));
  ok('未勾选的网盘不出现在结果卡片徽标里',
    !dom.badges.some(b => b.indexOf('阿里云盘') >= 0 || b.indexOf('磁力') >= 0 || b.indexOf('电驴') >= 0),
    [...new Set(dom.badges)].join('|'));
  ok('mergedResults 里只剩勾选的网盘',
    dom.mergedKeys.length > 0 && dom.mergedKeys.every(k => TARGET.indexOf(k) >= 0),
    dom.mergedKeys.join('|'));
  ok('勾选的夸克网盘正常展示',
    dom.labels.some(l => l.indexOf('夸克网盘') >= 0), dom.labels.join('|'));

  /* ============ 场景 C：改回全部，应立即恢复 ============ */
  console.log('\n──── 场景 C · 改回全选后应立刻恢复 ────');
  await fetch(BASE + '/api/admin/settings', {
    method: 'POST', headers: H, body: JSON.stringify({ visibleCloudTypes: FULL_VISIBLE })
  });
  const cfg2 = await (await fetch(BASE + '/api/ui-config')).json();
  ok('还原后 ui-config 立即反映全量白名单',
    JSON.stringify(cfg2.visible_cloud_types) === JSON.stringify(FULL_VISIBLE),
    `恢复 ${cfg2.visible_cloud_types.length} 类 / 原始 ${FULL_VISIBLE.length} 类`);

  // 刷新页面，确认全选状态下四类都能出来
  await send('Page.navigate', { url: BASE + '/?debug=1' });
  await sleep(3200);
  await evaluate(`(() => {
    const inp = document.querySelector('#search-box input[type=search], #search-box input[type=text]');
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(inp, '测试关键词');
    inp.dispatchEvent(new Event('input', { bubbles: true }));
    document.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    return true;
  })()`);
  await sleep(6000);
  const dom2 = await evaluate(`(() => {
    const tabs = document.getElementById('cloud-tabs');
    return tabs ? [...tabs.children].map(el => el.textContent.trim().replace(/\\s+/g, ' ')) : [];
  })()`);
  console.log(`  分类 Tab  : ${dom2.join(' | ')}`);
  ok('全选状态下四类网盘全部出现',
    ['夸克网盘', '阿里云盘', '磁力链接', '电驴链接'].every(n => dom2.some(l => l.indexOf(n) >= 0)),
    dom2.join('|'));

  /* ============ 场景 D：后台「结果展示」勾选框交互 ============ */
  console.log('\n──── 场景 D · 后台结果展示面板的勾选行为 ────');

  // 预置令牌，免去手打密码
  await send('Page.navigate', { url: BASE + '/admin' });
  await sleep(1500);
  await evaluate(`localStorage.setItem('pansou_admin_token', 'admin')`);
  await send('Page.navigate', { url: BASE + '/admin' });
  await sleep(3000);

  // 切到「结果展示」Tab
  const tabbed = await evaluate(`(() => {
    const btns = [...document.querySelectorAll('button')];
    const t = btns.find(b => b.textContent.trim() === '结果展示');
    if (!t) return 'no-tab | ' + btns.map(b => b.textContent.trim()).slice(0, 20).join(',');
    t.click();
    return 'ok';
  })()`);
  ok('后台存在「结果展示」Tab 且可点击', tabbed === 'ok', tabbed);
  await sleep(800);

  // 面板探测：找到勾选列表与计数文案
  const PANEL = `(() => {
    const headings = [...document.querySelectorAll('h3')];
    const h = headings.find(x => x.textContent.indexOf('搜索结果展示的网盘类型') >= 0);
    if (!h) return { err: 'no-panel' };
    const card = h.closest('div.bg-white');
    const rows = [...card.querySelectorAll('input[type=checkbox]')].map(cb => {
      const row = cb.closest('div');
      const label = row.querySelector('span.font-semibold');
      return { name: label ? label.textContent.trim() : '?', checked: cb.checked };
    });
    const counter = [...card.querySelectorAll('p')].map(p => p.textContent).find(t => t.indexOf('当前展示') >= 0) || '';
    return { rows, counter, dirty: document.body.innerText.includes('有未保存的修改') };
  })()`;

  const before = await evaluate(PANEL);
  ok('能读到网盘勾选列表', !before.err && before.rows.length > 0,
    before.err || `${before.rows.length} 项`);
  // 脏标记回归：Vue 的 watch 是异步的，applySettings 里同步 dirty=false 会被
  // 之后的回调翻回 true，导致「刚进后台就提示有未保存的修改」，
  // 保存成功后同样会再冒出来 —— 用户会读成「保存没生效 / 无法保存」。
  ok('刚进入后台时不显示「有未保存的修改」', before.dirty === false,
    'dirty=' + before.dirty);
  const quarkBefore = before.rows.find(r => r.name === '夸克网盘');
  ok('夸克网盘初始为已勾选', quarkBefore && quarkBefore.checked === true,
    quarkBefore ? String(quarkBefore.checked) : '未找到');

  // 点掉「夸克网盘」
  const clicked = await evaluate(`(() => {
    const headings = [...document.querySelectorAll('h3')];
    const h = headings.find(x => x.textContent.indexOf('搜索结果展示的网盘类型') >= 0);
    const card = h.closest('div.bg-white');
    const cbs = [...card.querySelectorAll('input[type=checkbox]')];
    const target = cbs.find(cb => {
      const label = cb.closest('div').querySelector('span.font-semibold');
      return label && label.textContent.trim() === '夸克网盘';
    });
    if (!target) return 'no-cb';
    target.click();
    return 'ok';
  })()`);
  ok('取消勾选可点击', clicked === 'ok', clicked);
  await sleep(700);

  const after = await evaluate(PANEL);
  const quarkAfter = after.rows.find(r => r.name === '夸克网盘');
  ok('取消勾选后复选框状态立刻变灰', quarkAfter && quarkAfter.checked === false,
    quarkAfter ? String(quarkAfter.checked) : '未找到');
  ok('计数文案随勾选实时更新',
    before.counter !== after.counter,
    `「${before.counter}」→「${after.counter}」`);
  ok('改动后提示「有未保存的修改」', after.dirty === true, 'dirty=' + after.dirty);

  // 保存
  const saved = await evaluate(`(() => {
    const b = [...document.querySelectorAll('button')].find(x => /保存/.test(x.textContent) && !x.disabled);
    if (!b) return 'no-save-btn';
    b.click();
    return 'ok';
  })()`);
  ok('找到并点击了保存按钮', saved === 'ok', saved);
  await sleep(2500);

  const persisted = (await (await fetch(BASE + '/api/admin/settings', { headers: H })).json()).visibleCloudTypes;
  ok('取消勾选的网盘已落盘（不再包含 quark）',
    Array.isArray(persisted) && persisted.indexOf('quark') < 0,
    JSON.stringify(persisted));

  // 保存成功后不应再提示「有未保存的修改」（否则用户会以为没保存成功）
  const afterSave = await evaluate(PANEL);
  ok('保存成功后不再显示「有未保存的修改」', afterSave.dirty === false, 'dirty=' + afterSave.dirty);

  const cfgAfter = await (await fetch(BASE + '/api/ui-config')).json();
  ok('前端首屏配置同步生效', cfgAfter.visible_cloud_types.indexOf('quark') < 0,
    JSON.stringify(cfgAfter.visible_cloud_types));

  // 还原：重新勾上并保存
  await evaluate(`(() => {
    const headings = [...document.querySelectorAll('h3')];
    const h = headings.find(x => x.textContent.indexOf('搜索结果展示的网盘类型') >= 0);
    const card = h.closest('div.bg-white');
    const cbs = [...card.querySelectorAll('input[type=checkbox]')];
    const target = cbs.find(cb => {
      const label = cb.closest('div').querySelector('span.font-semibold');
      return label && label.textContent.trim() === '夸克网盘';
    });
    if (target) target.click();
    const b = [...document.querySelectorAll('button')].find(x => /保存/.test(x.textContent) && !x.disabled);
    if (b) b.click();
    return true;
  })()`);
  await sleep(2500);
  const restored = (await (await fetch(BASE + '/api/admin/settings', { headers: H })).json()).visibleCloudTypes;
  ok('重新勾选后夸克网盘回到配置中', Array.isArray(restored) && restored.indexOf('quark') >= 0,
    JSON.stringify(restored));

  console.log('\n========================================================');
  console.log(fail === 0 ? `==== ${pass}/${pass} passed ====` : `==== ${pass} passed, ${fail} FAILED ====`);
  console.log('========================================================');
  cleanup();
  process.exit(fail === 0 ? 0 : 1);
} catch (e) {
  console.error('\n执行异常:', e.message);
  cleanup();
  process.exit(1);
}

/**
 * 线上后台「结果展示 → 保存」真实复现
 * ============================================================
 * 目的：用户反馈「选择还是不生效，无法保存」。本脚本用真浏览器打线上后台，
 * 把「点保存」这条链路每一步的状态都记下来：
 *   按钮是否可见/可点 → 是否变 dirty → POST 的请求体与响应 → toast 文案 → 控制台报错
 *
 * 用法: node verify_admin_save_live.mjs [站点] [密码]
 */
import { spawn } from 'node:child_process';
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const SITE = (process.argv[2] || 'https://pansou.dszz.us.ci').replace(/\/$/, '');
const PWD = process.argv[3] || 'admin';
const ADMIN_URL = SITE + '/admin';
const VIEWPORT_W = parseInt(process.env.VW || '1440', 10);
const VIEWPORT_H = parseInt(process.env.VH || '1000', 10);

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9600 + Math.floor(Math.random() * 300);
const profile = mkdtempSync(join(tmpdir(), 'adminsave-'));
const sleep = ms => new Promise(s => setTimeout(s, ms));

const chrome = spawn(CHROME, [
  '--headless=new',
  `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${profile}`,
  '--no-first-run', '--no-default-browser-check', '--disable-gpu', '--hide-scrollbars',
  `--window-size=${VIEWPORT_W},${VIEWPORT_H}`,
  'about:blank'
], { stdio: 'ignore' });

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
  for (let i = 0; i < 50; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/json/list`);
      const page = (await r.json()).find(t => t.type === 'page');
      if (page?.webSocketDebuggerUrl) return page.webSocketDebuggerUrl;
    } catch {}
    await sleep(400);
  }
  throw new Error('Chrome 调试端口未就绪');
}

const cleanup = () => {
  try { ws?.close(); } catch {}
  try { chrome.kill(); } catch {}
  try { rmSync(profile, { recursive: true, force: true }); } catch {}
};

// 捕获：控制台报错 / 网络请求响应
const consoleErrors = [];
const netLog = [];

try {
  ws = new WebSocket(await connect());
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });

  ws.onmessage = ev => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) {
      const { resolve, reject } = pending.get(m.id);
      pending.delete(m.id);
      m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result);
      return;
    }
    if (m.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(m.params.type)) {
      consoleErrors.push(
        `[${m.params.type}] ` + m.params.args.map(a => a.value ?? a.description ?? a.type).join(' ')
      );
    }
    if (m.method === 'Runtime.exceptionThrown') {
      consoleErrors.push('[exception] ' + (m.params.exceptionDetails?.exception?.description || m.params.exceptionDetails?.text));
    }
    if (m.method === 'Network.requestWillBeSent') {
      const u = m.params.request.url;
      if (u.indexOf('/api/') >= 0) {
        netLog.push({ kind: 'req', id: m.params.requestId, url: u, method: m.params.request.method, body: m.params.request.postData });
      }
    }
    if (m.method === 'Network.responseReceived') {
      const u = m.params.response.url;
      if (u.indexOf('/api/') >= 0) {
        const hit = netLog.find(x => x.kind === 'req' && x.id === m.params.requestId);
        if (hit) hit.status = m.params.response.status;
      }
    }
    if (m.method === 'Network.loadingFinished') {
      const hit = netLog.find(x => x.kind === 'req' && x.id === m.params.requestId);
      if (hit && hit.url.indexOf('/api/admin/settings') >= 0) hit.finished = true;
    }
  };

  await send('Page.enable');
  await send('Runtime.enable');
  await send('Network.enable');

  const evaluate = async (expression, awaitPromise = false) => {
    const res = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise });
    if (res.exceptionDetails) {
      throw new Error(res.exceptionDetails.text + ' :: ' + (res.exceptionDetails.exception?.description || ''));
    }
    return res.result?.value;
  };

  // 预置令牌，跳过登录页
  await send('Page.addScriptToEvaluateOnNewDocument', {
    source: `try { localStorage.setItem('pansou_admin_token', ${JSON.stringify(PWD)}); } catch(e) {}`
  });

  console.log(`\n打开线上后台: ${ADMIN_URL}  (窗口 ${VIEWPORT_W}x${VIEWPORT_H})\n`);
  await send('Page.navigate', { url: ADMIN_URL });
  await sleep(4000);

  const boot = await evaluate(`({
    href: location.href,
    hasApp: !!document.getElementById('app') && document.getElementById('app').innerHTML.length > 500,
    authed: !document.body.innerText.includes('请输入管理密码'),
    text: document.body.innerText.slice(0, 160).replace(/\\s+/g, ' ')
  })`);
  console.log('页面状态:', JSON.stringify(boot));

  // 侧边/移动端保存按钮的可见性
  const btnInfo = await evaluate(`(() => {
    const btns = [...document.querySelectorAll('button')].filter(b => /保存配置|保存中/.test(b.textContent));
    return btns.map(b => {
      const r = b.getBoundingClientRect();
      const cs = getComputedStyle(b);
      return {
        text: b.textContent.trim(),
        disabled: b.disabled,
        w: Math.round(r.width), h: Math.round(r.height),
        visible: r.width > 0 && r.height > 0 && cs.display !== 'none' && cs.visibility !== 'hidden',
        inViewport: r.top < window.innerHeight && r.bottom > 0
      };
    });
  })()`);
  console.log('保存按钮:', JSON.stringify(btnInfo, null, 2));

  // 切到「结果展示」
  const tabbed = await evaluate(`(() => {
    const t = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === '结果展示');
    if (!t) return 'no-tab';
    t.click();
    return 'ok';
  })()`);
  console.log('切换到结果展示:', tabbed);
  await sleep(1200);

  const PANEL = `(() => {
    const h = [...document.querySelectorAll('h3')].find(x => x.textContent.indexOf('搜索结果展示的网盘类型') >= 0);
    if (!h) return { err: 'no-panel', h3: [...document.querySelectorAll('h3')].map(x=>x.textContent.trim()) };
    const card = h.closest('div.bg-white');
    const rows = [...card.querySelectorAll('input[type=checkbox]')].map(cb => {
      const label = cb.closest('div').querySelector('span.font-semibold');
      return { name: label ? label.textContent.trim() : '?', checked: cb.checked };
    });
    const counter = [...card.querySelectorAll('p')].map(p => p.textContent).find(t => t.indexOf('当前展示') >= 0) || '';
    const dirty = document.body.innerText.includes('有未保存的修改');
    return { rows, counter, dirty };
  })()`;

  const before = await evaluate(PANEL);
  console.log('\n结果展示面板 before:', JSON.stringify({ counter: before.counter, count: before.rows?.length, dirty: before.dirty }));

  // 取消勾选「夸克网盘」
  const uncheck = await evaluate(`(() => {
    const h = [...document.querySelectorAll('h3')].find(x => x.textContent.indexOf('搜索结果展示的网盘类型') >= 0);
    if (!h) return 'no-panel';
    const card = h.closest('div.bg-white');
    const cb = [...card.querySelectorAll('input[type=checkbox]')].find(c => {
      const l = c.closest('div').querySelector('span.font-semibold');
      return l && l.textContent.trim() === '夸克网盘';
    });
    if (!cb) return 'no-checkbox';
    cb.click();
    return 'ok';
  })()`);
  console.log('取消勾选夸克网盘:', uncheck);
  await sleep(900);

  const after = await evaluate(PANEL);
  console.log('结果展示面板 after :', JSON.stringify({ counter: after.counter, dirty: after.dirty }));

  netLog.length = 0;

  // 点保存
  const clicked = await evaluate(`(() => {
    const btns = [...document.querySelectorAll('button')].filter(b => /保存配置/.test(b.textContent) && !b.disabled);
    if (!btns.length) return 'no-enabled-save-button';
    btns[0].click();
    return 'ok:' + btns[0].textContent.trim();
  })()`);
  console.log('\n点击保存:', clicked);
  await sleep(4000);

  const toast = await evaluate(`(() => {
    const el = document.querySelector('.fixed.left-1\\\\/2, [class*="bottom-6"]');
    return { toastText: el ? el.textContent.trim() : null, bodyTail: document.body.innerText.slice(-200).replace(/\\s+/g, ' ') };
  })()`);

  console.log('\n──── 网络 ────');
  for (const n of netLog) {
    if (n.url.indexOf('/api/admin/settings') >= 0 || n.url.indexOf('/api/admin') >= 0) {
      console.log(`  ${n.method || ''} ${n.url.replace(SITE, '')} -> HTTP ${n.status ?? '???'}`);
      if (n.body) console.log(`     body: ${String(n.body).slice(0, 400)}`);
    }
  }

  console.log('\n──── 控制台报错 ────');
  console.log(consoleErrors.length ? consoleErrors.slice(0, 20).map(s => '  ' + s).join('\n') : '  （无）');

  console.log('\n──── 页面提示 ────');
  console.log('  toast:', JSON.stringify(toast.toastText));
  console.log('  body 末尾:', toast.bodyTail);

  // 落盘保存后的真实配置
  const saved = await (await fetch(SITE + '/api/admin/settings', {
    headers: { Authorization: 'Bearer ' + PWD }
  })).json();
  console.log('\n──── 服务端真实配置 ────');
  console.log('  visibleCloudTypes =', JSON.stringify(saved.visibleCloudTypes));
  console.log('  夸克是否还在 =', (saved.visibleCloudTypes || []).indexOf('quark') >= 0 ? '在（保存未生效）' : '已移除（保存生效）');

  writeFileSync('admin_save_live.json', JSON.stringify({ boot, btnInfo, before, after, toast, netLog, consoleErrors, saved }, null, 2));
  cleanup();
} catch (e) {
  console.error('执行异常:', e.message);
  console.error('控制台报错:', consoleErrors.slice(0, 10));
  cleanup();
  process.exit(1);
}

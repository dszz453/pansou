/**
 * 后台（/admin）分页截图工具 —— `ui_shot.mjs` 的孪生兄弟，那个只截首页。
 *
 * 用法:
 *   node admin_shot.mjs [baseUrl] [outDir]
 *   默认 http://127.0.0.1:8787 → outputs/
 *   例：node admin_shot.mjs http://127.0.0.1:8787
 *
 * 做法：CDP 注入 localStorage 里的后台令牌跳过登录 → 依次点每个 Tab → 整页截图。
 * 想确认「某个控件在哪个 Tab 里」时用它最直观（比读源码快）。
 * ⚠️ 只对本地/可直连站点用；线上 qzz.io 在沙箱里 node fetch 不通。
 */
import { spawn } from 'node:child_process';
import { writeFileSync, mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const BASE = process.argv[2] || 'http://127.0.0.1:8787';
const OUT = process.argv[3] || 'outputs';
const CDP_PORT = 9334 + Math.floor(Math.random() * 200);
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
mkdirSync(OUT, { recursive: true });

const sleep = ms => new Promise(r => setTimeout(r, ms));
const profile = mkdtempSync(join(tmpdir(), 'adminshot-'));
const chrome = spawn(CHROME, [
  '--headless=new', `--remote-debugging-port=${CDP_PORT}`, `--user-data-dir=${profile}`,
  '--no-first-run', '--no-default-browser-check', '--disable-gpu', '--hide-scrollbars',
  '--no-proxy-server', '--proxy-bypass-list=<-loopback>', '--window-size=1500,1250', 'about:blank'
], { stdio: 'ignore' });

let ws, msgId = 0;
const pending = new Map();
const send = (method, params = {}) =>
  new Promise((res, rej) => { const id = ++msgId; pending.set(id, { res, rej }); ws.send(JSON.stringify({ id, method, params })); });

async function connect() {
  for (let i = 0; i < 60; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`)).json();
      const p = list.find(t => t.type === 'page');
      if (p?.webSocketDebuggerUrl) return p.webSocketDebuggerUrl;
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

try {
  ws = new WebSocket(await connect());
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = ev => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) {
      const { res, rej } = pending.get(m.id);
      pending.delete(m.id);
      m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result);
    }
  };
  await send('Page.enable');
  await send('Runtime.enable');
  const evaluate = async (expression, awaitPromise = false) => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise });
    return r.result?.value;
  };

  await send('Page.addScriptToEvaluateOnNewDocument', {
    source: `try { localStorage.setItem('pansou_admin_token', 'admin'); } catch(e) {}`
  });

  const shoot = async (tabLabel, file) => {
    await send('Page.navigate', { url: BASE + '/admin?debug=1' });
    await sleep(4000);
    await evaluate(`(() => {
      const b = [...document.querySelectorAll('button')].find(x => x.textContent.indexOf(${JSON.stringify(tabLabel)}) >= 0);
      if (b) b.click();
    })()`);
    await sleep(1200);
    const { data } = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
    writeFileSync(join(OUT, file), Buffer.from(data, 'base64'));
    console.log('已截图 ' + file);
  };

  // 六个 Tab 挨个截一张，文件名直接用 Tab 名，方便对照
  await shoot('总览', '后台-总览.png');
  await shoot('TG 频道', '后台-频道页.png');
  await shoot('搜索插件', '后台-搜索插件.png');
  await shoot('结果展示', '后台-结果展示.png');
  await shoot('API 接口', '后台-API接口.png');
  await shoot('系统设置', '后台-系统设置.png');
} catch (e) {
  console.log('脚本异常: ' + e.message);
  process.exitCode = 1;
} finally {
  cleanup();
}

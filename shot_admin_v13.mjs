/**
 * 线上后台新界面截图（V1.3）
 * 逐 Tab 截图：总览 / TG 频道 / 搜索插件 / 结果展示 / API 接口 / 系统设置
 *
 * 用法: node shot_admin_v13.mjs [站点] [密码] [前缀]
 */
import { spawn } from 'node:child_process';
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const SITE = (process.argv[2] || 'https://pansou.dszz.us.ci').replace(/\/$/, '');
const PWD = process.argv[3] || 'admin';
const PREFIX = process.argv[4] || 'v13-admin';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9700 + Math.floor(Math.random() * 200);
const profile = mkdtempSync(join(tmpdir(), 'admshot-'));
const sleep = ms => new Promise(s => setTimeout(s, ms));

const chrome = spawn(CHROME, [
  '--headless=new',
  `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${profile}`,
  '--no-first-run', '--no-default-browser-check', '--disable-gpu', '--hide-scrollbars',
  '--window-size=1440,1400',
  'about:blank'
], { stdio: 'ignore' });

let ws = null, msgId = 0;
const pending = new Map();
const send = (m, p = {}) => new Promise((res, rej) => {
  const id = ++msgId; pending.set(id, { res, rej });
  ws.send(JSON.stringify({ id, method: m, params: p }));
});

async function connect() {
  for (let i = 0; i < 50; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/json/list`);
      const pg = (await r.json()).find(t => t.type === 'page');
      if (pg?.webSocketDebuggerUrl) return pg.webSocketDebuggerUrl;
    } catch {}
    await sleep(400);
  }
  throw new Error('Chrome 未就绪');
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
      const { res, rej } = pending.get(m.id); pending.delete(m.id);
      m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result);
    }
  };

  await send('Page.enable');
  await send('Runtime.enable');
  const evaluate = async (expr, awaitPromise = false) => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.text);
    return r.result?.value;
  };
  const shoot = async name => {
    const r = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
    writeFileSync(`${PREFIX}-${name}.png`, Buffer.from(r.data, 'base64'));
    console.log(`  📸 ${PREFIX}-${name}.png`);
  };

  await send('Page.addScriptToEvaluateOnNewDocument', {
    source: `try { localStorage.setItem('pansou_admin_token', ${JSON.stringify(PWD)}); } catch(e) {}`
  });

  await send('Page.navigate', { url: SITE + '/admin' });
  await sleep(4200);

  const tabs = ['总览', 'TG 频道', '搜索插件', '结果展示', 'API 接口', '系统设置'];
  const slug = { '总览': 'overview', 'TG 频道': 'channels', '搜索插件': 'plugins', '结果展示': 'display', 'API 接口': 'api', '系统设置': 'system' };

  for (const t of tabs) {
    const r = await evaluate(`(() => {
      // Tab 文案带角标（如「TG 频道 143」「搜索插件 89」），用前缀匹配
      const b = [...document.querySelectorAll('button')].find(x => x.textContent.trim().indexOf(${JSON.stringify(t)}) === 0);
      if (!b) return 'no-tab';
      b.click();
      return 'ok';
    })()`);
    if (r !== 'ok') { console.log(`  ⚠️ 未找到 Tab: ${t}`); continue; }
    await sleep(1400);
    await shoot(slug[t]);
  }

  cleanup();
  console.log('\n完成。');
} catch (e) {
  console.error('失败:', e.message);
  cleanup();
  process.exit(1);
}

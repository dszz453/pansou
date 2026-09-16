/**
 * 零依赖 UI 布局验证 + 截图（Chrome DevTools Protocol）
 *
 * 用法:
 *   node ui_shot.mjs <url> [关键词] [输出前缀] [--mock]
 *
 *   --mock  注入模拟结果（不联网），用于离线验证结果区排版
 *
 * 产出: <前缀>-desktop.png / <前缀>-mobile.png ，并打印几何断言结果
 */
import { spawn } from 'node:child_process';
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const args = process.argv.slice(2);
const MOCK = args.includes('--mock');
const rest = args.filter(a => !a.startsWith('--'));
const URL_ = rest[0] || 'http://127.0.0.1:8787';
const KW = rest[1] || '庆余年';
const PREFIX = rest[2] || 'shot';

const IS_LOCAL = /^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])/i.test(URL_);
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
// 随机端口：固定端口会撞上「上一次异常退出残留的 Chrome 实例」，
// 导致 CDP 连到旧浏览器、读到的却是旧页面（本次踩坑实录）。
const PORT = 9300 + Math.floor(Math.random() * 600);
const profile = mkdtempSync(join(tmpdir(), 'uishot-'));
const sleep = ms => new Promise(s => setTimeout(s, ms));

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
    // 代理策略按目标区分：
    //  · 本地地址必须绕过代理，否则 Chrome 连不上 127.0.0.1（页面完全不挂载）；
    //  · 公网地址则**不能**禁用代理，本机出网依赖系统代理。
    ...(IS_LOCAL ? ['--no-proxy-server', '--proxy-bypass-list=<-loopback>'] : []),
    '--window-size=1440,1200',
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

/* ---------------- 页面内的量测逻辑（注入到浏览器执行） ---------------- */
const PROBE = `(() => {
  const box = document.getElementById('search-box');
  const btn = document.getElementById('search-submit');
  const inp = box ? box.querySelector('input[type=text]') : null;
  const tabs = document.getElementById('cloud-tabs');

  const r = el => { const b = el.getBoundingClientRect(); return { l: Math.round(b.left), r: Math.round(b.right), w: Math.round(b.width), h: Math.round(b.height), t: Math.round(b.top) }; };
  const out = {};

  if (box && inp && btn) {
    const B = r(box), I = r(inp), S = r(btn);
    out.searchBox = { w: B.w, h: B.h };
    out.input = { h: I.h, r: I.r };
    out.button = { w: S.w, h: S.h, l: S.l, r: S.r };
    // 按钮是否完全落在容器内
    out.buttonInside = S.r <= B.r + 1 && S.l >= B.l - 1;
    // 按钮是否压住输入框
    out.overlapWithInput = S.l < I.r;
    // 输入框可用文本区宽度
    out.inputTextArea = I.r - I.l;
    // 按钮文字是否被裁切
    out.buttonTextClipped = btn.scrollWidth > btn.clientWidth + 1;
    out.buttonText = btn.textContent.trim();
  } else {
    out.searchBox = null;
  }

  if (tabs) {
    const T = r(tabs);
    const kids = [...tabs.children].map(el => {
      const k = r(el);
      return { text: el.textContent.trim().replace(/\\s+/g, ' '), w: k.w, l: k.l, r: k.r, t: k.t, clipped: el.scrollWidth > el.clientWidth + 1 };
    });
    const rows = new Set(kids.map(k => k.t));
    out.tabs = {
      count: kids.length,
      rows: rows.size,
      scrollW: tabs.scrollWidth,
      clientW: tabs.clientWidth,
      horizOverflow: tabs.scrollWidth > tabs.clientWidth + 1,
      anyClipped: kids.some(k => k.clipped),
      outOfBox: kids.some(k => k.r > T.r + 1 || k.l < T.l - 1),
      labels: kids.map(k => k.text)
    };
  } else {
    out.tabs = null;
  }

  const card = document.querySelector('.card-hover-effect');
  out.cards = document.querySelectorAll('.card-hover-effect').length;
  out.card = card ? r(card) : null;
  out.title = document.title;

  // 测活状态统计（验证自动测活是否真的跑起来了）
  const q = s => document.querySelectorAll(s).length;
  out.status = {
    valid: q('.status-valid'),
    invalid: q('.status-invalid'),
    unknown: q('.status-unknown'),
    checking: q('.status-checking')
  };
  const sw = document.querySelector('#result-toolbar');
  out.toolbar = sw ? { h: r(sw).h, text: sw.textContent.trim().replace(/\\s+/g, ' ') } : null;
  return out;
})()`;

try {
  ws = new WebSocket(await connect());
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

  const shoot = async name => {
    const res = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
    writeFileSync(`${PREFIX}-${name}.png`, Buffer.from(res.data, 'base64'));
    console.log(`     📸 ${PREFIX}-${name}.png`);
  };

  const viewport = (w, h) =>
    send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 2, mobile: w < 640 });

  const report = (tag, p) => {
    console.log(`\n--- ${tag} ---`);
    if (!p.searchBox) {
      console.log('  ⚠️ 未找到 #search-box（页面可能没挂载）');
      return;
    }
    console.log(`  搜索框      : ${p.searchBox.w} × ${p.searchBox.h} px`);
    console.log(`  输入框高度  : ${p.input.h} px  ${p.input.h >= 40 ? '✅ 正常' : '❌ 过矮（样式缺失）'}`);
    console.log(`  搜索按钮    : ${p.button.w} × ${p.button.h} px，文字「${p.buttonText}」`);
    console.log(`  按钮在容器内: ${p.buttonInside ? '✅' : '❌ 溢出容器'}`);
    console.log(`  按钮压住输入: ${p.overlapWithInput ? '❌ 重叠 ' + (p.input.r - p.button.l) + 'px' : '✅ 不重叠'}`);
    console.log(`  按钮文字裁切: ${p.buttonTextClipped ? '❌ 被裁切' : '✅ 完整'}`);
    if (p.tabs) {
      console.log(`  分类栏      : ${p.tabs.count} 个标签 / 占 ${p.tabs.rows} 行`);
      console.log(`  横向溢出    : ${p.tabs.horizOverflow ? '❌ 需横向滚动（' + p.tabs.scrollW + ' > ' + p.tabs.clientW + '）' : '✅ 无'}`);
      console.log(`  标签被裁切  : ${p.tabs.anyClipped ? '❌ 有' : '✅ 无'}`);
      console.log(`  标签超出容器: ${p.tabs.outOfBox ? '❌ 有' : '✅ 无'}`);
      console.log(`  标签内容    : ${p.tabs.labels.join(' | ')}`);
    }
    console.log(`  结果卡片数  : ${p.cards}${p.card ? `  （单卡 ${p.card.w}×${p.card.h}）` : ''}`);
    if (p.status) {
      const s = p.status;
      const tot = s.valid + s.invalid + s.unknown + s.checking;
      console.log(`  测活状态    : 有效 ${s.valid} / 失效 ${s.invalid} / 未知 ${s.unknown} / 检测中 ${s.checking}  ${tot > 0 ? '✅ 自动测活已生效' : '（本次未触发检测）'}`);
    }
    if (p.toolbar) console.log(`  工具条      : ${p.toolbar.text.slice(0, 90)}`);
  };

  await viewport(1440, 1100);
  // --mock 需要页面暴露调试句柄，故带上 ?debug=1
  const navUrl = MOCK ? URL_ + (URL_.includes('?') ? '&' : '?') + 'debug=1' : URL_;
  await send('Page.navigate', { url: navUrl });
  await sleep(3200);
  const diag = await evaluate(`({
    title: document.title,
    bodyLen: document.body ? document.body.innerHTML.length : -1,
    hasVue: typeof Vue !== 'undefined',
    hasSearchBox: !!document.getElementById('search-box'),
    appHtmlLen: (document.getElementById('app') || {}).innerHTML ? document.getElementById('app').innerHTML.length : -1
  })`);
  const landed = await evaluate('location.href');
  console.log(`已载入: ${landed}`);
  console.log(`  标题=${JSON.stringify(diag.title)} | body=${diag.bodyLen}B | Vue=${diag.hasVue} | #app=${diag.appHtmlLen}B | search-box=${diag.hasSearchBox}`);
  if (!String(landed).startsWith(URL_.replace(/\/$/, ''))) {
    throw new Error(`导航目标不一致：期望 ${URL_}，实际 ${landed}（可能连到了残留的旧浏览器实例）`);
  }

  // 模拟结果：覆盖 8 类网盘，专门压测分类栏换行
  if (MOCK) {
    const ok = await evaluate(`(() => {
      const app = window.__pansouApp;
      // Vue 生产版里取根实例有多条路径，逐一回退
      const vm =
        (app && app._instance && app._instance.proxy) ||
        (app && app._container && app._container._vnode && app._container._vnode.component && app._container._vnode.component.proxy) ||
        null;
      if (!vm) {
        return 'no-vm | hasApp=' + !!app + ' keys=' + (app ? Object.keys(app).join(',') : '-') + ' hasInstance=' + !!(app && app._instance);
      }
      const types = ['quark','baidu','aliyun','uc','tianyi','xunlei','123','others'];
      const names = { quark:'夸克网盘', baidu:'百度网盘', aliyun:'阿里云盘', uc:'UC网盘', tianyi:'天翼云盘', xunlei:'迅雷云盘', '123':'123网盘', others:'其他网盘' };
      const mk = (t, i) => ({ url: 'https://example.com/' + t + '/' + i, note: '测试资源 ' + t + ' 第 ' + i + ' 条（用于验证排版）', password: i % 3 === 0 ? 'abcd' : '', datetime: new Date().toISOString(), source: 'tg:testchannel', cloudType: t });
      const res = {};
      [3,2,5,1,2,1,4,2].forEach((n, idx) => { const t = types[idx]; res[t] = Array.from({length:n}, (_,i)=>mk(t,i+1)); });
      vm.mergedResults = res;
      vm.totalCount = 20;
      vm.searched = true;
      vm.loading = false;
      vm.activeTab = 'all';
      return 'ok';
    })()`);
    console.log('模拟数据注入:', ok);
    await sleep(900);
  } else if (KW && KW !== '-') {
    console.log(`执行搜索「${KW}」...`);
    await evaluate(`(() => {
      const inp = document.querySelector('#search-box input[type=text]');
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      setter.call(inp, ${JSON.stringify(KW)});
      inp.dispatchEvent(new Event('input', { bubbles: true }));
      document.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      return true;
    })()`);
    await sleep(24000);
  }

  report('桌面 1440px', await evaluate(PROBE));
  await shoot('desktop');

  // 窄窗口压测（模拟用户遇到的「搜索框太窄」）
  await viewport(1024, 900);
  await sleep(900);
  report('窄窗 1024px', await evaluate(PROBE));

  await viewport(390, 844);
  await sleep(900);
  report('手机 390px', await evaluate(PROBE));
  await shoot('mobile');

  cleanup();
  console.log('\n完成。');
} catch (e) {
  console.error('失败:', e.message);
  cleanup();
  process.exit(1);
}

/**
 * 插件源「行级」管理端到端回归（V1.5）
 * ============================================================
 * 覆盖本次三项改动：
 *   1. 第三方源可**逐个删除**（界面上每一行都有垃圾桶）
 *   2. 第三方源可按**英文逗号批量导入**
 *   3. 子源复选框是**真开关**：取消勾选后，节点请求里不再带这个源
 *
 * 关键设计：用**本地假聚合节点**（记录每次请求的 X-Plugins / kw）代替真实
 * 第三方站点，这样断言的是「Worker 真正发出去了什么」，而不是隔着网络猜。
 * 场景 B 用真 Chrome + 真 /admin 页面，通过真实 DOM 操作（填文本框 / 点按钮 /
 * 勾复选框 / 点保存）走完一遍，最后从服务端读回落盘配置核对。
 *
 * 用法: node verify_plugin_rows_e2e.mjs
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import http from 'node:http';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 8900 + Math.floor(Math.random() * 300);
const CDP_PORT = 9500 + Math.floor(Math.random() * 400);
const STUB_PORT = 9300 + Math.floor(Math.random() * 300);
const BASE = `http://127.0.0.1:${PORT}`;
const NODE_ID = 'pansou_stub';

const sleep = ms => new Promise(s => setTimeout(s, ms));

let pass = 0;
let fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) {
    pass++;
    console.log(`PASS  ${name}${extra ? '  -> ' + extra : ''}`);
  } else {
    fail++;
    console.log(`FAIL  ${name}${extra ? '  -> ' + extra : ''}`);
  }
};

/* ---------------- 假聚合节点：记录出站请求 ---------------- */
const hits = [];
const stub = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://127.0.0.1');
  hits.push({
    path: u.pathname,
    kw: u.searchParams.get('kw'),
    res: u.searchParams.get('res'),
    plugins: req.headers['x-plugins'] || '',
    queryPlugins: u.searchParams.get('plugins') || ''
  });
  res.setHeader('content-type', 'application/json');
  res.end(
    JSON.stringify({
      code: 0,
      message: 'ok',
      data: {
        total: 2,
        merged_by_type: {
          quark: [{ url: 'https://pan.quark.cn/s/abcdef', note: 'e2e 假数据', source: 'stub' }]
        }
      }
    })
  );
});

/* ---------------- 本地真服务 ---------------- */
const server = spawn(process.execPath, ['serve-local.mjs', String(PORT)], {
  cwd: process.cwd(),
  stdio: 'ignore'
});

/* ---------------- CDP ---------------- */
let ws = null;
let chrome = null;
const profile = mkdtempSync(join(tmpdir(), 'plugin-rows-'));
let msgId = 0;
const pending = new Map();
const send = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const id = ++msgId;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });

const cleanup = () => {
  try { ws?.close(); } catch {}
  try { chrome?.kill(); } catch {}
  try { server.kill(); } catch {}
  try { stub.close(); } catch {}
  try { rmSync(profile, { recursive: true, force: true }); } catch {}
};

async function waitServer() {
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(BASE + '/api/health');
      if (r.ok) return true;
    } catch {}
    await sleep(400);
  }
  throw new Error('本地服务未就绪');
}

async function connectCDP() {
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`);
      const page = (await r.json()).find(t => t.type === 'page');
      if (page?.webSocketDebuggerUrl) return page.webSocketDebuggerUrl;
    } catch {}
    await sleep(400);
  }
  throw new Error('Chrome 调试端口未就绪');
}

const H = { 'Content-Type': 'application/json', Authorization: 'Bearer admin' };
const saveSettings = body =>
  fetch(BASE + '/api/admin/settings', { method: 'POST', headers: H, body: JSON.stringify(body) });
const readSettings = async () => (await (await fetch(BASE + '/api/admin/settings', { headers: H })).json());

try {
  await new Promise(r => stub.listen(STUB_PORT, '127.0.0.1', r));
  await waitServer();

  const ENDPOINT = `http://127.0.0.1:${STUB_PORT}/api/search`;
  const node = (pluginIds, disabledPluginIds = [], enabled = true) => ({
    id: NODE_ID,
    name: 'E2E 假聚合节点',
    enabled,
    type: 'pansou',
    apiEndpoint: ENDPOINT,
    pluginIds,
    disabledPluginIds
  });

  /* ============ 场景 A：子源开关要真的改变出站请求 ============ */
  console.log('\n──── 场景 A · 子源复选框是真开关 ────');

  await saveSettings({
    plugins: [
      { id: 'melost', name: '影盘社', enabled: false, type: 'native' },
      node(['srcA', 'srcB', 'srcC'], ['srcB'])
    ]
  });

  hits.length = 0;
  let r = await fetch(BASE + '/api/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ kw: 'e2e', plugins: [NODE_ID], res: 'merge' })
  });
  let d = await r.json();
  ok('搜索返回 200 + 合并结果', r.status === 200 && d.code === 0, 'code=' + d.code);
  ok('节点只被请求一次（子源不按行发请求）', hits.length === 1, 'hits=' + hits.length);
  ok('取消勾选的 srcB 不再出现在出站子源清单里', hits[0] && hits[0].queryPlugins === 'srcA,srcC',
    hits[0] && 'query=' + hits[0].queryPlugins + ' header=' + (hits[0].plugins || '(空)'));
  ok('子源过滤走 plugins= 查询参数（不是请求头）', hits[0] && hits[0].queryPlugins === 'srcA,srcC' && !hits[0].plugins,
    hits[0] && 'query=' + hits[0].queryPlugins + ' header=' + (hits[0].plugins || '(空)'));
  ok('关键词原样透传给节点', hits[0] && hits[0].kw === 'e2e', hits[0] && hits[0].kw);
  ok('假节点数据被解析进结果', JSON.stringify(d.merged_by_type || {}).includes('pan.quark.cn'));

  // 子源全部关掉 → 节点根本不该发请求
  await saveSettings({ plugins: [{ id: 'melost', enabled: false, type: 'native' }, node(['srcA', 'srcB'], ['srcA', 'srcB'], true)] });
  hits.length = 0;
  r = await fetch(BASE + '/api/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ kw: 'e2e2', plugins: [NODE_ID], res: 'merge' })
  });
  await r.json();
  ok('子源全关后节点不再发出任何请求', hits.length === 0, 'hits=' + hits.length);

  /* ============ 场景 A2：按子源 id 也能测试到所属节点 ============ */
  console.log('\n──── 场景 A2 · 后台测试按钮用子源 id 也要能命中节点 ────');

  await saveSettings({ plugins: [node(['srcA', 'srcB', 'srcC'], ['srcC'])] });
  hits.length = 0;
  r = await fetch(BASE + '/api/debug/plugin?kw=e2e3&ids=srcB', { headers: { Authorization: 'Bearer admin' } });
  d = await r.json();
  const row = (d.results || [])[0];
  ok('用子源 id 能匹配到所属节点', !!row && row.id === NODE_ID, row && row.id);
  ok('测试请求带出实际生效的子源清单', row && JSON.stringify(row.pluginIds) === '["srcA","srcB"]',
    row && JSON.stringify(row.pluginIds));
  ok('被关掉的子源不计入 covered', row && row.covered === 2, row && String(row.covered));
  ok('测试请求确实打到了节点',
    hits.length === 1 && hits[0].queryPlugins === 'srcA,srcB',
    hits.length + ' / header=' + (hits[0] && hits[0].plugins) + ' query=' + (hits[0] && hits[0].queryPlugins));

  /* ============ 场景 B：后台批量导入 / 删除 / 保存 ============ */
  console.log('\n──── 场景 B · 后台批量导入 + 删除 + 保存 ────');

  chrome = spawn(CHROME, [
    '--headless=new',
    `--remote-debugging-port=${CDP_PORT}`,
    `--user-data-dir=${profile}`,
    '--no-first-run', '--no-default-browser-check', '--disable-gpu', '--hide-scrollbars',
    '--no-proxy-server', '--proxy-bypass-list=<-loopback>',
    '--window-size=1440,1400',
    'about:blank'
  ], { stdio: 'ignore' });

  ws = new WebSocket(await connectCDP());
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  /**
   * 页面级 JS 报错收集。
   *
   * 必须收：Vue 会把**事件处理器里抛出的异常吞掉**，只打一条 console.error。
   * 于是「点按钮毫无反应、也不报错」这种最难查的故障，从 DOM 断言上完全看不出来
   * ——本次 `doPluginBatchImport` 引用了浏览器不存在的 DEFAULT_PLUGINS 就是这样被藏住的。
   */
  const pageErrors = [];
  ws.onmessage = ev => {
    const m = JSON.parse(ev.data);
    if (m.method === 'Page.javascriptDialogOpening') {
      // 删除是 confirm 确认的：这里自动点「确定」
      send('Page.handleJavaScriptDialog', { accept: true }).catch(() => {});
      return;
    }
    if (m.method === 'Runtime.exceptionThrown') {
      const d = m.params.exceptionDetails || {};
      pageErrors.push('未捕获: ' + (d.exception?.description || d.text || '').split('\n')[0]);
      return;
    }
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
      const text = (m.params.args || []).map(a => a.value || a.description || '').join(' ');
      // 只关心「代码写错了」这一类；网络 4xx / 资源 404 属于现场噪音
      if (/ReferenceError|TypeError|is not defined|is not a function|Cannot read/.test(text)) {
        pageErrors.push('console: ' + text.split('\n')[0].slice(0, 160));
      }
      return;
    }
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

  await send('Page.addScriptToEvaluateOnNewDocument', {
    source: `try { localStorage.setItem('pansou_admin_token', 'admin'); } catch(e) {}`
  });

  const VM = `(window.__pansouAdmin && (window.__pansouAdmin._instance && window.__pansouAdmin._instance.proxy
      || (window.__pansouAdmin._container && window.__pansouAdmin._container._vnode && window.__pansouAdmin._container._vnode.component && window.__pansouAdmin._container._vnode.component.proxy)))`;

  const openPluginsTab = async () => {
    await send('Page.navigate', { url: BASE + '/admin?debug=1' });
    await sleep(3800);
    const clicked = await evaluate(`(() => {
      const b = [...document.querySelectorAll('button')].find(x => x.textContent.trim().indexOf('搜索插件') === 0);
      if (!b) return 'no-tab';
      b.click();
      return 'ok';
    })()`);
    await sleep(900);
    return clicked;
  };

  const tab = await openPluginsTab();
  ok('后台已进入「搜索插件」Tab', tab === 'ok', tab);

  const before = await evaluate(`(() => {
    const vm = ${VM};
    const rows = [...document.querySelectorAll('tbody tr')];
    return { dom: rows.length, vm: vm ? vm.pluginSources.length : -1, hasBatch: !!document.querySelector('textarea[placeholder^="clxiong"]') };
  })()`);
  ok('插件源列表已渲染', before.vm > 0 && before.dom === before.vm, `dom=${before.dom} vm=${before.vm}`);
  ok('批量导入文本框存在', before.hasBatch === true);

  // —— 批量导入：英文逗号分隔，其中夹一个重复项（srcA 已在配置里）
  const imported = await evaluate(`(async () => {
    const vm = ${VM};
    if (!vm) return { err: 'no-vm' };
    const ta = document.querySelector('textarea[placeholder^="clxiong"]');
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
    setter.call(ta, 'csvA,csvB\\ncsvC, srcA ');
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise(r => setTimeout(r, 60));
    const btn = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === '确认导入');
    if (!btn) return { err: 'no-btn' };
    btn.click();
    await new Promise(r => setTimeout(r, 120));
    const ids = vm.pluginSources.map(s => s.id);
    return { ids, added: ids.filter(x => x.indexOf('csv') === 0), parents: vm.pluginSources.filter(s => x0(s)).map(s => s.parentId) };
    function x0(s) { return s.id.indexOf('csv') === 0; }
  })()`, true);

  ok('三个新源按英文逗号/换行批量导入成功', imported.added && imported.added.length === 3, JSON.stringify(imported.added));
  ok('重复的 srcA 被跳过（不产生重复行）',
    imported.ids && imported.ids.filter(x => x === 'srcA').length === 1,
    JSON.stringify(imported.ids));
  ok('导入的源挂在同一个第三方节点下',
    imported.parents && imported.parents.length === 3 && imported.parents.every(p => p === NODE_ID),
    JSON.stringify(imported.parents));

  const afterImport = await evaluate(`(() => {
    const vm = ${VM};
    return { n: vm.pluginSources.length, state: vm.pluginSources.map(s => s.id + ':' + s.enabled), batchEnable: vm.pluginBatchEnable };
  })()`);
  ok('表格行数随导入增加', afterImport.n === before.vm + 3, `${before.vm} -> ${afterImport.n}`);
  console.log('    导入后状态: ' + afterImport.state.join(' | ') + '  (默认启用勾选=' + afterImport.batchEnable + ')');
  ok('默认「导入即启用」生效',
    afterImport.batchEnable === true && afterImport.state.filter(s => s.indexOf('csv') === 0).every(s => s.endsWith(':true')),
    afterImport.state.join('|'));

  // —— 删除一行：点这一行的垃圾桶
  const deleted = await evaluate(`(async () => {
    const vm = ${VM};
    const rows = [...document.querySelectorAll('tbody tr')];
    const row = rows.find(tr => {
      const idEl = tr.querySelector('td .font-mono');
      return idEl && idEl.textContent.trim() === 'csvC';
    });
    if (!row) return { err: 'no-row' };
    const btn = row.querySelector('td:last-child button');
    if (!btn) return { err: 'no-btn' };
    btn.click();
    await new Promise(r => setTimeout(r, 250));
    return { ids: vm.pluginSources.map(s => s.id), state: vm.pluginSources.map(s => s.id + ':' + s.enabled), domRows: document.querySelectorAll('tbody tr').length };
  })()`, true);

  ok('删除按钮可用且该行立即消失', deleted.ids && deleted.ids.indexOf('csvC') < 0, JSON.stringify(deleted.err || deleted.ids));
  console.log('    删除后状态: ' + (deleted.state || []).join(' | '));
  ok('删除后 DOM 行数与数据一致', deleted.domRows === afterImport.n - 1, `dom=${deleted.domRows} expect=${afterImport.n - 1}`);

  // —— 取消勾选 csvB（制造 disabledPluginIds），再保存
  const saved = await evaluate(`(async () => {
    const vm = ${VM};
    // 用「行首 id 单元格文本」精确定位，别用整行文本包含判断：
    // 备注/描述里也可能出现同样的字样（踩过一次，勾错了行）
    const snap = () => [...document.querySelectorAll('tbody tr')].map(tr => {
      const idEl = tr.querySelector('td .font-mono');
      const box = tr.querySelector('input[type=checkbox]');
      return (idEl ? idEl.textContent.trim() : '?') + ':' + (box ? box.checked : '?');
    });
    const before = snap();
    const rows = [...document.querySelectorAll('tbody tr')];
    const row = rows.find(tr => {
      const idEl = tr.querySelector('td .font-mono');
      return idEl && idEl.textContent.trim() === 'csvB';
    });
    if (!row) return { err: 'no-row', before };
    const box = row.querySelector('input[type=checkbox]');
    if (!box) return { err: 'no-checkbox', before };
    box.click();
    await new Promise(r => setTimeout(r, 150));
    const after = snap();
    const btn = [...document.querySelectorAll('button')].find(b => b.textContent.trim().indexOf('保存配置') === 0);
    if (!btn) return { err: 'no-save', before, after };
    btn.click();
    await new Promise(r => setTimeout(r, 1500));
    return { ok: true, before, after, dirty: vm.dirty };
  })()`, true);

  ok('页面上完成取消勾选并点了保存', saved.ok === true,
    JSON.stringify(saved.err ? { err: saved.err, before: saved.before, after: saved.after } : saved.after));

  const persisted = await readSettings();
  const nodeRow = (persisted.plugins || []).find(p => p.id === NODE_ID);
  ok('第三方源仍以「一条节点配置」落盘（没有按行拆成 N 条）',
    (persisted.plugins || []).filter(p => p.id === NODE_ID).length === 1);
  ok('导入的源写进节点 pluginIds',
    nodeRow && nodeRow.pluginIds.indexOf('csvA') >= 0 && nodeRow.pluginIds.indexOf('csvB') >= 0,
    JSON.stringify(nodeRow && nodeRow.pluginIds));
  ok('被删除的源不再出现在 pluginIds',
    nodeRow && nodeRow.pluginIds.indexOf('csvC') < 0,
    JSON.stringify(nodeRow && nodeRow.pluginIds));
  ok('取消勾选的子源写进 disabledPluginIds',
    nodeRow && nodeRow.disabledPluginIds.indexOf('csvB') >= 0,
    JSON.stringify(nodeRow && nodeRow.disabledPluginIds));
  ok('导入时默认启用的源不会被误关',
    nodeRow && nodeRow.disabledPluginIds.indexOf('csvA') < 0,
    JSON.stringify(nodeRow && nodeRow.disabledPluginIds));
  ok('先前已关掉的子源没有被保存动作重新打开',
    nodeRow && nodeRow.disabledPluginIds.indexOf('srcC') >= 0,
    JSON.stringify(nodeRow && nodeRow.disabledPluginIds));
  ok('节点整体仍为启用（还有其他开着的子源）', nodeRow && nodeRow.enabled === true, String(nodeRow && nodeRow.enabled));

  // —— 「回到内置默认」：原生源全开、第三方子源全关
  //    这里按 type 判定而不是按节点 id —— 子源展开后每行 id 是子源自己的 id，
  //    节点 id 根本不是一行，按 id 判会一个都关不掉（改这处时踩过）。
  const reset = await evaluate(`(async () => {
    const vm = ${VM};
    const btn = [...document.querySelectorAll('button')].find(b => b.textContent.trim().indexOf('回到内置默认') === 0);
    if (!btn) return { err: 'no-btn' };
    btn.click();
    await new Promise(r => setTimeout(r, 150));
    const native = vm.pluginSources.filter(s => s.type === 'native');
    const other = vm.pluginSources.filter(s => s.type !== 'native');
    return {
      nativeOn: native.every(s => s.enabled),
      otherOff: other.every(s => !s.enabled),
      nativeCount: native.length,
      otherCount: other.length
    };
  })()`, true);
  ok('「回到内置默认」把第三方子源全部关闭',
    reset.nativeOn === true && reset.otherOff === true && reset.otherCount > 0,
    JSON.stringify(reset));

  // —— 刷新页面：行级状态要能原样还原（上一步的「回到默认」没保存，刷新后应回落到已保存状态）
  const tab2 = await openPluginsTab();  const reloaded = await evaluate(`(() => {
    const vm = ${VM};
    const rows = [...document.querySelectorAll('tbody tr')];
    const find = id => rows.find(tr => {
      const idEl = tr.querySelector('td .font-mono');
      return idEl && idEl.textContent.trim() === id;
    });
    const offRow = find('csvB');
    return {
      tab: ${JSON.stringify(tab2)},
      hasCsvA: !!find('csvA'),
      hasCsvC: !!find('csvC'),
      csvBChecked: offRow ? offRow.querySelector('input[type=checkbox]').checked : null,
      dom: rows.length,
      vm: vm ? vm.pluginSources.length : -1
    };
  })()`);

  ok('刷新后导入的源仍在列表里', reloaded.hasCsvA === true);
  ok('刷新后已删除的源不会复活', reloaded.hasCsvC === false);
  ok('刷新后取消勾选的状态被保留', reloaded.csvBChecked === false, String(reloaded.csvBChecked));
  ok('刷新后 DOM 行数与配置一致', reloaded.dom === reloaded.vm, `dom=${reloaded.dom} vm=${reloaded.vm}`);

  /* ============ 场景 D：一次粘一大批（含与已有原生源重名） ============ */
  console.log('\n──── 场景 D · 大批量导入（88 个新源 + 1 个重名）────');

  // 先摆好现场：一个原生源 melost + 一个空的第三方节点
  await saveSettings({
    plugins: [
      { id: 'melost', name: '影盘社', enabled: true, type: 'native' },
      { id: NODE_ID, name: 'E2E 假聚合节点', enabled: false, type: 'pansou', apiEndpoint: ENDPOINT, pluginIds: [], disabledPluginIds: [] }
    ]
  });

  const BULK_COUNT = 88;
  const bulkIds = Array.from({ length: BULK_COUNT }, (_, i) => 'bulk' + (i + 1));
  // 故意混入一个已经存在的原生源 id（melost）和一个重复项，检查去重
  const payload = ['melost', ...bulkIds, 'bulk1'].join(',');

  const tab3 = await openPluginsTab();
  ok('大批量导入前页面就绪', tab3 === 'ok', tab3);

  const bulk = await evaluate(`(async () => {
    const vm = ${VM};
    const before = vm.pluginSources.length;
    const ta = document.querySelector('textarea[placeholder^="clxiong"]');
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
    setter.call(ta, ${JSON.stringify(payload)});
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise(r => setTimeout(r, 80));
    const btn = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === '确认导入');
    btn.click();
    await new Promise(r => setTimeout(r, 250));
    const after = vm.pluginSources.length;
    const ids = vm.pluginSources.map(s => s.id);
    const btn2 = [...document.querySelectorAll('button')].find(b => b.textContent.trim().indexOf('保存配置') === 0);
    btn2.click();
    await new Promise(r => setTimeout(r, 1600));
    return { before, after, melostRows: ids.filter(x => x === 'melost').length, nodeRows: ids.filter(x => x === ${JSON.stringify(NODE_ID)}).length, bulkRows: ids.filter(x => x.indexOf('bulk') === 0).length, dom: document.querySelectorAll('tbody tr').length };
  })()`, true);
  // +88 个新源，同时原来的「空节点行」被摘掉（-1）——否则保存时同一个 id 会落盘两条配置
  ok('大批量导入只新增了不重复的源', bulk.after === bulk.before + BULK_COUNT - 1,
    `${bulk.before} -> ${bulk.after}（期望 +${BULK_COUNT - 1}）`);
  ok('原来的「空节点」行已被子源取代', bulk.nodeRows === 0, '空节点行数=' + bulk.nodeRows);
  ok('与已有原生源重名的 melost 不会被塞进第三方节点', bulk.melostRows === 1, '行数=' + bulk.melostRows);
  ok('批量行数与 DOM 一致', bulk.dom === bulk.after, `dom=${bulk.dom} vm=${bulk.after}`);

  const bulkSaved = await readSettings();
  const bulkNode = (bulkSaved.plugins || []).find(p => p.id === NODE_ID);
  ok('大批量导入后节点仍只落盘一条配置',
    (bulkSaved.plugins || []).filter(p => p.id === NODE_ID).length === 1);
  ok(`节点 pluginIds 收了全部 ${BULK_COUNT} 个新源`,
    bulkNode && bulkNode.pluginIds.length === BULK_COUNT,
    bulkNode && String(bulkNode.pluginIds.length));
  ok('节点 pluginIds 里没有 melost（它是原生源）',
    bulkNode && bulkNode.pluginIds.indexOf('melost') < 0);

  // 全场最后再查一遍：整轮操作下来，页面不该有任何「代码写错」类报错
  ok('整轮后台操作没有未捕获的 JS 报错', pageErrors.length === 0,
    pageErrors.slice(0, 3).join(' || ') || '（无）');

  /* ============ 场景 E：频道批量导入已挪到「TG 频道」Tab ============ */
  console.log('\n──── 场景 E · 频道批量导入挂在 TG 频道页 ────');

  const beforeCh = await readSettings();
  const baseChannels = (beforeCh.channels || []).map(c => ({ ...c }));
  const existingName = (baseChannels.find(c => c.enabled) || baseChannels[0] || {}).name || 'tgsearchers7';

  const openChannelsTab = async () => {
    await send('Page.navigate', { url: BASE + '/admin?debug=1' });
    await sleep(3800);
    const clicked = await evaluate(`(() => {
      const b = [...document.querySelectorAll('button')].find(x => x.textContent.indexOf('TG 频道') >= 0);
      if (!b) return 'no-tab';
      b.click();
      return 'ok';
    })()`);
    await sleep(900);
    return clicked;
  };

  const chTab = await openChannelsTab();
  ok('后台已进入「TG 频道」Tab', chTab === 'ok', chTab);

  const chView = await evaluate(`(() => {
    const vm = ${VM};
    return {
      activeTab: vm ? vm.activeTab : null,
      hasBatch: !!document.querySelector('textarea[placeholder^="channel1"]'),
      hasTitle: [...document.querySelectorAll('h3')].some(h => h.textContent.indexOf('批量导入频道') >= 0)
    };
  })()`);
  ok('当前 Tab 确实是频道页', chView.activeTab === 'channels', String(chView.activeTab));
  ok('频道页内含批量导入文本框', chView.hasBatch === true);
  ok('频道页内含「批量导入频道」标题', chView.hasTitle === true);

  // 混入 4 种脏数据：@前缀 / 空格分隔 / t.me 链接 / 已存在频道 / 非法短名
  const CH = ['e2ech_a', 'e2ech_b', 'e2ech_c'];
  const chPayload = `@${CH[0]}, ${CH[1]} https://t.me/s/${CH[2]}, ${existingName}, ab`;

  const chImport = await evaluate(`(async () => {
    const vm = ${VM};
    const before = vm.settings.channels.length;
    const ta = document.querySelector('textarea[placeholder^="channel1"]');
    if (!ta) return { err: 'no-textarea' };
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
    setter.call(ta, ${JSON.stringify(chPayload)});
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise(r => setTimeout(r, 80));
    const btn = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === '确认导入');
    if (!btn) return { err: 'no-btn' };
    btn.click();
    await new Promise(r => setTimeout(r, 250));
    const names = vm.settings.channels.map(c => c.name);
    return {
      before, after: names.length,
      added: ${JSON.stringify(CH)}.filter(n => names.indexOf(n) >= 0),
      desc: vm.settings.channels.filter(c => c.description === '批量导入').map(c => c.name),
      dupRows: names.filter(n => n === ${JSON.stringify(existingName)}).length,
      badRows: names.filter(n => n === 'ab').length,
      enabledOfA: (vm.settings.channels.find(c => c.name === ${JSON.stringify(CH[0])}) || {}).enabled,
      cleared: ta.value === ''
    };
  })()`, true);

  ok('批量导入按逗号/空格/换行/t.me 链接解析出 3 个新频道',
    chImport.added && chImport.added.length === 3, JSON.stringify(chImport.added));
  ok('已存在的频道不会重复导入',
    chImport.dupRows === 1 && chImport.after === chImport.before + 3,
    `dup=${chImport.dupRows} ${chImport.before} -> ${chImport.after}`);
  ok('非法短名 ab 被拒之门外', chImport.badRows === 0, 'ab 行数=' + chImport.badRows);
  ok('导入后的频道带「批量导入」备注',
    chImport.desc && chImport.desc.length === 3, JSON.stringify(chImport.desc));
  ok('默认「导入后启用」生效', chImport.enabledOfA === true, String(chImport.enabledOfA));
  ok('导入成功后清空输入框', chImport.cleared === true);

  const chSaved = await evaluate(`(async () => {
    const btn = [...document.querySelectorAll('button')].find(b => b.textContent.trim().indexOf('保存配置') === 0);
    if (!btn) return { err: 'no-save' };
    btn.click();
    await new Promise(r => setTimeout(r, 1800));
    return { ok: true };
  })()`, true);
  ok('频道页点保存未报错', chSaved.ok === true, JSON.stringify(chSaved));

  const chPersisted = await readSettings();
  const persistedNames = (chPersisted.channels || []).map(c => c.name);
  ok('导入的频道已落盘', CH.every(n => persistedNames.indexOf(n) >= 0),
    CH.filter(n => persistedNames.indexOf(n) < 0).join(',') || '全部在');
  ok('落盘频道总数只增加了 3',
    persistedNames.length === baseChannels.length + 3,
    `${baseChannels.length} -> ${persistedNames.length}`);

  // 挪走了就得真挪走：系统设置页不该再挂一份
  const sysView = await evaluate(`(async () => {
    const vm = ${VM};
    const b = [...document.querySelectorAll('button')].find(x => x.textContent.indexOf('系统设置') >= 0);
    if (b) b.click();
    await new Promise(r => setTimeout(r, 700));
    return { tab: vm ? vm.activeTab : null, hasChannelBatch: !!document.querySelector('textarea[placeholder^="channel1"]') };
  })()`, true);
  ok('系统设置页已不再挂频道批量导入',
    sysView.tab === 'system' && sysView.hasChannelBatch === false,
    `tab=${sysView.tab} hasBatch=${sysView.hasChannelBatch}`);

  // 清理：把频道列表还原成导入前的样子
  await saveSettings({ channels: baseChannels });
  const chRestored = await readSettings();
  ok('频道列表已还原（不污染后续用例）',
    (chRestored.channels || []).length === baseChannels.length,
    String((chRestored.channels || []).length));

  /* ============ 场景 C：把配置还原成「只留原生源」 ============ */
  console.log('\n──── 场景 C · 配置还原（避免污染后续用例）────');
  await saveSettings({
    plugins: [
      { id: 'melost', name: '影盘社', enabled: true, type: 'native' },
      { id: 'pansou_aggregate', name: 'PanSou 聚合节点', enabled: false, type: 'pansou', apiEndpoint: ENDPOINT, pluginIds: [], disabledPluginIds: [] }
    ]
  });
  const restored = await readSettings();
  const rest = (restored.plugins || []).filter(p => p.type === 'pansou').pop();
  ok('还原后不残留 e2e 源', !!rest && (rest.pluginIds || []).length === 0 && (rest.disabledPluginIds || []).length === 0,
    JSON.stringify(rest && rest.pluginIds));
} catch (e) {
  fail++;
  console.log('FAIL  脚本异常: ' + e.message);
} finally {
  cleanup();
}

console.log(`\n结果: ${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);

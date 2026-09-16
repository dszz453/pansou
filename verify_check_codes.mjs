/**
 * 测活「返回码语义」回归测试（离线版，不需要网络）
 *
 * 为什么要有这个脚本：
 *   线上真链/假链矩阵（verify_check_matrix.mjs）依赖真实网盘可达，
 *   但国内沙箱常常连不上网盘，而且真链随时会失效（别人取消分享），
 *   于是"判定逻辑本身对不对"就没法稳定验证了。
 *   这里直接把 worker 的 fetch 换成桩：喂给它各网盘的**真实返回报文**，
 *   断言判定结果 —— 纯逻辑回归，永远可跑、永远稳定。
 *
 * 用法: node verify_check_codes.mjs
 *   前置：先 node build.mjs（读 dist/worker.js）
 *
 * 被钉死的三个历史误判（2026-09 实测）：
 *   1. 夸克 41012「好友已取消了分享」   → 曾漏判成 unknown，应为 invalid
 *   2. 123   5103 「此分享不存在」       → 曾漏判成 unknown，应为 invalid
 *   3. 115   4100008「访问码错误」       → 曾被误判成 invalid，实为"分享存在、码不对"，应为 valid
 */
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/* ---------------- 各网盘真实报文桩 ---------------- */
// key 用分享 ID，方便把「某条链接」和「它的返回报文」一一对应
const QUARK = {
  // 好友已取消了分享 → 失效
  qa0000000011: { code: 41012, message: '好友已取消了分享' },
  // 分享不存在 → 失效
  qa0000000022: { code: 41027, message: '分享不存在' },
  // 正常拿到 token → 有效
  qa0000000033: { code: 0, message: 'ok', data: { pwd_id: 'qa0000000033' } },
  // 需要提取码 → 有效
  qa0000000044: { code: 41001, message: '需要密码' }
};

const PAN123 = {
  // 备用域名返回 5103「此分享不存在」→ 失效
  aB1234: { code: 5103, message: '此分享不存在', data: null },
  // 正常 → 有效
  aB5678: { code: 0, message: 'ok', data: { ShareKey: 'aB5678', SharePwd: '' } },
  // 带提取码 → 有效·需提取码
  aB9999: { code: 0, message: 'ok', data: { ShareKey: 'aB9999', SharePwd: 'abcd' } },
  // ★ 同是 5103，但 message 是「提取码错误」：分享**存在**，绝不能报失效
  'kyeA-5ntrv': { code: 5103, message: '提取码错误', data: null },
  // 格式异常的 key → 400，视作失效
  badkey: { code: 400, message: 'ShareKey格式异常', data: null }
};

const P115 = {
  // 访问码错误：分享明明存在，绝不能报"已失效"
  swzrznr3wrb: { errno: 4100008, error: '访问码错误' },
  // 未提供访问码
  swwdgkx3zrk: { errno: 4100012, error: '请输入访问码' },
  // 真失效：涉嫌违规
  swzzzz999xx: { errno: 4100033, error: '涉嫌违规，链接已失效' },
  // 正常
  swoooo111xx: { errno: 0, state: true, data: { list: [{ n: 'f' }] } },
  // ★ 真实链接实测：分享已取消 → 失效
  swcancel1234: { errno: 4100010, error: '分享已取消' },
  // ★ 伪造码实测：参数错误（share_code 无法识别）→ 失效
  swunknown999: { errno: 990002, error: '参数错误。' }
};

/* ---------------- 用例表 ---------------- */
// 格式：[用例名, URL, 提取码, 期望状态, 期望通道]
// 期望通道必须一起断言：曾经 41012 的用例「状态」判对了，但实际走的是
// 页面兜底（返回 404 也判 invalid），属于蒙对 —— 加了通道断言才暴露出来。
const CASES = [
  ['夸克·41012 好友已取消分享', 'https://pan.quark.cn/s/qa0000000011', '', 'invalid', 'api'],
  ['夸克·41027 分享不存在', 'https://pan.quark.cn/s/qa0000000022', '', 'invalid', 'api'],
  ['夸克·正常返回 token', 'https://pan.quark.cn/s/qa0000000033', '', 'valid', 'api'],
  ['夸克·需提取码', 'https://pan.quark.cn/s/qa0000000044', '', 'valid', 'api'],

  ['123·5103 分享不存在（备用域名）', 'https://www.123912.com/s/aB1234', '', 'invalid', 'api'],
  ['123·5103 分享不存在（主域名同构）', 'https://www.123684.com/s/aB1234', '', 'invalid', 'api'],
  // ★ 5103 一个码两种含义：这条 message 是「提取码错误」，分享是活的
  ['123·5103 提取码错误（分享存在）', 'https://www.123684.com/s/kyeA-5ntrv', '', 'valid', 'api'],
  ['123·400 ShareKey格式异常', 'https://www.123684.com/s/badkey', '', 'invalid', 'api'],
  ['123·正常分享', 'https://www.123684.com/s/aB5678', '', 'valid', 'api'],
  ['123·带提取码', 'https://www.123684.com/s/aB9999', '', 'valid', 'api'],
  // 域名不可达（主域名已停用等）→ 必须 unknown，绝不误报「已失效」
  ['123·域名不可达 → unknown', 'https://www.123912.com/s/DEADHOST', '', 'unknown', 'api'],
  // 提取码挂在链接 query 上时，应被自动取用并透传给接口（下方断言 SharePwd）
  ['123·query 里的提取码被透传', 'https://www.123684.com/s/aB5678?ABCD', '', 'valid', 'api'],

  ['115·4100008 访问码错误（分享存在）', 'https://115.com/s/swzrznr3wrb', 'sb72', 'valid', 'api'],
  ['115·4100012 未提供访问码', 'https://115.com/s/swwdgkx3zrk', '', 'valid', 'api'],
  ['115·4100033 涉嫌违规真失效', 'https://115.com/s/swzzzz999xx', '', 'invalid', 'api'],
  // ★ 真实链接实测新增的两类：已取消 / share_code 无法识别
  ['115·4100010 分享已取消', 'https://115.com/s/swcancel1234', '', 'invalid', 'api'],
  ['115·990002 参数错误（码不可识别）', 'https://115.com/s/swunknown999', '', 'invalid', 'api'],
  ['115·正常分享', 'https://115.com/s/swoooo111xx', '', 'valid', 'api']
];

/* ---------------- 安装 fetch 桩 ---------------- */
const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });

const realFetch = globalThis.fetch;
let stubCalls = 0;
/** 记录 123 接口被请求时带的 SharePwd，用于断言「链接 query 里的提取码有被透传」 */
const seen123SharePwd = [];

globalThis.fetch = async (input, init) => {
  const url = typeof input === 'string' ? input : input.url;
  const method = (init?.method || 'GET').toUpperCase();
  stubCalls++;

  // 夸克：POST body 里带 pwd_id
  if (url.includes('drive-pc.quark.cn') || url.includes('pan.quark.cn/sharepage')) {
    let pwdId = '';
    try {
      pwdId = JSON.parse(init?.body || '{}').pwd_id || '';
    } catch {}
    const hit = QUARK[pwdId];
    return hit ? json(hit) : json({ code: 41027, message: '分享不存在' }, 200);
  }

  // 123：query 里带 shareKey
  if (/\/b\/api\/share\/get/.test(url)) {
    const u = new URL(url);
    const key = u.searchParams.get('shareKey') || '';
    seen123SharePwd.push(u.searchParams.get('SharePwd') || '');
    // 模拟"域名本身都解析不了"（主域名停用场景）——桩要**抛出**而不是返回 404，
    // 因为 safeFetch 只有在 fetch reject 时才返回 null，返回 404 是另一条分支。
    if (key === 'DEADHOST') throw new TypeError('fetch failed: getaddrinfo ENOTFOUND');
    const hit = PAN123[key];
    return hit ? json(hit) : json({ code: 5103, message: '此分享不存在' }, 200);
  }

  // 115：query 里带 share_code
  if (url.includes('webapi.115.com/share/snap')) {
    const code = new URL(url).searchParams.get('share_code') || '';
    const hit = P115[code];
    return hit ? json(hit) : json({ errno: 4100033, error: '涉嫌违规，链接已失效' }, 200);
  }

  // 其余（页面探测等）一律模拟"不可达"，逼出真实分支而不是碰巧走兜底
  return new Response('stub: not found', { status: 404 });
};

/* ---------------- 跑 ---------------- */
const workerMod = await import(pathToFileURL(path.join(__dirname, 'dist', 'worker.js')).href);
const worker = workerMod.default;

const env = {
  ADMIN_PASSWORD: 'admin',
  DEFAULT_CONCURRENCY: '8',
  CACHE_TTL: '300',
  TG_PROXY_URL: ''
};
const ctx = { waitUntil() {}, passThroughOnException() {} };

console.log('\n## 测活返回码语义矩阵（离线 · 纯逻辑回归）\n');
console.log('用例'.padEnd(36), '期望'.padEnd(9), '实测'.padEnd(9), '通道'.padEnd(6), '判定依据');
console.log('-'.repeat(104));

let pass = 0;
for (const [name, url, pwd, expect, expectMethod] of CASES) {
  const req = new Request('http://local/api/check', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url, password: pwd })
  });
  const res = await worker.fetch(req, env, ctx);
  const d = await res.json();
  const okStatus = d.status === expect;
  const okMethod = !expectMethod || d.method === expectMethod;
  const ok = okStatus && okMethod;
  if (ok) pass++;
  console.log(
    `${ok ? '✅' : '❌'} ${name.padEnd(33)}`,
    expect.padEnd(9),
    String(d.status).padEnd(9),
    String(d.method || '-').padEnd(6),
    `${okStatus ? '' : '[状态不符]'}${okMethod ? '' : '[通道兜底了]'} ${d.label || ''} · ${String(d.message || '').slice(0, 28)}`
  );
}

console.log('-'.repeat(104));
console.log(`通过 ${pass}/${CASES.length}   （fetch 桩被调用 ${stubCalls} 次）`);

// 额外断言：链接 query 里带的提取码（`?ABCD`）必须被透传进 123 接口的 SharePwd
const pwdOk = seen123SharePwd.includes('ABCD');
console.log(
  `${pwdOk ? '✅' : '❌'} 链接 query 提取码透传  → SharePwd 实测收到 [${seen123SharePwd.filter(Boolean).join(',') || '空'}]`
);
console.log();

globalThis.fetch = realFetch;
process.exit(pass === CASES.length && pwdOk ? 0 : 1);

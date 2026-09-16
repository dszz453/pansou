/**
 * 网盘链接失效检测（测活）引擎
 * ============================
 * 运行在 Cloudflare Workers 边缘，对搜索结果中的分享链接做有效性探测。
 *
 * 设计原则：
 *  1. **宁缺毋滥**：只有确凿证据才判 `invalid`；网络异常/被墙/超时一律返回 `unknown`，
 *     避免把「探测失败」误报成「资源已失效」误导用户。
 *  2. **双通道**：优先走网盘官方/半官方接口（可信度最高），失败再退回页面特征词匹配。
 *  3. **短缓存**：内存 Map 缓存 10 分钟，避免重复搜索时反复打同一批链接。
 */

import { identifyCloudType } from './parser';

export type CheckStatus = 'valid' | 'invalid' | 'unknown';

export interface CheckResult {
  /** true=有效 false=已失效 null=无法判定 */
  valid: boolean | null;
  status: CheckStatus;
  /** 前端展示用的短标签 */
  label: string;
  /** 判定依据（排错用） */
  message: string;
  /** 探测通道：api / page / skip */
  method: string;
  latency_ms: number;
}

const CACHE_TTL_MS = 10 * 60 * 1000;
const PROBE_TIMEOUT_MS = 7000;

const BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

interface CacheEntry {
  at: number;
  res: CheckResult;
}

const cache = new Map<string, CacheEntry>();

/* ------------------------------------------------------------------ */
/* 通用工具                                                            */
/* ------------------------------------------------------------------ */

function makeResult(
  status: CheckStatus,
  label: string,
  message: string,
  method: string,
  startedAt: number
): CheckResult {
  return {
    valid: status === 'valid' ? true : status === 'invalid' ? false : null,
    status,
    label,
    message,
    method,
    latency_ms: Date.now() - startedAt
  };
}

/** 带超时的 fetch 包装，返回 null 表示网络层失败 */
async function safeFetch(
  url: string,
  init: RequestInit = {},
  timeoutMs = PROBE_TIMEOUT_MS
): Promise<Response | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal, redirect: 'follow' });
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** 网盘失效时页面上普遍会出现的特征词 */
const INVALID_MARKERS = [
  '分享已失效',
  '分享的文件已经被取消',
  '分享文件已失效',
  '分享链接已失效',
  '该分享已失效',
  '链接已失效',
  '已过期或被删除',
  '分享不存在',
  '分享已被取消',
  '该分享已被取消',
  '文件已删除',
  '你访问的页面不存在',
  '你访问的分享不存在',
  '你所访问的页面不存在',
  '分享者已删除',
  '链接不存在',
  '资源已失效',
  '分享已被删除',
  '内容已被删除'
];

/** 命中即说明分享确实存在 */
const VALID_MARKERS = [
  '提取文件',
  '分享的文件',
  '输入提取码',
  '请输入访问密码',
  'file_list',
  '分享者',
  '文件列表',
  '请输入访问码'
];

/** 提取链接中的分享 ID */
function extractId(url: string, regex: RegExp): string {
  const m = url.match(regex);
  return m && m[1] ? m[1] : '';
}

/**
 * 从链接 query 里捞提取码。
 *
 * 真实搜索结果里提取码常常直接挂在 query 上，形如：
 *   https://123pan.com/s/oec7Vv-OXIWh?ZY4K
 *   https://123pan.com/s/IpPUVv-QHDj?提取码:JZMM
 *   https://115.com/s/swhbjqa3zrk?password=8013
 * 这些码本来就在用户手上，白扔了很可惜 —— 带上它才能把「提取码错误」
 * 升级成真正的文件列表判定。
 */
function extractPwdFromUrl(url: string): string {
  const q = url.split('?')[1];
  if (!q) return '';
  const m =
    q.match(/(?:提取码|访问码|密码|password|pwd|code)\s*[:：=]?\s*([A-Za-z0-9]{4})/i) ||
    q.match(/^([A-Za-z0-9]{4})(?:$|[&#])/);
  return m ? m[1] : '';
}

/** 通用页面特征探测 */
async function probeByPage(
  url: string,
  startedAt: number,
  referer?: string
): Promise<CheckResult> {
  const res = await safeFetch(url, {
    method: 'GET',
    headers: {
      'User-Agent': BROWSER_UA,
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'zh-CN,zh;q=0.9',
      ...(referer ? { Referer: referer } : {})
    }
  });

  if (!res) return makeResult('unknown', '未知', '页面请求失败或超时', 'page', startedAt);

  if (res.status === 404 || res.status === 410) {
    return makeResult('invalid', '已失效', `HTTP ${res.status} 页面不存在`, 'page', startedAt);
  }
  if (res.status >= 500) {
    return makeResult('unknown', '未知', `HTTP ${res.status} 站点异常`, 'page', startedAt);
  }

  let html = '';
  try {
    html = await res.text();
  } catch {
    return makeResult('unknown', '未知', '响应体读取失败', 'page', startedAt);
  }

  if (html.length < 64) {
    return makeResult('unknown', '未知', '页面内容过短', 'page', startedAt);
  }

  // 前端渲染的 SPA 空壳必须**优先**识别：
  // 如 UC 网盘对任何分享地址都只回同一份 ~2KB 骨架页，其 meta 描述里恰好含「文件分享」
  // 这类词，若不先拦下，下面通用特征词匹配会给出错误的结论。
  if (
    html.length < 30000 &&
    /wpk-bid|__NUXT__|content="clouddrive"|<meta name="data-fact"|<div id="app"><\/div>|<div id="root"><\/div>/i.test(
      html
    )
  ) {
    return makeResult('unknown', '未知', '该网盘页面为前端渲染，暂无法自动判定', 'page', startedAt);
  }

  const hitInvalid = INVALID_MARKERS.find(m => html.includes(m));
  if (hitInvalid) {
    return makeResult('invalid', '已失效', `命中失效特征「${hitInvalid}」`, 'page', startedAt);
  }

  const hitValid = VALID_MARKERS.find(m => html.includes(m));
  if (hitValid) {
    return makeResult('valid', '有效', `命中有效特征「${hitValid}」`, 'page', startedAt);
  }

  return makeResult('unknown', '未知', '页面可访问但无法判定状态', 'page', startedAt);
}

/* ------------------------------------------------------------------ */
/* 各网盘定制探测                                                      */
/* ------------------------------------------------------------------ */

/** 阿里云盘：官方匿名分享查询接口 */
async function checkAliyun(url: string, startedAt: number): Promise<CheckResult> {
  const shareId = extractId(
    url,
    /(?:aliyundrive|alipan|alishare)\.com\/(?:s|share)\/([A-Za-z0-9_-]+)/i
  );
  if (!shareId) return makeResult('unknown', '未知', '无法提取分享 ID', 'api', startedAt);

  const res = await safeFetch(
    'https://api.aliyundrive.com/adrive/v3/share_link/get_share_by_anonymous',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': BROWSER_UA,
        Origin: 'https://www.alipan.com',
        Referer: 'https://www.alipan.com/'
      },
      body: JSON.stringify({ share_id: shareId })
    }
  );

  if (!res) return makeResult('unknown', '未知', '接口请求超时', 'api', startedAt);

  // 实测：不存在的分享 ID 会直接返回 404（真实分享则返回 200 + 分享元信息）
  if (res.status === 404 || res.status === 410) {
    return makeResult('invalid', '已失效', `分享不存在（接口 HTTP ${res.status}）`, 'api', startedAt);
  }
  if (res.status !== 200) {
    return makeResult('unknown', '未知', `接口返回 HTTP ${res.status}`, 'api', startedAt);
  }

  let json: any = null;
  try {
    json = await res.json();
  } catch {
    return makeResult('unknown', '未知', '接口返回非 JSON', 'api', startedAt);
  }

  const code = String(json?.code || '');
  const message = String(json?.message || '');

  if (code === 'ShareLink.Cancelled') return makeResult('invalid', '已失效', '分享已被取消', 'api', startedAt);
  if (code === 'ShareLink.NotFound') return makeResult('invalid', '已失效', '分享不存在', 'api', startedAt);
  if (code === 'ShareLink.Forbidden' || code === 'Forbidden') {
    return makeResult('valid', '有效', '分享存在但已禁止访问', 'api', startedAt);
  }

  if (json?.share_name || json?.display_name || typeof json?.file_count === 'number') {
    const needPwd = json?.share_pwd || json?.has_pwd;
    return makeResult(
      'valid',
      needPwd ? '有效·需提取码' : '有效',
      `分享「${json.share_name || json.display_name || ''}」在线`,
      'api',
      startedAt
    );
  }

  return makeResult(
    'unknown',
    '未知',
    `接口未返回有效信息${message ? '：' + message : ''}`,
    'api',
    startedAt
  );
}

/** 夸克网盘：官方分享 token 接口 */
async function checkQuark(url: string, pwd: string, startedAt: number): Promise<CheckResult> {
  const pwdId = extractId(url, /quark\.cn\/s\/([A-Za-z0-9_-]+)/i);
  if (!pwdId) return makeResult('unknown', '未知', '无法提取分享 ID', 'api', startedAt);

  const res = await safeFetch(
    'https://drive-pc.quark.cn/1/clouddrive/share/sharepage/token?pr=ucpro&fr=pc&uc_param_str=',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': BROWSER_UA,
        Origin: 'https://pan.quark.cn',
        Referer: 'https://pan.quark.cn/'
      },
      body: JSON.stringify({ pwd_id: pwdId, passcode: pwd || '' })
    }
  );

  if (res) {
    let json: any = null;
    try {
      json = await res.json();
    } catch {
      json = null;
    }
    if (json && typeof json.code !== 'undefined') {
      const code = Number(json.code);
      const msg = String(json.message || '');
      if (code === 0 && json.data) {
        return makeResult('valid', '有效', '分享 token 获取成功', 'api', startedAt);
      }
      // 实测确认（2026-09）的失效码：
      //   41027 = 分享不存在
      //   41012 = 好友已取消了分享
      //   其余为分享被取消 / 被删除 / 已过期
      if ([41004, 41006, 41008, 41010, 41012, 41013, 41027, 31001].includes(code)) {
        return makeResult('invalid', '已失效', msg || '分享已失效或被删除', 'api', startedAt);
      }
      if (code === 41001 || code === 41002) {
        return makeResult('valid', '有效·需提取码', msg || '需要访问密码', 'api', startedAt);
      }
    }
  }

  return probeByPage(url, startedAt, 'https://pan.quark.cn/');
}

/** 百度网盘：wxlist 接口 */
async function checkBaidu(url: string, pwd: string, startedAt: number): Promise<CheckResult> {
  const surl = extractId(url, /baidu\.com\/(?:s\/1|s\/|share\/init\?surl=)([A-Za-z0-9_-]+)/i);
  if (!surl) return makeResult('unknown', '未知', '无法提取分享 ID', 'api', startedAt);

  const api =
    `https://pan.baidu.com/share/wxlist?channel=weixin&version=2.2.2&op=list&surl=${surl}` +
    (pwd ? `&pwd=${encodeURIComponent(pwd)}` : '');

  const res = await safeFetch(api, {
    headers: { 'User-Agent': BROWSER_UA, Referer: 'https://pan.baidu.com/' }
  });

  if (res && res.status === 200) {
    let json: any = null;
    try {
      json = await res.json();
    } catch {
      json = null;
    }
    if (json && typeof json.errno !== 'undefined') {
      const errno = Number(json.errno);
      if (errno === 0) return makeResult('valid', '有效', '分享列表获取成功', 'api', startedAt);
      if (errno === -6 || errno === -9) {
        return makeResult('valid', '有效·需提取码', '需要提取码', 'api', startedAt);
      }
      if ([-7, 105, 110, 112, 113].includes(errno)) {
        return makeResult('invalid', '已失效', json.err_msg || '链接不存在或已失效', 'api', startedAt);
      }
    }
  }

  return probeByPage(url, startedAt, 'https://pan.baidu.com/');
}

/**
 * 123 网盘：官方分享接口
 *
 * 三个坑：
 *  1. 备用域名一长串（123684/123685/123865/123912/123951/123957…），漏一个就判不了；
 *  2. 主域名 www.123pan.com 现已基本停用（连页面都 404），
 *     所以接口请求要**跟着链接自身的域名走**，否则永远只能退回页面探测；
 *  3. **5103 是一个码两种含义**（2026-09 用真实链接实测）：
 *       message「此分享不存在」 → 真失效
 *       message「提取码错误」   → 分享**存在**，只是没给对提取码！
 *     一刀切把 5103 当失效，就会把「活着但要码」的资源误报成「已失效」——
 *     和 115 的 4100008 是同一类误报，必须按 message 分辨。
 *     （另外伪造/格式异常的 key 会返回 400「ShareKey格式异常」，也算失效。）
 */
async function check123Pan(url: string, pwd: string, startedAt: number): Promise<CheckResult> {
  const shareKey = extractId(
    url,
    /123(?:pan|684|685|865|912|951|957)\.(?:com|cn|net)\/s\/([A-Za-z0-9_-]+)/i
  );
  if (!shareKey) return makeResult('unknown', '未知', '无法提取分享 ID', 'api', startedAt);

  const host = (url.match(/^https?:\/\/([^/]+)/i) || [])[1] || 'www.123684.com';
  // 提取码优先用调用方给的，其次从链接 query 里捞（真实链接常把码挂在 query 上）
  const passPwd = pwd || extractPwdFromUrl(url);

  const api =
    `https://${host}/b/api/share/get?limit=100&next=1&orderBy=share_id&orderDirection=desc` +
    `&shareKey=${shareKey}&SharePwd=${encodeURIComponent(passPwd)}&ParentFileId=0&Page=1`;

  const res = await safeFetch(api, {
    headers: {
      'User-Agent': BROWSER_UA,
      Accept: 'application/json, text/plain, */*',
      Referer: `https://${host}/s/${shareKey}`
    }
  });

  if (res && res.status === 200) {
    let json: any = null;
    try {
      json = await res.json();
    } catch {
      json = null;
    }
    if (json && typeof json.code !== 'undefined') {
      const code = Number(json.code);
      const msg = String(json.message || '');
      if (code === 0) {
        const needPwd = !!json.data?.SharePwd;
        return makeResult(
          'valid',
          needPwd ? '有效·需提取码' : '有效',
          '分享信息获取成功',
          'api',
          startedAt
        );
      }
      // 5103 +「提取码错误」：分享存在，只是码不对 → 有效·需提取码（绝不报失效）
      if (code === 5103 && /提取码|密码|访问码/.test(msg)) {
        return makeResult('valid', '有效·需提取码', msg, 'api', startedAt);
      }
      // 5103「此分享不存在」/ 400「ShareKey格式异常」/ 历史主域名时期的失效码
      if ([5103, 400, 50001, 404, 1001, 5113].includes(code)) {
        return makeResult('invalid', '已失效', msg || '分享不存在或已失效', 'api', startedAt);
      }
    }
  }

  // 关键优化：123 的接口与分享页是**同一个域名**（本函数刻意跟随链接自身域名）。
  // 所以接口连不上（res === null = DNS/连接/超时）时，再拿同域页面探测一遍纯属白等，
  // 只会把单条耗时从 7s 拖到 14s。此时如实返回 unknown ——「域名都不可达」本身就
  // 属于「无法判定」，按「宁缺毋滥」原则绝不能报成「已失效」。
  if (!res) {
    return makeResult(
      'unknown',
      '未知',
      `分享域名 ${host} 不可达（可能已停用），无法判定`,
      'api',
      startedAt
    );
  }

  return probeByPage(url, startedAt, `https://${host}/`);
}

/**
 * 115 网盘：webapi 分享快照接口
 *
 * 实测（2026-09）该接口**无需登录**即可调用，且返回语义明确：
 *   errno 4100033「涉嫌违规，链接已失效」 → 已失效
 *   errno 4100010「分享已取消」           → 已失效（真实链接实测）
 *   errno 990002「参数错误。」             → share_code 无法识别 ⇒ 分享不存在
 *   errno 4100012「请输入访问码」          → 分享存在，需提取码
 *   errno 4100008「访问码错误」            → 分享存在，只是码给错了（**不是失效**）
 *   state:true + data.list               → 有效
 * 注意：另一个常见接口 share/shareinfo 需要登录（errno 990001），不可用。
 */
async function check115(url: string, pwd: string, startedAt: number): Promise<CheckResult> {
  const code = extractId(url, /115(?:cdn)?\.com\/s\/([A-Za-z0-9_-]+)/i);
  if (!code) return makeResult('unknown', '未知', '无法提取分享 ID', 'api', startedAt);

  // 提取码优先用调用方给的，其次从链接 query 里捞（真实链接常见 `?password=8013`）
  const passPwd = pwd || extractPwdFromUrl(url);

  const api =
    `https://webapi.115.com/share/snap?share_code=${code}&offset=0&limit=20` +
    (passPwd ? `&receive_code=${encodeURIComponent(passPwd)}` : '');

  const res = await safeFetch(api, {
    headers: {
      'User-Agent': BROWSER_UA,
      Accept: 'application/json, text/plain, */*',
      Referer: 'https://115.com/'
    }
  });

  if (res && res.status === 200) {
    let json: any = null;
    try {
      json = await res.json();
    } catch {
      json = null;
    }
    if (json && typeof json.errno !== 'undefined') {
      const errno = Number(json.errno);
      const msg = String(json.error || '');

      // ===== 实测语义（2026-09，逐个用真实链接验证过）=====
      //   4100033「涉嫌违规，链接已失效」 / 4100034 过期 / 4100004 已删除 → 真失效
      //   4100010「分享已取消」           → 真失效（真实链接实测）
      //   990002「参数错误。」             → share_code 无法识别，即分享不存在
      //                                    （伪造码实测普遍返回它，真码从不返回）
      //   4100012「请输入访问码」          → 分享**存在**，只是没给码
      //   4100008「访问码错误」            → 分享**存在**，只是码不对
      // 关键教训：4100008 早先被误归入失效列表，会把"活着但要正确提取码"的
      //          分享标成"已失效"，属于典型的误报，已修正。
      if ([4100033, 4100034, 4100004, 4100009, 4100010, 990002].includes(errno)) {
        return makeResult('invalid', '已失效', msg || '分享已失效或被删除', 'api', startedAt);
      }
      // 分享在，但要访问码（未提供 / 提供错误 都归到这一类，不误报失效）
      if (errno === 4100012 || errno === 4100008) {
        return makeResult('valid', '有效·需提取码', msg || '需要访问码', 'api', startedAt);
      }
      // 正常返回文件列表
      if (json.state === true || Array.isArray(json.data?.list)) {
        return makeResult('valid', '有效', '分享信息获取成功', 'api', startedAt);
      }
      // 接口要求登录——无法判定，如实返回
      if (errno === 990001) {
        return makeResult('unknown', '未知', '接口要求登录，无法自动判定', 'api', startedAt);
      }
    }
  }

  return probeByPage(url, startedAt, 'https://115.com/');
}

/**
 * 只支持页面特征词探测的网盘。
 *
 * 注意 UC 网盘：`drive.uc.cn` 对任何路径都返回前端 SPA 空壳（约 12KB），
 * 且其 clouddrive 接口强制校验 CSRF token，边缘侧拿不到，因此无法自动判定。
 * 这种情况下**诚实地返回「未知」**，不猜测——参见文件头「宁缺毋滥」原则。
 */
const PAGE_ONLY_TYPES = new Set(['tianyi', 'uc', 'mobile', 'xunlei', 'guangya', 'pikpak']);

/* ------------------------------------------------------------------ */
/* 对外入口                                                            */
/* ------------------------------------------------------------------ */

/**
 * 检测单个网盘分享链接是否有效。
 *
 * @param url   分享链接
 * @param pwd   提取码（可选，能显著提高百度/夸克判定准确率）
 * @param type  已知网盘类型（可选，不传则从 URL 推断）
 */
export async function checkLinkValidity(
  url: string,
  pwd?: string,
  type?: string
): Promise<CheckResult> {
  const startedAt = Date.now();
  const cleanUrl = String(url || '').trim();

  if (!/^https?:\/\//i.test(cleanUrl)) {
    return makeResult('unknown', '无法检测', '非 HTTP 链接，无法在线探测', 'skip', startedAt);
  }

  const cacheKey = `${cleanUrl}|${pwd || ''}`;
  const hit = cache.get(cacheKey);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) {
    return hit.res;
  }

  const cloudType = type || identifyCloudType(cleanUrl);
  let out: CheckResult;

  try {
    if (cloudType === 'aliyun') {
      out = await checkAliyun(cleanUrl, startedAt);
    } else if (cloudType === 'quark') {
      out = await checkQuark(cleanUrl, pwd || '', startedAt);
    } else if (cloudType === 'baidu') {
      out = await checkBaidu(cleanUrl, pwd || '', startedAt);
    } else if (cloudType === '115') {
      out = await check115(cleanUrl, pwd || '', startedAt);
    } else if (cloudType === '123') {
      out = await check123Pan(cleanUrl, pwd || '', startedAt);
    } else if (PAGE_ONLY_TYPES.has(String(cloudType))) {
      out = await probeByPage(cleanUrl, startedAt);
    } else {
      out = await probeByPage(cleanUrl, startedAt);
    }
  } catch (e: any) {
    out = makeResult('unknown', '未知', `探测异常：${(e && e.message) || e}`, 'page', startedAt);
  }

  if (cache.size > 500) {
    const firstKey = cache.keys().next().value;
    if (firstKey) cache.delete(firstKey);
  }
  cache.set(cacheKey, { at: Date.now(), res: out });

  return out;
}

/**
 * 搜索插件引擎
 * ============
 * 支持两类插件：
 *
 * 1. `type: 'pansou'` —— 调用任意「pansou 兼容」的 `/api/search` 节点。
 *    这是 pansou 生态的标准协议（fish2018/pansou），一个节点内部会并行跑几十上百个
 *    子插件（hunhepan / jikepan / qupansou / panwiki …），
 *    我们通过 `?plugins=id1,id2` 指定要启用哪些，一次 HTTP 请求拿到合并结果。
 *
 * 2. `type: 'custom'` —— 调用任意 REST API，用 `responseMapping` 把返回的 JSON
 *    字段映射成标准结构。适合接入自建服务或第三方开放接口。
 *
 * 输出统一为 SearchResultItem，可直接与 TG 频道抓取的结果合并去重。
 */
import { PluginConfig, SearchResultItem, CloudType } from '../types';
import {
  extractLinksAndPasswords,
  extractTags,
  extractTitle,
  ContextualExtractedLink
} from '../parser';

/** 部分站点会按 UA 拦截，统一伪装成普通浏览器 */
const BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36';

/**
 * 失败重试策略。
 *
 * 实测：聚合节点背后也是 Cloudflare，同一来源连续请求会被 WAF 拦成
 * `HTTP 403 / error code: 1003`（约 250ms 就返回）。同一隔离实例里第 1 次通常成功、
 * 紧接着的第 2 次就 403。因此需要重试，但必须用「总预算」封顶，
 * 否则 3 次 × 12s 超时会把单次搜索拖到 30 秒以上。
 */
const MAX_ATTEMPTS = 3;
/**
 * 重试退避基数。WAF 拦的是「同一来源的突发请求」，实测 600ms 太短、
 * 下一发仍然吃 403；拉到 1.2s（第 2 发等 1.2s、第 3 发等 2.4s）通过率明显更好。
 */
const RETRY_BASE_DELAY_MS = 1200;
/** 少于这个剩余预算就不再重试（重试也来不及返回了） */
const MIN_RETRY_BUDGET_MS = 3000;
/**
 * 单次尝试的时间上限。
 * 节点最慢实测 13.3 秒返回，但如果第一发就吃满整个预算，后面就没机会重试了；
 * 因此把单发压在 13 秒，超时后还能留 5 秒补一发（补发常能命中节点的边缘缓存，几百毫秒就回）。
 */
const ATTEMPT_CAP_MS = 13000;

const sleep = (ms: number) => new Promise(res => setTimeout(res, ms));

/**
 * 带「总预算」的 fetch 重试封装。
 *
 * @param budgetMs 从本次调用开始算的总时间预算；每次尝试的超时 = 剩余预算，
 *                 剩余不足 MIN_RETRY_BUDGET_MS 时直接放弃。
 * @returns 成功的 Response，或 null（所有尝试都失败/超预算）
 */
async function fetchWithRetry(
  target: string,
  init: RequestInit,
  budgetMs: number
): Promise<Response | null> {
  const deadline = Date.now() + budgetMs;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const remaining = deadline - Date.now();
    if (remaining < MIN_RETRY_BUDGET_MS) break;
    if (attempt > 0) {
      await sleep(Math.min(RETRY_BASE_DELAY_MS * attempt, Math.max(0, remaining - 1500)));
    }

    const remainingBudget = deadline - Date.now();
    const attemptBudget = Math.min(remainingBudget, ATTEMPT_CAP_MS);
    if (attemptBudget < 1000) break;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), attemptBudget);
    try {
      const res = await fetch(target, { ...init, signal: controller.signal });
      if (res.ok) {
        clearTimeout(timer);
        return res;
      }
      // 非 2xx（403 限流 / 5xx）——读掉 body 再重试，避免占着连接
      await res.text().catch(() => {});
    } catch (e) {
      // 超时或网络错误：进入下一轮重试
    } finally {
      clearTimeout(timer);
    }
  }

  return null;
}

/** 网盘类型别名归一：把各节点五花八门的写法统一到本项目的 CloudType */
const CLOUD_TYPE_ALIAS: Record<string, string> = {
  other: 'others',
  unknown: 'others',
  未知: 'others',
  其他: 'others',
  ali: 'aliyun',
  alipan: 'aliyun',
  '115com': '115',
  magnet_link: 'magnet',
  magnetlink: 'magnet',
  thunder: 'xunlei',
  '123pan': '123',
  caiyun: 'mobile',
  '139': 'mobile',
  '189': 'tianyi',
  gypan: 'guangya'
};

/** 把节点返回的网盘分类名归一化 */
export function normalizeCloudType(type: string): string {
  const t = String(type || '')
    .trim()
    .toLowerCase();
  if (!t) return 'others';
  return CLOUD_TYPE_ALIAS[t] || t;
}

/**
 * 把 pansou 节点返回的 `merged_by_type` 结构拍平成 SearchResultItem[]
 * 结构形如：{ quark: [{ url, password, note, datetime, source, images }], ... }
 */
function flattenMergedByType(
  merged: Record<string, any>,
  plugin: PluginConfig
): SearchResultItem[] {
  const items: SearchResultItem[] = [];
  let idx = 0;

  for (const cloudType of Object.keys(merged)) {
    const list = merged[cloudType];
    if (!Array.isArray(list)) continue;
    const normType = normalizeCloudType(cloudType);

    for (const entry of list) {
      if (!entry || !entry.url) continue;
      idx++;

      const url = String(entry.url).trim();
      const note = String(entry.note || entry.title || '').trim();
      // 节点通常已在 source 里标明来源（如 plugin:mizixing / tg:ucquark），保留它
      const source = String(entry.source || `plugin:${plugin.id}`).trim();

      const link: ContextualExtractedLink = {
        type: normType as CloudType,
        url,
        password: entry.password ? String(entry.password) : undefined,
        contextTitle: note || undefined
      };

      items.push({
        message_id: String(idx),
        unique_id: `${plugin.id}_${normType}_${idx}`,
        channel: source,
        datetime: entry.datetime || new Date().toISOString(),
        title: note || extractTitle(url),
        content: note,
        links: [link],
        tags: extractTags(note),
        images: Array.isArray(entry.images) && entry.images.length ? entry.images : undefined
      });
    }
  }

  return items;
}

/** 执行 pansou 兼容节点插件 */
async function executePansouPlugin(
  plugin: PluginConfig,
  keyword: string,
  budgetMs: number
): Promise<SearchResultItem[]> {
  const base = (plugin.apiEndpoint || '').trim();
  if (!base) return [];

  const sep = base.includes('?') ? '&' : '?';
  const ids = (plugin.pluginIds || []).filter(Boolean);
  const pluginParam = ids.length > 0 ? `&plugins=${encodeURIComponent(ids.join(','))}` : '';
  const target = `${base}${sep}kw=${encodeURIComponent(keyword)}&res=merge${pluginParam}`;

  const res = await fetchWithRetry(
    target,
    {
      method: 'GET',
      headers: {
        'User-Agent': BROWSER_UA,
        Accept: 'application/json, text/plain, */*',
        'Accept-Language': 'zh-CN,zh;q=0.9',
        ...(plugin.headers || {})
      }
    },
    budgetMs
  );
  if (!res) return [];

  const json: any = await res.json().catch(() => null);
  if (!json) return [];

  // 兼容两种外层包装：{code,data:{...}} 或直接就是 {...}
  const payload =
    json.data && (json.data.merged_by_type || json.data.results) ? json.data : json;

  // 若节点返回的是 results 数组而非 merged_by_type，退化为直接转换
  if (!payload.merged_by_type && Array.isArray(payload.results)) {
    return payload.results as SearchResultItem[];
  }

  const merged = payload.merged_by_type;
  if (!merged || typeof merged !== 'object') return [];

  return flattenMergedByType(merged, plugin);
}

/** 按 responseMapping 把任意 JSON 映射为标准结果 */
function parseMappedResponse(json: any, plugin: PluginConfig): SearchResultItem[] {
  const mapping = plugin.responseMapping || {};

  let list: any[] = [];
  if (mapping.resultPath) {
    let cur: any = json;
    for (const p of mapping.resultPath.split('.')) {
      cur = cur && typeof cur === 'object' ? cur[p] : null;
      if (cur === null) break;
    }
    if (Array.isArray(cur)) list = cur;
  }
  // 自动探测常见包装层级
  if (list.length === 0) {
    if (Array.isArray(json)) list = json;
    else if (Array.isArray(json?.data)) list = json.data;
    else if (Array.isArray(json?.data?.list)) list = json.data.list;
    else if (Array.isArray(json?.results)) list = json.results;
    else if (Array.isArray(json?.list)) list = json.list;
  }

  const items: SearchResultItem[] = [];
  for (let i = 0; i < list.length; i++) {
    const item = list[i];
    if (!item) continue;

    const titleField = mapping.titleField || 'title';
    const contentField = mapping.contentField || 'content';
    const urlField = mapping.urlField || 'url';
    const pwdField = mapping.pwdField || 'password';
    const dateField = mapping.dateField || 'datetime';

    const title = String(item[titleField] ?? item.name ?? '').trim();
    const content = String(item[contentField] ?? item.desc ?? item.description ?? title).trim();
    const rawUrl = String(item[urlField] ?? item.link ?? '').trim();
    const pwd = String(item[pwdField] ?? item.pwd ?? item.code ?? '').trim();
    const datetime = String(item[dateField] ?? item.time ?? new Date().toISOString());

    // 拼成文本后复用统一解析器，自动识别网盘类型与提取码
    const fullText = `${title}\n${content}\n${rawUrl}${pwd ? `\n密码: ${pwd}` : ''}`;
    const links = extractLinksAndPasswords(fullText);
    if (links.length > 0 && pwd && !links[0]!.password) {
      links[0]!.password = pwd;
    }
    if (links.length === 0) continue;

    items.push({
      message_id: String(item.id ?? item.message_id ?? i + 1),
      unique_id: `plugin_${plugin.id}_${item.id ?? i}`,
      channel: `plugin:${plugin.name || plugin.id}`,
      datetime,
      title: title || extractTitle(fullText),
      content: content || fullText,
      links,
      tags: extractTags(fullText)
    });
  }

  return items;
}

/** 执行自定义 REST API 插件 */
async function executeCustomApiPlugin(
  plugin: PluginConfig,
  keyword: string,
  budgetMs: number
): Promise<SearchResultItem[]> {
  const endpoint = (plugin.apiEndpoint || '').replace(/\{keyword\}/g, encodeURIComponent(keyword));
  if (!endpoint) return [];

  const method = plugin.method || 'GET';

  const headers: Record<string, string> = {
    'User-Agent': BROWSER_UA,
    Accept: 'application/json, text/plain, */*',
    ...(plugin.headers || {})
  };

  let body: string | undefined;
  if (method === 'POST' && plugin.bodyTemplate) {
    body = plugin.bodyTemplate.replace(/\{keyword\}/g, keyword);
    if (!headers['Content-Type']) headers['Content-Type'] = 'application/json';
  }

  const res = await fetchWithRetry(endpoint, { method, headers, body }, budgetMs);
  if (!res) return [];

  const json: any = await res.json().catch(() => null);
  if (!json) return [];

  return parseMappedResponse(json, plugin);
}

/**
 * 执行单个插件搜索
 * 任何异常都吞掉并返回空数组 —— 插件是「增益项」，绝不能因为它挂掉而影响整体搜索。
 */
export async function executePluginSearch(
  plugin: PluginConfig,
  keyword: string,
  budgetMs = 18000
): Promise<SearchResultItem[]> {
  if (!plugin || !plugin.enabled || !plugin.apiEndpoint) return [];
  if (plugin.type === 'pansou') {
    return executePansouPlugin(plugin, keyword, budgetMs);
  }
  return executeCustomApiPlugin(plugin, keyword, budgetMs);
}

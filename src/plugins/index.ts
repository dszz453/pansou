/**
 * 搜索插件引擎
 *
 * 支持三类插件：
 *  1. 'native'（V1.4 起默认）：**在 Worker 内直接抓取资源站**，实现见 `./native.ts`。
 *     不依赖任何第三方节点，是「不再依赖 so.252035.xyz」之后的主力路径。
 *  2. 'pansou'：调用任意「pansou 兼容」的 `/api/search` 聚合节点，
 *     传入 `plugins=id1,id2` 启用远端子插件源。默认配置里已停用。
 *  3. 'custom'：调用任意标准 REST API，通过字段映射（responseMapping）把任意 JSON 映射成搜索结果。
 */

import { PluginConfig, SearchResultItem, CloudType } from '../types';
import { runNativeSource } from './native';
import {
  extractTags,
  extractTitle,
  extractLinksAndPasswords,
  ContextualExtractedLink,
  identifyCloudType
} from '../parser';

const BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';

/** 重试配置：WAF 限流（403/1003 或 429）时做指数退避 */
const MAX_ATTEMPTS = 3;
const RETRY_DELAYS_MS = [1200, 2400];

/** 带重试的 fetch：仅在 403 / 429 / 502 / 503 / 504 时重试，并在总预算内控制 */
async function fetchWithRetry(
  url: string,
  init: RequestInit,
  budgetMs: number
): Promise<Response | null> {
  const start = Date.now();

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const elapsed = Date.now() - start;
    const remaining = budgetMs - elapsed;
    if (remaining <= 800) break;

    const perAttemptTimeout = Math.min(remaining, 13000);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), perAttemptTimeout);

    try {
      const res = await fetch(url, {
        ...init,
        signal: controller.signal
      });

      if (res.ok) {
        return res;
      }

      const shouldRetry =
        res.status === 403 ||
        res.status === 429 ||
        res.status === 502 ||
        res.status === 503 ||
        res.status === 504;

      if (!shouldRetry || attempt === MAX_ATTEMPTS - 1) {
        return res;
      }

      const delay = RETRY_DELAYS_MS[attempt] || 2000;
      if (Date.now() - start + delay >= budgetMs) {
        return res;
      }
      await new Promise(r => setTimeout(r, delay));
    } catch (e: any) {
      if (attempt === MAX_ATTEMPTS - 1) return null;
      const delay = RETRY_DELAYS_MS[attempt] || 1500;
      await new Promise(r => setTimeout(r, delay));
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
  其他网盘: 'others',
  ali: 'aliyun',
  alipan: 'aliyun',
  aliyunpan: 'aliyun',
  阿里云盘: 'aliyun',
  阿里: 'aliyun',
  quark: 'quark',
  夸克: 'quark',
  夸克网盘: 'quark',
  baidu: 'baidu',
  百度: 'baidu',
  百度网盘: 'baidu',
  百度云: 'baidu',
  '115com': '115',
  '115': '115',
  '115网盘': '115',
  magnet_link: 'magnet',
  magnetlink: 'magnet',
  magnet: 'magnet',
  磁力: 'magnet',
  thunder: 'xunlei',
  xunlei: 'xunlei',
  迅雷: 'xunlei',
  迅雷云盘: 'xunlei',
  '123pan': '123',
  '123': '123',
  '123网盘': '123',
  '123云盘': '123',
  caiyun: 'mobile',
  '139': 'mobile',
  移动云盘: 'mobile',
  和彩云: 'mobile',
  '189': 'tianyi',
  tianyi: 'tianyi',
  天翼: 'tianyi',
  天翼云盘: 'tianyi',
  gypan: 'guangya',
  guangya: 'guangya',
  光鸭: 'guangya',
  光鸭网盘: 'guangya',
  uc: 'uc',
  uc网盘: 'uc',
  pikpak: 'pikpak'
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

  for (const rawCloudType of Object.keys(merged)) {
    const list = merged[rawCloudType];
    if (!Array.isArray(list)) continue;
    let normType = normalizeCloudType(rawCloudType);

    for (const entry of list) {
      if (!entry || !entry.url) continue;
      idx++;

      const url = String(entry.url).trim();
      const note = String(entry.note || entry.title || '').trim();
      const source = String(entry.source || `plugin:${plugin.id}`).trim();

      // 如果原始分类是 others，或者 URL 明细可以识别出更精准的类型，优先使用 URL 识别结果
      const identifiedType = identifyCloudType(url);
      let finalType: CloudType = normType as CloudType;
      if (finalType === 'others' && identifiedType !== 'others') {
        finalType = identifiedType;
      } else if (identifiedType !== 'others' && finalType !== identifiedType) {
        // 如果 URL 明确判定是 aliyun/quark/baidu/123/uc 等，校正为精准分类
        finalType = identifiedType;
      }

      const link: ContextualExtractedLink = {
        type: finalType,
        url,
        password: entry.password ? String(entry.password) : undefined,
        contextTitle: note || undefined
      };

      items.push({
        message_id: String(idx),
        unique_id: `${plugin.id}_${finalType}_${idx}`,
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

/**
 * 把自定义 REST API 返回的任意 JSON 按照 responseMapping 拍平为 SearchResultItem[]
 */
function parseMappedResponse(
  json: any,
  plugin: PluginConfig
): SearchResultItem[] {
  if (!json) return [];
  const mapping = plugin.responseMapping || {};

  let list: any[] = [];
  if (mapping.resultPath) {
    const parts = mapping.resultPath.split('.');
    let cur: any = json;
    for (const p of parts) {
      if (cur && typeof cur === 'object' && p in cur) {
        cur = cur[p];
      } else {
        cur = null;
        break;
      }
    }
    if (Array.isArray(cur)) list = cur;
  } else {
    if (Array.isArray(json)) {
      list = json;
    } else if (Array.isArray(json.data)) {
      list = json.data;
    } else if (Array.isArray(json.results)) {
      list = json.results;
    } else if (Array.isArray(json.list)) {
      list = json.list;
    } else if (Array.isArray(json.items)) {
      list = json.items;
    } else if (json.data && typeof json.data === 'object') {
      if (Array.isArray(json.data.list)) list = json.data.list;
      else if (Array.isArray(json.data.results)) list = json.data.results;
      else if (Array.isArray(json.data.items)) list = json.data.items;
    }
  }

  if (!list.length) return [];

  const items: SearchResultItem[] = [];
  for (let i = 0; i < list.length; i++) {
    const item = list[i];
    if (!item || typeof item !== 'object') continue;

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

  try {
    const json = await res.json();
    return parseMappedResponse(json, plugin);
  } catch {
    return [];
  }
}

/** 执行 pansou 兼容聚合节点插件 */
async function executePansouPlugin(
  plugin: PluginConfig,
  keyword: string,
  budgetMs: number
): Promise<SearchResultItem[]> {
  const base = (plugin.apiEndpoint || '').replace(/\/+$/, '');
  if (!base) return [];

  let url = `${base}?kw=${encodeURIComponent(keyword)}&res=merge&src=all`;

  const headers: Record<string, string> = {
    'User-Agent': BROWSER_UA,
    Accept: 'application/json, text/plain, */*',
    'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
    ...(plugin.headers || {})
  };

  // 子源过滤必须走 `plugins=` 查询参数。
  // 实测（2026-09）：聚合节点会**完全忽略** `X-Plugins` 请求头，
  // 只认 url 上的 `plugins=id1,id2`；不带该参数时节点回它自带的全部源。
  // 这里用 effectivePluginIds 剔掉被单独关掉的子源，后台的复选框才是真开关。
  if (plugin.pluginIds && plugin.pluginIds.length > 0) {
    const ids = effectivePluginIds(plugin);
    if (ids.length > 0) {
      url += `&plugins=${encodeURIComponent(ids.join(','))}`;
    }
  }

  const res = await fetchWithRetry(url, { method: 'GET', headers }, budgetMs);
  if (!res) return [];

  try {
    const json: any = await res.json();
    if (!json) return [];

    if (json.merged_by_type && typeof json.merged_by_type === 'object') {
      return flattenMergedByType(json.merged_by_type, plugin);
    }

    if (json.data?.merged_by_type && typeof json.data.merged_by_type === 'object') {
      return flattenMergedByType(json.data.merged_by_type, plugin);
    }

    if (Array.isArray(json.results) && json.results.length > 0) {
      return json.results.map((r: any, idx: number) => ({
        message_id: String(r.message_id || idx + 1),
        unique_id: `${plugin.id}_res_${idx}`,
        channel: r.channel || `plugin:${plugin.id}`,
        datetime: r.datetime || new Date().toISOString(),
        title: r.title || '未命名资源',
        content: r.content || '',
        links: (r.links || []).map((l: any) => ({
          type: identifyCloudType(l.url || '') !== 'others' ? identifyCloudType(l.url || '') : (normalizeCloudType(l.type) as CloudType),
          url: l.url,
          password: l.password
        })),
        tags: r.tags || [],
        images: r.images
      }));
    }

    return [];
  } catch {
    return [];
  }
}

/**
 * 节点本次实际要请求的子源列表。
 *
 * `pluginIds` = 节点名下**全部**子源（后台要按它回显成一行一行）；
 * `disabledPluginIds` = 其中被单独取消勾选的。
 * 发请求前要把后者剔掉，否则后台那个子源复选框就只是摆设 ——
 * 用户关掉一个源，节点请求却照样把它带上去，等于没关。
 */
export function effectivePluginIds(plugin: PluginConfig): string[] {
  const all = (plugin.pluginIds || []).filter(Boolean);
  if (all.length === 0) return [];
  const off = new Set((plugin.disabledPluginIds || []).filter(Boolean));
  return all.filter(id => !off.has(id));
}

/** 插件搜索入口：按插件类型分发执行 */
export async function executePluginSearch(
  plugin: PluginConfig,
  keyword: string,
  budgetMs: number = 15000
): Promise<SearchResultItem[]> {
  if (!plugin || !plugin.enabled) return [];

  // 原生源：直接在 Worker 内抓取，不经过任何第三方节点
  if (plugin.type === 'native') {
    return runNativeSource(plugin.id, keyword, budgetMs);
  }

  if (plugin.type === 'custom') {
    return executeCustomApiPlugin(plugin, keyword, budgetMs);
  }

  // 第三方节点：子源被一个个关光后就没有请求的必要了（省一次 HTTP 与超时等待）
  if ((plugin.pluginIds || []).length > 0 && effectivePluginIds(plugin).length === 0) {
    return [];
  }
  return executePansouPlugin(plugin, keyword, budgetMs);
}

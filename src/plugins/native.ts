/**
 * 原生插件源引擎
 * ============================================================
 * 目标：不再依赖任何第三方聚合节点（如 so.252035.xyz），把资源站抓取原生跑在 Worker 里。
 *
 * 为什么需要「适配器」而不是每个源写一遍：
 *   上游 pansou 生态里的源虽然多，但协议高度收敛成几类——
 *   苹果CMS 的 `api.php/provide/vod`、Flarum 的 `/api/discussions`、
 *   以及各家自研的 JSON 搜索接口。把「请求怎么发」和「结果怎么解析」抽成适配器后，
 *   新增一个源通常只要写 5~10 行配置。
 *
 * ⚠️ 落地一条源前必须先验证「Worker 出口能否访问」：
 *   国内不少资源站把 Cloudflare 的 IP 段拉黑了（实测 hunhepan 直接回
 *   `403 Request blocked by WAF. Reason: ip_blacklist`），或源站本身已挂
 *   （jikepan 回 530 error 1016、hdmoli 同）。这类源无论代码写得多对都拿不到数据，
 *   别浪费时间。验证方式：`GET /api/debug/fetch?url=<接口>&full=1`。
 */

import { SearchResultItem, ExtractedLink, CloudType } from '../types';
import { identifyCloudType } from '../parser';

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

/** 单个原生源的实现契约 */
export interface NativeSourceDef {
  id: string;
  name: string;
  desc: string;
  /** 最多抓几页（1 = 只抓首页）。页数越多越慢，按源的产出规模定。 */
  maxPages: number;
  /** 抓取并解析一页 */
  search(keyword: string, page: number, timeoutMs: number): Promise<SearchResultItem[]>;
}

/* ------------------------------------------------------------------ */
/* 通用工具                                                            */
/* ------------------------------------------------------------------ */

/** 带超时的 fetch；失败返回 null（不抛异常，避免一个源拖垮整次搜索） */
async function request(url: string, init: RequestInit, timeoutMs: number): Promise<Response | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(1500, timeoutMs));
  try {
    const res = await fetch(url, { ...init, signal: controller.signal, redirect: 'follow' });
    return res.ok ? res : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function requestJson(url: string, init: RequestInit, timeoutMs: number): Promise<any | null> {
  const res = await request(url, init, timeoutMs);
  if (!res) return null;
  try {
    return await res.json();
  } catch {
    return null;
  }
}

/** 去掉 HTML 标签与 <em> 高亮标记，并还原实体 */
function stripTags(input: string): string {
  return String(input || '')
    .replace(/<\/?em>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

/** Flarum 返回的 contentHtml 是转义过的（\u003C 等），先还原再解析 */
function unescapeDeep(s: string): string {
  return String(s || '')
    .replace(/\\u003c/gi, '<')
    .replace(/\\u003e/gi, '>')
    .replace(/\\u0026/gi, '&')
    .replace(/\\n/g, '\n')
    .replace(/\\"/g, '"');
}

/** 把各种时间写法归一成 ISO；识别不了就原样返回，交给前端兜底 */
function normalizeTime(raw: string): string {
  const s = String(raw || '').trim();
  if (!s) return new Date().toISOString();
  // 2026-09-11 03:45:49（按北京时间理解）
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}+08:00`;
  // 10 位秒级时间戳
  if (/^\d{10}$/.test(s)) return new Date(parseInt(s, 10) * 1000).toISOString();
  if (/^\d{13}$/.test(s)) return new Date(parseInt(s, 10)).toISOString();
  return s;
}

const NETDISK_HINT =
  /pan\.quark\.cn|pan\.baidu\.com|alipan\.com|aliyundrive\.com|cloud\.189\.cn|pan\.xunlei\.com|115\.com|115cdn\.com|123pan\.com|123684\.com|123865\.com|uc\.cn|drive\.uc\.cn|caiyun\.139\.com|mypikpak\.com|guangyapan|magnet:|ed2k:\/\//i;

/** 从一段文本里抽出所有网盘直链（带 ?pwd= 的提取码） */
function extractDiskLinks(text: string): ExtractedLink[] {
  const found: ExtractedLink[] = [];
  const seen = new Set<string>();
  const re = /https?:\/\/[^\s"'<>)（），,、]+/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    let raw = m[0].replace(/[.,;:]+$/, '');
    if (!NETDISK_HINT.test(raw)) continue;
    let password = '';
    const pwd = raw.match(/[?&](?:pwd|password|code)=([A-Za-z0-9]{1,8})/i);
    if (pwd) {
      password = pwd[1];
      // 提取码不留在 URL 里，避免前端拼出重复参数
      raw = raw.replace(/[?&](?:pwd|password|code)=[A-Za-z0-9]{1,8}/i, '');
    }
    if (seen.has(raw)) continue;
    seen.add(raw);
    found.push({ type: identifyCloudType(raw) as CloudType, url: raw, password: password || undefined });
  }
  return found;
}

/** 组装一条标准结果（所有适配器共用） */
function buildItem(
  sourceId: string,
  title: string,
  links: ExtractedLink[],
  datetime: string,
  content: string,
  tags: string[] = []
): SearchResultItem | null {
  const clean = stripTags(title);
  if (!clean || links.length === 0) return null;
  return {
    message_id: `${sourceId}_${Math.abs(hash(clean + links[0].url))}`,
    unique_id: `${sourceId}_${links[0].url}`,
    channel: `native:${sourceId}`,
    datetime: normalizeTime(datetime),
    title: clean,
    content: content.slice(0, 4000),
    links,
    tags
  };
}

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return h;
}

/* ------------------------------------------------------------------ */
/* 适配器 1：JSON POST 自研接口（melost 型）                            */
/* ------------------------------------------------------------------ */

const MELOST_URL = 'https://www.melost.cn/v1/search/disk';

/**
 * melost（影盘社）——目前产出最高的源，关键词命中量可达数千条。
 *
 * 接口特点：请求体字段很多且不能省（少字段时服务端返回 `list: null`），
 * `adv_params.automated` 固定 `"0"`，`platform` 固定 `"pc"`。
 */
function melostBody(keyword: string, page: number, size: number) {
  return {
    page,
    q: keyword,
    user: '',
    exact: false,
    user_distinct: false,
    format: [] as string[],
    share_time: '',
    share_year: '',
    size,
    order: '',
    type: '',
    search_ticket: '',
    exclude_user: [] as string[],
    adv_params: { wechat_pwd: '', search_code: '', platform: 'pc', fp_data: '', automated: '0' }
  };
}

const MELOST_PAGE_SIZE = 50;

const melost: NativeSourceDef = {
  id: 'melost',
  name: '影盘社',
  desc: '综合网盘聚合（夸克/百度/阿里/迅雷/天翼等），单关键词可达数千条',
  /**
   * 实测（Worker 出口）：单页固定 50 条、`size` 传大于 50 会被服务端压回 10 条，
   * 所以「加深」只能靠翻页。每页约 0.7~0.9s，8 页 ≈ 400 条 / 6~8s，留足 18s 预算。
   * 深翻页的相关性衰减很慢（第 12 页仍有 30/50 命中），所以多翻几页是划算的。
   */
  maxPages: 8,
  async search(keyword, page, timeoutMs) {
    const json = await requestJson(
      MELOST_URL,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json, text/plain, */*',
          'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
          Origin: 'https://www.melost.cn',
          Referer: 'https://www.melost.cn/search',
          'User-Agent': UA
        },
        body: JSON.stringify(melostBody(keyword, page, MELOST_PAGE_SIZE))
      },
      timeoutMs
    );

    const list = json?.data?.list;
    if (!Array.isArray(list)) return [];

    const out: SearchResultItem[] = [];
    for (const it of list) {
      const link = String(it?.link || '');
      if (!link) continue;
      const links: ExtractedLink[] = [
        { type: identifyCloudType(link) as CloudType, url: link, password: String(it?.disk_pass || '') || undefined }
      ];
      const item = buildItem(
        'melost',
        it?.disk_name || it?.files || '',
        links,
        it?.shared_time || '',
        `${it?.files || ''}\n${it?.disk_name || ''}`,
        it?.tags && Array.isArray(it.tags) ? it.tags.map((t: any) => String(t)) : []
      );
      if (item) out.push(item);
    }
    return out;
  }
};

/* ------------------------------------------------------------------ */
/* 适配器 2：苹果CMS（maccms）JSON —— 链接在 vod_down_url，用 $$$ 分隔   */
/* ------------------------------------------------------------------ */

function maccmsSource(id: string, name: string, desc: string, endpoint: string, referer: string, maxPages = 2): NativeSourceDef {
  return {
    id,
    name,
    desc,
    maxPages,
    async search(keyword, page, timeoutMs) {
      const url = `${endpoint}?ac=detail&wd=${encodeURIComponent(keyword)}&pg=${page}`;
      const json = await requestJson(url, { headers: { Accept: 'application/json, */*', Referer: referer, 'User-Agent': UA } }, timeoutMs);
      const list = json?.list;
      if (!Array.isArray(list)) return [];

      const out: SearchResultItem[] = [];
      for (const it of list) {
        // 苹果CMS 把多个网盘链接塞在同一个字段里，用 $$$ 分隔
        const raw = [it?.vod_down_url, it?.vod_play_url, it?.vod_content].filter(Boolean).map(String).join('$$$');
        const links = extractDiskLinks(unescapeDeep(raw).replace(/\$\$\$/g, '\n'));
        const pwdFallback = String(it?.vod_pwd_down || it?.vod_pwd || '').trim();
        if (pwdFallback) for (const l of links) if (!l.password) l.password = pwdFallback;

        const item = buildItem(
          id,
          it?.vod_name || '',
          links,
          it?.vod_time || '',
          `${it?.vod_blurb || ''}\n${it?.vod_class || ''}\n${it?.vod_content || ''}`,
          String(it?.vod_class || '').split(',').filter(Boolean)
        );
        if (item) out.push(item);
      }
      return out;
    }
  };
}

/* ------------------------------------------------------------------ */
/* 适配器 3：Flarum 论坛 JSON:API —— 链接在 included 的 contentHtml 里   */
/* ------------------------------------------------------------------ */

function flarumSource(id: string, name: string, desc: string, host: string, maxPages = 1): NativeSourceDef {
  return {
    id,
    name,
    desc,
    maxPages,
    async search(keyword, page, timeoutMs) {
      const url = `${host}/api/discussions?filter%5Bq%5D=${encodeURIComponent(keyword)}&page%5Boffset%5D=${(page - 1) * 20}`;
      const json = await requestJson(
        url,
        { headers: { Accept: 'application/vnd.api+json, application/json', Referer: `${host}/`, 'User-Agent': UA } },
        timeoutMs
      );
      if (!json || !Array.isArray(json.data)) return [];

      // 帖子正文在 included 里，先按 id 建索引
      const posts = new Map<string, string>();
      for (const inc of json.included || []) {
        if (inc?.type === 'posts' && inc?.id) {
          posts.set(String(inc.id), unescapeDeep(inc?.attributes?.contentHtml || ''));
        }
      }

      const out: SearchResultItem[] = [];
      for (const d of json.data) {
        const attr = d?.attributes || {};
        const postId = d?.relationships?.firstPost?.data?.id ?? d?.relationships?.mostRelevantPost?.data?.id;
        const html = postId ? posts.get(String(postId)) || '' : '';
        const links = extractDiskLinks(stripTags(html).replace(/\s(?=https?:\/\/)/g, '\n'));
        if (links.length === 0) continue;
        const item = buildItem(id, attr.title || '', links, attr.createdAt || '', stripTags(html));
        if (item) out.push(item);
      }
      return out;
    }
  };
}

/* ------------------------------------------------------------------ */
/* 源注册表                                                            */
/* ------------------------------------------------------------------ */

export const NATIVE_SOURCES: NativeSourceDef[] = [
  melost,
  maccmsSource('ouge', '欧格资源', '苹果CMS 片库，网盘直链', 'https://woog.nxog.eu.org/api.php/provide/vod', 'https://woog.nxog.eu.org/'),
  flarumSource('quark4k', '夸克4K', 'Flarum 论坛，夸克网盘影视资源', 'https://quark4k.com')
];

const SOURCE_MAP = new Map(NATIVE_SOURCES.map((s) => [s.id, s]));

export function getNativeSource(id: string): NativeSourceDef | undefined {
  return SOURCE_MAP.get(id);
}

export function isNativeSource(id: string): boolean {
  return SOURCE_MAP.has(id);
}

/**
 * 跑一个原生源：按 maxPages 顺序翻页，并在总预算内提前收手。
 * 页与页之间串行——并行翻页容易触发站点限流，且 Workers 并发连接数有限。
 */
export async function runNativeSource(id: string, keyword: string, budgetMs: number): Promise<SearchResultItem[]> {
  const src = SOURCE_MAP.get(id);
  if (!src) return [];

  const start = Date.now();
  const perPageBudget = Math.max(2000, Math.floor(budgetMs / src.maxPages));
  const all: SearchResultItem[] = [];
  const seenUrl = new Set<string>();

  for (let page = 1; page <= src.maxPages; page++) {
    const remaining = budgetMs - (Date.now() - start);
    if (remaining < 1200) break;

    let items: SearchResultItem[] = [];
    try {
      items = await src.search(keyword, page, Math.min(perPageBudget, remaining));
    } catch {
      items = [];
    }
    if (items.length === 0) break;

    for (const it of items) {
      if (seenUrl.has(it.unique_id)) continue;
      seenUrl.add(it.unique_id);
      all.push(it);
    }

    // 没抓满一页说明已经到底了
    if (items.length < 5) break;
  }

  return all;
}

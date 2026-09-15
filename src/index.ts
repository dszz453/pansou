import {
  Env,
  SearchResultItem,
  MergedByType,
  MergedLinkItem,
  PanSouSearchResponse,
  CloudType
} from './types';
import { getSystemSettings, saveSystemSettings, verifyAdminAuth, buildDefaultSettings } from './admin';
import { DEFAULT_MAX_CHANNELS } from './defaults';
import { searchTgChannel, fetchTgChannelFeed, filterItemsByKeyword } from './tg';
import { scoreResultRelevance, isTitleRelevant, isUnreliableTitle } from './parser';
import { HTML_TEMPLATE } from './ui.html';
import { VUE_JS, TAILWIND_CSS } from './vendor.generated';

/**
 * 单次调用最多处理的频道数。
 * Cloudflare Workers 单次请求最多 50 个子请求、最多 6 个并发连接，
 * 因此把「全部频道」交给前端拆片后并发调度，每次调用只负责一个小分片。
 */
const MAX_CHANNELS_PER_CALL = 10;

/** 单个频道抓取超时（t.me 偶发慢响应，超时即视为该频道无结果） */
const PER_CHANNEL_TIMEOUT_MS = 9000;

/** 空结果的缓存时长（秒）：既避免把临时故障长期缓存，又能防止重复打爆上游 */
const EMPTY_CACHE_TTL = 60;

/** KV 中缓存「单频道 × 单关键词」结果的键前缀 */
const CHANNEL_CACHE_PREFIX = 'tgc';

/** KV 中缓存「频道最近消息流」的键前缀（与关键词无关，多个关键词共用） */
const FEED_CACHE_PREFIX = 'tgf';

/** 频道消息流缓存时长（秒）：6 小时，兼顾新鲜度与抓取压力 */
const FEED_CACHE_TTL = 6 * 3600;

/** 合法 TG 频道名（防 SSRF：只允许字母数字下划线） */
const CHANNEL_NAME_REGEX = /^[A-Za-z0-9_]{4,64}$/;

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    // CORS 跨域处理
    if (request.method === 'OPTIONS') {
      return handleCors();
    }

    // 0. 同源自托管静态资源（Vue 运行时 + 预编译 Tailwind CSS）
    //    —— 彻底摆脱 unpkg / cdnjs / cdn.tailwindcss.com 等海外 CDN，国内可稳定加载
    if (path === '/assets/vue.js') {
      return new Response(VUE_JS, {
        headers: {
          'Content-Type': 'application/javascript; charset=utf-8',
          'Cache-Control': 'public, max-age=31536000, immutable'
        }
      });
    }

    if (path === '/assets/app.css') {
      return new Response(TAILWIND_CSS, {
        headers: {
          'Content-Type': 'text/css; charset=utf-8',
          'Cache-Control': 'public, max-age=31536000, immutable'
        }
      });
    }

    // 1. 前端 UI 界面（支持根路径 / 以及 /admin 后台直达路径）
    if (path === '/' || path === '/index.html' || path === '/admin') {
      return new Response(HTML_TEMPLATE, {
        headers: {
          'Content-Type': 'text/html; charset=utf-8',
          'Cache-Control': 'no-cache, no-store, must-revalidate'
        }
      });
    }

    // 2. 热门搜索词 /api/hot
    if (path === '/api/hot') {
      const settings = await getSystemSettings(env);
      return jsonResponse({ hot_searches: settings.hotSearches }, 200, {
        'Cache-Control': 'public, max-age=300, stale-while-revalidate=3600'
      });
    }

    // 3. 频道清单 /api/channels —— 前端据此把全部频道拆成多个分片并发调度
    if (path === '/api/channels') {
      const settings = await getSystemSettings(env);
      const enabled = settings.channels
        .filter(c => c.enabled)
        .sort((a, b) => (a.priority || 2) - (b.priority || 2))
        .map(c => c.name);
      return jsonResponse({
        code: 0,
        total: settings.channels.length,
        enabled: enabled.length,
        shard_size: Math.min(8, settings.maxChannelsPerSearch || DEFAULT_MAX_CHANNELS),
        channels: enabled
      }, 200, {
        'Cache-Control': 'public, max-age=600, stale-while-revalidate=3600'
      });
    }

    // 4. 健康检查 /api/health
    if (path === '/api/health') {
      const settings = await getSystemSettings(env);
      const enabled = settings.channels.filter(c => c.enabled);
      return jsonResponse({
        status: 'ok',
        engine: 'native-tg',
        upstream_node: null,
        kv_bound: !!env.PANSOU_KV,
        channels_total: settings.channels.length,
        channels_enabled: enabled.length,
        max_channels_per_call: MAX_CHANNELS_PER_CALL,
        cache_ttl: settings.cacheTtl
      });
    }

    // 4.5 诊断接口 /api/debug/tg —— 检查云端能否直连 t.me 并解析出消息块
    if (path === '/api/debug/tg') {
      const ch = url.searchParams.get('ch') || 'PanjClub';
      const kw = url.searchParams.get('kw') || '';
      const before = url.searchParams.get('before') || '';
      const qs = kw ? `?q=${encodeURIComponent(kw)}${before ? `&before=${before}` : ''}` : before ? `?before=${before}` : '';
      const target = `https://t.me/s/${ch}${qs}`;
      try {
        const r = await fetch(target, {
          headers: {
            'User-Agent':
              'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
          }
        });
        const html = await r.text();
        // full=1 时回传完整 HTML（仅用于本地解析调试）
        if (url.searchParams.get('full') === '1') {
          return new Response(html, {
            headers: { 'Content-Type': 'text/html; charset=utf-8' }
          });
        }
        const blocks = html.split(/<div class="[^"]*tgme_widget_message_wrap[^"]*"/g).length - 1;
        return jsonResponse({
          target,
          status: r.status,
          html_len: html.length,
          msg_blocks: blocks,
          links_found: (html.match(/https?:\/\/[^\s"'<>]*pan[^\s"'<>]*/gi) || []).length,
          head: html.slice(0, 200)
        });
      } catch (e: any) {
        return jsonResponse({ target, error: String((e && e.message) || e) });
      }
    }

    // 5. 后台配置读写 /api/admin/settings
    if (path === '/api/admin/settings') {
      const isAuthed = await verifyAdminAuth(request, env);
      if (!isAuthed) {
        return jsonResponse({ code: 401, message: '未授权或密码错误' }, 401);
      }

      if (request.method === 'GET') {
        const settings = await getSystemSettings(env);
        return jsonResponse({
          ...settings,
          kv_bound: !!env.PANSOU_KV,
          adminPassword: undefined
        });
      }

      if (request.method === 'POST') {
        try {
          const body: any = await request.json();
          const current = await getSystemSettings(env);

          const next = {
            ...current,
            channels: Array.isArray(body.channels) ? body.channels : current.channels,
            concurrency:
              typeof body.concurrency === 'number' && body.concurrency > 0
                ? body.concurrency
                : current.concurrency,
            cacheTtl:
              typeof body.cacheTtl === 'number' && body.cacheTtl >= 0
                ? body.cacheTtl
                : current.cacheTtl,
            maxChannelsPerSearch:
              typeof body.maxChannelsPerSearch === 'number' && body.maxChannelsPerSearch > 0
                ? body.maxChannelsPerSearch
                : current.maxChannelsPerSearch,
            tgProxyUrl: typeof body.tgProxyUrl === 'string' ? body.tgProxyUrl : current.tgProxyUrl,
            hotSearches: Array.isArray(body.hotSearches) ? body.hotSearches : current.hotSearches
          };

          if (typeof body.adminPassword === 'string' && body.adminPassword.trim()) {
            next.adminPassword = body.adminPassword.trim();
          }

          await saveSystemSettings(env, next);
          return jsonResponse({ code: 0, message: '保存成功' });
        } catch (e) {
          return jsonResponse({ code: 400, message: '参数错误' }, 400);
        }
      }
    }

    // 6. 恢复出厂配置 /api/admin/defaults
    if (path === '/api/admin/defaults') {
      const isAuthed = await verifyAdminAuth(request, env);
      if (!isAuthed) {
        return jsonResponse({ code: 401, message: '未授权或密码错误' }, 401);
      }
      const defaults = buildDefaultSettings(env);
      return jsonResponse({
        channels: defaults.channels,
        concurrency: defaults.concurrency,
        maxChannelsPerSearch: defaults.maxChannelsPerSearch,
        cacheTtl: defaults.cacheTtl,
        hotSearches: defaults.hotSearches
      });
    }

    // 7. 核心搜索接口 /api/search 或 /api/panso/search
    if (path === '/api/search' || path === '/api/panso/search') {
      return handleSearch(request, env, ctx);
    }

    return new Response('Not Found', { status: 404 });
  }
};

/**
 * 自建检索后端
 * ============
 * 直接抓取 Telegram 公开频道搜索页（https://t.me/s/<channel>?q=<keyword>）并解析，
 * **不依赖任何第三方聚合节点**。
 *
 * 由于 Cloudflare Workers 单请求限制（50 子请求 / 6 并发连接），
 * 一次调用只处理一个「频道分片」；全部频道的覆盖由前端拆片并发调度完成，
 * 每个「频道 × 关键词」的结果独立写入 KV 缓存，重复搜索秒级命中。
 */
async function handleSearch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const url = new URL(request.url);
  const settings = await getSystemSettings(env);

  let keyword = '';
  let customChannels: string[] = [];
  let resultType = 'merge';
  let forceRefresh = false;
  let filterCloudTypes: string[] = [];

  if (request.method === 'GET') {
    keyword = url.searchParams.get('kw') || url.searchParams.get('keyword') || '';
    resultType = url.searchParams.get('res') || url.searchParams.get('result_type') || 'merge';
    forceRefresh =
      url.searchParams.get('refresh') === 'true' || url.searchParams.get('force_refresh') === 'true';

    const chParam = url.searchParams.get('channels');
    if (chParam) customChannels = chParam.split(',').map(s => s.trim()).filter(Boolean);

    const typeParam = url.searchParams.get('cloud_types');
    if (typeParam)
      filterCloudTypes = typeParam.split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
  } else if (request.method === 'POST') {
    try {
      const body: any = await request.json();
      keyword = body.kw || body.keyword || '';
      resultType = body.res || body.result_type || 'merge';
      forceRefresh = body.refresh === true || body.force_refresh === true;

      if (Array.isArray(body.channels)) {
        customChannels = body.channels.map((s: any) => String(s).trim()).filter(Boolean);
      } else if (typeof body.channels === 'string') {
        customChannels = body.channels.split(',').map((s: string) => s.trim()).filter(Boolean);
      }

      if (Array.isArray(body.cloud_types)) {
        filterCloudTypes = body.cloud_types.map((s: string) => s.trim().toLowerCase());
      }
    } catch (e) {
      return jsonResponse({ code: 400, message: 'Invalid JSON body' }, 400);
    }
  } else {
    return jsonResponse({ code: 405, message: 'Method Not Allowed' }, 405);
  }

  keyword = keyword.trim();
  if (!keyword) {
    return jsonResponse({ code: 400, message: '关键词不能为空' }, 400);
  }

  // ---------- 解析本次调用要处理的频道分片 ----------
  const knownChannels = new Map(settings.channels.map(c => [c.name.toLowerCase(), c]));

  let targetChannels: string[];
  if (customChannels.length > 0) {
    // 显式指定：只接受系统内已知且名称合法的频道（防 SSRF）
    targetChannels = [];
    for (const raw of customChannels) {
      const name = raw.replace(/^@/, '').trim();
      if (!CHANNEL_NAME_REGEX.test(name)) continue;
      if (!knownChannels.has(name.toLowerCase())) continue;
      targetChannels.push(name);
    }
    targetChannels = targetChannels.slice(0, MAX_CHANNELS_PER_CALL);
  } else {
    // 未指定：按优先级取前 N 个（默认上限来自设置，且不超过单次调用预算）
    const cap = Math.max(
      1,
      Math.min(settings.maxChannelsPerSearch || MAX_CHANNELS_PER_CALL, MAX_CHANNELS_PER_CALL)
    );
    targetChannels = settings.channels
      .filter(c => c.enabled)
      .sort((a, b) => (a.priority || 2) - (b.priority || 2))
      .slice(0, cap)
      .map(c => c.name);
  }

  if (targetChannels.length === 0) {
    return formatSearchResponse(
      { total: 0, results: [], merged_by_type: {} },
      resultType,
      filterCloudTypes,
      { channels_queried: 0, channels_ok: 0, from_cache: 0 }
    );
  }

  // ---------- 逐频道取数（KV 缓存优先） ----------
  const cacheTtl = Math.max(60, settings.cacheTtl || 300);
  const kwKey = keyword.toLowerCase();
  const perChannelLimit = Math.max(3, Math.min(settings.concurrency || 6, 10));

  const stats = { fromCache: 0, ok: 0 };
  const startedAt = Date.now();

  const loadChannel = async (channel: string): Promise<SearchResultItem[]> => {
    const cacheKey = `${CHANNEL_CACHE_PREFIX}:${kwKey}:${channel.toLowerCase()}`;

    if (!forceRefresh && env.PANSOU_KV) {
      try {
        const raw = await env.PANSOU_KV.get(cacheKey);
        if (raw) {
          stats.fromCache++;
          return JSON.parse(raw) as SearchResultItem[];
        }
      } catch (e) {}
    }

    let items: SearchResultItem[] = [];
    try {
      items = await searchTgChannel(channel, keyword, settings.tgProxyUrl, PER_CHANNEL_TIMEOUT_MS);
    } catch (e) {
      items = [];
    }

    // 兜底：Telegram 网页版搜索对短词是**逐字符松散匹配**（搜「三体」会返回一堆含「三」或「体」
    // 的无关帖子），精确校验后可能为空。此时改为抓取该频道最近消息流，做本地精确匹配。
    if (items.length === 0) {
      const feedKey = `${FEED_CACHE_PREFIX}:${channel.toLowerCase()}`;
      let feedItems: SearchResultItem[] | null = null;

      if (!forceRefresh && env.PANSOU_KV) {
        try {
          const raw = await env.PANSOU_KV.get(feedKey);
          if (raw) feedItems = JSON.parse(raw) as SearchResultItem[];
        } catch (e) {}
      }

      if (!feedItems) {
        try {
          feedItems = await fetchTgChannelFeed(channel, settings.tgProxyUrl, PER_CHANNEL_TIMEOUT_MS);
        } catch (e) {
          feedItems = [];
        }
        if (env.PANSOU_KV && feedItems && feedItems.length > 0) {
          ctx.waitUntil(
            env.PANSOU_KV.put(feedKey, JSON.stringify(feedItems), {
              expirationTtl: FEED_CACHE_TTL
            }).catch(() => {})
          );
        }
      }

      items = filterItemsByKeyword(feedItems || [], keyword);
    }

    if (items.length > 0) stats.ok++;

    if (env.PANSOU_KV) {
      // 命中结果按配置 TTL 缓存；空结果只做短缓存，避免把临时故障长期固化
      const ttl = items.length > 0 ? cacheTtl : EMPTY_CACHE_TTL;
      ctx.waitUntil(
        env.PANSOU_KV.put(cacheKey, JSON.stringify(items), { expirationTtl: ttl }).catch(() => {})
      );
    }

    return items;
  };

  const settled = await runWithConcurrency(
    targetChannels.map(ch => () => loadChannel(ch)),
    perChannelLimit
  );

  const rawResults: SearchResultItem[] = [];
  for (const res of settled) {
    if (res.status === 'fulfilled' && Array.isArray(res.value)) {
      rawResults.push(...res.value);
    }
  }

  // ---------- 聚合、去重、相关性闸门 ----------
  const mergedByType: MergedByType = {};
  const seenUrls = new Set<string>();

  for (const item of rawResults) {
    for (const link of item.links) {
      if (seenUrls.has(link.url)) continue;

      // 优先使用链接局部专属 contextTitle，其次为全局消息标题
      const noteTitle = (link as any).contextTitle || item.title || '网盘资源';

      // 相关性闸门：标题必须真正命中关键词，剔除「简介里提到该词」的无关资源
      if (!isTitleRelevant(noteTitle, keyword)) continue;
      // 可信度闸门：剧情文案、标签堆砌、元数据行不可作为资源名
      if (isUnreliableTitle(noteTitle)) continue;

      seenUrls.add(link.url);

      const cloudType: CloudType = link.type || 'others';
      if (!mergedByType[cloudType]) {
        mergedByType[cloudType] = [];
      }

      const mergedItem: MergedLinkItem = {
        url: link.url,
        password: link.password,
        note: noteTitle,
        datetime: item.datetime,
        source: item.channel,
        images: item.images
      };

      mergedByType[cloudType]!.push(mergedItem);
    }
  }

  // 每个网盘分类内按相关性打分降序
  for (const k in mergedByType) {
    const list = mergedByType[k as CloudType];
    if (list && list.length > 1) {
      list.sort(
        (a, b) =>
          scoreResultRelevance(b.note, b.note, keyword) -
          scoreResultRelevance(a.note, a.note, keyword)
      );
    }
  }

  const searchData: PanSouSearchResponse = {
    total: seenUrls.size,
    results: rawResults,
    merged_by_type: mergedByType
  };

  return formatSearchResponse(searchData, resultType, filterCloudTypes, {
    channels_queried: targetChannels.length,
    channels_ok: stats.ok,
    from_cache: stats.fromCache,
    elapsed_ms: Date.now() - startedAt
  });
}

/**
 * 受限并发执行任务池
 * 保证同一时刻最多 limit 个任务在跑，全部完成后统一返回结果（失败的任务返回 rejected）
 */
async function runWithConcurrency<T>(
  tasks: Array<() => Promise<T>>,
  limit: number
): Promise<PromiseSettledResult<T>[]> {
  const results: PromiseSettledResult<T>[] = new Array(tasks.length);
  let cursor = 0;

  const workers = new Array(Math.min(limit, tasks.length)).fill(0).map(async () => {
    while (true) {
      const index = cursor++;
      if (index >= tasks.length) return;
      try {
        // 惰性执行：轮到该任务时才发起请求，避免一次性创建全部 Promise 导致并发失控
        const value = await tasks[index]!();
        results[index] = { status: 'fulfilled', value };
      } catch (reason) {
        results[index] = { status: 'rejected', reason };
      }
    }
  });

  await Promise.all(workers);
  return results;
}

/**
 * 格式化输出满足不同 result_type 与 cloud_types 过滤需求
 */
function formatSearchResponse(
  data: PanSouSearchResponse,
  resultType: string,
  filterTypes: string[],
  meta: Record<string, any> = {}
): Response {
  let finalMerged: MergedByType = data.merged_by_type || {};

  // 按网盘类型筛选
  if (filterTypes.length > 0) {
    const filtered: MergedByType = {};
    for (const t of filterTypes) {
      if (finalMerged[t as CloudType]) {
        filtered[t as CloudType] = finalMerged[t as CloudType];
      }
    }
    finalMerged = filtered;
  }

  let count = 0;
  for (const k in finalMerged) {
    count += (finalMerged[k as CloudType] || []).length;
  }

  const responseObj: any = { code: 0, message: 'success', total: count, _meta: meta };

  if (resultType === 'merge' || resultType === 'merged_by_type') {
    responseObj.merged_by_type = finalMerged;
  } else if (resultType === 'results') {
    responseObj.results = data.results || [];
  } else {
    // 默认 'all' 返回两者
    responseObj.results = data.results || [];
    responseObj.merged_by_type = finalMerged;
  }

  return jsonResponse(responseObj);
}

function jsonResponse(data: any, status: number = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization'
    }
  });
}

function handleCors(): Response {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Max-Age': '86400'
    }
  });
}

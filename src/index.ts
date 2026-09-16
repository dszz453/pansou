import {
  Env,
  PluginConfig,
  SearchResultItem,
  MergedByType,
  MergedLinkItem,
  PanSouSearchResponse,
  CloudType
} from './types';
import { getSystemSettings, saveSystemSettings, verifyAdminAuth, buildDefaultSettings } from './admin';
import { DEFAULT_MAX_CHANNELS, DEFAULT_MAX_PLUGINS } from './defaults';
import { searchTgChannel, fetchTgChannelFeed, filterItemsByKeyword } from './tg';
import { scoreResultRelevance, isTitleRelevant, isUnreliableTitle, identifyCloudType } from './parser';
import { executePluginSearch } from './plugins';
import { checkLinkValidity } from './checker';
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

/**
 * 单个插件调用超时。
 * 插件背后是一个聚合节点（内部要跑几十个子插件），比单个 TG 频道慢得多。
 * 实测节点在 Worker 侧最慢一次耗时 13.3 秒才返回，因此给到 18 秒 ——
 * 插件的整体搜索由前端**单独发一个请求**，与频道分片并行、渐进式渲染，
 * 所以这里放宽超时不会阻塞频道结果的展示。
 */
const PER_PLUGIN_TIMEOUT_MS = 18000;

/** 插件结果「新鲜」时长（秒）：在这个窗口内直接命中缓存，不再打节点 */
const PLUGIN_CACHE_TTL = 1800;

/**
 * 插件结果「保鲜」时长（秒）——过期缓存兜底（stale-while-error）。
 *
 * 背景：聚合节点背后也是 Cloudflare，**从 Worker 出口发起**的请求会被其 WAF
 * 间歇性拦成 `HTTP 403 / error code: 1003`（本地直连则 4/4 全通，已实测不是请求头问题，
 * 而是 Worker 共享出口 IP 被节点侧限流）。重试能救回大部分，但无法保证 100%。
 *
 * 所以缓存值带上写入时间：超过「新鲜期」后**先尝试刷新，刷新失败则继续返回旧数据**。
 * 效果：某个关键词只要历史上成功抓到过一次，后续即便节点被拦也照常有结果。
 */
const PLUGIN_STALE_TTL = 21600;

/** KV 中缓存「单插件 × 单关键词」结果的键前缀 */
const PLUGIN_CACHE_PREFIX = 'plg';

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

    // 3.5 插件清单 /api/plugins —— 前端据此决定搜索时是否单独发一次插件请求
    if (path === '/api/plugins') {
      const settings = await getSystemSettings(env);
      const enabled = settings.plugins.filter(p => p.enabled && p.apiEndpoint);
      return jsonResponse(
        {
          code: 0,
          total: settings.plugins.length,
          enabled: enabled.length,
          plugins: enabled.map(p => ({
            id: p.id,
            name: p.name,
            type: p.type,
            apiEndpoint: p.apiEndpoint,
            pluginIds: p.pluginIds || []
          }))
        },
        200,
        { 'Cache-Control': 'public, max-age=300' }
      );
    }

    // 3.6 网盘链接失效检测 /api/check —— 前端「测活」按钮的后端
    if (path === '/api/check') {
      let targetUrl = url.searchParams.get('url') || '';
      let targetPwd = url.searchParams.get('pwd') || url.searchParams.get('password') || '';
      let targetType = url.searchParams.get('type') || '';

      if (request.method === 'POST') {
        try {
          const b: any = await request.json();
          if (b && typeof b.url === 'string') {
            targetUrl = b.url;
            targetPwd = b.password || b.pwd || targetPwd;
            targetType = b.type || targetType;
          }
        } catch (e) {}
      }

      if (!targetUrl) {
        return jsonResponse({ code: 400, message: '缺少 url 参数' }, 400);
      }

      const check = await checkLinkValidity(targetUrl, targetPwd, targetType);
      return jsonResponse({ code: 0, url: targetUrl, ...check });
    }

    // 4. 健康检查 /api/health
    if (path === '/api/health') {
      const settings = await getSystemSettings(env);
      const enabled = settings.channels.filter(c => c.enabled);
      const enabledPlugins = settings.plugins.filter(p => p.enabled && p.apiEndpoint);
      return jsonResponse({
        status: 'ok',
        engine: 'native-tg+pansou-plugins',
        upstream_node: enabledPlugins[0]?.apiEndpoint || null,
        kv_bound: !!env.PANSOU_KV,
        channels_total: settings.channels.length,
        channels_enabled: enabled.length,
        plugins_total: settings.plugins.length,
        plugins_enabled: enabledPlugins.length,
        max_channels_per_call: MAX_CHANNELS_PER_CALL,
        max_plugins_per_call: Math.max(1, settings.maxPluginsPerSearch || DEFAULT_MAX_PLUGINS),
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

    // 4.6 插件诊断 /api/debug/plugin —— 查看 Worker 侧调用插件节点时的真实状态码/耗时
    if (path === '/api/debug/plugin') {
      const settings = await getSystemSettings(env);
      const kw = url.searchParams.get('kw') || '流浪地球';
      const id = url.searchParams.get('id') || '';
      const rounds = Math.min(5, Math.max(1, parseInt(url.searchParams.get('rounds') || '3', 10) || 3));

      const targets = id
        ? settings.plugins.filter(p => p.id === id)
        : settings.plugins.filter(p => p.enabled && p.apiEndpoint);

      if (targets.length === 0) {
        return jsonResponse({ ok: false, message: '没有匹配的插件', plugins: settings.plugins.map(p => p.id) });
      }

      const plugin = targets[0]!;
      const base = (plugin.apiEndpoint || '').trim();
      const ids = (plugin.pluginIds || []).filter(Boolean);
      const sep = base.includes('?') ? '&' : '?';
      const target =
        plugin.type === 'pansou'
          ? `${base}${sep}kw=${encodeURIComponent(kw)}&res=merge${ids.length ? `&plugins=${encodeURIComponent(ids.join(','))}` : ''}`
          : base.replace(/\{keyword\}/g, encodeURIComponent(kw));

      const attempts: any[] = [];
      for (let i = 0; i < rounds; i++) {
        const t0 = Date.now();
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), PER_PLUGIN_TIMEOUT_MS);
        try {
          const r = await fetch(target, {
            headers: {
              'User-Agent':
                'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
              Accept: 'application/json, text/plain, */*'
            },
            signal: controller.signal
          });
          clearTimeout(timer);
          const text = await r.text();
          let total: any = null;
          try {
            const j = JSON.parse(text);
            const p = j.data && (j.data.merged_by_type || j.data.results) ? j.data : j;
            total = p.total != null ? p.total : Object.keys(p.merged_by_type || {}).length;
          } catch (e) {}
          attempts.push({
            try: i + 1,
            status: r.status,
            ok: r.ok,
            ms: Date.now() - t0,
            bytes: text.length,
            total,
            head: text.slice(0, 160)
          });
        } catch (e: any) {
          clearTimeout(timer);
          attempts.push({
            try: i + 1,
            error: String((e && e.name) || '') + ': ' + String((e && e.message) || e),
            ms: Date.now() - t0
          });
        }
        if (i < rounds - 1) await new Promise(res => setTimeout(res, 800));
      }

      return jsonResponse({
        plugin: { id: plugin.id, type: plugin.type, endpoint: base, pluginIds: ids.length },
        keyword: kw,
        target,
        attempts
      });
    }

    // 4.7 通用抓取诊断 /api/debug/fetch —— 观察 Worker 侧访问任意 URL 的真实响应
    //     用于排查网盘测活、反代等场景下「本地能通、边缘不通」的问题。
    //     ?url=目标地址 &method=GET|POST &body=原始请求体 &referer= &origin= &full=1
    if (path === '/api/debug/fetch') {
      const target = url.searchParams.get('url') || '';
      if (!/^https?:\/\//i.test(target)) {
        return jsonResponse({ ok: false, message: '需要合法的 http(s) url 参数' }, 400);
      }
      const method = (url.searchParams.get('method') || 'GET').toUpperCase();
      const rawBody = url.searchParams.get('body') || '';
      const referer = url.searchParams.get('referer') || '';
      const origin = url.searchParams.get('origin') || '';
      const t0 = Date.now();
      try {
        const r = await fetch(target, {
          method,
          headers: {
            'User-Agent':
              'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
            Accept: 'application/json, text/html;q=0.9, */*;q=0.8',
            'Accept-Language': 'zh-CN,zh;q=0.9',
            ...(rawBody ? { 'Content-Type': 'application/json' } : {}),
            ...(referer ? { Referer: referer } : {}),
            ...(origin ? { Origin: origin } : {})
          },
          ...(rawBody ? { body: rawBody } : {}),
          redirect: 'follow'
        });
        const text = await r.text();
        if (url.searchParams.get('full') === '1') {
          return new Response(text, {
            headers: { 'Content-Type': 'text/plain; charset=utf-8' }
          });
        }
        return jsonResponse({
          ok: true,
          target,
          method,
          status: r.status,
          content_type: r.headers.get('content-type') || '',
          bytes: text.length,
          ms: Date.now() - t0,
          head: text.slice(0, 600)
        });
      } catch (e: any) {
        return jsonResponse({
          ok: false,
          target,
          ms: Date.now() - t0,
          error: `${(e && e.name) || ''}: ${(e && e.message) || e}`
        });
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
            // 插件允许传空数组（= 主动关掉全部插件），因此只判断是否为数组
            plugins: Array.isArray(body.plugins) ? body.plugins : current.plugins,
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
            maxPluginsPerSearch:
              typeof body.maxPluginsPerSearch === 'number' && body.maxPluginsPerSearch > 0
                ? body.maxPluginsPerSearch
                : current.maxPluginsPerSearch,
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
        plugins: defaults.plugins,
        concurrency: defaults.concurrency,
        maxChannelsPerSearch: defaults.maxChannelsPerSearch,
        maxPluginsPerSearch: defaults.maxPluginsPerSearch,
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
  let customPlugins: string[] = [];
  let pluginsOnly = false;
  let noPlugins = false;
  let resultType = 'merge';
  let forceRefresh = false;
  let filterCloudTypes: string[] = [];

  if (request.method === 'GET') {
    keyword = url.searchParams.get('kw') || url.searchParams.get('keyword') || '';
    resultType = url.searchParams.get('res') || url.searchParams.get('result_type') || 'merge';
    forceRefresh =
      url.searchParams.get('refresh') === 'true' || url.searchParams.get('force_refresh') === 'true';
    pluginsOnly = url.searchParams.get('plugins_only') === 'true';
    noPlugins = url.searchParams.get('no_plugins') === 'true';

    const chParam = url.searchParams.get('channels');
    if (chParam) customChannels = chParam.split(',').map(s => s.trim()).filter(Boolean);

    const plParam = url.searchParams.get('plugins');
    if (plParam && plParam !== 'all') {
      customPlugins = plParam.split(',').map(s => s.trim()).filter(Boolean);
    }

    const typeParam = url.searchParams.get('cloud_types');
    if (typeParam)
      filterCloudTypes = typeParam.split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
  } else if (request.method === 'POST') {
    try {
      const body: any = await request.json();
      keyword = body.kw || body.keyword || '';
      resultType = body.res || body.result_type || 'merge';
      forceRefresh = body.refresh === true || body.force_refresh === true;
      pluginsOnly = body.plugins_only === true;
      noPlugins = body.no_plugins === true;

      if (Array.isArray(body.channels)) {
        customChannels = body.channels.map((s: any) => String(s).trim()).filter(Boolean);
      } else if (typeof body.channels === 'string') {
        customChannels = body.channels.split(',').map((s: string) => s.trim()).filter(Boolean);
      }

      if (Array.isArray(body.plugins)) {
        customPlugins = body.plugins.map((s: any) => String(s).trim()).filter(Boolean);
      } else if (typeof body.plugins === 'string' && body.plugins !== 'all') {
        customPlugins = body.plugins.split(',').map((s: string) => s.trim()).filter(Boolean);
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
  } else if (pluginsOnly) {
    targetChannels = [];
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

  // ---------- 解析本次调用要使用的插件 ----------
  // 关键约定：**只在「客户端显式指定了 channels」之外**才跑插件。
  // 前端分片调度时会为每个分片都显式带上 channels，如果每个分片都触发插件调用，
  // 一次搜索就会把插件打 18 遍；因此改成由前端单独发一次 plugins_only 请求。
  const allEnabledPlugins = settings.plugins.filter(p => p.enabled && p.apiEndpoint);

  let targetPlugins = allEnabledPlugins;
  if (noPlugins) {
    targetPlugins = [];
  } else if (customPlugins.length > 0) {
    const want = new Set(customPlugins.map(s => s.toLowerCase()));
    targetPlugins = allEnabledPlugins.filter(
      p => want.has(p.id.toLowerCase()) || want.has((p.name || '').toLowerCase())
    );
  } else if (customChannels.length > 0 && !pluginsOnly) {
    // 频道分片请求：不带插件
    targetPlugins = [];
  }

  const pluginCap = Math.max(1, settings.maxPluginsPerSearch || DEFAULT_MAX_PLUGINS);
  targetPlugins = targetPlugins.slice(0, pluginCap);

  if (targetChannels.length === 0 && targetPlugins.length === 0) {
    return formatSearchResponse(
      { total: 0, results: [], merged_by_type: {} },
      resultType,
      filterCloudTypes,
      { channels_queried: 0, channels_ok: 0, plugins_queried: 0, plugins_ok: 0, from_cache: 0 }
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

  // ---------- 插件取数（与频道抓取并行，KV 缓存优先） ----------
  // 插件背后是外部聚合节点，一次要跑 5~8 秒，所以：
  //   ① 缓存 TTL 给到 30 分钟（频道结果只有 5 分钟）；
  //   ② 并发上限压到 2，避免和频道抓取抢 Cloudflare 的 6 连接预算。
  const pluginStats = { ok: 0, fromCache: 0, stale: 0, failed: 0 };

  /**
   * 缓存值结构：{ at: 写入时间戳, items: 结果 }。
   * 兼容早期版本直接存数组的格式（视为「很旧的新鲜数据」）。
   */
  const readPluginCache = (raw: string): { at: number; items: SearchResultItem[] } | null => {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return { at: 0, items: parsed as SearchResultItem[] };
      if (parsed && Array.isArray(parsed.items)) {
        return { at: Number(parsed.at) || 0, items: parsed.items as SearchResultItem[] };
      }
      return null;
    } catch {
      return null;
    }
  };

  const loadPlugin = async (plugin: PluginConfig): Promise<SearchResultItem[]> => {
    const cacheKey = `${PLUGIN_CACHE_PREFIX}:${kwKey}:${plugin.id.toLowerCase()}`;

    // 先读缓存。即便强制刷新，也要把它留作「刷新失败时的兜底」。
    let cached: { at: number; items: SearchResultItem[] } | null = null;
    if (env.PANSOU_KV) {
      try {
        const raw = await env.PANSOU_KV.get(cacheKey);
        if (raw) cached = readPluginCache(raw);
      } catch (e) {}
    }

    if (cached && cached.items.length > 0 && !forceRefresh) {
      // 新鲜期内直接命中
      if (Date.now() - cached.at < PLUGIN_CACHE_TTL * 1000) {
        pluginStats.fromCache++;
        return cached.items;
      }
    }

    let items: SearchResultItem[] = [];
    try {
      items = await executePluginSearch(plugin, keyword, PER_PLUGIN_TIMEOUT_MS);
    } catch (e) {
      items = [];
    }

    if (items.length > 0) {
      pluginStats.ok++;
      if (env.PANSOU_KV) {
        const value = JSON.stringify({ at: Date.now(), items });
        ctx.waitUntil(
          env.PANSOU_KV.put(cacheKey, value, { expirationTtl: PLUGIN_STALE_TTL }).catch(() => {})
        );
      }
      return items;
    }

    // 本次没抓到 —— 优先返回过期缓存（stale-while-error），而不是给用户一个空结果
    if (cached && cached.items.length > 0) {
      pluginStats.stale++;
      return cached.items;
    }

    pluginStats.failed++;

    // 确实没数据（新关键词 + 节点被拦）：只做短缓存，尽快让后续请求再试
    if (env.PANSOU_KV) {
      ctx.waitUntil(
        env.PANSOU_KV.put(cacheKey, JSON.stringify({ at: 0, items: [] }), {
          expirationTtl: EMPTY_CACHE_TTL
        }).catch(() => {})
      );
    }

    return items;
  };

  const [settled, pluginSettled] = await Promise.all([
    runWithConcurrency(
      targetChannels.map(ch => () => loadChannel(ch)),
      perChannelLimit
    ),
    runWithConcurrency(
      targetPlugins.map(p => () => loadPlugin(p)),
      Math.min(DEFAULT_MAX_PLUGINS, Math.max(1, targetPlugins.length))
    )
  ]);

  const rawResults: SearchResultItem[] = [];
  for (const res of settled) {
    if (res.status === 'fulfilled' && Array.isArray(res.value)) {
      rawResults.push(...res.value);
    }
  }
  for (const res of pluginSettled) {
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

      // 网盘类型二次校正：
      // 上游 TG 频道 / 外部聚合节点常把阿里云盘、夸克、123 等误标成 others（或 other），
      // 这里回到链接本体重新识别一次，只有真正识别不出来的私有链接才留在「其他网盘」。
      let cloudType: CloudType = link.type || 'others';
      const reidentified = identifyCloudType(link.url);
      if (reidentified && reidentified !== 'others' && reidentified !== cloudType) {
        cloudType = reidentified;
      }

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
    plugins_queried: targetPlugins.length,
    plugins_ok: pluginStats.ok,
    plugins_from_cache: pluginStats.fromCache,
    /** 节点被 WAF 拦、但用过期缓存兜底成功的插件数 */
    plugins_stale: pluginStats.stale,
    /** 彻底没拿到数据的插件数（新关键词 + 节点被拦） */
    plugins_failed: pluginStats.failed,
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

  // fish2018/pansou 的标准响应是 { code, message, data: {...} }，
  // 真实数据（total / merged_by_type / results）必须放在 data 里。
  // 第三方客户端（影视 App 爬虫源、MoonTVPlus 等）会直接读 response.data，
  // 缺失该字段就会判定「数据格式不正确」并提取到 0 条链接。
  const dataObj: any = { total: count, _meta: meta };

  if (resultType === 'merge' || resultType === 'merged_by_type') {
    dataObj.merged_by_type = finalMerged;
  } else if (resultType === 'results') {
    dataObj.results = data.results || [];
  } else {
    // 默认 'all' 返回两者
    dataObj.results = data.results || [];
    dataObj.merged_by_type = finalMerged;
  }

  // ① 标准嵌套结构（第三方兼容的关键）
  const responseObj: any = { code: 0, message: 'success', data: dataObj };

  // ② 同时保留扁平字段，兼容按旧格式读取的调用方与内置前端
  responseObj.total = count;
  responseObj._meta = meta;
  if (dataObj.merged_by_type) responseObj.merged_by_type = dataObj.merged_by_type;
  if (dataObj.results) responseObj.results = dataObj.results;

  return jsonResponse(responseObj);
}

function jsonResponse(data: any, status: number = 200, extraHeaders: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      ...extraHeaders
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

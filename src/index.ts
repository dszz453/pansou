import {
  Env,
  SystemSettings,
  PluginConfig,
  SearchResultItem,
  MergedByType,
  MergedLinkItem,
  PanSouSearchResponse,
  CloudType
} from './types';
import {
  getSystemSettings,
  getSystemSettingsFresh,
  saveSystemSettings,
  verifyAdminAuth,
  buildDefaultSettings,
  verifyFrontendPassword,
  frontendAccessToken,
  isFrontendAuthEnabled,
  isUsingDefaultPassword,
  tokenMatches
} from './admin';
import { hashPassword, isPasswordHash } from './auth';
import { DEFAULT_MAX_CHANNELS, DEFAULT_MAX_PLUGINS } from './defaults';
import { searchTgChannel, fetchTgChannelFeed, filterItemsByKeyword } from './tg';
import {
  scoreResultRelevance,
  isTitleRelevant,
  isUnreliableTitle,
  identifyCloudType,
  isNonResourceLink
} from './parser';
import { executePluginSearch } from './plugins';
import { checkLinkValidity } from './checker';
import { HTML_TEMPLATE } from './ui.html';
import { ADMIN_TEMPLATE } from './admin.ui';
import { VUE_JS, TAILWIND_CSS, VENDOR_VERSION } from './vendor.generated';
import { APP_VERSION, APP_VERSION_LABEL, APP_NAME } from './version';
import { CLOUD_TYPES, DEFAULT_VISIBLE_CLOUDS, normalizeVisibleClouds } from './cloud';
import { buildManifest, buildServiceWorker, APP_ICON_SVG, APP_FAVICON_SVG } from './pwa';
import { channelCache, feedCache, pluginCache, cacheStats } from './cache';

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

/**
 * 前台访问控制（V1.3）
 * ------------------------------------------------------------
 * 后台开启「前台访问密码」后，所有**数据类**接口（搜索 / 测活 / 频道 / 插件 / 诊断）
 * 都要求携带 `X-Frontend-Token`；管理员用 Bearer 密码同样可以直连
 * （后台的「连通测试」按钮就走这条路径）。
 *
 * 注意：首页 HTML、`/api/ui-config`、`/api/hot`、`/api/health` 保持公开 ——
 * 否则访客连登录门都渲染不出来。
 */
async function requireFrontendAccess(
  request: Request,
  env: Env,
  settings: SystemSettings
): Promise<boolean> {
  if (!isFrontendAuthEnabled(settings)) return true;

  const token = (request.headers.get('X-Frontend-Token') || '').trim();
  if (token) {
    const expected = await frontendAccessToken(settings, env);
    if (expected && tokenMatches(token, expected)) return true;
  }

  return verifyAdminAuth(request, env);
}

function unauthorizedResponse(): Response {
  return jsonResponse({ code: 401, message: '需要访问密码' }, 401);
}

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

    // 0.6 PWA 资源：应用图标 / Manifest / Service Worker
    if (path === '/assets/icon.svg') {
      return new Response(APP_ICON_SVG, {
        headers: {
          'Content-Type': 'image/svg+xml; charset=utf-8',
          'Cache-Control': 'public, max-age=31536000, immutable'
        }
      });
    }

    if (path === '/assets/favicon.svg' || path === '/favicon.ico' || path === '/favicon.svg') {
      return new Response(APP_FAVICON_SVG, {
        headers: {
          'Content-Type': 'image/svg+xml; charset=utf-8',
          'Cache-Control': 'public, max-age=31536000, immutable'
        }
      });
    }

    if (path === '/manifest.webmanifest' || path === '/manifest.json') {
      return new Response(buildManifest(url.origin), {
        headers: {
          'Content-Type': 'application/manifest+json; charset=utf-8',
          'Cache-Control': 'public, max-age=3600'
        }
      });
    }

    // Service Worker 必须由根路径提供才能拿到整个站点的作用域。
    // 用 VENDOR_VERSION 做版本号：静态资源一更新，SW 缓存自动全量换代。
    if (path === '/sw.js') {
      return new Response(buildServiceWorker(APP_VERSION + '-' + VENDOR_VERSION), {
        headers: {
          'Content-Type': 'application/javascript; charset=utf-8',
          // 允许浏览器缓存，但改动后要能及时生效，所以给一个较短的 max-age
          'Cache-Control': 'public, max-age=600',
          'Service-Worker-Allowed': '/'
        }
      });
    }

    // 1. 后台管理页面（独立页面，不再挂在首页弹窗上）
    if (path === '/admin' || path === '/admin/' || path === '/admin.html') {
      return new Response(ADMIN_TEMPLATE, {
        headers: {
          'Content-Type': 'text/html; charset=utf-8',
          'Cache-Control': 'no-cache, no-store, must-revalidate',
          'X-Robots-Tag': 'noindex, nofollow'
        }
      });
    }

    // 1.1 前端首页
    if (path === '/' || path === '/index.html') {
      return new Response(HTML_TEMPLATE, {
        headers: {
          'Content-Type': 'text/html; charset=utf-8',
          'Cache-Control': 'no-cache, no-store, must-revalidate'
        }
      });
    }

    // 1.2 网页端 UI 配置：网盘可见列表 / 是否展示自动测活
    //     单独开一个轻量接口，前端首屏只拉这一小段 JSON
    if (path === '/api/ui-config') {
      // 强制直读 KV：这个接口决定「网页端展示哪些网盘」，
      // 后台一改就必须立刻可见。走 15 秒内存缓存时，写的是 A isolate、
      // 读的是 B isolate，就会出现「后台选了没用」的错觉。
      const settings = await getSystemSettingsFresh(env);
      const visible = Array.isArray(settings.visibleCloudTypes)
        ? settings.visibleCloudTypes
        : DEFAULT_VISIBLE_CLOUDS;
      return jsonResponse(
        {
          code: 0,
          version: APP_VERSION,
          version_label: APP_VERSION_LABEL,
          app_name: APP_NAME,
          visible_cloud_types: visible,
          // 顺带把中文名带下去，前端不必再维护一份映射表
          cloud_labels: CLOUD_TYPES.reduce((acc, c) => {
            acc[c.key] = c.label;
            return acc;
          }, {} as Record<string, string>),
          show_auto_check: settings.showAutoCheck !== false,
          /** V1.3：前台是否开启了访问密码（前端据此决定先弹登录门） */
          frontend_auth_enabled: isFrontendAuthEnabled(settings)
        },
        200,
        // 这份配置直接决定「网页端展示哪些网盘」，后台一改就必须立刻可见。
        // 之前给了 max-age=120 + stale-while-revalidate=600，一旦被中间层缓存，
        // 改动最长要 12 分钟才生效，表现就是「后台选了没用」。
        { 'Cache-Control': 'no-store' }
      );
    }

    // 1.3 前台访问密码 /api/frontend/auth
    //     开启前台密码后，访客先用密码换一个无状态访问令牌，
    //     之后所有数据接口都带 `X-Frontend-Token`。
    if (path === '/api/frontend/auth') {
      const settings = await getSystemSettings(env);

      if (!isFrontendAuthEnabled(settings)) {
        return jsonResponse({ code: 0, enabled: false, message: '前台未开启访问密码' });
      }

      if (request.method !== 'POST') {
        return jsonResponse({ code: 405, message: '请使用 POST 提交密码' }, 405);
      }

      let password = '';
      try {
        const body: any = await request.json();
        password = typeof body?.password === 'string' ? body.password : '';
      } catch (e) {
        password = '';
      }

      if (!password.trim()) {
        return jsonResponse({ code: 400, message: '请输入访问密码' }, 400);
      }

      const ok = await verifyFrontendPassword(password.trim(), settings, env);
      if (!ok) {
        return jsonResponse({ code: 401, message: '密码错误' }, 401);
      }

      return jsonResponse({
        code: 0,
        enabled: true,
        token: await frontendAccessToken(settings, env),
        expires_in: null // 无状态令牌，改密码即失效
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
      // 同 ui-config：频道启停是后台可改的配置，必须直读 KV 才谈得上「立刻生效」
      const settings = await getSystemSettingsFresh(env);
      if (!(await requireFrontendAccess(request, env, settings))) return unauthorizedResponse();
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
        // 同 ui-config：频道启停是后台可改的配置，不能让中间层缓存住
        'Cache-Control': 'no-store'
      });
    }

    // 3.5 插件清单 /api/plugins —— 前端据此决定搜索时是否单独发一次插件请求
    if (path === '/api/plugins') {
      // 插件源开关同样是后台配置，且这个接口会带出源备注名 —— 一并直读 KV
      const settings = await getSystemSettingsFresh(env);
      if (!(await requireFrontendAccess(request, env, settings))) return unauthorizedResponse();
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
            pluginIds: p.pluginIds || [],
            /** V1.3：已启用插件源的备注名（未填备注时前端自行回退成 id） */
            pluginLabels: settings.pluginSourceLabels || {}
          }))
        },
        200,
        // 插件源开关同样是后台配置，且这个接口会带出源备注名
        { 'Cache-Control': 'no-store' }
      );
    }

    // 3.6 网盘链接失效检测 /api/check —— 前端「测活」按钮的后端
    if (path === '/api/check') {
      if (!(await requireFrontendAccess(request, env, await getSystemSettings(env)))) {
        return unauthorizedResponse();
      }
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
        version: APP_VERSION,
        version_label: APP_VERSION_LABEL,
        engine: 'native-tg+pansou-plugins',
        upstream_node: enabledPlugins[0]?.apiEndpoint || null,
        kv_bound: !!env.PANSOU_KV,
        channels_total: settings.channels.length,
        channels_enabled: enabled.length,
        plugins_total: settings.plugins.length,
        plugins_enabled: enabledPlugins.length,
        max_channels_per_call: MAX_CHANNELS_PER_CALL,
        max_plugins_per_call: Math.max(1, settings.maxPluginsPerSearch || DEFAULT_MAX_PLUGINS),
        cache_ttl: settings.cacheTtl,
        /** V1.2：搜索结果缓存模式，memory 表示不消耗 KV 写配额 */
        result_cache_mode: settings.resultCacheMode || 'memory',
        /** V1.3：凭据是否已改为哈希存储（true 表示 KV 里不再有明文密码） */
        credentials_hashed: !!(settings.adminPasswordHash || isPasswordHash(env.ADMIN_PASSWORD || '')),
        /** V1.3：前台是否开启了访问密码 */
        frontend_auth_enabled: isFrontendAuthEnabled(settings),
        visible_cloud_types: settings.visibleCloudTypes || DEFAULT_VISIBLE_CLOUDS,
        /** 当前 isolate 内存缓存条目数，用于确认「没在用 KV 却依然有命中」 */
        memory_cache: cacheStats()
      });
    }

    // 4.1 缓存与配额诊断 /api/debug/cache
    if (path === '/api/debug/cache') {
      const settings = await getSystemSettings(env);
      return jsonResponse({
        version: APP_VERSION,
        result_cache_mode: settings.resultCacheMode || 'memory',
        kv_bound: !!env.PANSOU_KV,
        memory_cache: cacheStats(),
        note:
          settings.resultCacheMode === 'memory'
            ? '频道搜索结果仅缓存在 Worker isolate 内存中，不产生 KV 读写；唯一例外是插件结果缓存（每个关键词 1 个键、TTL 6 小时），用于在聚合节点被拦截时兜底。'
            : settings.resultCacheMode === 'kv'
              ? '搜索结果会写入 KV，注意免费版每日 1000 次写配额。'
              : '未开启结果缓存，每次搜索都实时抓取。'
      });
    }

    // 4.5 诊断接口 /api/debug/tg —— 检查云端能否直连 t.me 并解析出消息块
    if (path === '/api/debug/tg') {
      if (!(await requireFrontendAccess(request, env, await getSystemSettings(env)))) {
        return unauthorizedResponse();
      }
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
      if (!(await requireFrontendAccess(request, env, settings))) return unauthorizedResponse();
      const kw = url.searchParams.get('kw') || '流浪地球';
      const id = url.searchParams.get('id') || '';
      const idsParam = url.searchParams.get('ids') || '';
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
      if (!(await requireFrontendAccess(request, env, await getSystemSettings(env)))) {
        return unauthorizedResponse();
      }
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
        // 后台必须读**最新**配置：getSystemSettings 走 isolate 内存缓存（15 秒），
        // 而 Cloudflare 会同时跑多个 isolate —— 刚保存完就刷新后台时，
        // 请求可能落到一个还抱着旧配置的实例上，看到保存前的值，
        // 于是「改了不下十次都没反应」。这里强制跳过缓存直读 KV。
        const settings = await getSystemSettingsFresh(env);
        const { adminPasswordHash, adminPassword, frontendPasswordHash, ...rest } = settings;
        return jsonResponse({
          ...rest,
          kv_bound: !!env.PANSOU_KV,
          admin_password_is_default: await isUsingDefaultPassword(settings, env),
          // V1.3：任何哈希都不出服务器，只回传「是否已设置」这类布尔状态
          admin_password_set: !!(adminPasswordHash || adminPassword || env.ADMIN_PASSWORD),
          admin_password_hashed: isPasswordHash(adminPasswordHash || ''),
          admin_password_from_env: !adminPasswordHash && !adminPassword && !!env.ADMIN_PASSWORD,
          frontend_password_set: !!frontendPasswordHash
        });
      }

      if (request.method === 'POST') {
        try {
          const body: any = await request.json();
          const current = await getSystemSettings(env);

          const next: Partial<SystemSettings> = {
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
            hotSearches: Array.isArray(body.hotSearches) ? body.hotSearches : current.hotSearches,
            // V1.2 新增：结果缓存模式 / 网盘展示列表 / 自动测活开关
            resultCacheMode:
              body.resultCacheMode === 'memory' ||
              body.resultCacheMode === 'kv' ||
              body.resultCacheMode === 'off'
                ? body.resultCacheMode
                : current.resultCacheMode,
            visibleCloudTypes: Array.isArray(body.visibleCloudTypes)
              ? (normalizeVisibleClouds(body.visibleCloudTypes) ?? current.visibleCloudTypes)
              : current.visibleCloudTypes,
            showAutoCheck:
              typeof body.showAutoCheck === 'boolean' ? body.showAutoCheck : current.showAutoCheck,
            // V1.3：插件源备注 / 前台访问密码
            pluginSourceLabels:
              body.pluginSourceLabels && typeof body.pluginSourceLabels === 'object'
                ? body.pluginSourceLabels
                : current.pluginSourceLabels,
            frontendAuthEnabled:
              typeof body.frontendAuthEnabled === 'boolean'
                ? body.frontendAuthEnabled
                : current.frontendAuthEnabled,
            frontendPasswordMode:
              body.frontendPasswordMode === 'custom' || body.frontendPasswordMode === 'reuse'
                ? body.frontendPasswordMode
                : current.frontendPasswordMode
          };

          // 后台密码：立刻哈希后再落盘，明文绝不进 KV
          if (typeof body.adminPassword === 'string' && body.adminPassword.trim()) {
            next.adminPasswordHash = await hashPassword(body.adminPassword.trim());
            next.adminPassword = ''; // 顺手清掉历史遗留的明文
          }

          // 前台独立密码：同样只存哈希
          if (typeof body.frontendPassword === 'string' && body.frontendPassword.trim()) {
            next.frontendPasswordHash = await hashPassword(body.frontendPassword.trim());
          } else if (body.clearFrontendPassword === true) {
            next.frontendPasswordHash = '';
          }

          await saveSystemSettings(env, next);
          // 配置变了，清掉搜索结果缓存，避免旧配置下的结果继续被命中
          channelCache.clear();
          pluginCache.clear();
          feedCache.clear();
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
        hotSearches: defaults.hotSearches,
        resultCacheMode: defaults.resultCacheMode,
        visibleCloudTypes: defaults.visibleCloudTypes,
        showAutoCheck: defaults.showAutoCheck
      });
    }

    // 7. 核心搜索接口 /api/search 或 /api/panso/search
    if (path === '/api/search' || path === '/api/panso/search') {
      if (!(await requireFrontendAccess(request, env, await getSystemSettings(env)))) {
        return unauthorizedResponse();
      }
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

  // ---------- 缓存策略（V1.2 核心优化） ----------
  //
  // 背景：Cloudflare 免费版 KV 每天只有 **1000 次写**。
  // 旧实现把每一次「频道 × 关键词」的搜索结果都写进 KV，一次完整搜索
  // （143 频道 / 18 个分片）就是 140+ 次写 —— 搜几轮就把当天写额度打满，
  // 之后所有缓存写入静默失败，表现为「缓存越用越不灵」。
  //
  // 现在的三档策略：
  //   memory（默认）→ 结果只进 isolate 内存，KV 零读写
  //   kv            → 恢复旧行为（跨节点共享缓存，但吃写配额）
  //   off           → 完全不缓存，每次实时抓取
  //
  // ⚠️ 唯一的例外是「插件结果缓存」：它明知 KV 存在也照样写。
  //    原因是量级差三个数量级 —— 频道结果是「频道 × 关键词」（一次搜索 140+ 写），
  //    插件结果是「插件 × 关键词」（一次搜索 1 个键，TTL 6 小时，一天几十次写）。
  //    而它承担着「聚合节点被 WAF 拦时用旧结果兜底」的职责，只放 isolate 内存会随
  //    实例回收丢失，导致插件源在最需要兜底时集体归零。详见 loadPlugin。
  const cacheMode = settings.resultCacheMode || 'memory';
  const useKv = cacheMode === 'kv' && !!env.PANSOU_KV;
  const useMemory = cacheMode === 'memory';
  const cacheDisabled = cacheMode === 'off';
  /** 内存缓存的 TTL：固定 5 分钟，不受后台 cacheTtl 影响，避免误配成 0 导致内存缓存失效 */
  const MEMORY_RESULT_TTL = 5 * 60_000;

  const cacheTtl = Math.max(60, settings.cacheTtl || 300);
  const kwKey = keyword.toLowerCase();
  const perChannelLimit = Math.max(3, Math.min(settings.concurrency || 6, 10));

  const stats = { fromCache: 0, ok: 0 };
  const startedAt = Date.now();

  /**
   * 读一档缓存：内存优先（零成本），KV 仅在其被显式启用时参与。
   * 返回 null 表示没命中。
   */
  const readCache = async (key: string): Promise<SearchResultItem[] | null> => {
    if (forceRefresh) return null;

    if (useMemory) {
      const hit = channelCache.get(key) as SearchResultItem[] | undefined;
      return hit || null;
    }

    if (useKv) {
      try {
        const raw = await env.PANSOU_KV!.get(key);
        if (raw) return JSON.parse(raw) as SearchResultItem[];
      } catch (e) {}
    }

    return null;
  };

  /** 写一档缓存。memory / off 模式下不会产生任何 KV 写。 */
  const writeCache = (key: string, items: SearchResultItem[]) => {
    if (useMemory) {
      channelCache.set(key, items, MEMORY_RESULT_TTL);
      return;
    }
    if (useKv) {
      // 命中结果按配置 TTL 缓存；空结果只做短缓存，避免把临时故障长期固化
      const ttl = items.length > 0 ? cacheTtl : EMPTY_CACHE_TTL;
      ctx.waitUntil(
        env.PANSOU_KV!.put(key, JSON.stringify(items), { expirationTtl: ttl }).catch(() => {})
      );
    }
  };

  const loadChannel = async (channel: string): Promise<SearchResultItem[]> => {
    const cacheKey = `${CHANNEL_CACHE_PREFIX}:${kwKey}:${channel.toLowerCase()}`;

    const cached = await readCache(cacheKey);
    if (cached) {
      stats.fromCache++;
      return cached;
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

      if (!forceRefresh) {
        if (useMemory) {
          feedItems = (feedCache.get(feedKey) as SearchResultItem[] | undefined) || null;
        } else if (useKv) {
          try {
            const raw = await env.PANSOU_KV!.get(feedKey);
            if (raw) feedItems = JSON.parse(raw) as SearchResultItem[];
          } catch (e) {}
        }
      }

      if (!feedItems) {
        try {
          feedItems = await fetchTgChannelFeed(channel, settings.tgProxyUrl, PER_CHANNEL_TIMEOUT_MS);
        } catch (e) {
          feedItems = [];
        }

        if (feedItems && feedItems.length > 0) {
          if (useMemory) {
            feedCache.set(feedKey, feedItems, FEED_CACHE_TTL * 1000);
          } else if (useKv) {
            ctx.waitUntil(
              env.PANSOU_KV!.put(feedKey, JSON.stringify(feedItems), {
                expirationTtl: FEED_CACHE_TTL
              }).catch(() => {})
            );
          }
        }
      }

      items = filterItemsByKeyword(feedItems || [], keyword);
    }

    if (items.length > 0) stats.ok++;

    writeCache(cacheKey, items);

    return items;
  };

  // ---------- 插件取数（与频道抓取并行，缓存优先） ----------
  // 插件背后是外部聚合节点，一次要跑 5~8 秒，所以：
  //   ① 缓存 TTL 给到 30 分钟（频道结果只有 5 分钟）；
  //   ② 并发上限压到 2，避免和频道抓取抢 Cloudflare 的 6 连接预算。
  const pluginStats = { ok: 0, fromCache: 0, stale: 0, failed: 0 };

  /**
   * 缓存值结构：{ at: 写入时间戳, items: 结果 }。
   * 兼容早期版本直接存数组的格式（视为「很旧的新鲜数据」）。
   */
  const parsePluginCache = (raw: string): { at: number; items: SearchResultItem[] } | null => {
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

    // —— 插件缓存不支持 resultCacheMode === 'off'，其余两种模式都写 KV ——
    // 参数面：一次搜索只产生 1 个插件缓存键（而不是 140 个），TTL 6 小时，
    // 因此即使「默认不落 KV」的内存模式，也保留这一条 —— 它是插件源唯一的兜底。
    const pluginCacheEnabled = !cacheDisabled;

    // 读：内存优先（零成本），未命中再读一次 KV
    let cached: { at: number; items: SearchResultItem[] } | null = null;
    if (pluginCacheEnabled) {
      cached = (pluginCache.get(cacheKey) as { at: number; items: SearchResultItem[] }) || null;
      if (!cached && env.PANSOU_KV) {
        try {
          const raw = await env.PANSOU_KV.get(cacheKey);
          if (raw) cached = parsePluginCache(raw);
        } catch (e) {}
      }
    }

    // 回填内存：KV 命中的结果也放进 isolate 缓存，后续同实例请求不再读 KV
    if (cached && cached.items.length > 0 && !forceRefresh) {
      pluginCache.set(cacheKey, cached, PLUGIN_STALE_TTL * 1000);
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

    /** 同时写 isolate 内存与 KV（KV 未绑定时自动退化为纯内存） */
    const persist = (value: { at: number; items: SearchResultItem[] }, ttl: number) => {
      if (!pluginCacheEnabled) return;
      pluginCache.set(cacheKey, value, ttl * 1000);
      if (env.PANSOU_KV) {
        ctx.waitUntil(
          env.PANSOU_KV.put(cacheKey, JSON.stringify(value), { expirationTtl: ttl }).catch(() => {})
        );
      }
    };

    if (items.length > 0) {
      pluginStats.ok++;
      persist({ at: Date.now(), items }, PLUGIN_STALE_TTL);
      return items;
    }

    // 本次没抓到 —— 优先返回过期缓存（stale-while-error），而不是给用户一个空结果。
    // 这一步靠 KV 才能跨实例生效：节点被 WAF 拦时，历史上成功抓到过的关键词依旧有结果。
    if (cached && cached.items.length > 0) {
      pluginStats.stale++;
      return cached.items;
    }

    pluginStats.failed++;

    // 确实没数据（新关键词 + 节点被拦）：只做短缓存，尽快让后续请求再试
    persist({ at: 0, items: [] }, EMPTY_CACHE_TTL);

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
      // 资源闸门：频道推广用的 t.me 邀请链接不是网盘资源，直接剔除
      if (isNonResourceLink(link.url)) continue;

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
    /** 本次使用的缓存通道：memory（不耗 KV）/ kv / off */
    cache_mode: cacheMode,
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

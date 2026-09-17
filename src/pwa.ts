/**
 * PWA 支撑：Web App Manifest / Service Worker / 应用图标
 * ------------------------------------------------------------
 * 全部由 Worker 同域直接输出，不依赖任何外部 CDN 或图床。
 * 图标用内联 SVG（矢量、体积极小），Chrome / Edge / Android 均可正常安装。
 */

import { APP_NAME, APP_TAGLINE, APP_VERSION } from './version';

/** 主题色：与首页顶栏主色一致 */
const THEME_COLOR = '#2563eb';

/**
 * 应用图标（SVG）。
 * 画的是「闪电 + 云」：闪电代表极速检索，云代表网盘。
 */
export const APP_ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#3b82f6"/>
      <stop offset="55%" stop-color="#4f46e5"/>
      <stop offset="100%" stop-color="#6366f1"/>
    </linearGradient>
  </defs>
  <rect width="512" height="512" rx="112" fill="url(#g)"/>
  <path fill="#ffffff" d="M262 68 132 288h92l-26 156 156-232h-96z" opacity="0.96"/>
  <path fill="#ffffff" fill-opacity="0.22" d="M96 384c-20 0-36-16-36-36s16-36 36-36h4a58 58 0 0 1 110-18 46 46 0 0 1 66 40 44 44 0 0 1-44 50z"/>
</svg>`;

/** favicon 用的紧凑版（无圆角背景，适配浏览器标签页） */
export const APP_FAVICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64">
  <rect width="64" height="64" rx="14" fill="#4f46e5"/>
  <path fill="#fff" d="M33 8 16 36h12l-4 20 20-30H32z"/>
</svg>`;

/** Web App Manifest */
export function buildManifest(origin: string): string {
  const base = origin.replace(/\/$/, '');
  return JSON.stringify(
    {
      id: `${base}/?source=pwa`,
      name: `${APP_NAME} · ${APP_TAGLINE}`,
      short_name: APP_NAME,
      description: '极速全网盘资源聚合搜索，支持阿里、夸克、百度、115、123、迅雷等 15+ 类网盘，内置链接失效检测。',
      start_url: `${base}/?source=pwa`,
      scope: `${base}/`,
      display: 'standalone',
      display_override: ['standalone', 'minimal-ui'],
      orientation: 'portrait-primary',
      background_color: '#f8fafc',
      theme_color: THEME_COLOR,
      lang: 'zh-CN',
      dir: 'ltr',
      categories: ['search', 'utilities', 'entertainment'],
      version: APP_VERSION,
      icons: [
        {
          src: `${base}/assets/icon.svg`,
          sizes: 'any',
          type: 'image/svg+xml',
          purpose: 'any'
        },
        {
          src: `${base}/assets/icon.svg`,
          sizes: 'any',
          type: 'image/svg+xml',
          purpose: 'maskable'
        }
      ],
      shortcuts: [
        {
          name: '搜索资源',
          short_name: '搜索',
          url: `${base}/?source=pwa&focus=search`,
          icons: [{ src: `${base}/assets/icon.svg`, sizes: 'any', type: 'image/svg+xml' }]
        }
      ]
    },
    null,
    2
  );
}

/**
 * Service Worker 源码。
 *
 * 缓存策略（刻意保守，绝不缓存 API 结果）：
 *   - 静态资源（/assets/*）      → cache-first，配版本号，更新即换 URL
 *   - 页面导航                   → network-first，断网时回退缓存首页
 *   - /api/*                     → 一律直连网络（搜索结果必须实时，且响应体积大）
 *   - /admin                    → 直连网络，避免把后台页面缓存下来
 */
export function buildServiceWorker(version: string): string {
  return `/* PanSou Edge Service Worker v${version} — 由 Worker 动态生成 */
const CACHE = 'pansou-static-v${version}';
const OFFLINE_FALLBACK = '/';

/* 安装：预缓存应用外壳，但即使失败也不能让 SW 装不上 */
self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      try {
        const cache = await caches.open(CACHE);
        await cache.addAll([OFFLINE_FALLBACK, '/assets/app.css', '/assets/vue.js', '/assets/icon.svg']);
      } catch (e) {
        /* 离线预缓存失败不影响安装 */
      }
      await self.skipWaiting();
    })()
  );
});

/* 激活：清掉旧版本缓存 */
self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
      if (self.registration.navigationPreload) {
        try { await self.registration.navigationPreload.disable(); } catch (e) {}
      }
      await self.clients.claim();
    })()
  );
});

function isStaticAsset(url) {
  return url.pathname.startsWith('/assets/');
}

function isBypass(url) {
  return (
    url.pathname.startsWith('/api/') ||
    url.pathname.startsWith('/admin') ||
    url.pathname === '/sw.js' ||
    url.pathname === '/manifest.webmanifest'
  );
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  let url;
  try { url = new URL(req.url); } catch (e) { return; }

  // 只接管同源请求；跨域（如网盘直链、图片）一律放行
  if (url.origin !== self.location.origin) return;
  if (isBypass(url)) return;

  // 静态资源：cache-first（URL 带 ?v= 版本号，内容变了 URL 也会变）
  if (isStaticAsset(url)) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(CACHE);
        const hit = await cache.match(req);
        if (hit) return hit;
        try {
          const res = await fetch(req);
          if (res && res.ok) cache.put(req, res.clone());
          return res;
        } catch (e) {
          return hit || Response.error();
        }
      })()
    );
    return;
  }

  // 页面导航：network-first，断网回退缓存
  if (req.mode === 'navigate') {
    event.respondWith(
      (async () => {
        try {
          const res = await fetch(req);
          if (res && res.ok) {
            const cache = await caches.open(CACHE);
            cache.put(OFFLINE_FALLBACK, res.clone());
          }
          return res;
        } catch (e) {
          const cache = await caches.open(CACHE);
          const cached = await cache.match(OFFLINE_FALLBACK);
          if (cached) return cached;
          return new Response(
            '<!doctype html><meta charset="utf-8"><title>离线</title><body style="font-family:system-ui;text-align:center;padding:60px;color:#475569"><h2>当前处于离线状态</h2><p>请检查网络后重试</p></body>',
            { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
          );
        }
      })()
    );
  }
});
`;
}

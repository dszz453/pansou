/**
 * 独立后台管理页面（/admin）
 * ------------------------------------------------------------
 * 设计原则：
 *   1. **独立页面**，不再挂在首页弹窗里 —— 首页保持干净的搜索体验，
 *      后台也终于能有足够的空间做多 Tab 管理。
 *   2. 移动端优先：小屏时左侧导航自动变成横向可滑动的 Tab 条，
 *      频道表格退化成卡片，所有触控目标 ≥ 40px。
 *   3. 配置项分组清晰：总览 / 频道 / 插件 / 结果展示 / 系统设置。
 */

import { VENDOR_VERSION } from './vendor.generated';
import { ICONS_CSS } from './icons';
import { CLOUD_BADGE_CSS, CLOUD_TYPES } from './cloud';
import { APP_VERSION, APP_VERSION_LABEL, APP_NAME } from './version';
import { DEFAULT_PLUGINS } from './defaults';

/**
 * V1.4：插件源管理改为「一行 = 一个插件条目」。
 *
 * V1.3 及以前，内置插件是「一条聚合节点配置 + 89 个第三方子源 id」的结构，
 * 后台只能整条启停，子源开关形同虚设（节点一次性抓全部）。
 * V1.4 起搜索不再依赖第三方聚合节点：Worker 内直接实现原生抓取源（type='native'），
 * 每个源 = 一次独立的抓取，因此后台可以逐个开关、逐个看结果。
 */

/**
 * 第三方聚合节点的兜底地址（正常流程下沿用 KV 里已存的地址）。
 *
 * ⚠️ 不能取 `DEFAULT_PLUGINS[0]` —— V1.4 起第一位是原生源（影盘社），
 * 原生源没有 apiEndpoint，取其地址会拿到空串，于是后台新增/批量导入第三方源时
 * 会静默存下一条没有地址的插件配置（不报错，但永远抓不到数据）。
 * 这里显式找「第一个带地址的非原生插件」。
 */
const DEFAULT_AGGREGATE_PLUGIN = DEFAULT_PLUGINS.find(p => p.type !== 'native' && !!p.apiEndpoint);
const FALLBACK_PLUGIN_ENDPOINT = (DEFAULT_AGGREGATE_PLUGIN && DEFAULT_AGGREGATE_PLUGIN.apiEndpoint) || '';

/**
 * 兜底的第三方节点配置，**通过 JSON 注入**给浏览器端的脚本用。
 *
 * ⚠️ 这段 js 是跑在浏览器里的，`DEFAULT_PLUGINS` 只存在于构建期的 Node 作用域。
 * 直接在里面写 `DEFAULT_PLUGINS.find(...)` 会抛 ReferenceError，而 Vue 会把事件
 * 处理器里的异常**吞掉只打 console.error** —— 表现是「点『确认导入』毫无反应、
 * 也不报错」，极难查。凡是 Node 侧的数据，一律 JSON.stringify 后插值。
 */
const DEFAULT_AGGREGATE_NODE_JSON = JSON.stringify(
  DEFAULT_AGGREGATE_PLUGIN || {
    id: 'pansou_aggregate',
    name: 'PanSou 聚合节点',
    type: 'pansou',
    apiEndpoint: '',
    pluginIds: []
  }
);

/**
 * V1.3：开放 API 文档。
 *
 * 原先这段内容挂在首页的「API 接口」弹窗上，V1.3 挪进后台（首页不再承载任何
 * 非搜索功能），并补齐了 V1.2/V1.3 新增的接口。
 * 以 JSON 形式注入，避免在 HTML 模板里手写转义。
 */
const API_GROUPS_JSON = JSON.stringify([
  {
    name: '搜索与检测',
    icon: 'fa-magnifying-glass',
    items: [
      {
        method: 'POST',
        path: '/api/search',
        summary: '核心聚合搜索',
        desc:
          '网页端会把全部启用频道拆成多个分片并发调用本接口（每片 8 个频道），插件再单独发一次请求，' +
          '因此同一个关键词通常会产生多次调用，但每次调用之间结果是可合并的（按 URL 去重）。',
        req: 'Body: { "kw": "三体", "res": "merge" }；可选 channels=[...]、plugins=[...]、plugins_only=true、no_plugins=true',
        resp:
          '{\n' +
          '  "code": 0,\n' +
          '  "message": "success",\n' +
          '  "data": {\n' +
          '    "total": 143,\n' +
          '    "merged_by_type": {\n' +
          '      "quark": [\n' +
          '        { "url": "https://pan.quark.cn/s/xxxx", "password": "",\n' +
          '          "note": "三体 全三季 4K", "datetime": "2026-09-01T10:00:00Z", "source": "panjclub" }\n' +
          '      ],\n' +
          '      "aliyun": [ /* ... */ ]\n' +
          '    },\n' +
          '    "_meta": { "cache_mode": "memory", "channels_queried": 8, "channels_ok": 8,\n' +
          '               "plugins_ok": 1, "from_cache": 0, "elapsed_ms": 3200 }\n' +
          '  }\n' +
          '}'
      },
      {
        method: 'POST',
        path: '/api/check',
        summary: '网盘链接失效检测',
        desc: '网页端每条结果的「测活」按钮即调用本接口；GET 方式也支持（参数走 querystring）。',
        req: 'Body: { "url": "https://pan.quark.cn/s/xxxx", "password": "abcd", "type": "quark" }',
        resp:
          '{\n' +
          '  "code": 0,\n' +
          '  "url": "https://pan.quark.cn/s/xxxx",\n' +
          '  "valid": true,\n' +
          '  "status": "valid",\n' +
          '  "label": "有效"\n' +
          '}\n' +
          '\n' +
          '// status 取值：valid / invalid / unknown\n' +
          '// 注意：「提取码错误」类返回同样代表分享存在，会被判为 valid'
      }
    ]
  },
  {
    name: '配置读取（公开）',
    icon: 'fa-list',
    items: [
      {
        method: 'GET',
        path: '/api/channels',
        summary: '启用中的 TG 频道清单',
        req: '无',
        resp:
          '{\n' +
          '  "code": 0,\n' +
          '  "total": 143,\n' +
          '  "enabled": 143,\n' +
          '  "shard_size": 8,\n' +
          '  "channels": ["tgsearchers7", "Aliyun_4K_Movies", "..."]\n' +
          '}'
      },
      {
        method: 'GET',
        path: '/api/plugins',
        summary: '启用中的插件源',
        desc: 'V1.4 起插件源分两类：type="native" 由 Worker 直接抓取（不依赖第三方站点），type="pansou" 走外部聚合节点。',
        req: '无',
        resp:
          '{\n' +
          '  "code": 0,\n' +
          '  "total": 4,\n' +
          '  "enabled": 3,\n' +
          '  "plugins": [\n' +
          '    { "id": "melost",   "name": "Melost 网盘搜索", "type": "native", "desc": "JSON 接口，支持多网盘" },\n' +
          '    { "id": "ouge",     "name": "欧哥影视（苹果CMS）", "type": "native" },\n' +
          '    { "id": "quark4k",  "name": "夸克4K（Flarum 论坛）", "type": "native" },\n' +
          '    { "id": "pansou_aggregate", "name": "PanSou 聚合节点", "type": "pansou", "enabled": false }\n' +
          '  ]\n' +
          '}'
      },
      {
        method: 'GET',
        path: '/api/hot',
        summary: '热门搜索词',
        req: '无',
        resp: '{ "hot_searches": ["庆余年", "流浪地球2", "..."] }'
      },
      {
        method: 'GET',
        path: '/api/ui-config',
        summary: '网页端展示配置',
        desc: '首页首屏只拉这一小段 JSON：版本号、展示哪些网盘、是否显示自动测活、前台是否需要密码。',
        req: '无',
        resp:
          '{\n' +
          '  "code": 0,\n' +
          '  "version": "' + APP_VERSION + '",\n' +
          '  "version_label": "' + APP_VERSION_LABEL + '",\n' +
          '  "app_name": "PanSou Edge",\n' +
          '  "visible_cloud_types": ["quark", "aliyun", "baidu"],\n' +
          '  "cloud_labels": { "quark": "夸克网盘", "aliyun": "阿里云盘" },\n' +
          '  "show_auto_check": true,\n' +
          '  "frontend_auth_enabled": false\n' +
          '}'
      },
      {
        method: 'GET',
        path: '/api/health',
        summary: '健康检查',
        desc: '部署后自检、监控探针都可用它；不泄露任何凭据。',
        req: '无',
        resp:
          '{\n' +
          '  "status": "ok",\n' +
          '  "version": "' + APP_VERSION + '",\n' +
          '  "version_label": "' + APP_VERSION_LABEL + '",\n' +
          '  "kv_bound": true,\n' +
          '  "channels_enabled": 143,\n' +
          '  "plugins_enabled": 1,\n' +
          '  "result_cache_mode": "memory",\n' +
          '  "credentials_hashed": true,\n' +
          '  "frontend_auth_enabled": false,\n' +
          '  "memory_cache": { "settings": 1, "channels": 0, "feeds": 0, "plugins": 0, "checks": 0 }\n' +
          '}'
      }
    ]
  },
  {
    name: '前台访问密码（V1.3）',
    icon: 'fa-key',
    items: [
      {
        method: 'POST',
        path: '/api/frontend/auth',
        summary: '用前台密码换取访问令牌',
        desc:
          '仅当后台开启了「前台访问密码」时生效。密码校验通过后返回一个由密码哈希派生的无状态令牌，' +
          '把它放进请求头 X-Frontend-Token 即可调用数据类接口。改密码令牌自动失效，无需服务端会话。',
        req: 'Body: { "password": "你的前台密码" }',
        resp:
          '{\n' +
          '  "code": 0,\n' +
          '  "enabled": true,\n' +
          '  "token": "9f2c1a...（40 位十六进制）",\n' +
          '  "expires_in": null\n' +
          '}\n' +
          '\n' +
          '// 未开启前台密码时：{ "code": 0, "enabled": false, "message": "前台未开启访问密码" }\n' +
          '// 密码错误时 HTTP 401：{ "code": 401, "message": "密码错误" }'
      }
    ]
  },
  {
    name: '后台管理（需管理员密码）',
    icon: 'fa-sliders',
    items: [
      {
        method: 'POST',
        path: '/api/admin/settings',
        summary: '读取 / 保存全部配置',
        desc:
          '所有请求都必须带 Authorization: Bearer <后台密码>。GET 只回传「密码是否已设置」的布尔状态，' +
          '任何哈希都不出服务器；POST 提交的密码会在服务端用 PBKDF2-SHA256 加盐哈希后落盘。',
        req:
          'GET 无参数；POST Body 为配置片段，例如\n' +
          '{ "adminPassword": "新后台密码" }\n' +
          '{ "frontendAuthEnabled": true, "frontendPasswordMode": "custom", "frontendPassword": "访客密码" }\n' +
          '{ "frontendPasswordMode": "reuse", "clearFrontendPassword": true }',
        resp:
          'GET:\n' +
          '{\n' +
          '  "channels": [ /* ... */ ],\n' +
          '  "plugins": [ /* ... */ ],\n' +
          '  "resultCacheMode": "memory",\n' +
          '  "kv_bound": true,\n' +
          '  "admin_password_set": true,\n' +
          '  "admin_password_from_env": false,\n' +
          '  "frontend_password_set": false\n' +
          '}\n' +
          '\n' +
          'POST: { "code": 0, "message": "保存成功" }'
      },
      {
        method: 'GET',
        path: '/api/admin/defaults',
        summary: '出厂配置',
        desc: '回传内置的全部 TG 频道与默认插件源（原生源默认启用、第三方聚合节点默认停用），供后台「恢复出厂配置」使用。需管理员密码。',
        req: '无',
        resp: '{ "channels": [ /* 143 个频道 */ ], "plugins": [ /* 原生源 + 聚合节点 */ ], "hotSearches": [ "...", ] }'
      }
    ]
  },
  {
    name: '诊断（V1.3 起受前台密码保护）',
    icon: 'fa-stethoscope',
    items: [
      {
        method: 'GET',
        path: '/api/debug/cache',
        summary: '缓存与配额诊断',
        desc: '查看当前缓存模式、KV 是否绑定、各内存缓存条目数。此接口保持公开，便于监控。',
        req: '无',
        resp:
          '{\n' +
          '  "version": "' + APP_VERSION + '",\n' +
          '  "result_cache_mode": "memory",\n' +
          '  "kv_bound": true,\n' +
          '  "memory_cache": { "settings": 1, "channels": 12, "feeds": 8, "plugins": 1, "checks": 0 },\n' +
          '  "note": "频道搜索结果仅缓存在 Worker isolate 内存中……"\n' +
          '}'
      },
      {
        method: 'GET',
        path: '/api/debug/plugin',
        summary: '插件源连通诊断',
        desc: 'V1.4：原生源直接跑 Worker 内引擎，第三方节点走 HTTP 抓取；返回逐源结果，便于定位是哪个源挂了。',
        req: '?kw=流浪地球&id=melost 或 ?ids=melost,ouge,quark4k（缺省测全部已启用源）；rounds 仅对第三方节点生效',
        resp:
          '{\n' +
          '  "ok": true,\n' +
          '  "results": [\n' +
          '    { "id": "melost", "type": "native", "ok": true, "status": 200, "ms": 1860, "total": 7880 },\n' +
          '    { "id": "ouge",   "type": "native", "ok": true, "status": 200, "ms": 940,  "total": 42 }\n' +
          '  ]\n' +
          '}'
      },
      {
        method: 'GET',
        path: '/api/debug/tg',
        summary: 'Telegram 抓取诊断',
        req: '?ch=PanjClub&kw=三体',
        resp: '{ "ok": true, "status": 200, "blocks": 12, "bytes": 84213 }'
      },
      {
        method: 'GET',
        path: '/api/debug/fetch',
        summary: '任意 URL 抓取诊断',
        req: '?url=https://example.com',
        resp: '{ "ok": true, "status": 200, "content_type": "text/html", "bytes": 1256, "ms": 320 }'
      }
    ]
  }
]);

/**
 * 注入到内联脚本里的网盘元数据（key / 中文名 / 徽标色 / 默认是否可见）。
 * 后台的「结果展示」面板据此渲染勾选列表，避免前后端各维护一份映射。
 */
const CLOUDS_JSON = JSON.stringify(
  CLOUD_TYPES.map(c => ({ key: c.key, label: c.label, badge: c.badge, defaultVisible: c.defaultVisible }))
);

export const ADMIN_TEMPLATE = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
  <title>${APP_NAME} 管理后台 ${APP_VERSION_LABEL}</title>
  <meta name="robots" content="noindex, nofollow">
  <meta name="theme-color" content="#4f46e5">
  <link rel="icon" type="image/svg+xml" href="/assets/favicon.svg?v=${VENDOR_VERSION}">
  <link rel="stylesheet" href="/assets/app.css?v=${VENDOR_VERSION}">
  <style>
${ICONS_CSS}
${CLOUD_BADGE_CSS}
    :root { --safe-bottom: env(safe-area-inset-bottom, 0px); }
    body {
      -webkit-tap-highlight-color: transparent;
      overscroll-behavior-y: none;
    }
    .glass { background: rgba(255,255,255,0.9); backdrop-filter: blur(16px); -webkit-backdrop-filter: blur(16px); }
    .nav-scroll { -webkit-overflow-scrolling: touch; scrollbar-width: none; }
    .nav-scroll::-webkit-scrollbar { display: none; }
    .safe-bottom { padding-bottom: calc(12px + var(--safe-bottom)); }
    [v-cloak] { display: none; }
    /* 移动端输入框统一 16px，避免 iOS Safari 聚焦时自动放大页面 */
    @media (max-width: 767px) {
      input, select, textarea { font-size: 16px !important; }
    }
  </style>
  <script src="/assets/vue.js?v=${VENDOR_VERSION}"></script>
</head>
<body class="bg-slate-100 text-slate-800 min-h-screen font-sans antialiased">
<div id="app" v-cloak class="flex flex-col min-h-screen">

  <!-- ================= 顶栏 ================= -->
  <header class="glass border-b border-slate-200 sticky top-0 z-40">
    <div class="max-w-7xl mx-auto px-3 sm:px-4 h-14 sm:h-16 flex items-center justify-between gap-2">
      <div class="flex items-center gap-2.5 min-w-0">
        <div class="w-9 h-9 sm:w-10 sm:h-10 shrink-0 rounded-xl bg-gradient-to-tr from-blue-600 via-indigo-600 to-indigo-500 flex items-center justify-center text-white shadow-md shadow-indigo-500/20">
          <i class="fa-solid fa-sliders text-sm sm:text-base"></i>
        </div>
        <div class="min-w-0">
          <div class="flex items-center gap-1.5">
            <h1 class="font-bold text-base sm:text-lg leading-tight truncate">管理后台</h1>
            <span class="shrink-0 text-[10px] font-bold px-1.5 py-0.5 rounded bg-indigo-50 text-indigo-600 border border-indigo-100">{{ versionLabel }}</span>
          </div>
          <p class="text-[11px] text-slate-400 truncate hidden sm:block">{{ appName }} · 边缘节点配置中心</p>
        </div>
      </div>

      <div class="flex items-center gap-1.5 shrink-0">
        <a href="/" class="px-2.5 sm:px-3 py-1.5 text-xs font-medium text-slate-600 hover:text-blue-600 hover:bg-slate-100 rounded-lg transition flex items-center gap-1">
          <i class="fa-solid fa-house text-[11px]"></i><span class="hidden sm:inline">返回首页</span>
        </a>
        <button v-if="authed" @click="logout" class="px-2.5 sm:px-3 py-1.5 text-xs font-medium text-rose-600 hover:bg-rose-50 rounded-lg transition flex items-center gap-1">
          <i class="fa-solid fa-right-from-bracket text-[11px]"></i><span class="hidden sm:inline">退出</span>
        </button>
      </div>
    </div>
  </header>

  <!-- ================= 未登录：登录卡片 ================= -->
  <main v-if="!authed" class="flex-1 flex items-center justify-center px-4 py-10">
    <div class="w-full max-w-sm">
      <div class="bg-white rounded-2xl border border-slate-200 shadow-xl shadow-slate-200/50 p-6 sm:p-7">
        <div class="text-center mb-6">
          <div class="w-14 h-14 mx-auto rounded-2xl bg-gradient-to-tr from-blue-600 to-indigo-600 flex items-center justify-center text-white text-xl shadow-lg shadow-indigo-500/25 mb-3">
            <i class="fa-solid fa-lock"></i>
          </div>
          <h2 class="font-bold text-lg text-slate-800">管理员登录</h2>
          <p class="text-xs text-slate-400 mt-1">请输入后台密码以继续</p>
        </div>

        <form @submit.prevent="login" class="space-y-3">
          <div class="relative">
            <input
              :type="showPwd ? 'text' : 'password'"
              v-model="pwdInput"
              autocomplete="current-password"
              placeholder="管理员密码"
              class="w-full pl-10 pr-10 py-3 text-sm border-2 border-slate-200 rounded-xl outline-none transition focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/10"
            />
            <i class="fa-solid fa-key absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-300 text-sm"></i>
            <button type="button" @click="showPwd = !showPwd" class="absolute right-3 top-1/2 -translate-y-1/2 text-slate-300 hover:text-slate-500">
              <i class="fa-solid text-sm" :class="showPwd ? 'fa-eye-slash' : 'fa-eye'"></i>
            </button>
          </div>

          <button
            type="submit"
            :disabled="loggingIn || !pwdInput"
            class="w-full py-3 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white font-semibold text-sm rounded-xl transition shadow-md shadow-indigo-500/20 disabled:opacity-50 flex items-center justify-center gap-2"
          >
            <i class="fa-solid" :class="loggingIn ? 'fa-circle-notch fa-spin' : 'fa-arrow-right-to-bracket'"></i>
            <span>{{ loggingIn ? '验证中…' : '登录' }}</span>
          </button>
        </form>

        <p v-if="loginError" class="mt-3 text-xs text-rose-600 bg-rose-50 border border-rose-100 rounded-lg px-3 py-2 flex items-start gap-1.5">
          <i class="fa-solid fa-circle-exclamation mt-0.5"></i><span>{{ loginError }}</span>
        </p>

        <p class="mt-5 text-[11px] text-slate-400 text-center leading-relaxed">
          默认密码 <code class="px-1 py-0.5 bg-slate-100 rounded font-mono">admin</code>，
          可在「系统设置」中修改，或通过环境变量 <code class="font-mono">ADMIN_PASSWORD</code> 指定。
        </p>
      </div>
    </div>
  </main>

  <!-- ================= 已登录：后台主体 ================= -->
  <div v-else class="flex-1 max-w-7xl w-full mx-auto px-3 sm:px-4 py-4 sm:py-6">
    <div class="flex flex-col lg:flex-row gap-4 lg:gap-6">

      <!-- 左侧导航（移动端横向滚动 Tab 条） -->
      <aside class="lg:w-52 shrink-0">
        <nav class="nav-scroll flex lg:flex-col gap-1.5 overflow-x-auto pb-1 lg:pb-0">
          <button
            v-for="tab in tabs"
            :key="tab.key"
            @click="activeTab = tab.key"
            class="shrink-0 lg:w-full flex items-center gap-2 px-3 py-2.5 rounded-xl text-xs sm:text-sm font-medium transition whitespace-nowrap"
            :class="activeTab === tab.key
              ? 'bg-indigo-600 text-white shadow-md shadow-indigo-500/25'
              : 'bg-white text-slate-600 hover:bg-slate-50 border border-slate-200 lg:border-transparent'"
          >
            <i class="fa-solid w-4 text-center" :class="tab.icon"></i>
            <span>{{ tab.name }}</span>
            <span v-if="tab.badge" class="ml-auto hidden lg:inline text-[10px] px-1.5 py-0.5 rounded-full"
              :class="activeTab === tab.key ? 'bg-white/25' : 'bg-slate-100 text-slate-500'">{{ tab.badge }}</span>
          </button>
        </nav>

        <!-- 保存区（桌面端常驻左侧） -->
        <div class="hidden lg:block mt-4">
          <button
            @click="save"
            :disabled="saving"
            class="w-full py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-sm font-semibold transition shadow-md shadow-emerald-500/20 disabled:opacity-50 flex items-center justify-center gap-2"
          >
            <i class="fa-solid" :class="saving ? 'fa-circle-notch fa-spin' : 'fa-floppy-disk'"></i>
            <span>{{ saving ? '保存中…' : '保存配置' }}</span>
          </button>
          <p v-if="dirty" class="mt-2 text-[11px] text-amber-600 text-center flex items-center justify-center gap-1">
            <i class="fa-solid fa-circle text-[6px]"></i> 有未保存的修改
          </p>
          <p v-else class="mt-2 text-[11px] text-slate-400 text-center">配置已同步</p>
        </div>
      </aside>

      <!-- 右侧内容 -->
      <div class="flex-1 min-w-0 space-y-4">

        <!-- KV 未绑定提示 -->
        <div v-if="!kvBound" class="px-3 py-2.5 bg-amber-50 border border-amber-200 rounded-xl text-amber-800 text-xs flex items-start gap-2">
          <i class="fa-solid fa-triangle-exclamation text-amber-500 mt-0.5"></i>
          <span><strong>未绑定 KV 命名空间：</strong>配置只在内存生效，Worker 重启后会恢复默认。请绑定 <code class="font-mono">PANSOU_KV</code> 后再使用后台。</span>
        </div>

        <!-- ---------------- 总览 ---------------- -->
        <section v-if="activeTab === 'overview'" class="space-y-4">
          <div class="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <div class="bg-white rounded-2xl border border-slate-200 p-4">
              <div class="text-[11px] text-slate-400 mb-1">启用频道</div>
              <div class="text-2xl font-bold text-slate-800">{{ enabledChannelsCount }}<span class="text-sm font-normal text-slate-400">/{{ settings.channels.length }}</span></div>
            </div>
            <div class="bg-white rounded-2xl border border-slate-200 p-4">
              <div class="text-[11px] text-slate-400 mb-1">启用插件源</div>
              <div class="text-2xl font-bold text-slate-800">{{ enabledPluginCount }}<span class="text-sm font-normal text-slate-400">/{{ pluginSources.length }}</span></div>
            </div>
            <div class="bg-white rounded-2xl border border-slate-200 p-4">
              <div class="text-[11px] text-slate-400 mb-1">展示网盘类型</div>
              <div class="text-2xl font-bold text-slate-800">{{ (settings.visibleCloudTypes || []).length }}<span class="text-sm font-normal text-slate-400">/{{ allClouds.length }}</span></div>
            </div>
            <div class="bg-white rounded-2xl border border-slate-200 p-4">
              <div class="text-[11px] text-slate-400 mb-1">结果缓存</div>
              <div class="text-base font-bold text-slate-800 mt-1">{{ cacheModeLabel }}</div>
            </div>
          </div>

          <div class="bg-white rounded-2xl border border-slate-200 p-4">
            <h3 class="font-bold text-sm text-slate-800 mb-3 flex items-center gap-2">
              <i class="fa-solid fa-gauge-high text-indigo-600"></i>运行状态
            </h3>
            <div class="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2.5 text-xs">
              <div class="flex justify-between py-1.5 border-b border-slate-100">
                <span class="text-slate-500">KV 命名空间</span>
                <span :class="kvBound ? 'text-emerald-600 font-medium' : 'text-rose-600 font-medium'">{{ kvBound ? '已绑定' : '未绑定' }}</span>
              </div>
              <div class="flex justify-between py-1.5 border-b border-slate-100">
                <span class="text-slate-500">搜索并发数</span>
                <span class="font-mono text-slate-700">{{ settings.concurrency }}</span>
              </div>
              <div class="flex justify-between py-1.5 border-b border-slate-100">
                <span class="text-slate-500">全站频道总数</span>
                <span class="font-mono text-slate-700">{{ settings.channels.length }}</span>
              </div>
              <div class="flex justify-between py-1.5 border-b border-slate-100">
                <span class="text-slate-500">前台访问密码</span>
                <span :class="frontendAuthOn ? 'text-emerald-600 font-medium' : 'text-slate-500 font-medium'">{{ frontendAuthOn ? (settings.frontendPasswordMode === 'custom' ? '已开启（独立密码）' : '已开启（复用后台密码）') : '未开启' }}</span>
              </div>
              <div class="flex justify-between py-1.5 border-b border-slate-100">
                <span class="text-slate-500">凭据存储</span>
                <span :class="passwordHashed ? 'text-emerald-600 font-medium' : 'text-amber-600 font-medium'">{{ passwordHashed ? 'PBKDF2 哈希' : '待升级' }}</span>
              </div>
            </div>
            <p class="mt-3 text-[11px] text-slate-400 leading-relaxed">
              说明：全站频道会由前端自动拆片并发调度，因此「频道总数」可以远超单次并发数，不影响覆盖率。
              插件源则不同 —— 所有已启用的源会被<strong>合并成一次聚合节点请求</strong>，因此勾得越多单次响应越慢。
            </p>
          </div>

          <div class="bg-indigo-50/60 border border-indigo-100 rounded-2xl p-4">
            <h3 class="font-bold text-sm text-indigo-900 mb-2 flex items-center gap-2">
              <i class="fa-solid fa-lightbulb text-indigo-500"></i>关于 KV 配额（V1.2 起默认已优化）
            </h3>
            <p class="text-xs text-indigo-800/80 leading-relaxed">
              Cloudflare 免费版 KV 每天只有 <strong>1000 次写</strong>。旧版本会把每一次
              「频道 × 关键词」的搜索结果都写进 KV —— 一次搜索就是 140+ 次写入，几轮就把当天额度打满，
              之后所有缓存写入静默失败。现在默认改为
              <strong>仅内存缓存</strong>：搜索结果完全不再写 KV，只在当前边缘节点内存里保留一份副本，
              重复搜索依旧秒回，KV 只用于保存后台配置。如需跨节点共享缓存，
              可在「结果展示」里切回 KV 模式。
            </p>
          </div>
        </section>

        <!-- ---------------- 频道 ---------------- -->
        <section v-if="activeTab === 'channels'" class="bg-white rounded-2xl border border-slate-200 overflow-hidden">
          <div class="p-3 sm:p-4 border-b border-slate-100 flex flex-wrap items-center gap-2">
            <input
              v-model="channelFilter"
              type="search"
              placeholder="筛选频道…"
              class="flex-1 min-w-[140px] px-3 py-2 text-xs border border-slate-200 rounded-xl outline-none focus:border-indigo-500"
            />
            <div class="flex items-center gap-1.5">
              <button @click="toggleAllChannels(true)" class="px-2.5 py-2 text-xs bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-lg transition">全启用</button>
              <button @click="toggleAllChannels(false)" class="px-2.5 py-2 text-xs bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-lg transition">全禁用</button>
              <button @click="addChannel" class="px-2.5 py-2 text-xs bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg font-medium transition whitespace-nowrap">+ 添加</button>
            </div>
          </div>

          <!-- 批量导入频道（V1.5：从「系统设置」挪到频道页，与频道列表同屏，改完直接点保存） -->
          <div class="px-3 sm:px-4 py-3 border-b border-slate-100 bg-slate-50/60 space-y-2">
            <div class="flex flex-wrap items-center justify-between gap-2">
              <h3 class="text-xs font-bold text-slate-700 flex items-center gap-1.5">
                <i class="fa-solid fa-file-import text-indigo-600"></i>批量导入频道
              </h3>
              <span class="text-[11px] text-slate-400">英文逗号 / 换行 / 分号分隔 · 可整段粘 <code class="font-mono">@name</code> 或 <code class="font-mono">t.me</code> 链接</span>
            </div>
            <textarea
              v-model="batchText"
              rows="2"
              placeholder="channel1, @channel2, https://t.me/s/channel3"
              class="w-full p-2.5 border border-slate-200 rounded-xl text-xs font-mono outline-none focus:border-indigo-500 bg-white"
            ></textarea>
            <div class="flex flex-wrap items-center justify-between gap-2">
              <label class="flex items-center gap-1.5 text-xs text-slate-600 cursor-pointer">
                <input type="checkbox" v-model="batchEnableAll" class="w-4 h-4 rounded text-indigo-600">
                <span>导入后默认启用</span>
              </label>
              <button @click="doBatchImport" class="px-4 py-2 text-xs bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg font-medium transition">确认导入</button>
            </div>
          </div>

          <div class="px-3 sm:px-4 py-2 bg-slate-50 border-b border-slate-100 text-[11px] text-slate-500 flex items-center justify-between">
            <span>已启用 <strong class="text-slate-700">{{ enabledChannelsCount }}</strong> / {{ settings.channels.length }}（显示 {{ filteredChannels.length }} 条）</span>
            <span class="hidden sm:inline text-slate-400">勾选即启用 · 修改后需点保存</span>
          </div>

          <!-- 桌面端表格 -->
          <div class="hidden md:block max-h-[60vh] overflow-y-auto">
            <table class="w-full text-left text-xs">
              <thead class="bg-slate-50 sticky top-0 text-slate-500 border-b border-slate-100">
                <tr>
                  <th class="p-2.5 w-14 text-center font-medium">启用</th>
                  <th class="p-2.5 w-52 font-medium">频道 Username</th>
                  <th class="p-2.5 font-medium">描述 / 标签</th>
                  <th class="p-2.5 w-24 font-medium">优先级</th>
                  <th class="p-2.5 w-14 text-center font-medium">操作</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-slate-100">
                <tr v-for="ch in filteredChannels" :key="ch.name" class="hover:bg-slate-50/70">
                  <td class="p-2.5 text-center">
                    <input type="checkbox" v-model="ch.enabled" class="w-4 h-4 rounded text-indigo-600 align-middle">
                  </td>
                  <td class="p-2.5 font-mono text-slate-700">@{{ ch.name }}</td>
                  <td class="p-2.5"><input v-model="ch.description" class="w-full px-2 py-1 border border-slate-200 rounded-lg text-xs outline-none focus:border-indigo-500"></td>
                  <td class="p-2.5">
                    <select v-model="ch.priority" class="px-2 py-1 border border-slate-200 rounded-lg text-xs outline-none focus:border-indigo-500">
                      <option :value="1">高</option>
                      <option :value="2">中</option>
                      <option :value="3">低</option>
                    </select>
                  </td>
                  <td class="p-2.5 text-center">
                    <button @click="removeChannel(ch)" class="text-rose-500 hover:text-rose-700 p-1"><i class="fa-regular fa-trash-can"></i></button>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          <!-- 移动端卡片 -->
          <div class="md:hidden max-h-[60vh] overflow-y-auto divide-y divide-slate-100">
            <div v-for="ch in filteredChannels" :key="ch.name" class="p-3 flex items-start gap-3">
              <input type="checkbox" v-model="ch.enabled" class="mt-0.5 w-5 h-5 shrink-0 rounded text-indigo-600">
              <div class="flex-1 min-w-0 space-y-1.5">
                <div class="font-mono text-xs text-slate-700 truncate">@{{ ch.name }}</div>
                <input v-model="ch.description" placeholder="描述" class="w-full px-2 py-1.5 border border-slate-200 rounded-lg text-xs outline-none focus:border-indigo-500">
                <div class="flex items-center gap-2">
                  <select v-model="ch.priority" class="px-2 py-1.5 border border-slate-200 rounded-lg text-xs flex-1 outline-none focus:border-indigo-500">
                    <option :value="1">优先级：高</option>
                    <option :value="2">优先级：中</option>
                    <option :value="3">优先级：低</option>
                  </select>
                  <button @click="removeChannel(ch)" class="px-3 py-1.5 text-xs text-rose-600 bg-rose-50 rounded-lg shrink-0">删除</button>
                </div>
              </div>
            </div>
          </div>
        </section>

        <!-- ---------------- 插件（V1.4：一行 = 一个插件源，原生源各自独立抓取） ---------------- -->
        <section v-if="activeTab === 'plugins'" class="space-y-3">
          <!-- 工具栏 -->
          <div class="bg-white rounded-2xl border border-slate-200 p-3 sm:p-4 flex flex-wrap items-center gap-2">
            <input
              v-model="pluginFilter"
              type="search"
              placeholder="筛选插件源…"
              class="flex-1 min-w-[140px] px-3 py-2 text-xs border border-slate-200 rounded-xl outline-none focus:border-indigo-500"
            />
            <div class="flex flex-wrap items-center gap-1.5">
              <button @click="toggleAllPlugins(true)" class="px-2.5 py-2 text-xs bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-lg transition">全启用</button>
              <button @click="toggleAllPlugins(false)" class="px-2.5 py-2 text-xs bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-lg transition">全禁用</button>
              <button @click="resetPluginSources" class="px-2.5 py-2 text-xs bg-amber-50 hover:bg-amber-100 text-amber-700 rounded-lg transition whitespace-nowrap">回到内置默认</button>
              <button @click="addPluginSource" class="px-2.5 py-2 text-xs bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg font-medium transition whitespace-nowrap">+ 添加源</button>
            </div>
          </div>

          <div class="bg-white rounded-2xl border border-slate-200 overflow-hidden">
            <!-- 统计条 + 插件源连通测试 -->
            <div class="px-3 sm:px-4 py-2.5 border-b border-slate-100 flex flex-wrap items-center justify-between gap-2">
              <div class="text-[11px] text-slate-500">
                已启用 <strong class="text-slate-700">{{ enabledPluginCount }}</strong> / {{ pluginSources.length }} 个插件源
                <span class="text-slate-400 ml-1">（显示 {{ filteredPluginSources.length }} 条）</span>
              </div>
              <div class="flex items-center gap-2">
                <button
                  @click="testPlugins"
                  :disabled="pluginTesting"
                  class="px-2.5 py-1.5 text-[11px] bg-blue-50 hover:bg-blue-100 text-blue-600 rounded-lg transition flex items-center gap-1 disabled:opacity-60"
                >
                  <i class="fa-solid" :class="pluginTesting ? 'fa-circle-notch fa-spin' : 'fa-vial'"></i>测试已启用源
                </button>
                <span v-if="pluginTestResult" class="text-[11px] px-2 py-1 rounded-lg" :class="pluginTestResult.ok ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700'">
                  {{ pluginTestResult.text }}
                </span>
              </div>
            </div>

            <p class="px-3 sm:px-4 py-2.5 text-[11px] text-slate-400 leading-relaxed border-b border-slate-100">
              每个插件源独立一行，勾选即启用。<strong class="text-slate-500">「原生」源由本站后端直接抓取</strong>，
              不经过任何第三方站点，各自独立、互不影响；「第三方」源则是对外部聚合节点发起的一次 HTTP 请求。
              不确定的源建议关掉——每多开一个都会增加单次搜索的耗时。备注只用于你自己辨认，不影响抓取。
              行尾的垃圾桶可删除单个源；第三方节点下的子源被删空后，保存时该节点配置也会一并移除
              （需要找回请用「恢复出厂配置」）。
            </p>

            <!-- 桌面端表格 -->
            <div class="hidden md:block max-h-[62vh] overflow-y-auto">
              <table class="w-full text-left text-xs">
                <thead class="bg-slate-50 sticky top-0 text-slate-500 border-b border-slate-100">
                  <tr>
                    <th class="p-2.5 w-14 text-center font-medium">启用</th>
                    <th class="p-2.5 w-56 font-medium">插件源 ID</th>
                    <th class="p-2.5 font-medium">备注（可选）</th>
                    <th class="p-2.5 w-16 text-center font-medium">操作</th>
                  </tr>
                </thead>
                <tbody class="divide-y divide-slate-100">
                  <tr
                    v-for="src in filteredPluginSources"
                    :key="src.id + '@' + (src.parentId || 'self')"
                    class="hover:bg-slate-50/70 transition"
                    :class="src.enabled ? '' : 'opacity-60'"
                  >
                    <td class="p-2.5 text-center">
                      <input type="checkbox" v-model="src.enabled" class="w-4 h-4 rounded text-indigo-600 align-middle">
                    </td>
                    <td class="p-2.5">
                      <div class="font-mono text-slate-700 truncate">{{ src.id }}</div>
                      <div class="text-[10px] text-slate-400 truncate mt-1">
                        <span class="px-1.5 py-0.5 rounded mr-1" :class="src.type === 'native' ? 'bg-emerald-50 text-emerald-600' : 'bg-slate-100 text-slate-500'">{{ src.type === 'native' ? '原生' : '第三方' }}</span>
                        {{ src.name }} · {{ src.desc }}
                      </div>
                    </td>
                    <td class="p-2.5">
                      <input v-model="src.label" maxlength="40" placeholder="如：磁力熊" class="w-full px-2 py-1 border border-slate-200 rounded-lg text-xs outline-none focus:border-indigo-500">
                    </td>
                    <td class="p-2.5 text-center">
                      <button
                        @click="removePluginSource(src)"
                        title="删除该源"
                        class="text-rose-500 hover:text-rose-700 hover:bg-rose-50 rounded-lg p-1.5 transition"
                      ><i class="fa-regular fa-trash-can"></i></button>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>

            <!-- 移动端卡片 -->
            <div class="md:hidden max-h-[62vh] overflow-y-auto divide-y divide-slate-100">
              <div
                v-for="src in filteredPluginSources"
                :key="src.id + '@' + (src.parentId || 'self')"
                class="p-3 flex items-start gap-3"
                :class="src.enabled ? '' : 'opacity-60'"
              >
                <input type="checkbox" v-model="src.enabled" class="mt-0.5 w-5 h-5 shrink-0 rounded text-indigo-600">
                <div class="flex-1 min-w-0 space-y-1.5">
                  <div class="flex items-center gap-1.5 min-w-0">
                    <span class="font-mono text-xs text-slate-700 truncate">{{ src.id }}</span>
                    <span class="shrink-0 text-[10px] px-1.5 py-0.5 rounded" :class="src.type === 'native' ? 'bg-emerald-50 text-emerald-600' : 'bg-slate-100 text-slate-500'">{{ src.type === 'native' ? '原生' : '第三方' }}</span>
                  </div>
                  <div class="text-[10px] text-slate-400 truncate">{{ src.name }} · {{ src.desc }}</div>
                  <input v-model="src.label" maxlength="40" placeholder="备注（可选）" class="w-full px-2 py-1.5 border border-slate-200 rounded-lg text-xs outline-none focus:border-indigo-500">
                </div>
                <button
                  @click="removePluginSource(src)"
                  class="shrink-0 text-rose-500 hover:text-rose-700 hover:bg-rose-50 rounded-lg p-2 transition"
                ><i class="fa-regular fa-trash-can"></i></button>
              </div>
            </div>

            <div v-if="filteredPluginSources.length === 0" class="p-8 text-center text-xs text-slate-400">
              没有匹配「{{ pluginFilter }}」的插件源
            </div>
          </div>

          <!-- 批量导入第三方源（英文逗号分隔） -->
          <div class="bg-white rounded-2xl border border-slate-200 p-3 sm:p-4">
            <div class="flex flex-wrap items-center justify-between gap-2 mb-2">
              <h3 class="font-bold text-sm text-slate-800 flex items-center gap-2">
                <i class="fa-solid fa-file-import text-indigo-600"></i>批量导入第三方源
              </h3>
              <span class="text-[11px] text-slate-400">英文逗号分隔</span>
            </div>
            <textarea
              v-model="pluginBatchText"
              rows="3"
              placeholder="clxiong,xiaozhang,kuakedi,https://so.example.xyz/api/ps/pan"
              class="w-full p-3 border border-slate-200 rounded-xl text-xs font-mono outline-none focus:border-indigo-500"
            ></textarea>
            <div class="mt-2 flex flex-wrap items-center justify-between gap-2">
              <label class="flex items-center gap-1.5 text-xs text-slate-600 cursor-pointer">
                <input type="checkbox" v-model="pluginBatchEnable" class="w-4 h-4 rounded text-indigo-600">
                <span>导入后默认启用</span>
              </label>
              <button @click="doPluginBatchImport" class="px-4 py-2 text-xs bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg font-medium transition">确认导入</button>
            </div>
            <p class="mt-2 text-[11px] text-slate-400 leading-relaxed">
              英文逗号、换行或分号分隔都可以，一次可粘一大批（也接受整条链接，会自动取最后一段）。
              导入的源挂在现有第三方节点下（默认 <span class="font-mono">pansou_aggregate</span>），
              每源独立一行，可逐个启用或删除；重复的自动跳过。导入后记得点保存。
            </p>
          </div>
        </section>

        <!-- ---------------- 结果展示 ---------------- -->
        <section v-if="activeTab === 'display'" class="space-y-4">
          <div class="bg-white rounded-2xl border border-slate-200 p-4">
            <div class="flex flex-wrap items-center justify-between gap-2 mb-1">
              <h3 class="font-bold text-sm text-slate-800 flex items-center gap-2">
                <i class="fa-solid fa-filter text-indigo-600"></i>搜索结果展示的网盘类型
              </h3>
              <div class="flex items-center gap-1.5">
                <button @click="selectAllClouds(true)" class="px-2.5 py-1.5 text-[11px] bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-lg transition">全选</button>
                <button @click="selectAllClouds(false)" class="px-2.5 py-1.5 text-[11px] bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-lg transition">全不选</button>
                <button @click="selectMainClouds" class="px-2.5 py-1.5 text-[11px] bg-indigo-50 hover:bg-indigo-100 text-indigo-600 rounded-lg transition">仅主流网盘</button>
              </div>
            </div>
            <p class="text-[11px] text-slate-400 mb-4 leading-relaxed">
              勾选的类型会出现在网页端搜索结果的分类 Tab 中，顺序即下方顺序。
              未勾选的网盘不会展示给网页访客，但第三方 API 调用方依旧能拿到全量数据。
            </p>

            <div class="space-y-2">
              <div
                v-for="key in orderedCloudKeys"
                :key="key"
                class="flex items-center gap-2.5 p-2.5 rounded-xl border transition"
                :class="isCloudVisible(key) ? 'border-indigo-200 bg-indigo-50/40' : 'border-slate-200 bg-white'"
              >
                <input
                  type="checkbox"
                  :checked="isCloudVisible(key)"
                  @change="toggleCloud(key)"
                  class="w-5 h-5 shrink-0 rounded text-indigo-600"
                >
                <span class="text-[11px] font-semibold px-2.5 py-0.5 rounded-md shrink-0" :class="'badge-' + cloudBadgeOf(key)">
                  {{ cloudLabelOf(key) }}
                </span>
                <span class="text-[11px] font-mono text-slate-400 hidden sm:inline">{{ key }}</span>

                <div class="ml-auto flex items-center gap-1" v-if="isCloudVisible(key)">
                  <button @click="moveCloud(key, -1)" class="w-7 h-7 rounded-lg text-slate-400 hover:text-indigo-600 hover:bg-white transition" title="上移">
                    <i class="fa-solid fa-arrow-up text-[10px]"></i>
                  </button>
                  <button @click="moveCloud(key, 1)" class="w-7 h-7 rounded-lg text-slate-400 hover:text-indigo-600 hover:bg-white transition" title="下移">
                    <i class="fa-solid fa-arrow-down text-[10px]"></i>
                  </button>
                </div>
              </div>
            </div>

            <p class="mt-3 text-[11px] text-slate-400">当前展示 {{ (settings.visibleCloudTypes || []).length }} 种网盘：{{ visibleCloudNamesText }}</p>
          </div>

          <div class="bg-white rounded-2xl border border-slate-200 p-4">
            <h3 class="font-bold text-sm text-slate-800 mb-3 flex items-center gap-2">
              <i class="fa-solid fa-database text-indigo-600"></i>搜索结果缓存模式
            </h3>
            <div class="space-y-2">
              <label
                v-for="m in cacheModes"
                :key="m.key"
                class="flex items-start gap-3 p-3 rounded-xl border cursor-pointer transition"
                :class="settings.resultCacheMode === m.key ? 'border-indigo-300 bg-indigo-50/50' : 'border-slate-200 hover:bg-slate-50'"
              >
                <input type="radio" :value="m.key" v-model="settings.resultCacheMode" class="mt-0.5 w-4 h-4 text-indigo-600">
                <div class="flex-1 min-w-0">
                  <div class="flex items-center gap-2">
                    <span class="font-semibold text-xs text-slate-800">{{ m.name }}</span>
                    <span v-if="m.key === 'memory'" class="text-[10px] px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700 font-medium">推荐</span>
                  </div>
                  <p class="text-[11px] text-slate-500 mt-1 leading-relaxed">{{ m.desc }}</p>
                </div>
              </label>
            </div>
          </div>

          <div class="bg-white rounded-2xl border border-slate-200 p-4 flex items-center justify-between gap-3">
            <div class="min-w-0">
              <h3 class="font-bold text-sm text-slate-800">首页展示「自动测活」开关</h3>
              <p class="text-[11px] text-slate-500 mt-1 leading-relaxed">关闭后首页不再展示自动测活按钮，访客仍可手动点击单条「测活」。</p>
            </div>
            <button
              @click="settings.showAutoCheck = !settings.showAutoCheck"
              class="relative inline-flex w-11 h-6 shrink-0 rounded-full transition-colors"
              :class="settings.showAutoCheck ? 'bg-emerald-500' : 'bg-slate-300'"
            >
              <span class="absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform" :class="settings.showAutoCheck ? 'translate-x-5' : 'translate-x-0'"></span>
            </button>
          </div>
        </section>

        <!-- ---------------- API 接口（V1.3：从首页挪进后台） ---------------- -->
        <section v-if="activeTab === 'api'" class="space-y-4">
          <div class="bg-white rounded-2xl border border-slate-200 p-4">
            <div class="flex flex-wrap items-center justify-between gap-2">
              <h3 class="font-bold text-sm text-slate-800 flex items-center gap-2">
                <i class="fa-solid fa-code text-indigo-600"></i>开放 API 接口文档
              </h3>
              <div class="flex items-center gap-2">
                <code class="px-2 py-1 rounded bg-slate-100 font-mono text-[11px] text-slate-600">{{ siteOrigin }}</code>
                <button @click="copyText(siteOrigin, '站点地址已复制')" class="px-2.5 py-1.5 text-[11px] bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-lg transition">复制</button>
              </div>
            </div>
            <p class="text-[11px] text-slate-500 mt-2 leading-relaxed">
              全部接口开放 CORS，可直接在浏览器或任意后端调用。
              <template v-if="frontendAuthOn">
                当前<strong class="text-amber-600">已开启前台访问密码</strong>：数据类接口（搜索 / 测活 / 频道 / 插件 / 诊断）需附加请求头
                <code class="font-mono px-1 py-0.5 bg-slate-100 rounded">X-Frontend-Token</code>，令牌由下方「前台访问密码」接口换取；
              </template>
              <template v-else>当前未开启前台访问密码，数据类接口公开可调用；</template>
              后台管理接口始终需要 <code class="font-mono px-1 py-0.5 bg-slate-100 rounded">Authorization: Bearer &lt;后台密码&gt;</code>。
            </p>
          </div>

          <div v-for="g in apiGroups" :key="g.name" class="bg-white rounded-2xl border border-slate-200 overflow-hidden">
            <div class="px-3 sm:px-4 py-2.5 bg-slate-50 border-b border-slate-100 text-xs font-bold text-slate-700 flex items-center gap-2">
              <i class="fa-solid" :class="g.icon"></i>{{ g.name }}
            </div>
            <div class="divide-y divide-slate-100">
              <div v-for="ep in g.items" :key="ep.method + ep.path" class="p-3 sm:p-4 space-y-2">
                <div class="flex flex-wrap items-center gap-2">
                  <span class="text-[10px] font-bold px-1.5 py-0.5 rounded font-mono" :class="ep.method === 'GET' ? 'bg-emerald-50 text-emerald-700' : 'bg-blue-50 text-blue-700'">{{ ep.method }}</span>
                  <code class="font-mono text-xs font-semibold text-slate-800">{{ ep.path }}</code>
                  <span class="text-[11px] text-slate-500">{{ ep.summary }}</span>
                </div>
                <p v-if="ep.desc" class="text-[11px] text-slate-500 leading-relaxed">{{ ep.desc }}</p>
                <div v-if="ep.req" class="text-[11px] text-slate-500">
                  <span class="text-slate-400">请求：</span><code class="font-mono text-slate-600 whitespace-pre-wrap break-all">{{ ep.req }}</code>
                </div>
                <pre class="bg-slate-900 text-slate-200 rounded-xl p-3 font-mono text-[11px] leading-relaxed overflow-x-auto">{{ ep.resp }}</pre>
              </div>
            </div>
          </div>
        </section>

        <!-- ---------------- 系统设置 ---------------- -->
        <section v-if="activeTab === 'system'" class="space-y-4">
          <div class="bg-white rounded-2xl border border-slate-200 p-4 space-y-4">
            <h3 class="font-bold text-sm text-slate-800 flex items-center gap-2">
              <i class="fa-solid fa-microchip text-indigo-600"></i>并发与性能
            </h3>
            <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label class="block text-[11px] text-slate-500 mb-1">单次调用的并发数（1–10）</label>
                <input type="number" min="1" max="10" v-model.number="settings.concurrency" class="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm outline-none focus:border-indigo-500">
                <p class="mt-1 text-[11px] text-slate-400">受 Workers「单请求 6 路连接」约束，建议 6–8。</p>
              </div>
              <div>
                <label class="block text-[11px] text-slate-500 mb-1">结果缓存时间（秒）</label>
                <input type="number" min="0" max="86400" v-model.number="settings.cacheTtl" class="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm outline-none focus:border-indigo-500">
                <p class="mt-1 text-[11px] text-slate-400">仅对「KV 缓存模式」生效；内存模式用固定 TTL。</p>
              </div>
              <div>
                <label class="block text-[11px] text-slate-500 mb-1">前端单次分片频道数</label>
                <input type="number" min="1" max="10" v-model.number="settings.maxChannelsPerSearch" class="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm outline-none focus:border-indigo-500">
              </div>
            </div>
          </div>

          <!-- 后台登录密码（V1.3：哈希存储） -->
          <div class="bg-white rounded-2xl border border-slate-200 p-4 space-y-4">
            <div class="flex flex-wrap items-center justify-between gap-2">
              <h3 class="font-bold text-sm text-slate-800 flex items-center gap-2">
                <i class="fa-solid fa-shield-halved text-indigo-600"></i>后台管理密码
              </h3>
              <div class="flex items-center gap-1.5">
                <span v-if="settings.admin_password_from_env" class="text-[10px] px-1.5 py-0.5 rounded bg-sky-50 text-sky-700 border border-sky-100">来自环境变量 ADMIN_PASSWORD</span>
                <span v-else-if="passwordHashed" class="text-[10px] px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-100">已哈希存储</span>
                <span v-else class="text-[10px] px-1.5 py-0.5 rounded bg-amber-50 text-amber-700 border border-amber-100">仍是默认密码，建议立即修改</span>
              </div>
            </div>
            <div>
              <label class="block text-[11px] text-slate-500 mb-1">修改密码（留空则保持不变）</label>
              <input type="password" v-model="newPassword" autocomplete="new-password" placeholder="新密码" class="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm outline-none focus:border-indigo-500">
              <p class="mt-1 text-[11px] text-slate-400 leading-relaxed">
                保存时会在服务端用 <strong>PBKDF2-SHA256 + 16 字节随机盐</strong>（10000 轮）哈希后再写入 KV，
                明文既不落盘也不回传；旧版本遗留在 KV 里的明文密码会在你下次登录成功后自动升级为哈希。
                修改成功后当前会话自动沿用新密码，无需重新登录。
              </p>
            </div>
          </div>

          <!-- 前台访问密码（V1.3 新增） -->
          <div class="bg-white rounded-2xl border border-slate-200 p-4 space-y-4">
            <div class="flex flex-wrap items-center justify-between gap-2">
              <h3 class="font-bold text-sm text-slate-800 flex items-center gap-2">
                <i class="fa-solid fa-key text-indigo-600"></i>前台访问密码
              </h3>
              <button
                @click="settings.frontendAuthEnabled = !settings.frontendAuthEnabled"
                class="relative inline-flex w-11 h-6 shrink-0 rounded-full transition-colors"
                :class="settings.frontendAuthEnabled ? 'bg-emerald-500' : 'bg-slate-300'"
              >
                <span class="absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform" :class="settings.frontendAuthEnabled ? 'translate-x-5' : 'translate-x-0'"></span>
              </button>
            </div>
            <p class="text-[11px] text-slate-500 leading-relaxed">
              开启后，访客必须先在首页输入密码才能搜索。首页 HTML 与
              <code class="font-mono px-1 bg-slate-100 rounded">/api/ui-config</code> 始终公开（否则登录门都渲染不出来），
              搜索 / 测活 / 频道 / 插件 / 诊断接口会校验访问令牌。密码同样只存哈希。
            </p>

            <template v-if="settings.frontendAuthEnabled">
              <div class="space-y-2">
                <label
                  class="flex items-start gap-3 p-3 rounded-xl border cursor-pointer transition"
                  :class="settings.frontendPasswordMode === 'reuse' ? 'border-indigo-300 bg-indigo-50/50' : 'border-slate-200 hover:bg-slate-50'"
                >
                  <input type="radio" value="reuse" v-model="settings.frontendPasswordMode" class="mt-0.5 w-4 h-4 text-indigo-600">
                  <div class="flex-1 min-w-0">
                    <span class="font-semibold text-xs text-slate-800">复用后台管理密码</span>
                    <p class="text-[11px] text-slate-500 mt-0.5">访客密码 = 后台密码，改后台密码时前台同步跟着变，只记一套。</p>
                  </div>
                </label>
                <label
                  class="flex items-start gap-3 p-3 rounded-xl border cursor-pointer transition"
                  :class="settings.frontendPasswordMode === 'custom' ? 'border-indigo-300 bg-indigo-50/50' : 'border-slate-200 hover:bg-slate-50'"
                >
                  <input type="radio" value="custom" v-model="settings.frontendPasswordMode" class="mt-0.5 w-4 h-4 text-indigo-600">
                  <div class="flex-1 min-w-0">
                    <span class="font-semibold text-xs text-slate-800">使用独立的前台密码</span>
                    <p class="text-[11px] text-slate-500 mt-0.5">访客拿到的是另一套密码，改前台密码不会影响你登录后台。</p>
                  </div>
                </label>
              </div>

              <div v-if="settings.frontendPasswordMode === 'custom'" class="pt-1 border-t border-slate-100">
                <label class="block text-[11px] text-slate-500 mb-1 mt-3">前台密码（留空则保持不变）</label>
                <input type="password" v-model="newFrontendPassword" autocomplete="new-password" placeholder="访客访问密码" class="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm outline-none focus:border-indigo-500">
                <p class="mt-1 text-[11px] text-slate-400">
                  <span v-if="settings.frontend_password_set" class="text-emerald-600 font-medium">已设置独立密码</span>
                  <span v-else class="text-amber-600 font-medium">尚未设置，保存后会自动退回「复用后台密码」以免出现无密码可验的空档</span>
                </p>
                <button
                  v-if="settings.frontend_password_set"
                  @click="clearFrontendPassword"
                  class="mt-2 px-3 py-1.5 text-[11px] text-rose-600 bg-rose-50 hover:bg-rose-100 rounded-lg transition"
                >
                  <i class="fa-solid fa-eraser mr-1"></i>清除独立密码
                </button>
              </div>

              <div class="px-3 py-2 rounded-xl bg-slate-50 border border-slate-100 text-[11px] text-slate-500 leading-relaxed">
                <i class="fa-solid fa-circle-info text-slate-400 mr-1"></i>
                生效后，本站的数据接口（含 <code class="font-mono">/api/search</code>）必须带
                <code class="font-mono">X-Frontend-Token</code> 才能调用。用第三方程序调用接口时，
                先 POST <code class="font-mono">/api/frontend/auth</code> 换取令牌即可。改密码后旧令牌立即失效。
              </div>
            </template>
          </div>

          <!-- Telegram 反代 -->
          <div class="bg-white rounded-2xl border border-slate-200 p-4 space-y-3">
            <h3 class="font-bold text-sm text-slate-800 flex items-center gap-2">
              <i class="fa-solid fa-network-wired text-indigo-600"></i>Telegram 反代
            </h3>
            <div>
              <label class="block text-[11px] text-slate-500 mb-1">自定义 Telegram 镜像反代 URL（可选）</label>
              <input v-model="settings.tgProxyUrl" placeholder="如 https://tg.yourdomain.com" class="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm font-mono outline-none focus:border-indigo-500">
              <p class="mt-1 text-[11px] text-slate-400">留空则直连 t.me。当所在地区访问 t.me 不畅时再填。</p>
            </div>
          </div>

          <div class="bg-white rounded-2xl border border-slate-200 p-4 space-y-3">
            <h3 class="font-bold text-sm text-slate-800 flex items-center gap-2">
              <i class="fa-solid fa-file-arrow-down text-indigo-600"></i>配置导入导出
            </h3>
            <div class="flex flex-wrap gap-2">
              <button @click="exportConfig" class="px-3 py-2 text-xs bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg transition">
                <i class="fa-solid fa-download mr-1"></i>导出当前配置
              </button>
              <label class="px-3 py-2 text-xs bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg transition cursor-pointer">
                <i class="fa-solid fa-upload mr-1"></i>导入配置文件
                <input type="file" accept=".json,application/json" class="hidden" @change="importConfig">
              </label>
              <button @click="resetToDefaults" class="px-3 py-2 text-xs bg-amber-50 hover:bg-amber-100 text-amber-700 rounded-lg transition">
                <i class="fa-solid fa-rotate-left mr-1"></i>恢复出厂配置
              </button>
            </div>
            <p class="text-[11px] text-slate-400">恢复出厂会重新载入内置的全部 TG 频道与插件节点，当前自定义修改将被覆盖（仍需点击保存才真正生效）。</p>
          </div>
        </section>

        <!-- 移动端保存条 -->
        <div class="lg:hidden sticky bottom-0 z-30 bg-white/95 backdrop-blur border border-slate-200 rounded-2xl p-3 safe-bottom shadow-lg">
          <button
            @click="save"
            :disabled="saving"
            class="w-full py-3 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-sm font-semibold transition shadow-md shadow-emerald-500/20 disabled:opacity-50 flex items-center justify-center gap-2"
          >
            <i class="fa-solid" :class="saving ? 'fa-circle-notch fa-spin' : 'fa-floppy-disk'"></i>
            <span>{{ saving ? '保存中…' : '保存配置' }}</span>
          </button>
          <p v-if="dirty" class="mt-1.5 text-[11px] text-amber-600 text-center">有未保存的修改</p>
        </div>
      </div>
    </div>
  </div>

  <!-- 轻量 Toast -->
  <div v-if="toast" class="fixed left-1/2 -translate-x-1/2 bottom-6 z-50 px-4 py-2.5 rounded-xl shadow-lg text-sm text-white flex items-center gap-2 max-w-[90vw]"
    :class="toast.type === 'error' ? 'bg-rose-600' : 'bg-slate-900'">
    <i class="fa-solid" :class="toast.type === 'error' ? 'fa-circle-exclamation' : 'fa-circle-check'"></i>
    <span>{{ toast.msg }}</span>
  </div>
</div>

<script>
  const { createApp, ref, computed, onMounted, watch, nextTick } = Vue;

  const TOKEN_KEY = 'pansou_admin_token';

  const CLOUDS = ${CLOUDS_JSON};

  /** 插件配置被清空时的兜底节点地址 */
  const FALLBACK_PLUGIN_ENDPOINT = ${JSON.stringify(FALLBACK_PLUGIN_ENDPOINT)};
  /** 兜底第三方节点配置（Node 侧 JSON 注入，浏览器作用域里没有 DEFAULT_PLUGINS） */
  const DEFAULT_AGGREGATE_NODE = ${DEFAULT_AGGREGATE_NODE_JSON};

  /** V1.3：开放 API 文档数据 */
  const API_GROUPS = ${API_GROUPS_JSON};

  const CACHE_MODES = [
    { key: 'memory', name: '仅内存缓存（推荐）', desc: '频道搜索结果不写入 KV，只保留在当前边缘节点内存中，重复搜索依然秒回。KV 仅用于存后台配置与插件结果缓存（每个关键词 1 个键、6 小时），单次搜索的 KV 写入从 140+ 降到 1，彻底避免写额度被打满。' },
    { key: 'kv', name: 'KV 缓存', desc: '按「频道 × 关键词」写入 KV，可跨边缘节点共享缓存，命中率最高。但单次搜索会产生 140+ 次 KV 写入，仅在付费或自建 KV 时开启。' },
    { key: 'off', name: '不缓存', desc: '每次都实时抓取，KV 写入为 0，最省配额但最慢，适合调试或数据准确性优先的场景。' }
  ];

  const app = createApp({
    setup() {
      const authed = ref(false);
      const loggingIn = ref(false);
      const loginError = ref('');
      const pwdInput = ref('');
      const showPwd = ref(false);
      const saving = ref(false);
      const kvBound = ref(true);
      const activeTab = ref('overview');
      const toast = ref(null);
      const dirty = ref(false);

      const settings = ref({
        channels: [],
        plugins: [],
        concurrency: 6,
        cacheTtl: 300,
        maxChannelsPerSearch: 8,
        tgProxyUrl: '',
        resultCacheMode: 'memory',
        visibleCloudTypes: [],
        showAutoCheck: true,
        // V1.3
        frontendAuthEnabled: false,
        frontendPasswordMode: 'reuse',
        admin_password_hashed: false,
        admin_password_from_env: false,
        frontend_password_set: false
      });

      const newPassword = ref('');
      const newFrontendPassword = ref('');
      /** 点过「清除独立密码」后置位，保存时告诉服务端清空前台密码哈希 */
      const clearFrontendPwd = ref(false);
      const channelFilter = ref('');
      const batchText = ref('');
      const batchEnableAll = ref(true);

      /* ---- 插件源（V1.3：每个源独立一行） ---- */
      const pluginFilter = ref('');
      const pluginSources = ref([]);
      const pluginTesting = ref(false);
      const pluginTestResult = ref(null);
      /** 插件源批量导入：支持英文逗号 / 换行 / 分号分隔 */
      const pluginBatchText = ref('');
      // 默认「导入即启用」：用户是主动粘一批源进来用的，导完还全部关着会很反直觉。
      // 不想启用的话，旁边的复选框就在导入按钮左边。
      const pluginBatchEnable = ref(true);
      /** 聚合节点地址：不在界面展示，保存时原样带回，避免弄丢已有节点地址 */
      let pluginEndpoint = FALLBACK_PLUGIN_ENDPOINT;

      const versionLabel = ${JSON.stringify(APP_VERSION_LABEL)};
      const appName = ${JSON.stringify(APP_NAME)};

      const tabs = computed(() => [
        { key: 'overview', name: '总览', icon: 'fa-gauge-high' },
        { key: 'channels', name: 'TG 频道', icon: 'fa-bullhorn', badge: settings.value.channels.length },
        { key: 'plugins', name: '搜索插件', icon: 'fa-plug', badge: pluginSources.value.length },
        { key: 'display', name: '结果展示', icon: 'fa-filter' },
        { key: 'api', name: 'API 接口', icon: 'fa-code' },
        { key: 'system', name: '系统设置', icon: 'fa-gear' }
      ]);

      const allClouds = ref(CLOUDS);
      const orderedCloudKeys = computed(() => {
        const visible = settings.value.visibleCloudTypes || [];
        const rest = CLOUDS.map(c => c.key).filter(k => visible.indexOf(k) < 0);
        return visible.concat(rest);
      });

      const isCloudVisible = (key) => (settings.value.visibleCloudTypes || []).indexOf(key) >= 0;
      const cloudLabelOf = (key) => {
        const hit = CLOUDS.filter(c => c.key === key)[0];
        return hit ? hit.label : key;
      };
      const cloudBadgeOf = (key) => {
        const hit = CLOUDS.filter(c => c.key === key)[0];
        return hit ? hit.badge : 'others';
      };
      const visibleCloudNamesText = computed(() => {
        const list = (settings.value.visibleCloudTypes || []).map(cloudLabelOf);
        return list.length ? list.join('、') : '（无，网页端将不展示任何分类）';
      });

      const cacheModeLabel = computed(() => {
        const hit = CACHE_MODES.filter(m => m.key === settings.value.resultCacheMode)[0];
        return hit ? hit.name.replace('（推荐）', '') : '仅内存缓存';
      });

      const filteredChannels = computed(() => {
        const kw = channelFilter.value.trim().toLowerCase();
        if (!kw) return settings.value.channels;
        return settings.value.channels.filter(c =>
          c.name.toLowerCase().indexOf(kw) >= 0 || (c.description || '').toLowerCase().indexOf(kw) >= 0
        );
      });

      const enabledChannelsCount = computed(() => settings.value.channels.filter(c => c.enabled).length);

      /* ---- 插件源（V1.3） ---- */
      const enabledPluginCount = computed(() => pluginSources.value.filter(s => s.enabled).length);

      const filteredPluginSources = computed(() => {
        const kw = pluginFilter.value.trim().toLowerCase();
        if (!kw) return pluginSources.value;
        return pluginSources.value.filter(
          s => s.id.toLowerCase().indexOf(kw) >= 0 || (s.label || '').toLowerCase().indexOf(kw) >= 0
        );
      });

      /* ---- 安全状态 ---- */
      // 后台密码是否已哈希存储（来自接口下发的状态位，哈希本身不会出服务器）
      const passwordHashed = computed(() => !!settings.value.admin_password_hashed);
      const frontendAuthOn = computed(() => settings.value.frontendAuthEnabled === true);
      const siteOrigin = typeof location !== 'undefined' ? location.origin : '';

      const showToast = (msg, type) => {
        toast.value = { msg, type: type || 'ok' };
        setTimeout(() => { toast.value = null; }, 2600);
      };

      /* ---------------- 登录 ---------------- */
      const fetchSettings = async (token) => {
        const res = await fetch('/api/admin/settings', { headers: { Authorization: 'Bearer ' + token } });
        if (!res.ok) return null;
        const data = await res.json();
        return data;
      };

      /**
       * 从「聚合节点配置 + 源备注」还原出后台要展示的插件源列表（V1.3）。
       * 节点地址本身不进界面，只在内存里带着走，保存时原样写回。
       */
      /**
       * 插件源列表（V1.4 重构）：**一行 = 一个插件条目**。
       *
       * 旧版把第三方聚合节点里的 89 个子源展开成 89 行——那种模型下所有源共用一次
       * 节点请求、单独关掉一个源并不会减少请求数，开关其实是"假的"。
       * 现在原生源（type='native'）各自是一次独立的抓取，逐个开关才有真实含义。
       */
      const buildPluginSources = (plugins, labels) => {
        const list = Array.isArray(plugins) ? plugins : [];
        let endpoint = '';
        list.forEach(p => {
          if (!endpoint && p && p.apiEndpoint) endpoint = p.apiEndpoint;
        });

        const sources = [];
        for (const p of list) {
          if (!p || !p.id) continue;
          const type = p.type || 'pansou';

          /*
           * 第三方聚合节点：把 pluginIds 里的子源**展开成一行一个**。
           *
           * 这里的「一行」是**界面粒度**，不是请求粒度 —— 保存时会按 parentId
           * 合并回一条节点配置（见 save）。这样既能在界面上逐个开关/删除/批量导入，
           * 又不会让运行时按行发请求（20 个子源 = 20 次 HTTP 是灾难）。
           */
          if (type === 'pansou' && Array.isArray(p.pluginIds) && p.pluginIds.length > 0) {
            const nodeOn = p.enabled !== false;
            // 子源自己的开关存在 disabledPluginIds 里（pluginIds 保留全集，否则
            // 关掉的源在后台就再也显示不出来、也就没法重新打开）
            const nodeOff = new Set(
              (Array.isArray(p.disabledPluginIds) ? p.disabledPluginIds : []).map(x => String(x))
            );
            for (const rawId of p.pluginIds) {
              const childId = String(rawId || '').trim();
              if (!childId) continue;
              sources.push({
                id: childId,
                label: (labels && labels[childId]) || '',
                // 节点整体停用时，它的子源在界面上也应显示为关闭
                enabled: nodeOn && !nodeOff.has(childId),
                type: 'pansou',
                name: childId,
                desc: '第三方节点子源 · ' + (p.name || p.id),
                parentId: p.id,
                parentBase: p,
                base: null
              });
            }
            continue;
          }

          sources.push({
            id: p.id,
            label: (labels && labels[p.id]) || '',
            enabled: p.enabled !== false,
            type,
            name: p.name || p.id,
            desc:
              p.desc ||
              (type === 'native'
                ? 'Worker 内原生抓取'
                : type === 'custom'
                  ? '自定义 REST API'
                  : '第三方聚合节点'),
            parentId: null,
            parentBase: null,
            // 记录原始配置，保存时原样回写（保住 endpoint / pluginIds / 自定义字段）
            base: p
          });
        }

        return { endpoint: endpoint || FALLBACK_PLUGIN_ENDPOINT, sources };
      };

      const applySettings = (data) => {
        if (!Array.isArray(data.plugins)) data.plugins = [];
        if (!Array.isArray(data.channels)) data.channels = [];
        if (!Array.isArray(data.visibleCloudTypes)) {
          data.visibleCloudTypes = CLOUDS.filter(c => c.defaultVisible).map(c => c.key);
        }
        if (!data.resultCacheMode) data.resultCacheMode = 'memory';
        if (typeof data.showAutoCheck !== 'boolean') data.showAutoCheck = true;
        // V1.3：前台访问密码
        if (typeof data.frontendAuthEnabled !== 'boolean') data.frontendAuthEnabled = false;
        if (data.frontendPasswordMode !== 'custom') data.frontendPasswordMode = 'reuse';

        const derived = buildPluginSources(data.plugins, data.pluginSourceLabels);
        pluginEndpoint = derived.endpoint;
        pluginSources.value = derived.sources;

        settings.value = data;
        kvBound.value = data.kv_bound !== false;
        newPassword.value = '';
        newFrontendPassword.value = '';
        clearFrontendPwd.value = false;
        pluginTestResult.value = null;
        // 用 markClean 而不是直接 dirty.value = false —— 见「脏标记」一节的说明
        markClean();
      };

      const login = async () => {
        const token = pwdInput.value.trim();
        if (!token) return;
        loggingIn.value = true;
        loginError.value = '';
        try {
          const data = await fetchSettings(token);
          if (data) {
            applySettings(data);
            authed.value = true;
            localStorage.setItem(TOKEN_KEY, token);
          } else {
            loginError.value = '密码错误，请重新输入';
          }
        } catch (e) {
          loginError.value = '无法连接服务，请检查网络';
        } finally {
          loggingIn.value = false;
        }
      };

      const logout = () => {
        localStorage.removeItem(TOKEN_KEY);
        authed.value = false;
        pwdInput.value = '';
        activeTab.value = 'overview';
      };

      const currentToken = () => pwdInput.value.trim() || localStorage.getItem(TOKEN_KEY) || '';

      /* ---------------- 保存 ---------------- */
      const save = async () => {
        const token = currentToken();
        if (!token) { showToast('登录状态已失效，请重新登录', 'error'); return; }

        saving.value = true;
        try {
          // V1.4：插件源列表 → 还原成插件配置。
          //
          // 界面上一行 = 一个源，但运行时不该按行发请求：第三方聚合节点的一次 HTTP
          // 就能返回它全部子源的结果，拆成 20 行发 20 次是灾难。所以这里按 parentId
          // 把子源行**归并回一条节点配置**（pluginIds = 该节点下所有子源行），
          // 节点整体的 enabled = 「是否还有至少一个子源开着」。
          // 原生源没有 parentId，各自独立成条。
          const labels = {};
          pluginSources.value.forEach(s => {
            if (s.label && s.label.trim()) labels[s.id] = s.label.trim();
          });

          const plugins = [];
          const nodeByParent = {};
          pluginSources.value.forEach(s => {
            if (s.parentId) {
              let node = nodeByParent[s.parentId];
              if (!node) {
                const base = s.parentBase || {
                  id: s.parentId,
                  name: s.parentId,
                  type: 'pansou',
                  apiEndpoint: pluginEndpoint
                };
                node = { ...base, pluginIds: [], disabledPluginIds: [], enabled: false };
                nodeByParent[s.parentId] = node;
                plugins.push(node);
              }
              node.pluginIds.push(s.id);
              // 单独关掉的子源记进停用集：它们仍要在界面上显示，但不参与请求
              if (!s.enabled) node.disabledPluginIds.push(s.id);
              // 任一子源开着，节点就得开着（子源粒度才是真正的开关）
              if (s.enabled) node.enabled = true;
              return;
            }
            const base = s.base || {
              id: s.id,
              name: s.name || s.id,
              type: s.type === 'native' ? 'native' : 'pansou',
              apiEndpoint: s.type === 'native' ? undefined : pluginEndpoint,
              pluginIds: []
            };
            plugins.push({ ...base, enabled: !!s.enabled });
          });

          const payload = {
            channels: settings.value.channels,
            plugins,
            pluginSourceLabels: labels,
            concurrency: Number(settings.value.concurrency) || 6,
            maxChannelsPerSearch: Number(settings.value.maxChannelsPerSearch) || 8,
            cacheTtl: Number(settings.value.cacheTtl) || 300,
            tgProxyUrl: settings.value.tgProxyUrl || '',
            resultCacheMode: settings.value.resultCacheMode || 'memory',
            visibleCloudTypes: settings.value.visibleCloudTypes || [],
            showAutoCheck: settings.value.showAutoCheck !== false,
            frontendAuthEnabled: settings.value.frontendAuthEnabled === true,
            frontendPasswordMode: settings.value.frontendPasswordMode || 'reuse'
          };
          if (newPassword.value.trim()) payload.adminPassword = newPassword.value.trim();
          if (newFrontendPassword.value.trim()) payload.frontendPassword = newFrontendPassword.value.trim();
          if (clearFrontendPwd.value) payload.clearFrontendPassword = true;

          const res = await fetch('/api/admin/settings', {
            method: 'POST',
            headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
          });
          const data = await res.json().catch(() => ({}));

          if (res.ok && data.code === 0) {
            if (payload.adminPassword) {
              // 服务端存的是哈希，浏览器这边仍用明文当 Bearer 凭据
              localStorage.setItem(TOKEN_KEY, payload.adminPassword);
              pwdInput.value = payload.adminPassword;
              settings.value.admin_password_hashed = true;
              settings.value.admin_password_from_env = false;
              newPassword.value = '';
            }
            if (payload.frontendPassword) {
              settings.value.frontend_password_set = true;
              newFrontendPassword.value = '';
              clearFrontendPwd.value = false;
            }
            if (payload.clearFrontendPassword) {
              settings.value.frontend_password_set = false;
              settings.value.frontendPasswordMode = 'reuse';
              clearFrontendPwd.value = false;
            }
            // 保存成功：把状态落定为「已保存」。
            // 上面几行刚改过 settings.value（哈希/密码状态位），异步 watcher
            // 会把 dirty 又翻成 true，用户看到「有未保存的修改」就以为没保存成功。
            markClean();
            showToast('配置已保存并生效');
          } else {
            showToast(data.message || '保存失败，请检查 KV 绑定', 'error');
          }
        } catch (e) {
          showToast('保存异常，请重试', 'error');
        } finally {
          saving.value = false;
        }
      };

      /* ---------------- 频道 ---------------- */
      const toggleAllChannels = (on) => {
        settings.value.channels.forEach(c => { c.enabled = on; });
        dirty.value = true;
      };

      const addChannel = () => {
        const raw = prompt('请输入 Telegram 频道 username（无需 @ 或 https://t.me/）：');
        if (!raw || !raw.trim()) return;
        const clean = raw.trim().replace(/^@/, '').replace(/^https?:\\/\\/t\\.me\\/(s\\/)?/i, '').replace(/[/?#].*$/, '');
        if (!/^[A-Za-z0-9_]{4,64}$/.test(clean)) { showToast('频道名格式不合法', 'error'); return; }
        if (settings.value.channels.some(c => c.name.toLowerCase() === clean.toLowerCase())) { showToast('该频道已存在', 'error'); return; }
        settings.value.channels.unshift({ name: clean, enabled: true, priority: 2, description: '手动添加' });
        dirty.value = true;
      };

      const removeChannel = (ch) => {
        if (!confirm('确定删除频道 @' + ch.name + ' 吗？')) return;
        settings.value.channels = settings.value.channels.filter(c => c !== ch);
        dirty.value = true;
      };

      /**
       * 批量导入 TG 频道。
       * 分隔符与「插件源批量导入」保持一致：英文逗号 / 换行 / 分号 / 中文逗号分号 / 空格，
       * 允许整段粘贴 @name 或 t.me 链接；自动去重、剔除非法名，并回显跳过数量。
       */
      const doBatchImport = () => {
        const raw = batchText.value.trim();
        if (!raw) { showToast('请先粘贴要导入的频道', 'error'); return; }
        const tokens = raw.split(/[\\r\\n,;，；\\s]+/).map(s => s.trim()).filter(Boolean);
        let added = 0, dup = 0, bad = 0;
        tokens.forEach(tok => {
          const clean = tok.replace(/^@/, '').replace(/^https?:\\/\\/t\\.me\\/(s\\/)?/i, '').replace(/[/?#].*$/, '').trim();
          if (!clean || !/^[A-Za-z0-9_]{4,64}$/.test(clean)) { bad++; return; }
          if (settings.value.channels.some(c => c.name.toLowerCase() === clean.toLowerCase())) { dup++; return; }
          settings.value.channels.unshift({ name: clean, enabled: batchEnableAll.value, priority: 2, description: '批量导入' });
          added++;
        });
        batchText.value = '';
        if (added > 0) dirty.value = true;
        if (added === 0) {
          showToast('没有可导入的频道' + (dup ? '（' + dup + ' 个已存在）' : '') + (bad ? '（' + bad + ' 个格式不合法）' : ''), 'error');
          return;
        }
        showToast('成功导入 ' + added + ' 个频道，记得保存' + (dup ? '（跳过 ' + dup + ' 个已存在）' : ''));
      };

      /* ---------------- 插件源（V1.4：一行 = 一个插件条目） ---------------- */
      const toggleAllPlugins = (on) => {
        pluginSources.value.forEach(s => { s.enabled = on; });
        dirty.value = true;
      };

      const resetPluginSources = () => {
        // 「回到内置默认」= 原生源全开、第三方源全关、清空原生源备注。
        // 之所以顺手关掉第三方：V1.4 的目标就是搜索不再依赖第三方站点。
        //
        // 注意这里按 **type** 判定而不是按 id === 'pansou_aggregate'：
        // 第三方节点的子源展开后，每行的 id 是子源自己的（如 hunhepan），
        // 节点 id 根本不是一个行，按 id 判会一个都关不掉。
        pluginSources.value.forEach(s => {
          if (s.type === 'native') {
            s.enabled = true;
            s.label = '';
          } else {
            s.enabled = false;
          }
        });
        dirty.value = true;
        showToast('已恢复为「原生源全开 / 第三方源全关」，记得点保存');
      };

      /**
       * 清洗用户输入的源 ID。
       *
       * 允许直接粘链接（取最后一段路径），也允许带 @ 或参数，最后只保留
       * 字母 / 数字 / 下划线 / 点 / 连字符——这是节点侧认的字符集，
       * 脏字符会让请求静默返回空。
       */
      const cleanSourceId = (raw) => {
        let s = String(raw == null ? '' : raw).trim();
        if (!s) return '';
        s = s.replace(/^@/, '').replace(/^https?:\\/\\//i, '');
        if (s.indexOf('/') >= 0) s = s.split('/').filter(Boolean).pop() || '';
        s = s.replace(/[?#].*$/, '');
        return s.replace(/[^A-Za-z0-9_.-]/g, '');
      };

      /**
       * 找一个「能挂第三方源」的节点，返回 { parentId, parentBase }。
       *
       * 优先级（顺序不能颠倒）：
       *   ① 列表里已有子源的节点 —— 直接挂上去（默认是 pansou_aggregate）；
       *   ② 列表里那个**还没有任何子源**的第三方节点行 —— 挂给它，别去新建；
       *   ③ 内置默认里的第三方节点 —— 子源被删空后能靠它把节点重建回来；
       *   ④ 都没有就现造一个 pansou_custom。
       */
      const resolvePansouParent = () => {
        const child = pluginSources.value.find(s => s.parentId && s.parentBase);
        if (child) return { parentId: child.parentId, parentBase: child.parentBase };

        const emptyNode = pluginSources.value.find(
          s => !s.parentId && s.base && (s.base.type || 'pansou') !== 'native' && s.base.id
        );
        if (emptyNode) return { parentId: emptyNode.id, parentBase: emptyNode.base };

        const fallback = DEFAULT_AGGREGATE_NODE;
        if (fallback && fallback.id) return { parentId: fallback.id, parentBase: fallback };

        return {
          parentId: 'pansou_custom',
          parentBase: {
            id: 'pansou_custom',
            name: '自定义聚合节点',
            type: 'pansou',
            apiEndpoint: pluginEndpoint,
            enabled: false,
            pluginIds: []
          }
        };
      };

      /** 把 id 作为一个第三方子源挂到节点下；重复 / 非法返回 false */
      const attachPansouSource = (id, enabled) => {
        if (!id) return false;
        if (pluginSources.value.some(s => s.id === id)) return false;
        const parent = resolvePansouParent();
        const parentName = (parent.parentBase && (parent.parentBase.name || parent.parentBase.id)) || parent.parentId;
        // 插在同节点最后一个子源之后，界面上聚成一块
        let insertAt = pluginSources.value.length;
        pluginSources.value.forEach((s, i) => {
          if (s.parentId === parent.parentId) insertAt = i + 1;
        });
        pluginSources.value.splice(insertAt, 0, {
          id,
          label: '',
          enabled: !!enabled,
          type: 'pansou',
          name: id,
          desc: '第三方节点子源 · ' + parentName,
          parentId: parent.parentId,
          parentBase: parent.parentBase,
          base: null
        });

        /*
         * 这个节点原来在界面上是「一行空节点」（还没有任何子源），现在它有子源了，
         * 那一行必须摘掉 —— 否则保存时同一个 id 会落盘成两条配置
         * （一条 pluginIds 为空、一条带着子源），运行时会把节点白白请求两遍。
         */
        const isPlaceholder = r => !r.parentId && r.base && r.base.id === parent.parentId;
        if (pluginSources.value.some(isPlaceholder)) {
          pluginSources.value = pluginSources.value.filter(r => !isPlaceholder(r));
        }
        return true;
      };

      const addPluginSource = () => {
        const raw = prompt('插件源 ID（第三方节点支持的源标识，如 clxiong）：');
        if (!raw || !raw.trim()) return;
        const id = cleanSourceId(raw);
        if (!id) { showToast('源 ID 格式不合法', 'error'); return; }
        if (!attachPansouSource(id, true)) { showToast('该源已在列表中', 'error'); return; }
        dirty.value = true;
        showToast('已添加「' + id + '」，记得保存');
      };

      /** 删除单个插件源（原生源整条移除；第三方子源从所属节点里摘掉） */
      const removePluginSource = (src) => {
        if (!src) return;
        const isNative = src.type === 'native';
        const tip = isNative
          ? '确定删除原生源「' + src.id + '」吗？\\n\\n删除后需点击保存才生效；要找回它请用「恢复出厂配置」。'
          : '确定删除第三方源「' + src.id + '」吗？' +
            (src.parentId ? '\\n\\n它属于节点 ' + src.parentId + '，删除只是从这个节点里摘掉。' : '');
        if (!confirm(tip)) return;
        pluginSources.value = pluginSources.value.filter(s => s !== src);
        dirty.value = true;
        // 子源被删空 → 保存时该节点配置不会再生效（见 save 的按 parentId 归并）
        const left = src.parentId ? pluginSources.value.filter(s => s.parentId === src.parentId).length : -1;
        if (left === 0) {
          showToast('已删除「' + src.id + '」，节点已无子源，保存后一并移除');
        } else {
          showToast('已删除「' + src.id + '」，记得保存');
        }
      };

      /**
       * 批量导入第三方插件源：支持英文逗号、中文逗号、分号、换行、空格分隔。
       * 全部挂到同一个节点下（有子源就用现有节点，否则用内置默认节点）。
       */
      const doPluginBatchImport = () => {
        const raw = pluginBatchText.value.trim();
        if (!raw) { showToast('请先粘贴要导入的源 ID', 'error'); return; }
        const tokens = raw.split(/[\\r\\n,;，；\\s]+/).map(t => t.trim()).filter(Boolean);
        const seen = {};
        pluginSources.value.forEach(s => { seen[s.id] = true; });
        let ok = 0;
        let dup = 0;
        let bad = 0;
        tokens.forEach(tok => {
          const id = cleanSourceId(tok);
          if (!id) { bad++; return; }
          if (seen[id]) { dup++; return; }
          if (attachPansouSource(id, pluginBatchEnable.value)) {
            seen[id] = true;
            ok++;
          } else {
            dup++;
          }
        });
        pluginBatchText.value = '';
        dirty.value = true;
        showToast(
          '导入 ' + ok + ' 个源' +
            (dup ? '，跳过重复 ' + dup + ' 个' : '') +
            (bad ? '，忽略无效 ' + bad + ' 项' : '') +
            '，记得保存'
        );
      };

      /**
       * 测试当前已启用的插件源。
       *
       * 注意「请求单元」和界面上的「行」不是一回事：原生源一行一次抓取，
       * 而第三方节点名下的 N 个子源共用**一次** HTTP（后端按节点抓一次、
       * 一次带回全部 pluginIds 的结果）。所以这里先把已启用行折成请求单元
       * （原生源算自己，第三方子源算它所属的节点）再去测，否则会拿子源 id
       * 去问后端、一个都匹配不上。
       */
      const testPlugins = async () => {
        const units = [];
        const seenUnit = {};
        pluginSources.value.forEach(s => {
          if (!s.enabled) return;
          const unitId = s.parentId || s.id;
          if (seenUnit[unitId]) return;
          seenUnit[unitId] = true;
          units.push(unitId);
        });
        if (units.length === 0) {
          pluginTestResult.value = { ok: false, text: '没有启用任何插件源' };
          return;
        }
        pluginTesting.value = true;
        pluginTestResult.value = null;
        try {
          const r = await fetch(
            '/api/debug/plugin?rounds=1&kw=' + encodeURIComponent('流浪地球') +
              '&ids=' + encodeURIComponent(units.join(',')),
            { headers: { Authorization: 'Bearer ' + currentToken() } }
          );
          const d = await r.json();
          const rows = Array.isArray(d.results) ? d.results : [];
          if (rows.length === 0) {
            pluginTestResult.value = { ok: false, text: '没有匹配的插件源' };
            return;
          }
          const okCount = rows.filter(x => x.ok).length;
          const parts = rows.map(x => {
            // 第三方节点：把「这一次请求覆盖了哪几个子源」说清楚
            const cover =
              x.type === 'native' || !x.covered ? '' : '（含 ' + x.covered + ' 个子源）';
            if (x.ok) {
              return x.id + cover + (x.total != null ? ' ' + x.total + ' 条' : ' 通') + '（' + x.ms + 'ms）';
            }
            return (
              x.id + cover + ' 失败' +
              (x.error ? '：' + String(x.error).slice(0, 24) : x.status ? ' HTTP ' + x.status : '')
            );
          });
          pluginTestResult.value = {
            ok: okCount === rows.length,
            text: '通过 ' + okCount + '/' + rows.length + ' · ' + parts.join(' · ')
          };
        } catch (e) {
          pluginTestResult.value = { ok: false, text: '请求异常' };
        } finally {
          pluginTesting.value = false;
        }
      };

      const clearFrontendPassword = () => {
        newFrontendPassword.value = '';
        clearFrontendPwd.value = true;
        showToast('保存后将清除独立密码，并退回「复用后台密码」');
      };

      const copyText = (text, msg) => {
        if (!text) return;
        navigator.clipboard
          .writeText(text)
          .then(() => showToast(msg || '已复制'))
          .catch(() => showToast('复制失败，请手动选取', 'error'));
      };

      /* ---------------- 网盘展示 ---------------- */
      const toggleCloud = (key) => {
        const list = (settings.value.visibleCloudTypes || []).slice();
        const i = list.indexOf(key);
        if (i >= 0) list.splice(i, 1);
        else list.push(key);
        settings.value.visibleCloudTypes = list;
        dirty.value = true;
      };

      const selectAllClouds = (on) => {
        settings.value.visibleCloudTypes = on ? CLOUDS.map(c => c.key) : [];
        dirty.value = true;
      };

      const selectMainClouds = () => {
        settings.value.visibleCloudTypes = CLOUDS.filter(c => c.defaultVisible).map(c => c.key);
        dirty.value = true;
      };

      const moveCloud = (key, delta) => {
        const list = (settings.value.visibleCloudTypes || []).slice();
        const i = list.indexOf(key);
        const j = i + delta;
        if (i < 0 || j < 0 || j >= list.length) return;
        const tmp = list[i];
        list[i] = list[j];
        list[j] = tmp;
        settings.value.visibleCloudTypes = list;
        dirty.value = true;
      };

      /* ---------------- 导入导出 / 重置 ---------------- */
      const exportConfig = () => {
        const data = {
          version: versionLabel,
          exportedAt: new Date().toISOString(),
          channels: settings.value.channels,
          // V1.3：导出插件源开关 + 备注（不含节点地址，导入端沿用本地已存地址）
          pluginSources: pluginSources.value.map(s => ({ id: s.id, enabled: s.enabled, label: s.label || '' })),
          concurrency: settings.value.concurrency,
          cacheTtl: settings.value.cacheTtl,
          maxChannelsPerSearch: settings.value.maxChannelsPerSearch,
          tgProxyUrl: settings.value.tgProxyUrl,
          resultCacheMode: settings.value.resultCacheMode,
          visibleCloudTypes: settings.value.visibleCloudTypes,
          showAutoCheck: settings.value.showAutoCheck,
          frontendAuthEnabled: settings.value.frontendAuthEnabled === true,
          frontendPasswordMode: settings.value.frontendPasswordMode || 'reuse'
        };
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'pansou-config-' + Date.now() + '.json';
        a.click();
        URL.revokeObjectURL(a.href);
        showToast('配置已导出');
      };

      const importConfig = (ev) => {
        const file = ev.target.files && ev.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = () => {
          try {
            const d = JSON.parse(String(reader.result));
            if (Array.isArray(d.channels) && d.channels.length) settings.value.channels = d.channels;
            // 兼容两种导入格式：V1.3 的 pluginSources，或旧版的 plugins
            if (Array.isArray(d.pluginSources)) {
              const byId = {};
              d.pluginSources.forEach(s => { if (s && s.id) byId[s.id] = s; });
              pluginSources.value.forEach(s => {
                if (byId[s.id]) {
                  s.enabled = byId[s.id].enabled !== false;
                  s.label = byId[s.id].label || '';
                }
              });
            } else if (Array.isArray(d.plugins)) {
              const derived = buildPluginSources(d.plugins, d.pluginSourceLabels);
              pluginSources.value = derived.sources;
            }
            if (typeof d.resultCacheMode === 'string') settings.value.resultCacheMode = d.resultCacheMode;
            if (Array.isArray(d.visibleCloudTypes)) settings.value.visibleCloudTypes = d.visibleCloudTypes;
            if (typeof d.frontendAuthEnabled === 'boolean') settings.value.frontendAuthEnabled = d.frontendAuthEnabled;
            if (d.frontendPasswordMode === 'custom' || d.frontendPasswordMode === 'reuse') {
              settings.value.frontendPasswordMode = d.frontendPasswordMode;
            }
            dirty.value = true;
            showToast('配置已载入，请点击保存生效');
          } catch (e) {
            showToast('配置文件解析失败', 'error');
          }
        };
        reader.readAsText(file);
        ev.target.value = '';
      };

      const resetToDefaults = async () => {
        if (!confirm('确定恢复出厂配置吗？\\n会重新载入内置的全部 TG 频道与插件节点，当前自定义修改将被覆盖。')) return;
        try {
          const res = await fetch('/api/admin/defaults', { headers: { Authorization: 'Bearer ' + currentToken() } });
          if (!res.ok) { showToast('获取默认配置失败', 'error'); return; }
          const d = await res.json();
          settings.value.channels = d.channels || [];
          settings.value.maxChannelsPerSearch = d.maxChannelsPerSearch || 8;
          if (Array.isArray(d.visibleCloudTypes)) settings.value.visibleCloudTypes = d.visibleCloudTypes;
          if (d.resultCacheMode) settings.value.resultCacheMode = d.resultCacheMode;
          // 插件源一并恢复为「内置全开」
          const derived = buildPluginSources(d.plugins, null);
          pluginEndpoint = derived.endpoint;
          pluginSources.value = derived.sources;
          dirty.value = true;
          showToast('已载入内置配置，请点击保存生效');
        } catch (e) {
          showToast('载入失败', 'error');
        }
      };

      /* ---------------- 脏标记 ----------------
       * ⚠️ 这里的 watcher 是**异步**触发的（Vue 默认 flush: 'pre'）：
       * 赋值语句执行完才轮到回调。所以「先 settings.value = data，紧接着
       * dirty.value = false」是没用的 —— 回调随后又把 dirty 翻回 true，
       * 表现为①页面一加载就恒显「有未保存的修改」；②保存成功后提示又冒出来，
       * 用户会以为「保存没生效 / 无法保存」。
       * 正确做法：赋值期间挂起 watcher，并用 nextTick 在回调跑完之后再落定。
       */
      let hydrating = false;
      watch(settings, () => { if (hydrating) return; dirty.value = true; }, { deep: true });

      /** 把当前配置认定为「已保存」状态（在 applySettings / save 成功后调用） */
      const markClean = () => {
        hydrating = true;
        dirty.value = false;
        nextTick(() => { hydrating = false; dirty.value = false; });
      };

      onMounted(async () => {
        const token = localStorage.getItem(TOKEN_KEY);
        if (token) {
          pwdInput.value = token;
          loggingIn.value = true;
          try {
            const data = await fetchSettings(token);
            if (data) { applySettings(data); authed.value = true; }
            else localStorage.removeItem(TOKEN_KEY);
          } catch (e) { /* 网络异常时留在登录页 */ }
          loggingIn.value = false;
        }
      });

      return {
        authed, loggingIn, loginError, pwdInput, showPwd, login, logout,
        saving, kvBound, activeTab, tabs, settings, toast, dirty,
        newPassword, newFrontendPassword, clearFrontendPassword,
        channelFilter, batchText, batchEnableAll,
        allClouds, orderedCloudKeys, isCloudVisible, cloudLabelOf, cloudBadgeOf, visibleCloudNamesText,
        cacheModes: CACHE_MODES, cacheModeLabel,
        filteredChannels, enabledChannelsCount,
        toggleAllChannels, addChannel, removeChannel, doBatchImport,
        // V1.4：插件源 / 安全状态 / API 文档
        pluginFilter, pluginSources, pluginTesting, pluginTestResult,
        pluginBatchText, pluginBatchEnable,
        filteredPluginSources, enabledPluginCount,
        toggleAllPlugins, resetPluginSources, addPluginSource, removePluginSource,
        doPluginBatchImport, testPlugins,
        passwordHashed, frontendAuthOn, siteOrigin, copyText, apiGroups: API_GROUPS,
        toggleCloud, selectAllClouds, selectMainClouds, moveCloud,
        exportConfig, importConfig, resetToDefaults, save,
        versionLabel, appName
      };
    }
  });

  if (location.search.indexOf('debug=1') >= 0) window.__pansouAdmin = app;
  app.mount('#app');
</script>
</body>
</html>
`;

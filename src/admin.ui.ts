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
import { APP_VERSION_LABEL, APP_NAME } from './version';

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
              <div class="text-[11px] text-slate-400 mb-1">启用插件</div>
              <div class="text-2xl font-bold text-slate-800">{{ enabledPluginsCount }}<span class="text-sm font-normal text-slate-400">/{{ settings.plugins.length }}</span></div>
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
                <span class="text-slate-500">单次搜索插件上限</span>
                <span class="font-mono text-slate-700">{{ settings.maxPluginsPerSearch }}</span>
              </div>
            </div>
            <p class="mt-3 text-[11px] text-slate-400 leading-relaxed">
              说明：全站频道会由前端自动拆片并发调度，因此「频道总数」可以远超单次并发数，不影响覆盖率。
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

        <!-- ---------------- 插件 ---------------- -->
        <section v-if="activeTab === 'plugins'" class="space-y-3">
          <div class="bg-white rounded-2xl border border-slate-200 p-3 sm:p-4 flex flex-wrap items-center justify-between gap-3">
            <div class="text-xs text-slate-600">
              启用 <strong class="text-slate-800">{{ enabledPluginsCount }}</strong> / {{ settings.plugins.length }} 个插件
              <span class="text-slate-400 ml-2">（共引用 {{ pluginIdCount }} 个外部子源）</span>
            </div>
            <button @click="addPlugin" class="px-3 py-2 text-xs bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg font-medium transition">
              <i class="fa-solid fa-plus mr-1"></i>添加插件
            </button>
          </div>

          <div v-if="settings.plugins.length === 0" class="bg-white rounded-2xl border border-dashed border-slate-300 p-10 text-center">
            <i class="fa-solid fa-plug-circle-xmark text-3xl text-slate-300 mb-3"></i>
            <p class="text-sm text-slate-500 mb-1">暂无插件配置</p>
            <p class="text-xs text-slate-400 mb-4">插件用于补充 TG 频道覆盖不到的第三方资源站</p>
            <button @click="resetToDefaults" class="px-4 py-2 text-xs bg-amber-50 text-amber-700 hover:bg-amber-100 rounded-lg font-medium transition">载入内置插件节点</button>
          </div>

          <div v-else class="space-y-2.5">
            <div
              v-for="pl in settings.plugins"
              :key="pl.id"
              class="bg-white rounded-2xl border transition overflow-hidden"
              :class="pl.enabled ? 'border-slate-200' : 'border-slate-200 bg-slate-50/60 opacity-75'"
            >
              <!-- 摘要行（默认折叠，信息一眼可见） -->
              <div class="p-3 sm:p-4 flex items-start gap-3">
                <button
                  @click="togglePluginEnabled(pl)"
                  class="mt-0.5 relative inline-flex w-9 h-5 shrink-0 rounded-full transition-colors"
                  :class="pl.enabled ? 'bg-emerald-500' : 'bg-slate-300'"
                  :title="pl.enabled ? '点击停用' : '点击启用'"
                >
                  <span class="absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform" :class="pl.enabled ? 'translate-x-4' : 'translate-x-0'"></span>
                </button>

                <div class="flex-1 min-w-0">
                  <div class="flex flex-wrap items-center gap-1.5">
                    <span class="font-semibold text-sm text-slate-800 truncate">{{ pl.name || pl.id }}</span>
                    <span class="text-[10px] px-1.5 py-0.5 rounded font-mono"
                      :class="pl.type === 'pansou' ? 'bg-blue-50 text-blue-600' : 'bg-violet-50 text-violet-600'">{{ pl.type }}</span>
                    <span v-if="pl.type === 'pansou' && (pl.pluginIds || []).length" class="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-600">
                      {{ (pl.pluginIds || []).length }} 个子源
                    </span>
                  </div>
                  <div class="mt-1 text-[11px] font-mono text-slate-400 truncate" :title="pl.apiEndpoint">{{ pl.apiEndpoint || '（未填写接口地址）' }}</div>

                  <div class="mt-2 flex flex-wrap items-center gap-1.5">
                    <button @click="toggleExpand(pl)" class="px-2.5 py-1 text-[11px] bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-lg transition flex items-center gap-1">
                      <i class="fa-solid text-[10px]" :class="expandedPlugin === pl.id ? 'fa-chevron-up' : 'fa-chevron-down'"></i>
                      {{ expandedPlugin === pl.id ? '收起' : '编辑' }}
                    </button>
                    <button @click="testPlugin(pl)" :disabled="testingPlugin === pl.id" class="px-2.5 py-1 text-[11px] bg-blue-50 hover:bg-blue-100 text-blue-600 rounded-lg transition flex items-center gap-1 disabled:opacity-60">
                      <i class="fa-solid text-[10px]" :class="testingPlugin === pl.id ? 'fa-circle-notch fa-spin' : 'fa-vial'"></i>连通测试
                    </button>
                    <button @click="removePlugin(pl)" class="px-2.5 py-1 text-[11px] text-rose-600 hover:bg-rose-50 rounded-lg transition">删除</button>

                    <span v-if="testResult[pl.id]" class="text-[11px] px-2 py-1 rounded-lg"
                      :class="testResult[pl.id].ok ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700'">
                      {{ testResult[pl.id].text }}
                    </span>
                  </div>
                </div>
              </div>

              <!-- 展开编辑区 -->
              <div v-if="expandedPlugin === pl.id" class="px-3 sm:px-4 pb-4 pt-1 border-t border-slate-100 bg-slate-50/50 space-y-3">
                <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div>
                    <label class="block text-[11px] text-slate-500 mb-1">插件 ID（唯一标识）</label>
                    <input v-model="pl.id" class="w-full px-2.5 py-2 border border-slate-200 rounded-lg text-xs font-mono outline-none focus:border-indigo-500">
                  </div>
                  <div>
                    <label class="block text-[11px] text-slate-500 mb-1">显示名称</label>
                    <input v-model="pl.name" class="w-full px-2.5 py-2 border border-slate-200 rounded-lg text-xs outline-none focus:border-indigo-500">
                  </div>
                </div>

                <div>
                  <label class="block text-[11px] text-slate-500 mb-1">接口地址 Endpoint</label>
                  <input v-model="pl.apiEndpoint" placeholder="https://example.com/api/search" class="w-full px-2.5 py-2 border border-slate-200 rounded-lg text-xs font-mono outline-none focus:border-indigo-500">
                </div>

                <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div>
                    <label class="block text-[11px] text-slate-500 mb-1">插件类型</label>
                    <select v-model="pl.type" class="w-full px-2.5 py-2 border border-slate-200 rounded-lg text-xs outline-none focus:border-indigo-500">
                      <option value="pansou">pansou 兼容聚合节点</option>
                      <option value="custom">通用 REST API</option>
                    </select>
                  </div>
                  <div v-if="pl.type === 'custom'">
                    <label class="block text-[11px] text-slate-500 mb-1">请求方式</label>
                    <select v-model="pl.method" class="w-full px-2.5 py-2 border border-slate-200 rounded-lg text-xs outline-none focus:border-indigo-500">
                      <option value="GET">GET</option>
                      <option value="POST">POST</option>
                    </select>
                  </div>
                </div>

                <div v-if="pl.type === 'pansou'">
                  <label class="block text-[11px] text-slate-500 mb-1">
                    远端子源 ID 列表
                    <span class="text-slate-400">（逗号分隔，留空表示用节点默认的全部源）</span>
                  </label>
                  <textarea
                    :value="(pl.pluginIds || []).join(',')"
                    @input="pl.pluginIds = $event.target.value.split(',').map(s => s.trim()).filter(Boolean)"
                    rows="3"
                    class="w-full px-2.5 py-2 border border-slate-200 rounded-lg text-xs font-mono outline-none focus:border-indigo-500"
                  ></textarea>
                  <p class="mt-1 text-[11px] text-slate-400">当前 {{ (pl.pluginIds || []).length }} 个：{{ (pl.pluginIds || []).join('、') || '（未指定）' }}</p>
                </div>

                <div v-else>
                  <label class="block text-[11px] text-slate-500 mb-1">响应字段映射（可选，留空自动探测）</label>
                  <div class="grid grid-cols-2 md:grid-cols-3 gap-2">
                    <input v-model="pl.responseMapping.resultPath" placeholder="结果路径 如 data.list" class="px-2.5 py-2 border border-slate-200 rounded-lg text-xs font-mono outline-none focus:border-indigo-500">
                    <input v-model="pl.responseMapping.titleField" placeholder="标题字段 title" class="px-2.5 py-2 border border-slate-200 rounded-lg text-xs font-mono outline-none focus:border-indigo-500">
                    <input v-model="pl.responseMapping.urlField" placeholder="链接字段 url" class="px-2.5 py-2 border border-slate-200 rounded-lg text-xs font-mono outline-none focus:border-indigo-500">
                    <input v-model="pl.responseMapping.pwdField" placeholder="提取码字段 password" class="px-2.5 py-2 border border-slate-200 rounded-lg text-xs font-mono outline-none focus:border-indigo-500">
                    <input v-model="pl.responseMapping.contentField" placeholder="内容字段 content" class="px-2.5 py-2 border border-slate-200 rounded-lg text-xs font-mono outline-none focus:border-indigo-500">
                    <input v-model="pl.responseMapping.dateField" placeholder="时间字段 datetime" class="px-2.5 py-2 border border-slate-200 rounded-lg text-xs font-mono outline-none focus:border-indigo-500">
                  </div>
                </div>
              </div>
            </div>
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
                <label class="block text-[11px] text-slate-500 mb-1">单次搜索插件上限</label>
                <input type="number" min="1" max="10" v-model.number="settings.maxPluginsPerSearch" class="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm outline-none focus:border-indigo-500">
              </div>
              <div>
                <label class="block text-[11px] text-slate-500 mb-1">前端单次分片频道数</label>
                <input type="number" min="1" max="10" v-model.number="settings.maxChannelsPerSearch" class="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm outline-none focus:border-indigo-500">
              </div>
            </div>
          </div>

          <div class="bg-white rounded-2xl border border-slate-200 p-4 space-y-4">
            <h3 class="font-bold text-sm text-slate-800 flex items-center gap-2">
              <i class="fa-solid fa-shield-halved text-indigo-600"></i>反代与安全
            </h3>
            <div>
              <label class="block text-[11px] text-slate-500 mb-1">自定义 Telegram 镜像反代 URL（可选）</label>
              <input v-model="settings.tgProxyUrl" placeholder="如 https://tg.yourdomain.com" class="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm font-mono outline-none focus:border-indigo-500">
            </div>
            <div>
              <label class="block text-[11px] text-slate-500 mb-1">修改管理员密码（留空则保持不变）</label>
              <input type="password" v-model="newPassword" autocomplete="new-password" placeholder="新密码" class="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm outline-none focus:border-indigo-500">
              <p class="mt-1 text-[11px] text-slate-400">修改成功后当前会话自动沿用新密码，无需重新登录。</p>
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

          <div class="bg-white rounded-2xl border border-slate-200 p-4">
            <h3 class="font-bold text-sm text-slate-800 mb-2 flex items-center gap-2">
              <i class="fa-solid fa-plug text-indigo-600"></i>批量导入频道
            </h3>
            <textarea v-model="batchText" rows="4" placeholder="channel1, @channel2, https://t.me/s/channel3" class="w-full p-3 border border-slate-200 rounded-xl text-xs font-mono outline-none focus:border-indigo-500"></textarea>
            <div class="mt-2 flex items-center justify-between">
              <label class="flex items-center gap-1.5 text-xs text-slate-600 cursor-pointer">
                <input type="checkbox" v-model="batchEnableAll" class="w-4 h-4 rounded text-indigo-600">
                <span>导入后默认启用</span>
              </label>
              <button @click="doBatchImport" class="px-4 py-2 text-xs bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg font-medium transition">确认导入</button>
            </div>
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
  const { createApp, ref, computed, onMounted, watch } = Vue;

  const TOKEN_KEY = 'pansou_admin_token';

  const CLOUDS = ${CLOUDS_JSON};

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
        maxPluginsPerSearch: 2,
        tgProxyUrl: '',
        resultCacheMode: 'memory',
        visibleCloudTypes: [],
        showAutoCheck: true
      });

      const newPassword = ref('');
      const channelFilter = ref('');
      const expandedPlugin = ref('');
      const testingPlugin = ref('');
      const testResult = ref({});
      const batchText = ref('');
      const batchEnableAll = ref(true);

      const versionLabel = ${JSON.stringify(APP_VERSION_LABEL)};
      const appName = ${JSON.stringify(APP_NAME)};

      const tabs = computed(() => [
        { key: 'overview', name: '总览', icon: 'fa-gauge-high' },
        { key: 'channels', name: 'TG 频道', icon: 'fa-bullhorn', badge: settings.value.channels.length },
        { key: 'plugins', name: '搜索插件', icon: 'fa-plug', badge: settings.value.plugins.length },
        { key: 'display', name: '结果展示', icon: 'fa-filter' },
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
      const enabledPluginsCount = computed(() => settings.value.plugins.filter(p => p.enabled).length);
      const pluginIdCount = computed(() => {
        const set = {};
        for (const p of settings.value.plugins) for (const id of (p.pluginIds || [])) set[id] = 1;
        return Object.keys(set).length;
      });

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

      const applySettings = (data) => {
        if (!Array.isArray(data.plugins)) data.plugins = [];
        data.plugins.forEach(p => {
          if (!p.responseMapping) p.responseMapping = {};
          if (!Array.isArray(p.pluginIds)) p.pluginIds = [];
          if (!p.method) p.method = 'GET';
        });
        if (!Array.isArray(data.channels)) data.channels = [];
        if (!Array.isArray(data.visibleCloudTypes)) {
          data.visibleCloudTypes = CLOUDS.filter(c => c.defaultVisible).map(c => c.key);
        }
        if (!data.resultCacheMode) data.resultCacheMode = 'memory';
        if (typeof data.showAutoCheck !== 'boolean') data.showAutoCheck = true;
        if (typeof data.maxPluginsPerSearch !== 'number') data.maxPluginsPerSearch = 2;

        settings.value = data;
        kvBound.value = data.kv_bound !== false;
        dirty.value = false;
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
          const payload = {
            channels: settings.value.channels,
            plugins: settings.value.plugins,
            concurrency: Number(settings.value.concurrency) || 6,
            maxChannelsPerSearch: Number(settings.value.maxChannelsPerSearch) || 8,
            maxPluginsPerSearch: Number(settings.value.maxPluginsPerSearch) || 2,
            cacheTtl: Number(settings.value.cacheTtl) || 300,
            tgProxyUrl: settings.value.tgProxyUrl || '',
            resultCacheMode: settings.value.resultCacheMode || 'memory',
            visibleCloudTypes: settings.value.visibleCloudTypes || [],
            showAutoCheck: settings.value.showAutoCheck !== false
          };
          if (newPassword.value.trim()) payload.adminPassword = newPassword.value.trim();

          const res = await fetch('/api/admin/settings', {
            method: 'POST',
            headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
          });
          const data = await res.json().catch(() => ({}));

          if (res.ok && data.code === 0) {
            if (payload.adminPassword) {
              localStorage.setItem(TOKEN_KEY, payload.adminPassword);
              pwdInput.value = payload.adminPassword;
              newPassword.value = '';
            }
            dirty.value = false;
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

      const doBatchImport = () => {
        const raw = batchText.value.trim();
        if (!raw) return;
        const tokens = raw.split(/[\\r\\n,;，；]+/).map(s => s.trim()).filter(Boolean);
        let count = 0;
        tokens.forEach(tok => {
          const clean = tok.replace(/^@/, '').replace(/^https?:\\/\\/t\\.me\\/(s\\/)?/i, '').replace(/[/?#].*$/, '').trim();
          if (!clean || !/^[A-Za-z0-9_]{4,64}$/.test(clean)) return;
          if (settings.value.channels.some(c => c.name.toLowerCase() === clean.toLowerCase())) return;
          settings.value.channels.unshift({ name: clean, enabled: batchEnableAll.value, priority: 2, description: '批量导入' });
          count++;
        });
        batchText.value = '';
        dirty.value = true;
        showToast('成功导入 ' + count + ' 个频道，记得保存');
      };

      /* ---------------- 插件 ---------------- */
      const togglePluginEnabled = (pl) => { pl.enabled = !pl.enabled; dirty.value = true; };
      const toggleExpand = (pl) => { expandedPlugin.value = expandedPlugin.value === pl.id ? '' : pl.id; };

      const addPlugin = () => {
        const id = prompt('插件 ID（唯一标识，字母数字下划线）：');
        if (!id || !id.trim()) return;
        const endpoint = prompt('接口地址 Endpoint：');
        if (!endpoint || !endpoint.trim()) return;
        settings.value.plugins.push({
          id: id.trim(),
          name: id.trim(),
          enabled: true,
          type: 'pansou',
          apiEndpoint: endpoint.trim(),
          pluginIds: [],
          responseMapping: {}
        });
        expandedPlugin.value = id.trim();
        dirty.value = true;
      };

      const removePlugin = (pl) => {
        if (!confirm('确定删除插件「' + (pl.name || pl.id) + '」吗？')) return;
        const idx = settings.value.plugins.indexOf(pl);
        if (idx >= 0) settings.value.plugins.splice(idx, 1);
        dirty.value = true;
      };

      const testPlugin = async (pl) => {
        testingPlugin.value = pl.id;
        try {
          const r = await fetch('/api/debug/plugin?id=' + encodeURIComponent(pl.id) + '&kw=' + encodeURIComponent('流浪地球') + '&rounds=1');
          const d = await r.json();
          const a = (d.attempts || [])[0] || {};
          if (a.ok) {
            testResult.value[pl.id] = { ok: true, text: '通 ' + a.status + ' · ' + a.ms + 'ms · ' + (a.total != null ? a.total + ' 条' : '无计数') };
          } else {
            testResult.value[pl.id] = { ok: false, text: a.error ? '失败：' + a.error.slice(0, 40) : 'HTTP ' + (a.status || '?') };
          }
        } catch (e) {
          testResult.value[pl.id] = { ok: false, text: '请求异常' };
        } finally {
          testingPlugin.value = '';
        }
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
          plugins: settings.value.plugins,
          concurrency: settings.value.concurrency,
          cacheTtl: settings.value.cacheTtl,
          maxChannelsPerSearch: settings.value.maxChannelsPerSearch,
          maxPluginsPerSearch: settings.value.maxPluginsPerSearch,
          tgProxyUrl: settings.value.tgProxyUrl,
          resultCacheMode: settings.value.resultCacheMode,
          visibleCloudTypes: settings.value.visibleCloudTypes,
          showAutoCheck: settings.value.showAutoCheck
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
            if (Array.isArray(d.plugins)) settings.value.plugins = d.plugins;
            if (typeof d.resultCacheMode === 'string') settings.value.resultCacheMode = d.resultCacheMode;
            if (Array.isArray(d.visibleCloudTypes)) settings.value.visibleCloudTypes = d.visibleCloudTypes;
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
          settings.value.plugins = (d.plugins || []).map(p => Object.assign({ responseMapping: {}, pluginIds: [], method: 'GET' }, p));
          settings.value.maxChannelsPerSearch = d.maxChannelsPerSearch || 8;
          settings.value.maxPluginsPerSearch = d.maxPluginsPerSearch || 2;
          if (Array.isArray(d.visibleCloudTypes)) settings.value.visibleCloudTypes = d.visibleCloudTypes;
          if (d.resultCacheMode) settings.value.resultCacheMode = d.resultCacheMode;
          dirty.value = true;
          showToast('已载入内置配置，请点击保存生效');
        } catch (e) {
          showToast('载入失败', 'error');
        }
      };

      /* ---------------- 脏标记 ---------------- */
      watch(settings, () => { dirty.value = true; }, { deep: true });

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
        newPassword, channelFilter, expandedPlugin, testingPlugin, testResult,
        batchText, batchEnableAll,
        allClouds, orderedCloudKeys, isCloudVisible, cloudLabelOf, cloudBadgeOf, visibleCloudNamesText,
        cacheModes: CACHE_MODES, cacheModeLabel,
        filteredChannels, enabledChannelsCount, enabledPluginsCount, pluginIdCount,
        toggleAllChannels, addChannel, removeChannel, doBatchImport,
        togglePluginEnabled, toggleExpand, addPlugin, removePlugin, testPlugin,
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

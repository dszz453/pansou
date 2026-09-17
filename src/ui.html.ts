import { VENDOR_VERSION } from './vendor.generated';
import { ICONS_CSS } from './icons';
import { CLOUD_BADGE_CSS } from './cloud';
import { APP_VERSION_LABEL, APP_NAME } from './version';

export const HTML_TEMPLATE = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <!-- viewport-fit=cover：让 iPhone 刘海 / 底部小黑条区域能被 CSS 安全区变量正确识别 -->
  <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
  <title>${APP_NAME} · 极速网盘搜索聚合 ${APP_VERSION_LABEL}</title>
  <meta name="application-name" content="${APP_NAME}">
  <meta name="description" content="极速全网盘资源聚合搜索，支持阿里、夸克、百度、115、123、迅雷等 15+ 类网盘，内置链接失效检测。">
  <meta name="theme-color" content="#2563eb">
  <meta name="mobile-web-app-capable" content="yes">
  <meta name="apple-mobile-web-app-capable" content="yes">
  <meta name="apple-mobile-web-app-status-bar-style" content="default">
  <meta name="apple-mobile-web-app-title" content="${APP_NAME}">
  <meta name="format-detection" content="telephone=no">
  <!-- PWA：Manifest + 图标（全部同源自托管，无外部依赖） -->
  <link rel="manifest" href="/manifest.webmanifest?v=${VENDOR_VERSION}">
  <link rel="icon" type="image/svg+xml" href="/assets/favicon.svg?v=${VENDOR_VERSION}">
  <link rel="apple-touch-icon" href="/assets/icon.svg?v=${VENDOR_VERSION}">
  <!-- 全部前端资源同源自托管（无 unpkg / cdnjs / cdn.tailwindcss.com 等海外 CDN 依赖） -->
  <link rel="stylesheet" href="/assets/app.css?v=${VENDOR_VERSION}">
  <style>
${ICONS_CSS}
${CLOUD_BADGE_CSS}
    :root {
      --safe-top: env(safe-area-inset-top, 0px);
      --safe-bottom: env(safe-area-inset-bottom, 0px);
    }
    html { -webkit-text-size-adjust: 100%; }
    body {
      -webkit-tap-highlight-color: transparent;
      /* 关掉 iOS 的整页橡皮筋回弹，让内部滚动区域自己滚，避免误触时页面整体晃动 */
      overscroll-behavior-y: none;
    }
    .glass {
      background: rgba(255, 255, 255, 0.88);
      backdrop-filter: blur(16px);
      -webkit-backdrop-filter: blur(16px);
    }

    .card-hover-effect {
      transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1);
    }
    .card-hover-effect:hover {
      transform: translateY(-2px);
      box-shadow: 0 12px 24px -10px rgba(0, 0, 0, 0.08), 0 4px 6px -2px rgba(0, 0, 0, 0.03);
    }

    /* 状态指示胶囊 */
    .status-valid { background-color: #ecfdf5; color: #047857; border-color: #a7f3d0; }
    .status-invalid { background-color: #fef2f2; color: #b91c1c; border-color: #fecaca; }
    .status-unknown { background-color: #f8fafc; color: #64748b; border-color: #e2e8f0; }
    .status-checking { background-color: #eff6ff; color: #1d4ed8; border-color: #bfdbfe; }

    /* 横向滚动容器：手机上分类 Tab / 快捷标签横滑时隐藏滚动条 */
    .no-scrollbar { -webkit-overflow-scrolling: touch; scrollbar-width: none; }
    .no-scrollbar::-webkit-scrollbar { display: none; }

    /* iOS 安全区适配 */
    .safe-top { padding-top: var(--safe-top); }
    .safe-bottom { padding-bottom: calc(8px + var(--safe-bottom)); }

    [v-cloak] { display: none; }

    /* ---------------- 移动端专项优化 ----------------
       1. 输入框字号强制 16px：iOS Safari 对 <16px 的输入框聚焦时会自动放大整页 ——
          这正是「手机上一点搜索框，页面突然变大」的根因。
       2. 触控目标至少 44px，符合 iOS 人机界面指南。
       3. 卡片内边距在小屏收紧，一屏能多展示一条结果。 */
    @media (max-width: 767px) {
      input, select, textarea { font-size: 16px !important; }
      .tap-target { min-height: 44px; }
    }
  </style>
  <script src="/assets/vue.js?v=${VENDOR_VERSION}"></script>
</head>
<body class="bg-gradient-to-b from-slate-50 via-slate-50 to-slate-100/60 text-slate-800 min-h-screen flex flex-col font-sans antialiased">
  <div id="app" v-cloak class="flex flex-col min-h-screen">

    <!-- ============ 前台访问密码（V1.3） ============
         后台开启「前台访问密码」后，访客必须先解锁才能搜索。
         首页 HTML 与 /api/ui-config 保持公开，所以这一层是前端渲染的登录门，
         真正的拦截发生在数据接口（无令牌一律 401）。 -->
    <div v-if="locked" class="fixed inset-0 z-[60] flex items-center justify-center px-4 bg-slate-50">
      <div class="w-full max-w-sm">
        <div class="bg-white rounded-2xl border border-slate-200 shadow-xl shadow-slate-200/60 p-6 sm:p-7">
          <div class="text-center mb-6">
            <div class="w-14 h-14 mx-auto rounded-2xl bg-gradient-to-tr from-blue-600 to-indigo-600 flex items-center justify-center text-white text-xl shadow-lg shadow-indigo-500/25 mb-3">
              <i class="fa-solid fa-lock"></i>
            </div>
            <h2 class="font-bold text-lg text-slate-800">需要访问密码</h2>
            <p class="text-xs text-slate-400 mt-1">本站已开启访问保护，请输入密码后继续</p>
          </div>

          <form @submit.prevent="unlock" class="space-y-3">
            <div class="relative">
              <input
                :type="showUnlockPwd ? 'text' : 'password'"
                v-model="unlockInput"
                autocomplete="current-password"
                placeholder="访问密码"
                class="w-full pl-10 pr-10 py-3 text-base border-2 border-slate-200 rounded-xl outline-none transition focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10"
              />
              <i class="fa-solid fa-key absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-300 text-sm"></i>
              <button type="button" @click="showUnlockPwd = !showUnlockPwd" class="absolute right-3 top-1/2 -translate-y-1/2 text-slate-300 hover:text-slate-500">
                <i class="fa-solid text-sm" :class="showUnlockPwd ? 'fa-eye-slash' : 'fa-eye'"></i>
              </button>
            </div>
            <button
              type="submit"
              :disabled="unlocking || !unlockInput"
              class="w-full py-3 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white font-semibold text-sm rounded-xl transition shadow-md shadow-blue-500/20 disabled:opacity-50 flex items-center justify-center gap-2"
            >
              <i class="fa-solid" :class="unlocking ? 'fa-circle-notch fa-spin' : 'fa-unlock'"></i>
              <span>{{ unlocking ? '验证中…' : '解锁' }}</span>
            </button>
          </form>

          <p v-if="unlockError" class="mt-3 text-xs text-rose-600 bg-rose-50 border border-rose-100 rounded-lg px-3 py-2 flex items-start gap-1.5">
            <i class="fa-solid fa-circle-exclamation mt-0.5"></i><span>{{ unlockError }}</span>
          </p>
        </div>
      </div>
    </div>

    <!-- 顶栏导航 -->
    <header class="border-b border-slate-200/80 glass sticky top-0 z-40">
      <div class="safe-top"></div>
      <div class="max-w-6xl mx-auto px-3 sm:px-4 h-14 sm:h-16 flex items-center justify-between gap-2">
        <div class="flex items-center space-x-2.5 cursor-pointer group min-w-0" @click="resetToHome">
          <div class="w-9 h-9 sm:w-10 sm:h-10 shrink-0 rounded-xl bg-gradient-to-tr from-blue-600 via-indigo-600 to-indigo-500 flex items-center justify-center text-white font-bold text-lg shadow-md shadow-blue-500/20 group-hover:scale-105 transition-transform">
            <i class="fa-solid fa-bolt text-sm sm:text-base"></i>
          </div>
          <div class="min-w-0">
            <div class="flex items-center space-x-1.5">
              <h1 class="font-bold text-base sm:text-lg leading-tight bg-gradient-to-r from-blue-600 via-indigo-600 to-indigo-700 bg-clip-text text-transparent truncate">PanSou Edge</h1>
              <span class="shrink-0 text-[10px] font-bold tracking-wider px-1.5 py-0.5 rounded bg-blue-50 text-blue-600 border border-blue-100/60">{{ versionLabel }}</span>
            </div>
            <p class="text-[11px] text-slate-400 truncate hidden sm:block">极速全网盘聚合 · 智能失效检测</p>
          </div>
        </div>

        <div class="flex items-center space-x-1 sm:space-x-2 shrink-0">
          <!-- 安装到桌面（PWA）：仅在浏览器支持且尚未安装时出现 -->
          <button
            v-if="canInstall"
            @click="installPwa"
            class="px-2.5 sm:px-3 py-1.5 text-xs font-medium text-emerald-700 bg-emerald-50 hover:bg-emerald-100 rounded-lg transition flex items-center gap-1"
            title="把本站安装到桌面，像 App 一样打开"
          >
            <i class="fa-solid fa-mobile-screen-button"></i>
            <span class="hidden sm:inline">安装到桌面</span>
          </button>
          <!-- V1.3：首页不再放任何管理入口 —— 配置与 API 文档统一在 /admin，
               首页只做搜索这一件事。（从站外地址栏直接访问 /admin 即可） -->
        </div>
      </div>
    </header>

    <!-- 主搜索内容区 -->
    <main class="flex-1 max-w-6xl w-full mx-auto px-4 py-8">
      <!-- 搜索框区域 -->
      <div class="text-center mb-6 sm:mb-8 pt-1 sm:pt-4">
        <h2 class="text-2xl font-extrabold text-slate-900 tracking-tight sm:text-4xl mb-2 sm:mb-3">
          搜你想搜，即刻触达
        </h2>
        <p class="text-slate-500 max-w-xl mx-auto text-xs sm:text-sm px-2">
          原生并发抓取 Telegram 公开频道与聚合插件，支持阿里、夸克、百度、UC、天翼、迅雷、123 等 15+ 类主流网盘
        </p>

        <!-- 搜索表单
             关键点：按钮**参与 flex 布局**（不再用 absolute），并设 shrink-0，
             因此无论窗口多窄，按钮都不会被压缩、文字也不会溢出到框外；
             输入框 flex-1 + min-w-0 只占用剩余空间。 -->
        <div class="mt-5 sm:mt-7 w-full max-w-3xl mx-auto">
          <form @submit.prevent="doSearch" class="w-full">
            <div
              id="search-box"
              class="flex items-center gap-1.5 p-1.5 bg-white border-2 border-slate-200 rounded-2xl shadow-lg shadow-slate-200/60 transition
                     focus-within:border-blue-500 focus-within:ring-4 focus-within:ring-blue-500/10"
            >
              <span class="pl-2.5 flex items-center text-slate-400 shrink-0">
                <i class="fa-solid fa-magnifying-glass text-sm"></i>
              </span>
              <input
                id="search-input"
                type="search"
                v-model="keyword"
                autocomplete="off"
                enterkeyhint="search"
                placeholder="搜索电影、剧集、动漫、电子书…"
                class="flex-1 min-w-0 bg-transparent border-0 outline-none py-2.5 sm:py-3 text-base text-slate-800 placeholder-slate-400"
              />
              <button
                v-if="keyword"
                type="button"
                @click="keyword = ''"
                class="shrink-0 px-2 py-1 text-slate-300 hover:text-slate-500 transition tap-target flex items-center"
                title="清空"
              >
                <i class="fa-solid fa-circle-xmark text-base"></i>
              </button>
              <button
                id="search-submit"
                type="submit"
                :disabled="loading"
                class="shrink-0 whitespace-nowrap px-4 sm:px-5 py-2.5 sm:py-3 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white font-medium text-sm rounded-xl transition shadow-md shadow-blue-500/20 disabled:opacity-50 flex items-center gap-1.5"
              >
                <i class="fa-solid" :class="loading ? 'fa-circle-notch fa-spin' : 'fa-magnifying-glass'"></i>
                <span>{{ loading ? '检索中' : '搜索' }}</span>
              </button>
            </div>
          </form>

          <!-- 热门搜索推荐 -->
          <!-- 热门搜索推荐：手机端单行横滑（不换行，避免占满三行把结果挤下去），桌面端自动居中换行 -->
          <div class="mt-3 sm:mt-4 flex flex-nowrap sm:flex-wrap items-center sm:justify-center gap-1.5 sm:gap-2 text-xs text-slate-500 overflow-x-auto no-scrollbar px-1">
            <span class="font-medium text-slate-400 flex items-center shrink-0">
              <i class="fa-solid fa-fire text-amber-500 mr-1"></i>大家都在搜:
            </span>
            <span
              v-for="tag in hotSearches"
              :key="tag"
              @click="quickSearch(tag)"
              class="cursor-pointer shrink-0 bg-white hover:bg-blue-50 hover:text-blue-600 hover:border-blue-200 border border-slate-200/60 px-2.5 py-1.5 rounded-full transition shadow-2xs text-[11px] sm:text-xs"
            >
              {{ tag }}
            </span>
          </div>
        </div>
      </div>

      <!-- 检索进度与状态 -->
      <div v-if="searched && loading" class="mt-6 flex flex-col sm:flex-row items-center justify-center gap-3 text-xs text-slate-500 bg-white p-3 rounded-xl border border-slate-200/60 shadow-2xs max-w-xl mx-auto">
        <div class="flex items-center space-x-2">
          <i class="fa-solid fa-circle-notch fa-spin text-blue-600"></i>
          <span>
            正在检索多路频道与插件源
            <strong class="text-slate-700">{{ searchProgress.done }}</strong>
            /
            <strong class="text-slate-700">{{ searchProgress.total }}</strong>
          </span>
        </div>
        <div class="flex items-center space-x-2">
          <div class="w-32 h-1.5 bg-slate-100 rounded-full overflow-hidden border border-slate-200">
            <div
              class="h-full bg-blue-600 transition-all duration-300"
              :style="{ width: searchProgress.total ? (searchProgress.done / searchProgress.total * 100) + '%' : '0%' }"
            ></div>
          </div>
          <span v-if="totalCount > 0" class="text-blue-600 font-semibold">已汇总 {{ totalCount }} 条</span>
        </div>
      </div>

      <!-- 搜索结果区 -->
      <div v-if="searched" class="mt-6 sm:mt-8">
        <!-- 分类切换 Tabs & 工具条 -->
        <div class="mb-4 sm:mb-6">
          <!-- 网盘分类：自动换行，保证每个分类都完整可见（不做横向截断）。
               手机端内边距收紧、字号降一档，一屏能塞下更多分类。 -->
          <div id="cloud-tabs" class="flex flex-wrap items-center gap-1.5 sm:gap-2">
            <button
              @click="activeTab = 'all'"
              :class="activeTab === 'all'
                ? 'bg-blue-600 border-blue-600 text-white font-semibold shadow-sm shadow-blue-500/25'
                : 'bg-white border-slate-200/80 text-slate-600 hover:border-blue-200 hover:text-blue-600'"
              class="px-2.5 sm:px-3.5 py-2 sm:py-1.5 rounded-xl border text-xs sm:text-sm transition flex items-center gap-1.5"
            >
              <span>全部网盘</span>
              <span
                class="text-[10px] font-semibold px-1.5 py-0.5 rounded-full"
                :class="activeTab === 'all' ? 'bg-white/25' : 'bg-slate-100 text-slate-500'"
              >{{ totalCount }}</span>
            </button>
            <button
              v-for="type in tabTypes"
              :key="type"
              @click="activeTab = type"
              :class="activeTab === type
                ? 'bg-blue-600 border-blue-600 text-white font-semibold shadow-sm shadow-blue-500/25'
                : 'bg-white border-slate-200/80 text-slate-600 hover:border-blue-200 hover:text-blue-600'"
              class="px-2.5 sm:px-3 py-2 sm:py-1.5 rounded-xl border text-xs sm:text-sm transition flex items-center gap-1.5"
            >
              <span>{{ getCloudLabel(type) }}</span>
              <span
                class="text-[10px] font-semibold px-1.5 py-0.5 rounded-full"
                :class="activeTab === type ? 'bg-white/25' : 'bg-slate-100 text-slate-500'"
              >{{ mergedResults[type].length }}</span>
            </button>
          </div>

          <!-- 工具条：自动测活开关 / 只看有效 / 批量检测
               手机端允许横向滑动，避免三个控件被挤成三行、把结果推下去 -->
          <div id="result-toolbar" class="mt-3 pt-3 border-t border-slate-200/80 flex flex-wrap sm:flex-nowrap items-center gap-2 text-xs overflow-x-auto no-scrollbar">
            <!-- 自动测活开关（后台可关闭；关闭后不渲染） -->
            <button
              v-if="showAutoCheck"
              @click="toggleAutoCheck"
              class="flex items-center gap-2 pl-2.5 pr-3 py-2 sm:py-1.5 rounded-xl border font-medium transition shrink-0"
              :class="autoCheck
                ? 'bg-emerald-50 border-emerald-200 text-emerald-700'
                : 'bg-white border-slate-200/80 text-slate-500 hover:bg-slate-50'"
              :title="autoCheck ? '已开启：搜索结果会自动检测链接有效性' : '点击开启：搜索结果自动检测链接有效性'"
            >
              <span
                class="relative inline-block w-9 h-5 rounded-full transition-colors shrink-0"
                :class="autoCheck ? 'bg-emerald-500' : 'bg-slate-300'"
              >
                <span
                  class="absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform"
                  :class="autoCheck ? 'translate-x-4' : 'translate-x-0'"
                ></span>
              </span>
              <span>自动测活</span>
            </button>

            <!-- 仅显示有效筛选 -->
            <label
              v-if="hasCheckedAny"
              class="flex items-center gap-1.5 cursor-pointer select-none px-2.5 py-2 sm:py-1.5 rounded-xl border border-slate-200/80 bg-white text-slate-600 hover:text-blue-600 transition shrink-0"
            >
              <input type="checkbox" v-model="filterValidOnly" class="w-4 h-4 rounded text-blue-600 focus:ring-0">
              <span>只看有效 ({{ validOnlyCount }})</span>
            </label>

            <!-- 批量一键检测按钮 -->
            <button
              @click="batchCheckCurrent"
              :disabled="batchChecking || currentList.length === 0"
              class="px-3 py-2 sm:py-1.5 bg-white hover:bg-blue-50 text-slate-700 hover:text-blue-600 border border-slate-200/80 rounded-xl transition flex items-center gap-1.5 font-medium disabled:opacity-50 shrink-0"
              title="检测当前分类下所有网盘链接是否失效"
            >
              <i class="fa-solid" :class="batchChecking ? 'fa-circle-notch fa-spin text-blue-600' : 'fa-stethoscope text-emerald-600'"></i>
              <span v-if="batchChecking">检测中 {{ checkedCount }}/{{ checkingTarget }}</span>
              <span v-else>检测本页有效性</span>
            </button>

            <span class="text-slate-400 sm:ml-auto whitespace-nowrap shrink-0 pl-0.5">
              共 {{ displayedList.length }} 条<span v-if="hasCheckedAny"> · 已检测 {{ checkedCount }}</span>
            </span>
          </div>
        </div>

        <!-- 结果卡片网格 -->
        <div v-if="displayedList.length > 0" class="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div
            v-for="(item, idx) in displayedList"
            :key="idx"
            class="bg-white p-4 sm:p-5 rounded-2xl border border-slate-200/80 card-hover-effect flex flex-col justify-between"
          >
            <div>
              <!-- 顶部标签与时间 -->
              <div class="flex items-center justify-between gap-2 mb-2.5">
                <div class="flex items-center space-x-1.5">
                  <span
                    class="text-[11px] font-semibold px-2.5 py-0.5 rounded-md shadow-2xs"
                    :class="'badge-' + (item.cloudType || activeTab)"
                  >
                    {{ getCloudLabel(item.cloudType || activeTab) }}
                  </span>

                  <!-- 失效状态徽标 -->
                  <span
                    v-if="itemStatusMap[item.url]"
                    class="text-[10px] font-medium px-2 py-0.5 rounded-md border flex items-center space-x-1"
                    :class="getStatusClass(itemStatusMap[item.url].status)"
                  >
                    <i class="fa-solid text-[9px]" :class="getStatusIcon(itemStatusMap[item.url].status)"></i>
                    <span>{{ itemStatusMap[item.url].label }}</span>
                  </span>
                </div>

                <span class="text-[11px] text-slate-400 flex items-center">
                  <i class="fa-regular fa-clock mr-1 text-[10px]"></i>
                  {{ formatDateTime(item.datetime) }}
                </span>
              </div>

              <!-- 资源标题 -->
              <h3 class="text-sm sm:text-base font-semibold text-slate-800 line-clamp-2 hover:text-blue-600 transition leading-snug">
                <a :href="item.url" target="_blank" rel="noopener noreferrer">
                  {{ item.note || item.title || '网盘分享链接' }}
                </a>
              </h3>
            </div>

            <!-- 底部来源与操作按钮 -->
            <div class="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between text-xs">
              <!-- 来源渠道 -->
              <div class="flex items-center space-x-1.5 text-slate-400 truncate max-w-[45%]" :title="item.source || 'TG 频道'">
                <i class="fa-solid fa-bullhorn text-slate-300 text-[11px]"></i>
                <span class="truncate text-[11px] text-slate-500">{{ item.source || 'TG 频道' }}</span>
              </div>

              <!-- 右侧操作区：提取码 + 检测 + 直达 -->
              <div class="flex items-center space-x-2">
                <!-- 提取码 -->
                <span
                  v-if="item.password"
                  @click="copyText(item.password, '提取码已复制')"
                  class="cursor-pointer bg-amber-50 hover:bg-amber-100 text-amber-700 font-mono font-medium px-2 py-0.5 rounded border border-amber-200/80 transition text-[11px] flex items-center space-x-1"
                  title="点击复制提取码"
                >
                  <i class="fa-regular fa-copy text-[10px]"></i>
                  <span>{{ item.password }}</span>
                </span>

                <!-- 单项有效性检测按钮 -->
                <button
                  @click="checkSingle(item)"
                  class="px-2 py-1 bg-slate-50 hover:bg-slate-100 text-slate-600 rounded-lg transition text-[11px] border border-slate-200/60"
                  title="检测此链接是否失效"
                >
                  <i class="fa-solid fa-rotate text-[10px]" :class="{ 'fa-spin text-blue-600': itemStatusMap[item.url]?.status === 'checking' }"></i>
                  <span class="ml-1 hidden sm:inline">测活</span>
                </button>

                <!-- 直达链接 -->
                <a
                  :href="item.url"
                  target="_blank"
                  rel="noopener noreferrer"
                  class="px-3 py-1 bg-blue-50 hover:bg-blue-600 text-blue-600 hover:text-white rounded-lg font-medium transition text-[11px] sm:text-xs flex items-center space-x-1"
                >
                  <span>直达</span>
                  <i class="fa-solid fa-arrow-up-right-from-square text-[10px]"></i>
                </a>
              </div>
            </div>
          </div>
        </div>

        <!-- 筛选后无有效结果 -->
        <div v-else-if="filterValidOnly && currentList.length > 0" class="text-center py-16 bg-white rounded-2xl border border-slate-200/80 shadow-2xs">
          <div class="w-14 h-14 bg-amber-50 rounded-2xl flex items-center justify-center mx-auto text-amber-500 text-2xl mb-3">
            <i class="fa-solid fa-filter-circle-xmark"></i>
          </div>
          <h3 class="text-slate-700 font-semibold mb-1 text-sm">当前分类下未检测出「确定有效」的链接</h3>
          <p class="text-slate-400 text-xs mb-4">可以关闭「只看有效」筛选，或点击右上角「检测本页有效性」触发全面测活</p>
          <button @click="filterValidOnly = false" class="px-4 py-1.5 bg-blue-50 text-blue-600 rounded-lg text-xs font-medium hover:bg-blue-100">
            查看全部 {{ currentList.length }} 条资源
          </button>
        </div>

        <!-- 空数据提示 -->
        <div v-else-if="!loading" class="text-center py-16 bg-white rounded-2xl border border-dashed border-slate-300">
          <div class="w-16 h-16 bg-slate-100 rounded-2xl flex items-center justify-center mx-auto text-slate-400 text-2xl mb-4">
            <i class="fa-regular fa-folder-open"></i>
          </div>
          <h3 class="text-slate-700 font-semibold mb-1">未找到相关资源</h3>
          <p class="text-slate-400 text-xs">请尝试更换更简短的关键词，或稍后重试（上游频道偶发限流）</p>
        </div>
      </div>
    </main>

    <!-- 页脚 -->
    <footer class="border-t border-slate-200/80 bg-white/70 py-6 mt-auto text-center text-xs text-slate-400 backdrop-blur">
      <div class="max-w-6xl mx-auto px-4 flex flex-col sm:flex-row items-center justify-between gap-2">
        <div>
          Powered by <strong>Cloudflare Workers & KV</strong> · 边缘高速计算与智能测活
        </div>
        <div class="flex space-x-4">
          <span>兼容 pansou-web / panhub 协议</span>
          <span>原生 TG 分片调度</span>
        </div>
      </div>
    </footer>


  </div>

  <script>
    const { createApp, ref, computed, onMounted } = Vue;

    const app = createApp({
      setup() {
        const keyword = ref('');
        const searched = ref(false);
        const loading = ref(false);
        const activeTab = ref('all');

        /* ---------------- 前台访问密码（V1.3） ----------------
           令牌由服务端下发、存在本地，之后所有数据接口都带 X-Frontend-Token。
           它由密码哈希派生，所以后台一改密码，这边的旧令牌就会自动 401 并被清掉。 */
        const FE_TOKEN_KEY = 'pansou_fe_token';
        const locked = ref(false);
        const unlockInput = ref('');
        const unlockError = ref('');
        const unlocking = ref(false);
        const showUnlockPwd = ref(false);
        // 隐私模式 / 禁用存储时 localStorage 会直接抛错，这里必须兜住
        let savedFeToken = '';
        try { savedFeToken = localStorage.getItem(FE_TOKEN_KEY) || ''; } catch (e) {}
        const feToken = ref(savedFeToken);

        const hotSearches = ref(['热辣滚烫', '周处除三害', '沙丘2', '繁花', '三体', '庆余年', '黑神话悟空', '流浪地球2']);
        const mergedResults = ref({});
        const totalCount = ref(0);
        const searchProgress = ref({ done: 0, total: 0 });

        // 失效检测状态映射: { [url]: { status: 'checking'|'valid'|'invalid'|'unknown', label: '有效'|'已失效'|'需提取码' } }
        const itemStatusMap = ref({});
        const batchChecking = ref(false);
        const filterValidOnly = ref(false);
        // 自动测活：是否显示由后台控制（showAutoCheck），默认开启
        const autoCheck = ref(false);
        const checkingTarget = ref(0);

        /* ---------------- 后台可配置项（来自 /api/ui-config） ---------------- */
        // 版本号：优先用接口返回值，接口未返回时兜底构建期常量
        const versionLabel = ref('${APP_VERSION_LABEL}');
        // 是否展示「自动测活」开关
        const showAutoCheck = ref(true);
        // 搜索结果中允许展示的网盘类型（按后台配置的顺序渲染分类 Tab）
        const visibleCloudTypes = ref([]);
        // 云端配置是否已加载：加载前不启用网盘过滤，避免首屏空白
        const cloudFilterActive = ref(false);
        // 网盘中文名映射（由后台下发，前端不再硬编码）
        const cloudLabels = ref({});

        /* ---------------- PWA 安装 ---------------- */
        const canInstall = ref(false);
        let deferredPrompt = null;

        const getCloudLabel = (type) => cloudLabels.value[type] || type || '其他网盘';

        /* ---------------- 带访问令牌的数据请求 ----------------
           后台开启前台密码后，搜索/测活/频道/插件接口都要求令牌；
           这里统一注入请求头，并在收到 401 时立即退回登录门。 */
        const apiFetch = async (url, init) => {
          const opts = Object.assign({}, init || {});
          const headers = Object.assign({}, opts.headers || {});
          if (feToken.value) headers['X-Frontend-Token'] = feToken.value;
          opts.headers = headers;

          const res = await fetch(url, opts);
          if (res.status === 401) {
            feToken.value = '';
            try { localStorage.removeItem(FE_TOKEN_KEY); } catch (e) {}
            locked.value = true;
          }
          return res;
        };

        const unlock = async () => {
          const pwd = unlockInput.value.trim();
          if (!pwd) return;
          unlocking.value = true;
          unlockError.value = '';
          try {
            const res = await fetch('/api/frontend/auth', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ password: pwd })
            });
            const d = await res.json().catch(() => ({}));
            if (res.ok && d.code === 0 && (d.token || d.enabled === false)) {
              if (d.token) {
                feToken.value = d.token;
                try { localStorage.setItem(FE_TOKEN_KEY, d.token); } catch (e) {}
              }
              unlockInput.value = '';
              locked.value = false;
            } else {
              unlockError.value = d.message || '密码错误，请重新输入';
            }
          } catch (e) {
            unlockError.value = '无法连接服务，请检查网络';
          } finally {
            unlocking.value = false;
          }
        };

        // 扁平化全部结果列表
        const allList = computed(() => {
          const list = [];
          for (const [type, items] of Object.entries(mergedResults.value)) {
            items.forEach(it => list.push({ ...it, cloudType: type }));
          }
          return list;
        });

        /**
         * 分类 Tab 的展示顺序：
         * 先按后台配置的 visible_cloud_types 顺序，未在配置里登记的类型追加在后面。
         */
        const tabTypes = computed(() => {
          const types = Object.keys(mergedResults.value);
          const pref = visibleCloudTypes.value.filter(t => types.indexOf(t) >= 0);
          const rest = types.filter(t => pref.indexOf(t) < 0);
          return pref.concat(rest);
        });

        // 当前 Tab 选中的结果列表
        const currentList = computed(() => {
          if (activeTab.value === 'all') {
            return allList.value;
          }
          return (mergedResults.value[activeTab.value] || []).map(it => ({
            ...it,
            cloudType: activeTab.value
          }));
        });

        // 根据「只看有效」过滤后的列表
        const displayedList = computed(() => {
          if (!filterValidOnly.value) return currentList.value;
          return currentList.value.filter(it => {
            const st = itemStatusMap.value[it.url];
            return st && (st.status === 'valid' || st.valid === true);
          });
        });

        const hasCheckedAny = computed(() => Object.keys(itemStatusMap.value).length > 0);

        // 已出结果的检测条数（不含仍在检测中的）
        const checkedCount = computed(
          () => Object.values(itemStatusMap.value).filter(s => s && s.status !== 'checking').length
        );
        const validOnlyCount = computed(() => {
          return currentList.value.filter(it => {
            const st = itemStatusMap.value[it.url];
            return st && (st.status === 'valid' || st.valid === true);
          }).length;
        });

        const getStatusClass = (status) => {
          if (status === 'valid') return 'status-valid';
          if (status === 'invalid') return 'status-invalid';
          if (status === 'checking') return 'status-checking';
          return 'status-unknown';
        };

        const getStatusIcon = (status) => {
          if (status === 'valid') return 'fa-circle-check text-emerald-600';
          if (status === 'invalid') return 'fa-circle-xmark text-rose-600';
          if (status === 'checking') return 'fa-circle-notch fa-spin text-blue-600';
          return 'fa-circle-question text-slate-400';
        };

        const formatDateTime = (dt) => {
          if (!dt) return '刚刚';
          try {
            const d = new Date(dt);
            if (isNaN(d.getTime())) return dt.slice(0, 10);
            const m = String(d.getMonth() + 1).padStart(2, '0');
            const day = String(d.getDate()).padStart(2, '0');
            return m + '-' + day;
          } catch (e) {
            return dt.slice(0, 10);
          }
        };

        const copyText = (txt, msg) => {
          if (!txt) return;
          navigator.clipboard.writeText(txt).then(() => {
            alert(msg || '已复制到剪贴板');
          }).catch(() => {
            prompt('请手动复制：', txt);
          });
        };

        // 单个链接测活
        const checkSingle = async (item) => {
          if (!item || !item.url) return;
          itemStatusMap.value[item.url] = { status: 'checking', label: '检测中...' };
          try {
            const r = await apiFetch('/api/check', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                url: item.url,
                password: item.password || '',
                type: item.cloudType || ''
              })
            });
            const d = await r.json();
            itemStatusMap.value[item.url] = {
              status: d.status || (d.valid ? 'valid' : 'invalid'),
              label: d.label || (d.valid ? '有效' : '已失效'),
              valid: d.valid
            };
          } catch (e) {
            itemStatusMap.value[item.url] = { status: 'unknown', label: '未知', valid: undefined };
          }
        };

        // 测活队列：4 路并发消费（复用同一套 worker，避免重复发起）
        const runCheckQueue = async (list) => {
          if (batchChecking.value || !list || list.length === 0) return;
          batchChecking.value = true;
          checkingTarget.value = checkedCount.value + list.length;

          const queue = [...list];
          const worker = async () => {
            while (queue.length > 0) {
              const it = queue.shift();
              if (!it) break;
              if (itemStatusMap.value[it.url] && itemStatusMap.value[it.url].status !== 'unknown') {
                continue;
              }
              await checkSingle(it);
            }
          };

          await Promise.all([worker(), worker(), worker(), worker()]);
          batchChecking.value = false;
        };

        // 手动批量：检测当前分类下所有链接（最多前 40 条）
        const batchCheckCurrent = () => runCheckQueue(currentList.value.slice(0, 40));

        // 自动测活：搜索完成后检测前若干条，数量刻意压小以免拖慢首屏
        const AUTO_CHECK_LIMIT = 24;
        const runAutoCheck = () => {
          if (!autoCheck.value) return;
          const list = currentList.value
            .slice(0, AUTO_CHECK_LIMIT)
            .filter(it => !itemStatusMap.value[it.url]);
          return runCheckQueue(list);
        };

        // 开关：开启时立即对当前结果补测一次
        const toggleAutoCheck = () => {
          autoCheck.value = !autoCheck.value;
          if (autoCheck.value) runAutoCheck();
        };

        /* ---------------- PWA：安装到桌面 ---------------- */
        const installPwa = async () => {
          if (!deferredPrompt) return;
          try {
            deferredPrompt.prompt();
            await deferredPrompt.userChoice;
          } catch (e) {}
          deferredPrompt = null;
          canInstall.value = false;
        };

        const SHARD_CONCURRENCY = 4;
        let cachedChannelsInfo = null;
        let cachedPluginsInfo = null;

        const doSearch = async () => {
          const kw = keyword.value.trim();
          if (!kw) return;

          loading.value = true;
          searched.value = true;
          activeTab.value = 'all';
          mergedResults.value = {};
          totalCount.value = 0;
          itemStatusMap.value = {};
          filterValidOnly.value = false;
          searchProgress.value = { done: 0, total: 0 };

          const merged = {};
          const seen = new Set();
          const commit = () => {
            const snapshot = {};
            for (const k in merged) snapshot[k] = merged[k].slice();
            mergedResults.value = snapshot;
            totalCount.value = seen.size;
          };
          const bump = () => {
            searchProgress.value = {
              done: searchProgress.value.done + 1,
              total: searchProgress.value.total
            };
          };
          // 后端仍会把全部网盘类型返回给第三方 API 调用方，
          // 网页端则在这里按后台配置过滤掉「不在展示白名单里」的网盘。
          const mergeInto = (byType) => {
            for (const type in byType) {
              if (cloudFilterActive.value && visibleCloudTypes.value.indexOf(type) < 0) continue;
              if (!merged[type]) merged[type] = [];
              for (const item of byType[type]) {
                if (seen.has(item.url)) continue;
                seen.add(item.url);
                merged[type].push(item);
              }
            }
          };

          try {
            if (!cachedChannelsInfo) {
              const chRes = await apiFetch('/api/channels');
              cachedChannelsInfo = await chRes.json();
            }
            if (!cachedPluginsInfo) {
              try {
                const plRes = await apiFetch('/api/plugins');
                cachedPluginsInfo = await plRes.json();
              } catch (e) {
                cachedPluginsInfo = { plugins: [] };
              }
            }
            const all = (cachedChannelsInfo && cachedChannelsInfo.channels) || [];
            const size = (cachedChannelsInfo && cachedChannelsInfo.shard_size) || 8;
            const pluginCount = ((cachedPluginsInfo && cachedPluginsInfo.plugins) || []).length;

            const shards = [];
            for (let i = 0; i < all.length; i += size) shards.push(all.slice(i, i + size));

            searchProgress.value = { done: 0, total: shards.length + (pluginCount > 0 ? 1 : 0) };

            // 频道分片任务
            const shardTask = async () => {
              if (shards.length === 0) return;
              let cursor = 0;
              const worker = async () => {
                while (true) {
                  const idx = cursor++;
                  if (idx >= shards.length) return;
                  try {
                    const r = await apiFetch('/api/search', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ kw, channels: shards[idx], res: 'merge' })
                    });
                    const d = await r.json();
                    mergeInto(d.merged_by_type || {});
                    commit();
                  } catch (e) {
                    console.warn('分片检索失败', shards[idx], e);
                  }
                  bump();
                }
              };
              await Promise.all(
                new Array(Math.min(SHARD_CONCURRENCY, shards.length)).fill(0).map(worker)
              );
            };

            // 插件任务
            const pluginTask = async () => {
              if (pluginCount === 0) return;
              try {
                const r = await apiFetch('/api/search', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ kw, plugins_only: true, res: 'merge' })
                });
                const d = await r.json();
                mergeInto(d.merged_by_type || {});
                commit();
              } catch (e) {
                console.warn('插件检索失败', e);
              }
              bump();
            };

            await Promise.all([shardTask(), pluginTask()]);
          } catch (e) {
            console.error('搜索异常', e);
            alert('搜索请求失败，请检查网络连接');
          } finally {
            loading.value = false;
            // 自动测活（默认开启）：结果落盘后立刻开始检测
            if (autoCheck.value) runAutoCheck();
          }
        };

        const quickSearch = (tag) => {
          keyword.value = tag;
          doSearch();
        };

        const resetToHome = () => {
          keyword.value = '';
          searched.value = false;
          mergedResults.value = {};
          itemStatusMap.value = {};
          activeTab.value = 'all';
        };

        onMounted(async () => {
          // 后台可配置项：版本号 / 展示哪些网盘 / 是否展示自动测活
          try {
            const res = await fetch('/api/ui-config');
            const cfg = await res.json();
            if (cfg && cfg.code === 0) {
              if (cfg.version_label) versionLabel.value = cfg.version_label;
              if (Array.isArray(cfg.visible_cloud_types)) {
                visibleCloudTypes.value = cfg.visible_cloud_types;
                cloudFilterActive.value = true;
              }
              if (cfg.cloud_labels && typeof cfg.cloud_labels === 'object') {
                cloudLabels.value = cfg.cloud_labels;
              }
              showAutoCheck.value = cfg.show_auto_check !== false;
              autoCheck.value = showAutoCheck.value;
              // V1.3：后台开了前台访问密码 → 没有本地令牌就先弹登录门
              // （本地令牌若已失效，第一次数据请求会 401，再由 apiFetch 退回登录门）
              if (cfg.frontend_auth_enabled) {
                locked.value = !feToken.value;
              } else {
                locked.value = false;
              }
            }
          } catch (e) {}

          try {
            const res = await fetch('/api/hot');
            const data = await res.json();
            if (data.hotSearches && data.hotSearches.length > 0) {
              hotSearches.value = data.hotSearches;
            }
          } catch (e) {}

          // PWA：捕获安装事件，供顶栏「安装到桌面」按钮使用
          window.addEventListener('beforeinstallprompt', (e) => {
            e.preventDefault();
            deferredPrompt = e;
            canInstall.value = true;
          });
          window.addEventListener('appinstalled', () => {
            deferredPrompt = null;
            canInstall.value = false;
          });

          // 注册 Service Worker：必须由根路径 /sw.js 提供才能拿到全站作用域
          if ('serviceWorker' in navigator && location.protocol === 'https:') {
            window.addEventListener('load', () => {
              navigator.serviceWorker.register('/sw.js').catch(() => {});
            });
          }
        });

        return {
          keyword,
          searched,
          loading,
          activeTab,
          hotSearches,
          mergedResults,
          tabTypes,
          totalCount,
          currentList,
          displayedList,
          searchProgress,
          itemStatusMap,
          batchChecking,
          filterValidOnly,
          autoCheck,
          toggleAutoCheck,
          checkingTarget,
          checkedCount,
          hasCheckedAny,
          validOnlyCount,
          getStatusClass,
          getStatusIcon,
          formatDateTime,
          copyText,
          checkSingle,
          batchCheckCurrent,
          getCloudLabel,
          // V1.2 新增
          versionLabel,
          showAutoCheck,
          canInstall,
          installPwa,
          doSearch,
          quickSearch,
          resetToHome,
          // V1.3：前台访问密码
          locked,
          unlockInput,
          unlockError,
          unlocking,
          showUnlockPwd,
          unlock
        };
      }
    });

    // 仅当 URL 带 ?debug=1 时暴露调试句柄：
    // Vue 生产版不会设置 container.__vue_app__，自动化脚本（ui_shot.mjs）
    // 需要它来注入模拟数据、读取内部状态做布局回归验证。
    if (location.search.indexOf('debug=1') >= 0) {
      window.__pansouApp = app;
    }

    app.mount('#app');
  </script>
</body>
</html>
`;

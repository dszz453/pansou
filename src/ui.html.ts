import { VENDOR_VERSION } from './vendor.generated';
import { ICONS_CSS } from './icons';

export const HTML_TEMPLATE = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>PanSou Edge · 极速网盘搜索聚合</title>
  <meta name="application-name" content="PanSou Edge">
  <!-- 全部前端资源同源自托管（无 unpkg / cdnjs / cdn.tailwindcss.com 等海外 CDN 依赖） -->
  <link rel="stylesheet" href="/assets/app.css?v=${VENDOR_VERSION}">
  <style>
${ICONS_CSS}
    .glass {
      background: rgba(255, 255, 255, 0.88);
      backdrop-filter: blur(16px);
      -webkit-backdrop-filter: blur(16px);
    }
    .badge-aliyun { background: linear-gradient(135deg, #ff6a00, #ff8533); color: white; }
    .badge-quark { background: linear-gradient(135deg, #2563eb, #3b82f6); color: white; }
    .badge-baidu { background: linear-gradient(135deg, #1d4ed8, #2563eb); color: white; }
    .badge-tianyi { background: linear-gradient(135deg, #dc2626, #ef4444); color: white; }
    .badge-uc { background: linear-gradient(135deg, #ea580c, #f97316); color: white; }
    .badge-115 { background: linear-gradient(135deg, #0284c7, #38bdf8); color: white; }
    .badge-xunlei { background: linear-gradient(135deg, #0369a1, #0ea5e9); color: white; }
    .badge-123 { background: linear-gradient(135deg, #059669, #10b981); color: white; }
    .badge-guangya { background: linear-gradient(135deg, #d97706, #f59e0b); color: white; }
    .badge-mobile { background: linear-gradient(135deg, #0891b2, #06b6d4); color: white; }
    .badge-pikpak { background: linear-gradient(135deg, #4f46e5, #6366f1); color: white; }
    .badge-magnet { background: linear-gradient(135deg, #7c3aed, #8b5cf6); color: white; }
    .badge-ed2k { background: linear-gradient(135deg, #9333ea, #a855f7); color: white; }
    .badge-google { background: linear-gradient(135deg, #ea4335, #f87171); color: white; }
    .badge-others { background: linear-gradient(135deg, #64748b, #94a3b8); color: white; }
    .badge-other { background: linear-gradient(135deg, #64748b, #94a3b8); color: white; }

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

    [v-cloak] { display: none; }
  </style>
  <script src="/assets/vue.js?v=${VENDOR_VERSION}"></script>
</head>
<body class="bg-gradient-to-b from-slate-50 via-slate-50 to-slate-100/60 text-slate-800 min-h-screen flex flex-col font-sans antialiased">
  <div id="app" v-cloak class="flex flex-col min-h-screen">
    <!-- 顶栏导航 -->
    <header class="border-b border-slate-200/80 bg-white/80 sticky top-0 z-40 backdrop-blur-md">
      <div class="max-w-6xl mx-auto px-4 h-16 flex items-center justify-between">
        <div class="flex items-center space-x-3 cursor-pointer group" @click="resetToHome">
          <div class="w-10 h-10 rounded-xl bg-gradient-to-tr from-blue-600 via-indigo-600 to-indigo-500 flex items-center justify-center text-white font-bold text-lg shadow-md shadow-blue-500/20 group-hover:scale-105 transition-transform">
            <i class="fa-solid fa-bolt"></i>
          </div>
          <div>
            <div class="flex items-center space-x-2">
              <h1 class="font-bold text-lg leading-tight bg-gradient-to-r from-blue-600 via-indigo-600 to-indigo-700 bg-clip-text text-transparent">PanSou Edge</h1>
              <span class="text-[10px] uppercase font-bold tracking-wider px-1.5 py-0.5 rounded bg-blue-50 text-blue-600 border border-blue-100/60">Edge</span>
            </div>
            <p class="text-[11px] text-slate-400">极速全网盘聚合 · 智能失效检测</p>
          </div>
        </div>

        <div class="flex items-center space-x-2">
          <button @click="showApiModal = true" class="px-3 py-1.5 text-xs font-medium text-slate-600 hover:text-blue-600 hover:bg-slate-100/80 rounded-lg transition flex items-center space-x-1">
            <i class="fa-solid fa-code"></i>
            <span>API 接口</span>
          </button>
          <button @click="openAdmin" class="px-3 py-1.5 text-xs font-medium text-blue-600 bg-blue-50 hover:bg-blue-100/80 rounded-lg transition flex items-center space-x-1">
            <i class="fa-solid fa-sliders"></i>
            <span>管理后台</span>
          </button>
        </div>
      </div>
    </header>

    <!-- 主搜索内容区 -->
    <main class="flex-1 max-w-6xl w-full mx-auto px-4 py-8">
      <!-- 搜索框区域 -->
      <div class="text-center mb-8 pt-2 sm:pt-4">
        <h2 class="text-3xl font-extrabold text-slate-900 tracking-tight sm:text-4xl mb-3">
          搜你想搜，即刻触达
        </h2>
        <p class="text-slate-500 max-w-xl mx-auto text-xs sm:text-sm">
          原生并发抓取 Telegram 公开频道与聚合插件，支持阿里、夸克、百度、UC、天翼、迅雷、123 等 15+ 类主流网盘
        </p>

        <!-- 搜索表单
             关键点：按钮**参与 flex 布局**（不再用 absolute），并设 shrink-0，
             因此无论窗口多窄，按钮都不会被压缩、文字也不会溢出到框外；
             输入框 flex-1 + min-w-0 只占用剩余空间。 -->
        <div class="mt-7 w-full max-w-3xl mx-auto">
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
                type="text"
                v-model="keyword"
                autocomplete="off"
                enterkeyhint="search"
                placeholder="搜索电影、剧集、动漫、电子书…"
                class="flex-1 min-w-0 bg-transparent border-0 outline-none py-2.5 text-sm sm:text-base text-slate-800 placeholder-slate-400"
              />
              <button
                v-if="keyword"
                type="button"
                @click="keyword = ''"
                class="shrink-0 px-1.5 text-slate-300 hover:text-slate-500 transition"
                title="清空"
              >
                <i class="fa-solid fa-circle-xmark text-sm"></i>
              </button>
              <button
                id="search-submit"
                type="submit"
                :disabled="loading"
                class="shrink-0 whitespace-nowrap px-4 sm:px-5 py-2.5 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white font-medium text-sm rounded-xl transition shadow-md shadow-blue-500/20 disabled:opacity-50 flex items-center gap-1.5"
              >
                <i class="fa-solid" :class="loading ? 'fa-circle-notch fa-spin' : 'fa-magnifying-glass'"></i>
                <span>{{ loading ? '检索中' : '搜索' }}</span>
              </button>
            </div>
          </form>

          <!-- 热门搜索推荐 -->
          <div class="mt-4 flex flex-wrap items-center justify-center gap-1.5 sm:gap-2 text-xs text-slate-500">
            <span class="font-medium text-slate-400 flex items-center">
              <i class="fa-solid fa-fire text-amber-500 mr-1"></i>大家都在搜:
            </span>
            <span
              v-for="tag in hotSearches"
              :key="tag"
              @click="quickSearch(tag)"
              class="cursor-pointer bg-white hover:bg-blue-50 hover:text-blue-600 hover:border-blue-200 border border-slate-200/60 px-2.5 py-1 rounded-full transition shadow-2xs text-[11px] sm:text-xs"
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
      <div v-if="searched" class="mt-8">
        <!-- 分类切换 Tabs & 工具条 -->
        <div class="mb-6">
          <!-- 网盘分类：自动换行，保证每个分类都完整可见（不再横向滚动截断） -->
          <div id="cloud-tabs" class="flex flex-wrap items-center gap-1.5 sm:gap-2">
            <button
              @click="activeTab = 'all'"
              :class="activeTab === 'all'
                ? 'bg-blue-600 border-blue-600 text-white font-semibold shadow-sm shadow-blue-500/25'
                : 'bg-white border-slate-200/80 text-slate-600 hover:border-blue-200 hover:text-blue-600'"
              class="px-3 sm:px-3.5 py-1.5 rounded-xl border text-xs sm:text-sm transition flex items-center gap-1.5"
            >
              <span>全部网盘</span>
              <span
                class="text-[10px] font-semibold px-1.5 py-0.5 rounded-full"
                :class="activeTab === 'all' ? 'bg-white/25' : 'bg-slate-100 text-slate-500'"
              >{{ totalCount }}</span>
            </button>
            <button
              v-for="(items, type) in mergedResults"
              :key="type"
              @click="activeTab = type"
              :class="activeTab === type
                ? 'bg-blue-600 border-blue-600 text-white font-semibold shadow-sm shadow-blue-500/25'
                : 'bg-white border-slate-200/80 text-slate-600 hover:border-blue-200 hover:text-blue-600'"
              class="px-3 py-1.5 rounded-xl border text-xs sm:text-sm transition flex items-center gap-1.5"
            >
              <span>{{ getCloudLabel(type) }}</span>
              <span
                class="text-[10px] font-semibold px-1.5 py-0.5 rounded-full"
                :class="activeTab === type ? 'bg-white/25' : 'bg-slate-100 text-slate-500'"
              >{{ items.length }}</span>
            </button>
          </div>

          <!-- 工具条：自动测活开关 / 只看有效 / 批量检测 -->
          <div id="result-toolbar" class="mt-3 pt-3 border-t border-slate-200/80 flex flex-wrap items-center gap-2 text-xs">
            <!-- 自动测活开关（默认存在，一键开启） -->
            <button
              @click="toggleAutoCheck"
              class="flex items-center gap-2 pl-2.5 pr-3 py-1.5 rounded-xl border font-medium transition"
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
              class="flex items-center gap-1.5 cursor-pointer select-none px-2.5 py-1.5 rounded-xl border border-slate-200/80 bg-white text-slate-600 hover:text-blue-600 transition"
            >
              <input type="checkbox" v-model="filterValidOnly" class="rounded text-blue-600 focus:ring-0">
              <span>只看有效 ({{ validOnlyCount }})</span>
            </label>

            <!-- 批量一键检测按钮 -->
            <button
              @click="batchCheckCurrent"
              :disabled="batchChecking || currentList.length === 0"
              class="px-3 py-1.5 bg-white hover:bg-blue-50 text-slate-700 hover:text-blue-600 border border-slate-200/80 rounded-xl transition flex items-center gap-1.5 font-medium disabled:opacity-50"
              title="检测当前分类下所有网盘链接是否失效"
            >
              <i class="fa-solid" :class="batchChecking ? 'fa-circle-notch fa-spin text-blue-600' : 'fa-stethoscope text-emerald-600'"></i>
              <span v-if="batchChecking">检测中 {{ checkedCount }}/{{ checkingTarget }}</span>
              <span v-else>检测本页有效性</span>
            </button>

            <span class="text-slate-400 ml-auto whitespace-nowrap">
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
          <p class="text-slate-400 text-xs">请尝试更换更简短的关键词，或在管理后台开启更多搜索源</p>
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

    <!-- API 接入说明弹窗 (Modal) -->
    <div v-if="showApiModal" class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm">
      <div class="bg-white rounded-2xl max-w-2xl w-full p-6 shadow-2xl border border-slate-100 max-h-[90vh] overflow-y-auto">
        <div class="flex items-center justify-between pb-3 border-b border-slate-100">
          <h3 class="font-bold text-lg text-slate-800">
            <i class="fa-solid fa-code text-blue-600 mr-2"></i>开放 API 接口文档
          </h3>
          <button @click="showApiModal = false" class="text-slate-400 hover:text-slate-600">
            <i class="fa-solid fa-xmark text-lg"></i>
          </button>
        </div>
        <div class="mt-4 space-y-4 text-xs">
          <div>
            <h4 class="font-bold text-slate-700 text-sm mb-1">1. 核心聚合搜索</h4>
            <div class="bg-slate-900 text-slate-200 p-3 rounded-xl font-mono text-xs overflow-x-auto">
              POST /api/search<br>
              Body: {"kw":"三体", "res":"merge"}<br>
              返回: {"code":0, "message":"success", "data":{ "total":..., "merged_by_type":{...} }}
            </div>
          </div>
          <div>
            <h4 class="font-bold text-slate-700 text-sm mb-1">2. 网盘链接有效性检测</h4>
            <div class="bg-slate-900 text-slate-200 p-3 rounded-xl font-mono text-xs overflow-x-auto">
              GET /api/check?url=https://pan.quark.cn/s/xxx<br>
              返回: {"code":0, "valid":true, "status":"valid", "label":"有效"}
            </div>
          </div>
          <div>
            <h4 class="font-bold text-slate-700 text-sm mb-1">3. 频道与插件列表</h4>
            <div class="bg-slate-900 text-slate-200 p-3 rounded-xl font-mono text-xs">
              GET /api/channels · GET /api/plugins
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- 管理后台弹窗 (Modal) -->
    <div v-if="showAdminModal" class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm">
      <div class="bg-white rounded-2xl max-w-4xl w-full p-6 shadow-2xl border border-slate-100 max-h-[90vh] flex flex-col">
        <!-- 后台顶部 -->
        <div class="flex items-center justify-between pb-4 border-b border-slate-100">
          <div class="flex items-center space-x-2">
            <i class="fa-solid fa-sliders text-blue-600 text-xl"></i>
            <h3 class="font-bold text-lg text-slate-800">系统管理后台</h3>
            <span class="text-xs bg-slate-100 text-slate-500 px-2 py-0.5 rounded font-mono">/admin</span>
          </div>
          <button @click="closeAdmin" class="text-slate-400 hover:text-slate-600">
            <i class="fa-solid fa-xmark text-lg"></i>
          </button>
        </div>

        <!-- 密码登录框 -->
        <div v-if="!isAdminAuthed" class="py-12 max-w-sm mx-auto w-full text-center">
          <h4 class="text-base font-semibold text-slate-800 mb-2">请输入后台管理员密码</h4>
          <p class="text-xs text-slate-400 mb-4">默认密码为 <code>admin</code>，可在环境变量中修改</p>
          <div class="flex space-x-2">
            <input
              type="password"
              v-model="adminInputPwd"
              placeholder="管理员密码"
              @keyup.enter="authAdmin"
              class="flex-1 px-4 py-2 text-sm border rounded-xl focus:border-blue-600 focus:outline-none"
            />
            <button
              @click="authAdmin"
              class="px-4 py-2 bg-blue-600 text-white rounded-xl text-sm font-medium hover:bg-blue-700 transition"
            >
              登录
            </button>
          </div>
        </div>

        <!-- 后台管理主体 (已登录) -->
        <div v-else class="flex-1 flex flex-col overflow-hidden pt-4">
          <!-- KV 状态提示 -->
          <div v-if="!kvBound" class="mb-3 px-3 py-2 bg-amber-50 border border-amber-200 rounded-xl text-amber-800 text-xs flex items-center justify-between">
            <div class="flex items-center space-x-1.5">
              <i class="fa-solid fa-triangle-exclamation text-amber-500"></i>
              <span><strong>提示：</strong>当前未绑定 KV 命名空间，修改的配置仅在内存生效，Worker 重启后会恢复默认。</span>
            </div>
          </div>

          <!-- 导航 Tabs 与批量工具条 -->
          <div class="flex items-center justify-between border-b border-slate-200 pb-2 mb-4">
            <div class="flex space-x-4">
              <button
                @click="adminTab = 'channels'"
                class="text-sm pb-2 transition"
                :class="adminTab === 'channels' ? 'border-b-2 border-blue-600 text-blue-600 font-bold' : 'text-slate-500'"
              >
                Telegram 频道 ({{ adminSettings.channels.length }})
              </button>
              <button
                @click="adminTab = 'plugins'"
                class="text-sm pb-2 transition"
                :class="adminTab === 'plugins' ? 'border-b-2 border-blue-600 text-blue-600 font-bold' : 'text-slate-500'"
              >
                搜索插件 ({{ (adminSettings.plugins || []).length }})
              </button>
              <button
                @click="adminTab = 'system'"
                class="text-sm pb-2 transition"
                :class="adminTab === 'system' ? 'border-b-2 border-blue-600 text-blue-600 font-bold' : 'text-slate-500'"
              >
                系统与参数设置
              </button>
            </div>

            <!-- 批量导入/操作快捷按钮 -->
            <div class="flex items-center space-x-2">
              <button
                @click="openBatchModal"
                class="px-2.5 py-1 text-xs bg-indigo-50 text-indigo-600 hover:bg-indigo-100 rounded-lg font-medium transition flex items-center"
              >
                <i class="fa-solid fa-file-import mr-1"></i> 批量导入
              </button>
              <button
                @click="exportCurrentConfig"
                class="px-2.5 py-1 text-xs bg-slate-100 text-slate-700 hover:bg-slate-200 rounded-lg transition"
              >
                <i class="fa-solid fa-download mr-1"></i> 导出
              </button>
              <button
                @click="resetToDefaults"
                class="px-2.5 py-1 text-xs bg-amber-50 text-amber-700 hover:bg-amber-100 rounded-lg transition"
              >
                <i class="fa-solid fa-rotate-left mr-1"></i> 恢复默认
              </button>
            </div>
          </div>

          <!-- 内容区域 (滚动) -->
          <div class="flex-1 overflow-y-auto pr-1">
            <!-- 1. Telegram 频道管理 -->
            <div v-if="adminTab === 'channels'" class="space-y-4">
              <div class="flex flex-wrap items-center justify-between gap-2 bg-slate-50 p-2 rounded-xl">
                <div class="flex items-center space-x-2">
                  <input
                    type="text"
                    v-model="channelFilter"
                    placeholder="按名称/类型筛选..."
                    class="px-3 py-1 text-xs border rounded-lg focus:outline-none w-44"
                  />
                  <span class="text-xs text-slate-400">
                    已启用: {{ enabledChannelsCount }} / {{ adminSettings.channels.length }}
                  </span>
                </div>
                <div class="flex space-x-2">
                  <button @click="toggleAllChannels(true)" class="px-2 py-1 text-xs bg-slate-200 hover:bg-slate-300 rounded">全部启用</button>
                  <button @click="toggleAllChannels(false)" class="px-2 py-1 text-xs bg-slate-200 hover:bg-slate-300 rounded">全部禁用</button>
                  <button @click="addChannel" class="px-2.5 py-1 text-xs bg-blue-600 hover:bg-blue-700 text-white rounded font-medium">+ 添加频道</button>
                </div>
              </div>

              <div class="border rounded-xl overflow-hidden text-xs">
                <div class="max-h-[50vh] overflow-y-auto">
                  <table class="w-full text-left">
                    <thead class="bg-slate-100 sticky top-0 text-slate-600">
                      <tr>
                        <th class="p-2 w-12 text-center">启用</th>
                        <th class="p-2">频道 Username</th>
                        <th class="p-2">描述 / 标签</th>
                        <th class="p-2 w-20">优先级</th>
                        <th class="p-2 w-12 text-center">操作</th>
                      </tr>
                    </thead>
                    <tbody class="divide-y divide-slate-100">
                      <tr v-for="ch in filteredChannels" :key="ch.name" class="hover:bg-slate-50">
                        <td class="p-2 text-center">
                          <input type="checkbox" v-model="ch.enabled" class="rounded text-blue-600" />
                        </td>
                        <td class="p-2 font-mono font-medium text-slate-700">@{{ ch.name }}</td>
                        <td class="p-2"><input type="text" v-model="ch.description" class="w-full px-2 py-0.5 border rounded bg-transparent text-xs" /></td>
                        <td class="p-2">
                          <select v-model="ch.priority" class="px-1 py-0.5 border rounded bg-transparent text-xs">
                            <option :value="1">高</option>
                            <option :value="2">中</option>
                            <option :value="3">低</option>
                          </select>
                        </td>
                        <td class="p-2 text-center">
                          <button @click="removeChannel(ch)" class="text-rose-500 hover:text-rose-700"><i class="fa-regular fa-trash-can"></i></button>
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
            </div>

            <!-- 2. 搜索插件管理 -->
            <div v-if="adminTab === 'plugins'" class="space-y-4 text-xs">
              <div class="flex items-center justify-between bg-slate-50 p-2 rounded-xl">
                <div class="text-xs text-slate-600">
                  启用的插件：<strong>{{ enabledPluginsCount }}</strong> / {{ (adminSettings.plugins || []).length }}
                  <span class="text-slate-400 ml-2">（共连接 {{ pluginIdCount }} 个外部插件源）</span>
                </div>
                <button @click="addPlugin" class="px-2.5 py-1 text-xs bg-blue-600 hover:bg-blue-700 text-white rounded font-medium">+ 添加插件</button>
              </div>

              <div v-if="!adminSettings.plugins || adminSettings.plugins.length === 0" class="p-8 text-center bg-slate-50 rounded-xl border border-dashed border-slate-200 text-slate-400">
                暂无配置插件，点击右上角「恢复默认」可载入内置插件节点
              </div>

              <div v-else class="space-y-3">
                <div v-for="pl in adminSettings.plugins" :key="pl.id" class="p-3 border rounded-xl bg-slate-50/60 space-y-2">
                  <div class="flex items-center justify-between">
                    <div class="flex items-center space-x-2">
                      <input type="checkbox" v-model="pl.enabled" class="rounded text-blue-600" />
                      <input type="text" v-model="pl.name" placeholder="插件名称" class="px-2 py-1 font-semibold text-xs border rounded bg-white" />
                      <span class="text-[10px] px-1.5 py-0.5 rounded bg-slate-200 text-slate-600 font-mono">{{ pl.type }}</span>
                    </div>
                    <button @click="removePlugin(pl)" class="text-rose-500 hover:text-rose-700 text-xs"><i class="fa-regular fa-trash-can mr-1"></i>删除</button>
                  </div>

                  <div class="grid grid-cols-1 md:grid-cols-2 gap-2">
                    <div>
                      <label class="block text-slate-500 mb-0.5">接口 Endpoint URL</label>
                      <input type="text" v-model="pl.apiEndpoint" class="w-full px-2 py-1 border rounded bg-white font-mono text-[11px]" />
                    </div>
                    <div>
                      <label class="block text-slate-500 mb-0.5">插件类型</label>
                      <select v-model="pl.type" class="w-full px-2 py-1 border rounded bg-white text-xs">
                        <option value="pansou">pansou 兼容节点</option>
                        <option value="custom">通用 REST API</option>
                      </select>
                    </div>
                  </div>

                  <div v-if="pl.type === 'pansou'">
                    <label class="block text-slate-500 mb-0.5">远端插件 ID 列表（逗号分隔）</label>
                    <textarea
                      :value="(pl.pluginIds || []).join(',')"
                      @input="pl.pluginIds = $event.target.value.split(',').map(s => s.trim()).filter(Boolean)"
                      rows="2"
                      class="w-full px-2 py-1 border rounded bg-white font-mono text-[11px] text-slate-600"
                    ></textarea>
                  </div>
                </div>
              </div>
            </div>

            <!-- 3. 系统与参数设置 -->
            <div v-if="adminTab === 'system'" class="space-y-4 text-xs">
              <div class="bg-slate-50 p-4 rounded-xl space-y-3">
                <h4 class="font-bold text-slate-700 text-sm">并发与缓存配置</h4>
                <div class="grid grid-cols-2 gap-4">
                  <div>
                    <label class="block text-slate-600 mb-1">单次调用的并发数</label>
                    <input type="number" v-model="adminSettings.concurrency" min="1" max="10" class="w-full px-3 py-1.5 border rounded-lg bg-white" />
                  </div>
                  <div>
                    <label class="block text-slate-600 mb-1">结果缓存时间 (秒)</label>
                    <input type="number" v-model="adminSettings.cacheTtl" min="0" max="86400" class="w-full px-3 py-1.5 border rounded-lg bg-white" />
                  </div>
                </div>
              </div>

              <div class="bg-slate-50 p-4 rounded-xl space-y-3">
                <h4 class="font-bold text-slate-700 text-sm">反代与安全配置</h4>
                <div>
                  <label class="block text-slate-600 mb-1">自定义 Telegram 镜像反代 URL (可选)</label>
                  <input type="text" v-model="adminSettings.tgProxyUrl" placeholder="如 https://tg.yourdomain.com" class="w-full px-3 py-1.5 border rounded-lg bg-white" />
                </div>
                <div>
                  <label class="block text-slate-600 mb-1">修改管理员密码</label>
                  <input type="password" v-model="adminSettings.adminPassword" placeholder="留空则保持原密码" class="w-full px-3 py-1.5 border rounded-lg bg-white" />
                </div>
              </div>
            </div>
          </div>

          <!-- 保存按钮 -->
          <div class="pt-4 border-t border-slate-100 flex items-center justify-end space-x-3">
            <button
              @click="saveSettings"
              class="px-6 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-sm font-semibold shadow-md transition"
            >
              保存配置
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- 批量导入通用弹窗 (Modal) -->
    <div v-if="showBatchModal" class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm">
      <div class="bg-white rounded-2xl max-w-xl w-full p-6 shadow-2xl border border-slate-100">
        <div class="flex items-center justify-between pb-3 border-b border-slate-100">
          <h3 class="font-bold text-base text-slate-800">
            <i class="fa-solid fa-file-import text-indigo-600 mr-2"></i>批量导入 Telegram 频道
          </h3>
          <button @click="showBatchModal = false" class="text-slate-400 hover:text-slate-600">
            <i class="fa-solid fa-xmark text-lg"></i>
          </button>
        </div>

        <div class="mt-4 space-y-3 text-xs">
          <div>
            <textarea
              v-model="batchInputText"
              rows="8"
              placeholder="channel1, @channel2, https://t.me/s/channel3"
              class="w-full p-3 border rounded-xl font-mono text-xs focus:border-blue-600 focus:outline-none"
            ></textarea>
          </div>

          <div class="flex items-center justify-between pt-2">
            <label class="flex items-center space-x-1.5 text-slate-600 cursor-pointer">
              <input type="checkbox" v-model="batchEnableAll" class="rounded text-blue-600" />
              <span>导入后默认启用</span>
            </label>
            <div class="flex space-x-2">
              <button @click="showBatchModal = false" class="px-4 py-1.5 bg-slate-100 text-slate-600 rounded-lg hover:bg-slate-200">
                取消
              </button>
              <button @click="doBatchImport" class="px-4 py-1.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-semibold">
                确认导入
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>

  <script>
    const { createApp, ref, computed, onMounted } = Vue;

    const app = createApp({
      setup() {
        const keyword = ref('');
        const searched = ref(false);
        const loading = ref(false);
        const activeTab = ref('all');
        const showApiModal = ref(false);
        const showAdminModal = ref(false);
        const showBatchModal = ref(false);
        const batchInputText = ref('');
        const batchEnableAll = ref(true);

        const hotSearches = ref(['热辣滚烫', '周处除三害', '沙丘2', '繁花', '三体', '庆余年', '黑神话悟空', '流浪地球2']);
        const mergedResults = ref({});
        const totalCount = ref(0);
        const searchProgress = ref({ done: 0, total: 0 });

        // 失效检测状态映射: { [url]: { status: 'checking'|'valid'|'invalid'|'unknown', label: '有效'|'已失效'|'需提取码' } }
        const itemStatusMap = ref({});
        const batchChecking = ref(false);
        const filterValidOnly = ref(false);
        // 自动测活：默认开启，搜索完成后自动检测当前列表前若干条链接
        const autoCheck = ref(true);
        const checkingTarget = ref(0);

        // 后台管理状态
        const isAdminAuthed = ref(false);
        const adminInputPwd = ref('');
        const adminTab = ref('channels');
        const channelFilter = ref('');
        const adminSettings = ref({
          channels: [],
          plugins: [],
          concurrency: 6,
          maxChannelsPerSearch: 8,
          maxPluginsPerSearch: 2,
          cacheTtl: 300,
          tgProxyUrl: '',
          adminPassword: ''
        });
        const kvBound = ref(true);

        // 网盘名称映射
        const CLOUD_MAP = {
          aliyun: '阿里云盘',
          quark: '夸克网盘',
          baidu: '百度网盘',
          tianyi: '天翼云盘',
          uc: 'UC网盘',
          mobile: '移动云盘',
          115: '115网盘',
          pikpak: 'PikPak',
          xunlei: '迅雷云盘',
          123: '123网盘',
          guangya: '光鸭网盘',
          magnet: '磁力链接',
          ed2k: '电驴链接',
          google: '谷歌网盘',
          others: '其他网盘',
          other: '其他网盘'
        };

        const getCloudLabel = (type) => CLOUD_MAP[type] || type || '其他网盘';

        // 扁平化全部结果列表
        const allList = computed(() => {
          const list = [];
          for (const [type, items] of Object.entries(mergedResults.value)) {
            items.forEach(it => list.push({ ...it, cloudType: type }));
          }
          return list;
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
            const r = await fetch('/api/check', {
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

        const filteredChannels = computed(() => {
          if (!channelFilter.value.trim()) return adminSettings.value.channels;
          const kw = channelFilter.value.toLowerCase();
          return adminSettings.value.channels.filter(c =>
            c.name.toLowerCase().includes(kw) || (c.description || '').toLowerCase().includes(kw)
          );
        });

        const enabledChannelsCount = computed(() =>
          adminSettings.value.channels.filter(c => c.enabled).length
        );

        const enabledPluginsCount = computed(() =>
          (adminSettings.value.plugins || []).filter(p => p.enabled).length
        );

        const pluginIdCount = computed(() => {
          const ids = new Set();
          for (const p of adminSettings.value.plugins || []) {
            for (const id of p.pluginIds || []) ids.add(id);
          }
          return ids.size;
        });

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
          const mergeInto = (byType) => {
            for (const type in byType) {
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
              const chRes = await fetch('/api/channels');
              cachedChannelsInfo = await chRes.json();
            }
            if (!cachedPluginsInfo) {
              try {
                const plRes = await fetch('/api/plugins');
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
                    const r = await fetch('/api/search', {
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
                const r = await fetch('/api/search', {
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
        };

        const openAdmin = () => {
          showAdminModal.value = true;
          if (!window.location.hash.includes('admin')) {
            history.pushState(null, '', '#/admin');
          }
          const savedToken = localStorage.getItem('pansou_admin_token');
          if (savedToken) {
            adminInputPwd.value = savedToken;
            authAdmin();
          }
        };

        const closeAdmin = () => {
          showAdminModal.value = false;
          if (window.location.hash.includes('admin')) {
            history.pushState(null, '', window.location.pathname + window.location.search);
          }
        };

        const authAdmin = async () => {
          const token = adminInputPwd.value.trim();
          if (!token) return;

          try {
            const res = await fetch('/api/admin/settings', {
              headers: { Authorization: 'Bearer ' + token }
            });
            if (res.ok) {
              const data = await res.json();
              if (!Array.isArray(data.plugins)) data.plugins = [];
              if (typeof data.maxPluginsPerSearch !== 'number') data.maxPluginsPerSearch = 2;
              adminSettings.value = data;
              kvBound.value = data.kv_bound !== false;
              isAdminAuthed.value = true;
              localStorage.setItem('pansou_admin_token', token);
            } else {
              alert('管理员密码错误');
            }
          } catch (e) {
            alert('加载配置失败');
          }
        };

        const toggleAllChannels = (status) => {
          adminSettings.value.channels.forEach(c => c.enabled = status);
        };

        const addChannel = () => {
          const name = prompt('请输入 Telegram 频道 username (无需 @ 或 https://t.me/):');
          if (name && name.trim()) {
            const cleanName = name.trim().replace(/^@/, '').replace(/^https?:\\/\\/t\\.me\\/(s\\/)?/, '');
            adminSettings.value.channels.unshift({
              name: cleanName,
              enabled: true,
              priority: 2,
              description: '用户自定义添加'
            });
          }
        };

        const removeChannel = (ch) => {
          if (confirm('确定删除频道 @' + ch.name + ' 吗？')) {
            adminSettings.value.channels = adminSettings.value.channels.filter(c => c !== ch);
          }
        };

        const addPlugin = () => {
          const id = prompt('请输入插件 ID（唯一标识）:');
          if (!id || !id.trim()) return;
          const endpoint = prompt('请输入接口地址：');
          if (!endpoint || !endpoint.trim()) return;

          if (!adminSettings.value.plugins) adminSettings.value.plugins = [];
          adminSettings.value.plugins.push({
            id: id.trim(),
            name: id.trim(),
            enabled: true,
            type: 'pansou',
            apiEndpoint: endpoint.trim(),
            pluginIds: []
          });
        };

        const removePlugin = (pl) => {
          if (!confirm('确定删除插件「' + (pl.name || pl.id) + '」吗？')) return;
          adminSettings.value.plugins = (adminSettings.value.plugins || []).filter(p => p !== pl);
        };

        const openBatchModal = () => {
          batchInputText.value = '';
          showBatchModal.value = true;
        };

        const doBatchImport = () => {
          const raw = batchInputText.value.trim();
          if (!raw) return;

          const tokens = raw.split(/[\\r\\n,;，；]+/).map(s => s.trim()).filter(Boolean);
          let count = 0;

          tokens.forEach(tok => {
            const clean = tok
              .replace(/^@/, '')
              .replace(/^https?:\\/\\/t\\.me\\/(s\\/)?/, '')
              .replace(/[/?#].*$/, '')
              .trim();
            if (
              clean &&
              /^[A-Za-z0-9_]{4,64}$/.test(clean) &&
              !adminSettings.value.channels.some(c => c.name.toLowerCase() === clean.toLowerCase())
            ) {
              adminSettings.value.channels.unshift({
                name: clean,
                enabled: batchEnableAll.value,
                priority: 2,
                description: '批量导入频道'
              });
              count++;
            }
          });

          alert('成功批量导入 ' + count + ' 个频道！记得点击「保存配置」生效。');
          if (count > 0) showBatchModal.value = false;
        };

        const exportCurrentConfig = () => {
          const exportData = {
            channels: adminSettings.value.channels,
            plugins: adminSettings.value.plugins || [],
            concurrency: adminSettings.value.concurrency,
            maxChannelsPerSearch: adminSettings.value.maxChannelsPerSearch,
            maxPluginsPerSearch: adminSettings.value.maxPluginsPerSearch,
            cacheTtl: adminSettings.value.cacheTtl,
            exportedAt: new Date().toISOString()
          };
          const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = 'pansou-config-' + Date.now() + '.json';
          a.click();
        };

        const saveSettings = async () => {
          const token = adminInputPwd.value.trim() || localStorage.getItem('pansou_admin_token') || 'admin';
          try {
            const payload = {
              channels: adminSettings.value.channels,
              plugins: adminSettings.value.plugins || [],
              concurrency: Number(adminSettings.value.concurrency) || 6,
              maxChannelsPerSearch: Number(adminSettings.value.maxChannelsPerSearch) || 8,
              maxPluginsPerSearch: Number(adminSettings.value.maxPluginsPerSearch) || 2,
              cacheTtl: Number(adminSettings.value.cacheTtl) || 300,
              tgProxyUrl: adminSettings.value.tgProxyUrl || ''
            };
            if (adminSettings.value.adminPassword) {
              payload.adminPassword = adminSettings.value.adminPassword;
            }

            const res = await fetch('/api/admin/settings', {
              method: 'POST',
              headers: {
                'Authorization': 'Bearer ' + token,
                'Content-Type': 'application/json'
              },
              body: JSON.stringify(payload)
            });
            const data = await res.json().catch(() => ({}));

            if (res.ok && data.code === 0) {
              const enabledCount = payload.channels.filter(c => c.enabled).length;
              const enabledPlugins = payload.plugins.filter(p => p.enabled).length;
              alert('配置保存成功！当前已启用 ' + enabledCount + ' 个频道、' + enabledPlugins + ' 个插件。');
              if (adminSettings.value.adminPassword) {
                localStorage.setItem('pansou_admin_token', adminSettings.value.adminPassword);
              }
            } else {
              alert('保存失败：' + (data.message || '请检查密码或 KV 绑定'));
            }
          } catch (e) {
            alert('保存异常');
          }
        };

        const resetToDefaults = async () => {
          if (!confirm('确定要恢复出厂配置吗？\\n将重新载入内置的全部 Telegram 频道与搜索插件，当前自定义修改会被覆盖。')) return;
          try {
            const res = await fetch('/api/admin/defaults', {
              headers: { 'Authorization': 'Bearer ' + (adminInputPwd.value.trim() || localStorage.getItem('pansou_admin_token') || 'admin') }
            });
            if (!res.ok) {
              alert('获取默认配置失败');
              return;
            }
            const data = await res.json();
            adminSettings.value.channels = data.channels || [];
            adminSettings.value.plugins = data.plugins || [];
            adminSettings.value.maxChannelsPerSearch = data.maxChannelsPerSearch || 8;
            adminSettings.value.maxPluginsPerSearch = data.maxPluginsPerSearch || 2;
            alert('已载入内置配置：' + adminSettings.value.channels.length + ' 个频道、' + adminSettings.value.plugins.length + ' 个插件。\\n请点击「保存配置」写入生效。');
          } catch (e) {
            alert('载入失败');
          }
        };

        onMounted(async () => {
          if (window.location.pathname.startsWith('/admin') || window.location.hash.includes('admin')) {
            openAdmin();
          }

          window.addEventListener('hashchange', () => {
            if (window.location.hash.includes('admin')) {
              openAdmin();
            } else if (showAdminModal.value) {
              showAdminModal.value = false;
            }
          });

          try {
            const res = await fetch('/api/hot');
            const data = await res.json();
            if (data.hotSearches && data.hotSearches.length > 0) {
              hotSearches.value = data.hotSearches;
            }
          } catch (e) {}
        });

        return {
          keyword,
          searched,
          loading,
          activeTab,
          showApiModal,
          showAdminModal,
          showBatchModal,
          batchInputText,
          batchEnableAll,
          hotSearches,
          mergedResults,
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
          isAdminAuthed,
          adminInputPwd,
          adminTab,
          channelFilter,
          adminSettings,
          kvBound,
          filteredChannels,
          enabledChannelsCount,
          enabledPluginsCount,
          pluginIdCount,
          getCloudLabel,
          doSearch,
          quickSearch,
          resetToHome,
          openAdmin,
          closeAdmin,
          authAdmin,
          toggleAllChannels,
          addChannel,
          removeChannel,
          addPlugin,
          removePlugin,
          openBatchModal,
          doBatchImport,
          exportCurrentConfig,
          resetToDefaults,
          saveSettings
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

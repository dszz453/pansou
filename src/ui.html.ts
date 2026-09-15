import { VENDOR_VERSION } from './vendor.generated';
import { ICONS_CSS } from './icons';

export const HTML_TEMPLATE = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>PanSou & PanHub · 极速网盘搜索聚合</title>
  <!-- 全部前端资源同源自托管（无 unpkg / cdnjs / cdn.tailwindcss.com 等海外 CDN 依赖） -->
  <link rel="stylesheet" href="/assets/app.css?v=${VENDOR_VERSION}">
  <style>
${ICONS_CSS}
    .glass {
      background: rgba(255, 255, 255, 0.85);
      backdrop-filter: blur(12px);
      -webkit-backdrop-filter: blur(12px);
    }
    .badge-aliyun { background-color: #ff6a00; color: white; }
    .badge-quark { background-color: #2b77ef; color: white; }
    .badge-baidu { background-color: #2932e1; color: white; }
    .badge-tianyi { background-color: #e60012; color: white; }
    .badge-uc { background-color: #ff8c00; color: white; }
    .badge-115 { background-color: #1980ff; color: white; }
    .badge-xunlei { background-color: #0c82ff; color: white; }
    .badge-123 { background-color: #07c160; color: white; }
    .badge-guangya { background-color: #d97706; color: white; }
    .badge-mobile { background-color: #0284c7; color: white; }
    .badge-pikpak { background-color: #3b82f6; color: white; }
    .badge-magnet { background-color: #7b1fa2; color: white; }
    .badge-ed2k { background-color: #6366f1; color: white; }
    .badge-google { background-color: #ea4335; color: white; }
    .badge-others { background-color: #64748b; color: white; }
    .badge-other { background-color: #64748b; color: white; }
    [v-cloak] { display: none; }
  </style>
  <script src="/assets/vue.js?v=${VENDOR_VERSION}"></script>
</head>
<body class="bg-slate-50 text-slate-800 min-h-screen flex flex-col font-sans transition-colors duration-200">
  <div id="app" v-cloak class="flex flex-col min-h-screen">
    <!-- 顶栏导航 -->
    <header class="border-b border-slate-200 bg-white/70 sticky top-0 z-40 backdrop-blur">
      <div class="max-w-6xl mx-auto px-4 h-16 flex items-center justify-between">
        <div class="flex items-center space-x-3 cursor-pointer" @click="resetToHome">
          <div class="w-10 h-10 rounded-xl bg-gradient-to-tr from-blue-600 to-indigo-500 flex items-center justify-center text-white font-bold text-xl shadow-lg shadow-blue-500/30">
            <i class="fa-solid fa-bolt"></i>
          </div>
          <div>
            <h1 class="font-bold text-lg leading-tight bg-gradient-to-r from-blue-600 to-indigo-600 bg-clip-text text-transparent">PanSou Edge</h1>
            <p class="text-xs text-slate-500">Cloudflare 极速全网盘聚合</p>
          </div>
        </div>

        <div class="flex items-center space-x-2">
          <button @click="showApiModal = true" class="px-3 py-1.5 text-xs font-medium text-slate-600 hover:text-blue-600 hover:bg-slate-100 rounded-lg transition">
            <i class="fa-solid fa-code mr-1"></i> API 接口
          </button>
          <button @click="openAdmin" class="px-3 py-1.5 text-xs font-medium text-blue-600 bg-blue-50 hover:bg-blue-100 rounded-lg transition">
            <i class="fa-solid fa-sliders mr-1"></i> 管理后台
          </button>
        </div>
      </div>
    </header>

    <!-- 主搜索内容区 -->
    <main class="flex-1 max-w-5xl w-full mx-auto px-4 py-8">
      <!-- 搜索框区域 -->
      <div class="text-center mb-8 pt-4">
        <h2 class="text-3xl font-extrabold text-slate-900 tracking-tight sm:text-4xl mb-3">
          搜你想搜，即刻触达
        </h2>
        <p class="text-slate-500 max-w-xl mx-auto text-sm">
          多源并发聚合 Telegram 频道与网络插件，支持百度、阿里、夸克、UC、光鸭、天翼、迅雷、123、115、PikPak、移动等全网盘
        </p>

        <!-- 搜索表单 -->
        <div class="mt-8 max-w-2xl mx-auto">
          <form @submit.prevent="doSearch" class="relative flex items-center">
            <input
              type="text"
              v-model="keyword"
              placeholder="输入电影、电视剧、动漫、课程、软件或小说名称..."
              class="w-full pl-12 pr-28 py-4 bg-white border-2 border-slate-200 rounded-2xl shadow-sm hover:border-blue-400 focus:border-blue-600 focus:ring-4 focus:ring-blue-100 focus:outline-none text-base transition-all"
              autofocus
            />
            <div class="absolute left-4 text-slate-400">
              <i class="fa-solid fa-magnifying-glass text-lg"></i>
            </div>
            <button
              type="submit"
              :disabled="loading"
              class="absolute right-2 px-6 py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-xl shadow-md transition-all flex items-center disabled:opacity-50"
            >
              <i v-if="loading" class="fa-solid fa-circle-notch fa-spin mr-2"></i>
              <span>{{ loading ? '搜索中' : '搜索' }}</span>
            </button>
          </form>

          <!-- 热门搜索推荐 -->
          <div class="mt-4 flex flex-wrap items-center justify-center gap-2 text-xs text-slate-500">
            <span class="font-medium text-slate-400"><i class="fa-solid fa-fire text-amber-500 mr-1"></i>大家都在搜:</span>
            <span
              v-for="tag in hotSearches"
              :key="tag"
              @click="quickSearch(tag)"
              class="cursor-pointer bg-slate-100 hover:bg-blue-50 hover:text-blue-600 px-2.5 py-1 rounded-full transition"
            >
              {{ tag }}
            </span>
          </div>
        </div>
      </div>

      <!-- 检索进度 -->
      <div v-if="searched && loading" class="mt-6 flex items-center justify-center space-x-3 text-xs text-slate-500">
        <i class="fa-solid fa-circle-notch fa-spin text-blue-600"></i>
        <span>
          正在检索 Telegram 频道
          <strong class="text-slate-700">{{ searchProgress.done }}</strong>
          /
          <strong class="text-slate-700">{{ searchProgress.total }}</strong>
          个分片<span v-if="totalCount > 0">，已找到 <strong class="text-blue-600">{{ totalCount }}</strong> 条结果</span>
        </span>
        <div class="w-32 h-1.5 bg-slate-200 rounded-full overflow-hidden">
          <div
            class="h-full bg-blue-600 transition-all duration-300"
            :style="{ width: searchProgress.total ? (searchProgress.done / searchProgress.total * 100) + '%' : '0%' }"
          ></div>
        </div>
      </div>

      <!-- 搜索结果区 -->
      <div v-if="searched" class="mt-6">
        <!-- 分类切换 Tabs -->
        <div class="flex items-center justify-between border-b border-slate-200 pb-3 mb-6 overflow-x-auto">
          <div class="flex space-x-2">
            <button
              @click="activeTab = 'all'"
              :class="activeTab === 'all' ? 'bg-blue-600 text-white font-semibold' : 'bg-white text-slate-600 hover:bg-slate-100'"
              class="px-4 py-2 rounded-xl text-sm transition shadow-sm whitespace-nowrap"
            >
              全部结果 ({{ totalCount }})
            </button>
            <button
              v-for="(items, type) in mergedResults"
              :key="type"
              @click="activeTab = type"
              :class="activeTab === type ? 'bg-blue-600 text-white font-semibold' : 'bg-white text-slate-600 hover:bg-slate-100'"
              class="px-3.5 py-2 rounded-xl text-sm transition shadow-sm flex items-center space-x-1.5 whitespace-nowrap"
            >
              <span>{{ getCloudLabel(type) }}</span>
              <span class="text-xs opacity-80 px-1.5 py-0.5 rounded-full bg-black/10">
                {{ items.length }}
              </span>
            </button>
          </div>

          <div class="text-xs text-slate-400 hidden sm:block">
            找到 <strong class="text-slate-700">{{ currentList.length }}</strong> 条资源
          </div>
        </div>

        <!-- 列表内容 -->
        <div v-if="currentList.length > 0" class="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div
            v-for="(item, idx) in currentList"
            :key="idx"
            class="bg-white p-5 rounded-2xl border border-slate-200/80 hover:border-blue-400 hover:shadow-lg transition-all flex flex-col justify-between"
          >
            <div>
              <div class="flex items-start justify-between gap-2 mb-2">
                <span
                  class="text-xs font-semibold px-2.5 py-1 rounded-lg"
                  :class="'badge-' + (item.cloudType || activeTab)"
                >
                  {{ getCloudLabel(item.cloudType || activeTab) }}
                </span>
                <span class="text-xs text-slate-400">{{ item.datetime || '刚刚' }}</span>
              </div>
              <h3 class="text-base font-semibold text-slate-900 line-clamp-2 hover:text-blue-600 transition">
                <a :href="item.url" target="_blank" rel="noopener noreferrer">
                  {{ item.note || item.title || '网盘分享链接' }}
                </a>
              </h3>
            </div>

            <div class="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between text-xs">
              <div class="flex items-center space-x-2 text-slate-500 truncate max-w-[60%]">
                <i class="fa-solid fa-cloud"></i>
                <span class="truncate">{{ item.source || 'TG 频道 / 插件' }}</span>
              </div>

              <div class="flex items-center space-x-2">
                <span v-if="item.password" class="bg-amber-50 text-amber-700 font-mono font-medium px-2 py-1 rounded border border-amber-200">
                  提取码: {{ item.password }}
                </span>
                <a
                  :href="item.url"
                  target="_blank"
                  rel="noopener noreferrer"
                  class="px-3 py-1.5 bg-blue-50 text-blue-600 hover:bg-blue-600 hover:text-white rounded-lg font-medium transition"
                >
                  直达 <i class="fa-solid fa-arrow-up-right-from-square ml-1"></i>
                </a>
              </div>
            </div>
          </div>
        </div>

        <!-- 空数据提示 -->
        <div v-else-if="!loading" class="text-center py-16 bg-white rounded-2xl border border-dashed border-slate-300">
          <div class="w-16 h-16 bg-slate-100 rounded-full flex items-center justify-center mx-auto text-slate-400 text-2xl mb-4">
            <i class="fa-regular fa-folder-open"></i>
          </div>
          <h3 class="text-slate-700 font-semibold mb-1">未找到相关资源</h3>
          <p class="text-slate-400 text-xs">请尝试更换更简短的关键词，或在管理后台开启更多搜索源</p>
        </div>
      </div>
    </main>

    <!-- 页脚 -->
    <footer class="border-t border-slate-200 bg-white py-6 mt-auto text-center text-xs text-slate-400">
      <div class="max-w-5xl mx-auto px-4 flex flex-col sm:flex-row items-center justify-between gap-2">
        <div>
          Powered by <strong>Cloudflare Workers & KV</strong> · 边缘高速计算
        </div>
        <div class="flex space-x-4">
          <span>兼容 pansou-web / panhub 协议</span>
          <span>100% 边缘运行</span>
        </div>
      </div>
    </footer>

    <!-- API 接口文档弹窗 (Modal) -->
    <div v-if="showApiModal" class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm">
      <div class="bg-white rounded-2xl max-w-xl w-full p-6 shadow-2xl border border-slate-100 max-h-[90vh] overflow-y-auto">
        <div class="flex items-center justify-between pb-3 border-b border-slate-100">
          <h3 class="font-bold text-lg text-slate-800"><i class="fa-solid fa-code text-blue-600 mr-2"></i>API 接口文档</h3>
          <button @click="showApiModal = false" class="text-slate-400 hover:text-slate-600">
            <i class="fa-solid fa-xmark text-lg"></i>
          </button>
        </div>
        <div class="mt-4 space-y-4 text-xs">
          <div>
            <h4 class="font-bold text-slate-700 text-sm mb-1">1. 网盘搜索接口 (兼容 pansou-web)</h4>
            <div class="bg-slate-900 text-slate-200 p-3 rounded-xl font-mono text-xs overflow-x-auto">
              GET /api/search?kw={keyword}&res=merge<br>
              POST /api/search<br>
              Body: {"keyword":"三体", "res":"merge"}
            </div>
          </div>
          <div>
            <h4 class="font-bold text-slate-700 text-sm mb-1">2. 健康检查与源状态</h4>
            <div class="bg-slate-900 text-slate-200 p-3 rounded-xl font-mono text-xs">
              GET /api/health
            </div>
          </div>
          <div>
            <h4 class="font-bold text-slate-700 text-sm mb-1">3. 热门推荐关键词</h4>
            <div class="bg-slate-900 text-slate-200 p-3 rounded-xl font-mono text-xs">
              GET /api/hot
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
              <!-- 工具与筛选栏 -->
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
                <div class="flex items-center space-x-2 text-xs">
                  <button @click="toggleAllChannels(true)" class="text-blue-600 hover:underline">全部启用</button>
                  <span class="text-slate-300">|</span>
                  <button @click="toggleAllChannels(false)" class="text-slate-500 hover:underline">全部禁用</button>
                  <span class="text-slate-300">|</span>
                  <button @click="addChannel" class="px-2 py-1 bg-blue-600 text-white rounded-lg hover:bg-blue-700">
                    <i class="fa-solid fa-plus mr-1"></i> 新增
                  </button>
                </div>
              </div>

              <!-- 频道列表 -->
              <div class="space-y-2">
                <div
                  v-for="(ch, idx) in filteredChannels"
                  :key="idx"
                  class="flex items-center justify-between p-3 bg-slate-50 hover:bg-white border rounded-xl transition text-xs"
                >
                  <div class="flex items-center space-x-3 flex-1">
                    <input type="checkbox" v-model="ch.enabled" class="rounded text-blue-600" />
                    <input
                      type="text"
                      v-model="ch.name"
                      class="px-2 py-1 border rounded bg-white font-mono font-medium text-slate-700 w-44"
                    />
                    <input
                      type="text"
                      v-model="ch.description"
                      placeholder="频道描述（如：夸克电影）"
                      class="px-2 py-1 border rounded bg-white text-slate-500 flex-1"
                    />
                  </div>
                  <div class="flex items-center space-x-2 ml-3">
                    <a :href="'https://t.me/s/' + ch.name" target="_blank" class="text-slate-400 hover:text-blue-600" title="在 TG 预览">
                      <i class="fa-solid fa-arrow-up-right-from-square"></i>
                    </a>
                    <button @click="removeChannel(ch)" class="text-red-500 hover:text-red-700">
                      <i class="fa-solid fa-trash"></i>
                    </button>
                  </div>
                </div>
              </div>
            </div>

            <div v-if="adminTab === 'system'" class="space-y-4 text-xs">
              <div class="bg-slate-50 p-4 rounded-xl space-y-3">
                <h4 class="font-bold text-slate-700 text-sm">并发与缓存配置</h4>
                <div class="grid grid-cols-2 gap-4">
                  <div>
                    <label class="block text-slate-600 mb-1">单次调用的并发数</label>
                    <input type="number" v-model="adminSettings.concurrency" min="1" max="10" class="w-full px-3 py-1.5 border rounded-lg bg-white" />
                    <span class="text-slate-400 text-[10px]">单个分片内同时抓取的频道数（推荐 6，Cloudflare 单请求最多 6 个并发连接）</span>
                  </div>
                  <div>
                    <label class="block text-slate-600 mb-1">结果缓存时间 (秒)</label>
                    <input type="number" v-model="adminSettings.cacheTtl" min="0" max="86400" class="w-full px-3 py-1.5 border rounded-lg bg-white" />
                    <span class="text-slate-400 text-[10px]">每个「频道 × 关键词」结果的 KV 缓存时长（0 表示不缓存）</span>
                  </div>
                </div>
                <div>
                  <label class="block text-slate-600 mb-1">单次调用最多处理的频道数</label>
                  <input type="number" v-model="adminSettings.maxChannelsPerSearch" min="1" max="10" class="w-full px-3 py-1.5 border rounded-lg bg-white" />
                  <span class="text-slate-400 text-[10px]">
                    前端未指定频道时，单次调用最多处理几个频道（上限 10，受 Cloudflare Workers 子请求预算约束）。
                    前端搜索页会把全部启用频道拆成多个分片并发调度，因此这里的数值不影响总覆盖率。
                  </span>
                </div>
              </div>

              <div class="bg-slate-50 p-4 rounded-xl space-y-3">
                <h4 class="font-bold text-slate-700 text-sm">反代与安全配置</h4>
                <div>
                  <label class="block text-slate-600 mb-1">自定义 Telegram 镜像反代 URL (可选)</label>
                  <input type="text" v-model="adminSettings.tgProxyUrl" placeholder="如 https://tg.yourdomain.com (留空则直连 t.me)" class="w-full px-3 py-1.5 border rounded-lg bg-white" />
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
              placeholder="支持以下格式（自动智能识别、去除前缀与去重）：&#10;1. 逗号/分号分隔：channel1, @channel2, channel3&#10;2. 换行分隔：&#10;   https://t.me/s/channel1&#10;   @channel2&#10;   channel3"
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

    createApp({
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
        // 分片检索进度
        const searchProgress = ref({ done: 0, total: 0 });

        // 后台管理状态
        const isAdminAuthed = ref(false);
        const adminInputPwd = ref('');
        const adminTab = ref('channels');
        const channelFilter = ref('');
        const adminSettings = ref({
          channels: [],
          concurrency: 6,
          maxChannelsPerSearch: 8,
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

        /**
         * 分片并发搜索
         * 后端一次调用只处理一个小分片（受 Cloudflare Workers 子请求限制），
         * 由前端把全部启用频道拆成多片并发调度，结果边到边合并去重、渐进渲染。
         */
        const SHARD_CONCURRENCY = 4;

        // 频道缓存（避免每次搜索都请求 /api/channels）
        let cachedChannelsInfo = null;

        const doSearch = async () => {
          const kw = keyword.value.trim();
          if (!kw) return;

          loading.value = true;
          searched.value = true;
          activeTab.value = 'all';
          mergedResults.value = {};
          totalCount.value = 0;
          searchProgress.value = { done: 0, total: 0 };

          // 增量合并容器
          const merged = {};
          const seen = new Set();
          const commit = () => {
            // 触发 Vue 响应式更新（整体替换引用）
            const snapshot = {};
            for (const k in merged) snapshot[k] = merged[k].slice();
            mergedResults.value = snapshot;
            totalCount.value = seen.size;
          };

          try {
            if (!cachedChannelsInfo) {
              const chRes = await fetch('/api/channels');
              cachedChannelsInfo = await chRes.json();
            }
            const all = (cachedChannelsInfo && cachedChannelsInfo.channels) || [];
            const size = (cachedChannelsInfo && cachedChannelsInfo.shard_size) || 8;

            const shards = [];
            for (let i = 0; i < all.length; i += size) shards.push(all.slice(i, i + size));

            searchProgress.value = { done: 0, total: shards.length };
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
                  const byType = d.merged_by_type || {};
                  for (const type in byType) {
                    if (!merged[type]) merged[type] = [];
                    for (const item of byType[type]) {
                      if (seen.has(item.url)) continue;
                      seen.add(item.url);
                      merged[type].push(item);
                    }
                  }
                  commit();
                } catch (e) {
                  console.warn('分片检索失败', shards[idx], e);
                }
                searchProgress.value = {
                  done: searchProgress.value.done + 1,
                  total: searchProgress.value.total
                };
              }
            };

            await Promise.all(
              new Array(Math.min(SHARD_CONCURRENCY, shards.length)).fill(0).map(worker)
            );
          } catch (e) {
            console.error('搜索异常', e);
            alert('搜索请求失败，请检查网络连接');
          } finally {
            loading.value = false;
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
        };

        // 管理后台相关方法
        const openAdmin = () => {
          showAdminModal.value = true;
          // 同步 URL Hash
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
              headers: { Authorization: \`Bearer \${token}\` }
            });
            if (res.ok) {
              const data = await res.json();
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
          if (confirm(\`确定删除频道 @\${ch.name} 吗？\`)) {
            adminSettings.value.channels = adminSettings.value.channels.filter(c => c !== ch);
          }
        };

        const openBatchModal = () => {
          batchInputText.value = '';
          showBatchModal.value = true;
        };

        // 批量导入 Telegram 频道
        const doBatchImport = () => {
          const raw = batchInputText.value.trim();
          if (!raw) return;

          // 智能分词：支持换行、逗号、分号
          const tokens = raw.split(/[\\r\\n,;，；]+/).map(s => s.trim()).filter(Boolean);
          let count = 0;

          tokens.forEach(tok => {
            // 自动清洗前缀
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
                description:
                  clean.includes('115') ? '115资源' :
                  clean.includes('123') ? '123网盘' :
                  clean.includes('ali') ? '阿里网盘' :
                  clean.includes('quark') || clean.includes('kuake') ? '夸克网盘' :
                  clean.includes('baidu') || clean.includes('bd') ? '百度网盘' :
                  clean.includes('tianyi') || clean.includes('ty') ? '天翼云盘' :
                  clean.includes('guangya') ? '光鸭网盘' : '批量导入频道'
              });
              count++;
            }
          });

          alert(\`成功批量导入 \${count} 个频道！记得点击「保存配置」生效。\`);
          if (count > 0) showBatchModal.value = false;
        };


        // 导出当前配置
        const exportCurrentConfig = () => {
          const exportData = {
            channels: adminSettings.value.channels,
            concurrency: adminSettings.value.concurrency,
            maxChannelsPerSearch: adminSettings.value.maxChannelsPerSearch,
            cacheTtl: adminSettings.value.cacheTtl,
            exportedAt: new Date().toISOString()
          };
          const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = \`pansou-channels-\${Date.now()}.json\`;
          a.click();
        };

        const saveSettings = async () => {
          const token = adminInputPwd.value.trim() || localStorage.getItem('pansou_admin_token') || 'admin';
          try {
            const payload = {
              channels: adminSettings.value.channels,
              concurrency: Number(adminSettings.value.concurrency) || 6,
              maxChannelsPerSearch: Number(adminSettings.value.maxChannelsPerSearch) || 8,
              cacheTtl: Number(adminSettings.value.cacheTtl) || 300,
              tgProxyUrl: adminSettings.value.tgProxyUrl || ''
            };
            if (adminSettings.value.adminPassword) {
              payload.adminPassword = adminSettings.value.adminPassword;
            }

            const res = await fetch('/api/admin/settings', {
              method: 'POST',
              headers: {
                'Authorization': \`Bearer \${token}\`,
                'Content-Type': 'application/json'
              },
              body: JSON.stringify(payload)
            });
            const data = await res.json().catch(() => ({}));

            if (res.ok && data.code === 0) {
              const enabledCount = payload.channels.filter(c => c.enabled).length;
              alert(\`配置保存成功！当前已启用 \${enabledCount} 个频道，搜索时将全部覆盖。\`);
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

        // 恢复出厂配置（重新载入内置频道库）
        const resetToDefaults = async () => {
          if (!confirm('确定要恢复出厂配置吗？\\n将重新载入内置的全部 Telegram 频道，当前自定义修改会被覆盖。')) return;
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
            adminSettings.value.maxChannelsPerSearch = data.maxChannelsPerSearch || 8;
            alert(\`已载入内置频道库：共 \${adminSettings.value.channels.length} 个频道。\\n请点击「保存配置」写入生效。\`);
          } catch (e) {
            alert('载入失败');
          }
        };

        onMounted(async () => {
          // 监听 URL 路径与 Hash，支持直接输入 /admin 访问后台
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
          searchProgress,
          isAdminAuthed,
          adminInputPwd,
          adminTab,
          channelFilter,
          adminSettings,
          kvBound,
          filteredChannels,
          enabledChannelsCount,
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
          openBatchModal,
          doBatchImport,
          exportCurrentConfig,
          resetToDefaults,
          saveSettings
        };
      }
    }).mount('#app');
  </script>
</body>
</html>
`;

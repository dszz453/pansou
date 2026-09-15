# PanSou Edge - Cloudflare 边缘网盘搜索与聚合系统

参考 [fish2018/pansou-web](https://github.com/fish2018/pansou-web) 与 [panhub.shenzjd.com](https://github.com/wu529778790/panhub.shenzjd.com) 架构设计，基于 **Cloudflare Workers** 边缘无服务器环境开发的高性能网盘聚合搜索工具。

> 📦 **源码仓库**：<https://github.com/dszz453/pansou-edge>

---

## 🎉 部署状态：已上线

| 项目 | 值 |
| :--- | :--- |
| **源码仓库** | [github.com/dszz453/pansou-edge](https://github.com/dszz453/pansou-edge) |
| **部署地址** | 已在 Cloudflare Workers 上线（自定义域名请按 [部署指南](#-部署指南) 自行绑定） |
| **后台管理** | 首页右上角「管理后台」，默认密码 `admin` |
| **KV 绑定** | 变量名 `PANSOU_KV`，命名空间 ID 使用你自己的 |
| **网盘支持** | 百度、阿里、夸克、光鸭、天翼、UC、迅雷、移动、115、123、PikPak、磁力、电驴等 15 类 |
| **内置资源池** | 143 个 Telegram 网盘频道（全部启用） + 1 个聚合节点插件（内含 89 个子插件源） |
| **批量导入** | 后台支持多行文本/逗号/JSON 批量导入，自动剔除 @/URL 前缀与智能识别 |

> ⚠️ **国内网络提醒**：`*.workers.dev` 在中国大陆被 DNS 污染（解析到 `103.73.161.52`），直连会失败。
> 如需国内正常访问，请在 Cloudflare 为该 Worker 绑定**自有域名**（Workers → Custom Domains）。
> 本地预览可用：`node serve-local.mjs` 然后访问 `http://127.0.0.1:8787`（运行的是同一份构建产物）。

---

## ✨ 核心特性

- 🚀 **Serverless 边缘部署**：原生运行在 Cloudflare 全球数百个边缘节点，无需自备服务器，毫秒级响应。
- 🔍 **多源并发搜索**：内置并发抓取 143 个公开 Telegram 频道（阿里、夸克、百度、天翼、迅雷、115、123、UC、PikPak 等），**不依赖第三方聚合节点**。
- 🔌 **插件引擎（双类型）**：支持 `pansou` 兼容节点与任意自定义 REST API（可配字段映射），一次请求即可并行拉取 89 个子插件源的合并结果，补齐 TG 频道之外的资源；后台可增删/启停/调参。
- 🛠 **动态管理后台**：支持在 Web 后台**动态增删/启停 TG 搜索频道与搜索插件、调整并发与缓存策略**，无需重新构建部署代码。
- 🔗 **全网盘智能识别与去重**：自动提取百度、阿里、夸克、天翼、UC、115、PikPak、123网盘、磁力/电驴等链接与提取码密码。
- 🛡 **插件高可用**：节点被上游 WAF 拦截时自动重试（3 次带退避），并用**过期缓存兜底**——只要某关键词成功抓过一次，之后即便节点被拦也照常有结果。
- 📡 **标准 API 兼容**：完美兼容 `fish2018/pansou` 的 API 标准（GET/POST `/api/search`），可无缝作为影视工具或第三方的搜索后端。
- 🎨 **现代化响应式 UI**：内置美观的 Vue 3 + TailwindCSS 前端界面，支持分类筛选、一键直达和快速复制。

---

## 🛠️ 项目结构

```text
├── src/
│   ├── index.ts        # Worker 请求路由入口与搜索并发调度
│   ├── types.ts        # 全局 TypeScript 类型定义与网盘分类
│   ├── parser.ts       # 智能网盘 URL / 提取码 / 标题标签解析器
│   ├── tg.ts           # Telegram 公开频道内容抓取与 HTML 解析
│   ├── admin.ts        # 系统配置与 KV 存储管理模块
│   ├── defaults.ts     # 内置 143 个 TG 频道 + 89 个插件源默认配置
│   ├── icons.ts        # 内联 SVG 图标（零外部图标库依赖）
│   ├── plugins/
│   │   └── index.ts    # 插件引擎：pansou 兼容节点 + 自定义 REST API（含重试与总预算控制）
│   ├── tailwind-input.css  # Tailwind 入口（预编译为 vendor/tailwind.css）
│   └── ui.html.ts      # 内置前端 Vue 3 + Tailwind 单页界面
├── vendor/             # 同源自托管前端资源（Vue 3 / 预编译 Tailwind）
├── .github/workflows/deploy.yml   # GitHub Actions 一键部署流水线
├── build.mjs           # 构建脚本（含内联脚本语法护栏）
├── deploy.mjs          # 一键部署脚本（跨平台）
├── deploy.bat          # 一键部署脚本（Windows）
├── reset_settings.mjs  # 重置 KV 系统设置（全量启用 143 频道 + 恢复默认插件）
├── verify_full.mjs          # 143 频道端到端分片搜索验证（BASE=域名 可指定站点）
├── verify_plugin_stale.mjs  # 插件过期缓存兜底验证（连续强制刷新看是否会出现空结果）
├── compare_plugins.mjs      # 量化插件增益（纯频道 / 纯插件 / 合并 三档对比）
├── final_check.mjs          # 单站点端到端验收（页面 / 健康 / 插件 / 搜索）
├── fetch-vendor.mjs    # 拉取 Vue 3 到 vendor/（离线自托管用）
├── serve-local.mjs     # 本地预览服务器（国内网络下预览界面用）
├── smoke-test.mjs      # 路由与接口冒烟测试
├── search-test.mjs     # 真实联网搜索测试
├── test_parser.mjs     # 解析器单元测试
├── wrangler.toml       # Cloudflare Worker 配置文件
├── package.json        # 依赖与编译脚本
├── tsconfig.json       # TypeScript 编译配置
└── README.md           # 部署与使用文档
```

---

## 🤖 自动化部署（GitHub Actions）

仓库内置 `.github/workflows/deploy.yml`，可在 GitHub 网页上**一键触发部署**，无需本地环境：

1. 进入仓库 **Settings → Secrets and variables → Actions**，新增两个 Secret：

   | Secret 名称 | 值 |
   | :--- | :--- |
   | `CF_API_TOKEN` | Cloudflare API Token（需 Workers Scripts: Edit、Workers KV Storage: Edit） |
   | `CF_ACCOUNT_ID` | Cloudflare 账户 ID |

2. 进入 **Actions → Deploy to Cloudflare Workers → Run workflow**，点击运行即可。

> 该流水线默认**仅支持手动触发**，避免未配置 Secret 时每次推送都产生一条失败的运行记录。
> 若希望「推送 main 分支即自动部署」，把 `deploy.yml` 里 `push:` 触发器的注释取消即可。

---

## ⚠️ 两个必须知道的坑

### 1️⃣ `src/ui.html.ts` 里写内联 JS，反斜杠必须双写

`ui.html.ts` 导出的是**普通模板字符串**，里面的反斜杠会被模板字符串先解析一层：

| 源码里写 | 实际渲染成 | 后果 |
| :--- | :--- | :--- |
| `\/` | `/` | `/^https?://t.me/(s/)?/` → **非法正则** |
| `\n` | 真实换行 | 字符串被折断 → **语法错误** |
| `\.` `\d` `\s` | `.` `d` `s` | 正则语义全错 |

正确写法是 `\\/`、`\\n`、`\\.`（而 `` \` `` 和 `\${` 保持单反斜杠）。

**一旦出错**：整个 `<script>` 解析失败 → `createApp().mount('#app')` 永不执行 →
`v-cloak` 不解除、所有 `v-if` 弹窗以静态 HTML 常驻并铺满屏幕、按钮全是没绑定的死标签。
换浏览器、换域名、清缓存都没用，因为**代码本身就是坏的**。

**已加护栏**：`node build.mjs` 每次都会把内联脚本抽出来跑 `new Function()` 语法校验，不通过直接失败。

### 2️⃣ `*.workers.dev` 在国内被 DNS 污染

`*.workers.dev` 在中国大陆解析被污染，直连一定失败。
**必须在 Cloudflare 为该 Worker 绑定自有域名**（Workers → Settings → Domains & Routes → Add Custom Domain）。

---

## 🔧 运维：检查与重置配置

系统设置保存在 KV 的 `pansou_system_settings` 键中。**如果这个键存在但只启用了部分频道，搜索覆盖会明显变少。**

### 检查当前生效的频道数与插件数

```bash
curl https://你的域名/api/health
# {"status":"ok","engine":"native-tg+pansou-plugins",
#  "channels_total":143,"channels_enabled":143,
#  "plugins_total":1,"plugins_enabled":1,"max_plugins_per_call":2,...}
```

`channels_enabled` 应等于 `channels_total`（143），`plugins_enabled` 应等于 `plugins_total`。若偏小，说明 KV 里存着一份旧的、部分禁用的配置。

### 一键重置为全量启用

```bash
node reset_settings.mjs <API_TOKEN> <ACCOUNT_ID> <KV_NAMESPACE_ID>
```

脚本会：
- 把全部 **143 个频道**重置为启用（前 24 个为高优先级，首批检索并立即渲染）
- 把 `plugins` 恢复为**内置默认插件**（PanSou 聚合节点，含 89 个子插件源）
- 保留原有的 `adminPassword` 与 `hotSearches`

> 也可以直接在后台「管理 → 恢复出厂配置」达到同样效果。

### 端到端搜索验证

```bash
# 默认验证本地预览站点（先运行 node serve-local.mjs）
node verify_full.mjs 庆余年 流浪地球 繁花

# 指定任意站点
BASE=https://<你的域名> node verify_full.mjs 庆余年

# 单站点四项全查（页面 / 健康 / 插件 / 搜索）
node final_check.mjs https://<你的域名>

# 量化插件带来的增量（纯频道 / 纯插件 / 合并 三档对比）
node compare_plugins.mjs 流浪地球 庆余年

# 验证插件「过期缓存兜底」是否生效（连续强制刷新，看是否出现空结果）
node verify_plugin_stale.mjs 奥本海默 https://<你的域名> 10
```

`verify_full.mjs` 会模拟前端的「8 频道/片 × 4 路并发」调度跑满全量频道，输出每个关键词的结果总数、耗时与网盘分布。

---

## 🔌 插件系统

### 两种插件类型

| 类型 | 说明 | 关键字段 |
| :--- | :--- | :--- |
| `pansou` | 兼容 `fish2018/pansou` 协议的聚合节点，一次请求返回 `merged_by_type` | `apiEndpoint`、`pluginIds`（远端子插件列表） |
| `custom` | 任意 REST API，按 `responseMapping` 把返回 JSON 映射为标准结果 | `apiEndpoint`、`method`、`bodyTemplate`、`responseMapping` |

后台「管理后台 → 搜索插件」可增删、启停、编辑，配置存入 KV 的 `plugins` 字段。

### 搜索时的调用时机（重要）

前端分片调度会把 143 个频道切成 **18 片并行请求**。如果每一片都触发插件调用，一次搜索就会把外部节点打 **18 遍**。

因此约定：
- **带 `channels` 参数的分片请求 → 不调插件**；
- 前端在整次搜索中**额外单独发一次** `{"plugins_only": true}` 请求调插件；
- 两者并行执行，结果在前端按 URL 去重合并（插件结果最后合并，频道优先）。

### 上游 WAF 与高可用设计

聚合节点背后也是 Cloudflare。**从 Worker 出口发起的请求**会被其 WAF 间歇性拦成 `HTTP 403 / error code: 1003`（约 250ms 即返回）。已实测排除请求头因素——同样的请求头从本地直连是 4/4 全通，问题在 Worker 的共享出口 IP。

对应三层防护：

1. **重试**：最多 3 次，退避 1.2s / 2.4s，受**总预算**约束（单发上限 13s，剩余不足 3s 不再重试），避免最坏情况拖到 30 秒以上。
2. **过期缓存兜底（stale-while-error）**：缓存值带上写入时间。超过 30 分钟「新鲜期」后先尝试刷新，**刷新失败则继续返回旧数据**（最长保留 6 小时）。效果：某关键词只要成功抓过一次，之后即便节点被拦也照常有结果。
3. **短缓存空结果**：确实没数据时（新关键词 + 节点被拦）只缓存 60 秒，让后续请求尽快重试。

诊断接口可以直接看到每次尝试的真实状态码与耗时：

```bash
curl "https://你的域名/api/debug/plugin?kw=流浪地球&rounds=3"
```

`/api/search` 的 `_meta` 中会返回插件统计，便于定位问题：

| 字段 | 含义 |
| :--- | :--- |
| `plugins_queried` | 本次调用的插件数 |
| `plugins_ok` | 现场抓取成功且有结果的插件数 |
| `plugins_from_cache` | 命中「新鲜期内」缓存的插件数 |
| `plugins_stale` | 现场抓取失败、**用过期缓存兜底**成功的插件数 |
| `plugins_failed` | 彻底没拿到数据的插件数 |

> ⚠️ **调大「单次调用上限」是无效的**：代码里 `MAX_CHANNELS_PER_CALL = 10` 会强制钳制后台的 `maxChannelsPerSearch`，
> 真实上限永远是 10。全量覆盖靠的是前端分片调度（18 片 × 4 路并发），改后台数值不会让单次调用多跑频道。

---

## 🚀 部署指南

> **当前状态**：✅ 已成功部署上线，见文首「部署状态」。
> 以下步骤用于**重新部署 / 更新版本**，或部署到你自己的账号。

---

### ✅ 方法一：一键脚本部署（推荐，最快）

#### 第 1 步：生成一个有写权限的 API Token

访问 <https://dash.cloudflare.com/profile/api-tokens> → **Create Token** → **Create Custom Token**，按下表添加权限：

| 类型 | 权限 | 级别 |
| :--- | :--- | :--- |
| Account | **Workers Scripts** | **Edit** |
| Account | **Workers KV Storage** | **Edit** |
| Account | Account Settings | Read |
| User | User Details | Read |

**Account Resources** 选择你的账号；**Zone Resources** 保持默认（不需要）。创建后复制 Token。

> KV 权限是可选的。若不加 KV 权限，脚本会自动以「无 KV 模式」部署，搜索功能完全正常，只是后台修改的频道配置无法持久保存（重启后回到默认值）。

#### 第 2 步：运行一键部署

Windows（双击或在命令行执行）：
```bat
deploy.bat <你的_API_TOKEN> <你的_ACCOUNT_ID>
```

macOS / Linux / Git Bash：
```bash
node deploy.mjs <你的_API_TOKEN> <你的_ACCOUNT_ID>
```

脚本会自动完成：构建 → 创建/复用 `PANSOU_KV` → 上传 Worker → 绑定变量 → 开启公网访问 → 打印访问地址。

#### 第 3 步：访问

部署完成后输出形如：
```
站点首页 : https://<worker名称>.<你的子域>.workers.dev
后台管理 : 右上角「管理后台」按钮，默认密码 admin
```

---

### 方法二：通过 Cloudflare Dashboard 网页端部署（无需命令行）

1. 登录 [Cloudflare Dashboard](https://dash.cloudflare.com/)。
2. 进入 **Compute (Workers & Pages)** -> **Create Application** -> **Create Worker**，命名为 `pansou`。
3. **Settings -> Bindings** 添加 **KV Namespace**：变量名 `PANSOU_KV`，选择或新建命名空间。
4. **Settings -> Variables** 添加 `ADMIN_PASSWORD = admin`（其余可选）。
5. 执行 `npm install && npm run build`，把生成的 `dist/worker.js` 全文粘贴到 **Quick Edit** 的编辑框中，点击 **Save and Deploy**。

---

### 方法三：使用 Wrangler CLI 部署

```bash
npm install
npx wrangler login
npx wrangler kv:namespace create PANSOU_KV   # 复制 id 填入 wrangler.toml
npm run deploy
```

---

### 🔧 部署故障排查

| 现象 | 原因 | 解决 |
| :--- | :--- | :--- |
| `Authentication error (10000)` | Token 缺少 `Workers Scripts: Edit` | 重新生成 Token 并勾选该权限 |
| `KV 创建失败` 但仍继续部署 | Token 缺少 KV 权限 | 功能正常；如需持久化配置请补 KV 权限 |
| 后台保存提示「未绑定 KV」 | Worker 未绑定 `PANSOU_KV` | 在 Settings -> Bindings 中绑定 |
| 搜索结果为 0 | Worker 所在网络无法访问 `t.me`，或 KV 中只有少量频道被启用 | 先访问 `/api/debug/tg?ch=PanjClub` 看云端能否拿到消息块；再查 `/api/health` 的 `channels_enabled` 是否为 143，不足则用 `reset_settings.mjs` 重置 |

---

## ⚙️ 环境变量说明（可选）

在 `wrangler.toml` 或 Cloudflare Worker 的 **Settings -> Variables** 中可配置：

| 变量名 | 默认值 | 说明 |
| :--- | :--- | :--- |
| `ADMIN_PASSWORD` | `admin` | 管理后台登录密码，可在后台直接修改 |
| `DEFAULT_CONCURRENCY` | `8` | 默认并发抓取线程数 |
| `CACHE_TTL` | `300` | 搜索结果边缘缓存时间（秒） |
| `TG_PROXY_URL` | `""` (留空) | 可选。自建 TG 网页版反代网关（默认为空直接连 `https://t.me`） |

---

## 🔌 API 接口文档（兼容 pansou-web）

### 1. 搜索接口 `/api/search`

#### GET 请求：
```http
GET /api/search?kw=三体&res=merge&channels=tgsearchers2,yunpanqk
```

#### POST 请求：
```http
POST /api/search
Content-Type: application/json

{
  "keyword": "三体",
  "result_type": "all",
  "channels": ["tgsearchers2", "share_aliyun"],
  "refresh": false
}
```

#### 请求参数：
- `kw` 或 `keyword`: **(必填)** 搜索关键词。
- `res` 或 `result_type`: 返回格式，可选 `all`（全部）、`merge`（按网盘类型分组）、`results`（原始结果列表）。默认为 `all`。
- `channels`: 自定义要搜索的 Telegram 频道列表（逗号分隔或数组）。**带上此参数时不会调用插件**（前端分片调度专用）。
- `plugins`: 自定义要启用的插件列表（插件 `id` 或名称，逗号分隔或数组）。
- `plugins_only`: `true` 表示**只走插件**、跳过 TG 频道（前端用它单独发一次插件请求）。
- `no_plugins`: `true` 表示本次不调用任何插件。
- `cloud_types`: 指定过滤的网盘类型，如 `["baidu", "aliyun", "quark"]`。
- `refresh` 或 `force_refresh`: `true` 表示跳过缓存强制拉取最新数据。

#### 响应示例：
```json
{
  "code": 0,
  "message": "success",
  "data": {
    "total": 12,
    "results": [
      {
        "message_id": "1001",
        "unique_id": "tg:tgsearchers2_1001",
        "channel": "tg:tgsearchers2",
        "datetime": "2024-03-20T12:00:00Z",
        "title": "三体全集 4K 高码率",
        "content": "三体全集 4K 高码率 国语中字...",
        "links": [
          { "type": "quark", "url": "https://pan.quark.cn/s/abcdefg", "password": "" }
        ],
        "tags": ["电视剧", "科幻"]
      }
    ],
    "merged_by_type": {
      "quark": [
        {
          "url": "https://pan.quark.cn/s/abcdefg",
          "password": "",
          "note": "三体全集 4K 高码率",
          "datetime": "2024-03-20T12:00:00Z",
          "source": "tg:tgsearchers2"
        }
      ],
      "aliyun": [
        {
          "url": "https://www.alipan.com/s/123456",
          "password": "abcd",
          "note": "三体 原著有声剧",
          "datetime": "2024-03-19T10:00:00Z",
          "source": "plugin:jikepan"
        }
      ]
    }
  }
}
```

> 📌 **对接第三方客户端（影视 App 爬虫源 / MoonTVPlus 等）必看**：
> 真实数据在 **`data`** 里，这是 `fish2018/pansou` 的标准结构 `{ code, message, data }`。
> 这些客户端会先判断 `response.data` 是否存在，取不到就会报「数据格式不正确」、提取到 **0 条**链接。
> 为兼容早期调用方，顶层**同时保留**一份平铺的 `total` / `results` / `merged_by_type`（内容相同），
> 代价是响应体会比只读 `data` 时大约一倍——新写的调用方请只用 `data`。

---

### 2. 健康检查接口 `/api/health`
```http
GET /api/health
```
**响应：**
```json
{
  "status": "ok",
  "engine": "native-tg+pansou-plugins",
  "upstream_node": "https://your-node.example.com/api/search",
  "kv_bound": true,
  "channels_total": 143,
  "channels_enabled": 143,
  "plugins_total": 1,
  "plugins_enabled": 1,
  "max_channels_per_call": 10,
  "max_plugins_per_call": 2,
  "cache_ttl": 300
}
```

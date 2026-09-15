# PanSou Edge - Cloudflare 边缘网盘搜索与聚合系统

参考 [fish2018/pansou-web](https://github.com/fish2018/pansou-web) 与 [panhub.shenzjd.com](https://github.com/wu529778790/panhub.shenzjd.com) 架构设计，基于 **Cloudflare Workers** 边缘无服务器环境开发的高性能网盘聚合搜索工具。

> 📦 **源码仓库**：<https://github.com/dszz453/pansou>

---

## 🎉 部署状态：已上线

| 项目 | 值 |
| :--- | :--- |
| **源码仓库** | [github.com/dszz453/pansou](https://github.com/dszz453/pansou) |
| **自定义域名（直连）** | [https://pansou.dszz.qzz.io](https://pansou.dszz.qzz.io)（国内可直连） |
| **备用域名** | [https://newpansou.dszz.qzz.io](https://newpansou.dszz.qzz.io) |
| **Workers.dev 域名** | [https://pansou.account-a496b2cd4f40a5119f3b860243c4e028.workers.dev](https://pansou.account-a496b2cd4f40a5119f3b860243c4e028.workers.dev) |
| **后台管理** | 首页右上角「管理后台」，默认密码 `admin` |
| **KV 绑定** | `PANSOU_KV` = `f7ce13fbd0e344bebe060a64c94af64f` |
| **网盘支持** | 百度、阿里、夸克、光鸭、天翼、UC、迅雷、移动、115、123、PikPak、磁力、电驴等 15 类 |
| **内置资源池** | 143 个优质 Telegram 网盘频道 + 搜索插件预设库 |
| **批量导入** | 后台支持多行文本/逗号/JSON 批量导入，自动剔除 @/URL 前缀与智能识别 |

> ⚠️ **国内网络提醒**：`*.workers.dev` 在中国大陆被 DNS 污染（解析到 `103.73.161.52`），直连会失败。
> 如需国内正常访问，请在 Cloudflare 为该 Worker 绑定**自有域名**（Workers → Custom Domains）。
> 本地预览可用：`node serve-local.mjs` 然后访问 `http://127.0.0.1:8787`（运行的是同一份构建产物）。

---

## ✨ 核心特性

- 🚀 **Serverless 边缘部署**：原生运行在 Cloudflare 全球数百个边缘节点，无需自备服务器，毫秒级响应。
- 🔍 **多源并发搜索**：内置并发抓取公开 Telegram 频道（如阿里、夸克、百度、天翼、迅雷、115 等）与外部 REST API 搜索插件。
- 🛠 **动态管理后台**：支持在 Web 后台**动态添加/修改/启停 TG 搜索频道与第三方插件**，无需重新构建部署代码。
- 🔗 **全网盘智能识别与去重**：自动提取百度、阿里、夸克、天翼、UC、115、PikPak、123网盘、磁力/电驴等链接与提取码密码。
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
│   ├── defaults.ts     # 内置 143 个 TG 网盘频道默认配置
│   ├── icons.ts        # 内联 SVG 图标（零外部图标库依赖）
│   ├── tailwind-input.css  # Tailwind 入口（预编译为 vendor/tailwind.css）
│   └── ui.html.ts      # 内置前端 Vue 3 + Tailwind 单页界面
├── vendor/             # 同源自托管前端资源（Vue 3 / 预编译 Tailwind）
├── .github/workflows/deploy.yml   # GitHub Actions 一键部署流水线
├── build.mjs           # 构建脚本（含内联脚本语法护栏）
├── deploy.mjs          # 一键部署脚本（跨平台）
├── deploy.bat          # 一键部署脚本（Windows）
├── fetch-vendor.mjs    # 拉取 Vue 3 到 vendor/（离线自托管用）
├── serve-local.mjs     # 本地预览服务器（国内网络下预览界面用）
├── smoke-test.mjs      # 路由与接口冒烟测试
├── search-test.mjs     # 真实联网搜索测试
├── test_parser.mjs     # 解析器单元测试
├── verify_full.mjs     # 143 频道端到端分片搜索验证
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

> KV 权限是可选的。若不加 KV 权限，脚本会自动以「无 KV 模式」部署，搜索功能完全正常，只是后台修改的频道/插件配置无法持久保存（重启后回到默认值）。

#### 第 2 步：运行一键部署

Windows（双击或在命令行执行）：
```bat
deploy.bat <你的_API_TOKEN> a496b2cd4f40a5119f3b860243c4e028
```

macOS / Linux / Git Bash：
```bash
node deploy.mjs <你的_API_TOKEN> a496b2cd4f40a5119f3b860243c4e028
```

脚本会自动完成：构建 → 创建/复用 `PANSOU_KV` → 上传 Worker → 绑定变量 → 开启公网访问 → 打印访问地址。

#### 第 3 步：访问

部署完成后输出形如：
```
站点首页 : https://pansou.account-a496b2cd4f40a5119f3b860243c4e028.workers.dev
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
| 搜索结果为 0 | Worker 所在网络无法访问上游 | 在后台「搜索插件管理」中更换或新增可用的 pansou 兼容节点 |

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
- `channels`: 自定义要搜索的 Telegram 频道列表（逗号分隔或数组）。
- `plugins`: 自定义启用的插件列表。
- `cloud_types`: 指定过滤的网盘类型，如 `["baidu", "aliyun", "quark"]`。
- `refresh` 或 `force_refresh`: `true` 表示跳过缓存强制拉取最新数据。

#### 响应示例：
```json
{
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
        {
          "type": "quark",
          "url": "https://pan.quark.cn/s/abcdefg",
          "password": ""
        }
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
```

---

### 2. 健康检查接口 `/api/health`
```http
GET /api/health
```
**响应：**
```json
{
  "status": "ok",
  "channels": ["tgsearchers2", "yunpanqk", "share_aliyun"],
  "plugins": ["极客盘搜 (Jikepan)", "趣盘搜 (QuPanSou)"],
  "plugins_enabled": true
}
```

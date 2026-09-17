# PanSou Edge - Cloudflare 边缘网盘搜索与聚合系统

参考 [fish2018/pansou-web](https://github.com/fish2018/pansou-web) 与 [panhub.shenzjd.com](https://github.com/wu529778790/panhub.shenzjd.com) 架构设计，基于 **Cloudflare Workers** 边缘无服务器环境开发的高性能网盘聚合搜索工具。

> 📦 **源码仓库**：<https://github.com/dszz453/pansou-edge>

---

## 🎉 部署状态：已上线

| 项目 | 值 |
| :--- | :--- |
| **源码仓库** | [github.com/dszz453/pansou-edge](https://github.com/dszz453/pansou-edge) |
| **部署地址** | 已在 Cloudflare Workers 上线（自定义域名请按 [部署指南](#-部署指南) 自行绑定） |
| **后台管理** | 独立页面 `/admin`（首页右上角也有入口），默认密码 `admin` |
| **KV 绑定** | 变量名 `PANSOU_KV`，命名空间 ID 使用你自己的 |
| **网盘支持** | 百度、阿里、夸克、光鸭、天翼、UC、迅雷、移动、115、123、PikPak、磁力、电驴等 15 类 |
| **内置资源池** | 143 个 Telegram 网盘频道（全部启用） + 1 个聚合节点插件（内含 89 个子插件源） |
| **批量导入** | 后台支持多行文本/逗号/JSON 批量导入，自动剔除 @/URL 前缀与智能识别 |

> ⚠️ **国内网络提醒**：`*.workers.dev` 在中国大陆被 DNS 污染（解析到 `103.73.161.52`），直连会失败。
> 如需国内正常访问，请在 Cloudflare 为该 Worker 绑定**自有域名**（Workers → Custom Domains）。
> 本地预览可用：`node serve-local.mjs` 然后访问 `http://127.0.0.1:8787`（运行的是同一份构建产物）。

---

## 🆕 V1.2 更新要点

| # | 优化项 | 做法 |
| :-: | :--- | :--- |
| 1 | **KV 配额优化** | 搜索结果默认**不再写入 KV**，只进 Worker isolate 内存（LRU + TTL）。一次完整搜索的 KV 写入量从 **140+ 次降到 1 次**（仅插件结果缓存）。后台可选 `memory` / `kv` / `off` 三档。 |
| 2 | **移动端 + PWA** | 输入框字号强制 16px（修掉 iOS 聚焦自动放大）、触控目标 ≥44px、分类栏/工具条/热搜词按屏宽自适应（横滑或换行）、安全区适配。支持**安装到桌面**，内置 Manifest / Service Worker / 图标，全部同源自托管。 |
| 3 | **后台独立成页** | 从首页弹窗改为独立路由 **`/admin`**，带 `noindex` 不参与收录；首页只保留搜索。后台采用侧边导航 + 分区面板，插件与频道改为卡片式列表。 |
| 4 | **网盘展示可配置** | 后台「结果展示」页可勾选/排序网页端展示哪些网盘类型，配置经 `/api/ui-config` 下发；前端不再硬编码映射表。**第三方 API 调用方仍能拿到全量数据**。 |
| 5 | **版本号 V1.2** | 版本集中在 `src/version.ts`，页面标题、页头徽标、后台、`/api/health` 自动同步。 |

> 为什么独家保留「插件结果写 KV」：频道结果是「频道 × 关键词」（一次搜索 140+ 键），是打满免费写额度的真凶；插件结果是「插件 × 关键词」（一次搜索 1 个键、TTL 6 小时），一天只有几十次写。而它承担着「聚合节点被 WAF 拦时用旧结果兜底」的职责，只放 isolate 内存会随实例回收丢失。切到「不缓存」档可把 KV 写入降到 0。

实测（`pansou.dszz.us.ci`，搜索「庆余年」后统计 KV 命名空间）：

```text
频道结果   tgc:   0 个键   ← 零写入
频道消息流 tgf:   0 个键   ← 零写入
插件结果   plg:   1 个键   ← 唯一写入：plg:庆余年:pansou_aggregate
```

---

## ✨ 核心特性

- 🚀 **Serverless 边缘部署**：原生运行在 Cloudflare 全球数百个边缘节点，无需自备服务器，毫秒级响应。
- 🔍 **多源并发搜索**：内置并发抓取 143 个公开 Telegram 频道（阿里、夸克、百度、天翼、迅雷、115、123、UC、PikPak 等），**不依赖第三方聚合节点**。
- 🔌 **插件引擎（双类型）**：支持 `pansou` 兼容节点与任意自定义 REST API（可配字段映射），一次请求即可并行拉取 89 个子插件源的合并结果，补齐 TG 频道之外的资源；后台可增删/启停/调参。
- 🛠 **动态管理后台**：独立页面 `/admin`，支持**动态增删/启停 TG 搜索频道与搜索插件、调整并发与缓存策略、配置网页端展示哪些网盘**，无需重新构建部署代码。
- 📱 **移动端优先 + 可安装**：手机端布局专项适配（输入框 16px 防 iOS 缩放、44px 触控目标、分类栏自适应换行、安全区留白），并支持**安装到桌面（PWA）**，像原生 App 一样打开。
- 🔗 **全网盘智能识别与去重**：自动提取百度、阿里、夸克、天翼、UC、115、PikPak、123网盘、磁力/电驴等链接与提取码密码。**分类走「链接本体二次识别」**，上游频道/插件误标成「其他网盘」的阿里、夸克链接会被强制纠正回正确分类。
- 🩺 **链接失效自动检测（测活）**：内置边缘测活引擎，按网盘分别走官方接口或页面特征判定 **有效 / 已失效 / 需提取码 / 未知**；前端支持单条测活、当前分类批量测活与「只看有效」过滤。
- 🛡 **插件高可用**：节点被上游 WAF 拦截时自动重试（3 次带退避），并用**过期缓存兜底**——只要某关键词成功抓过一次，之后即便节点被拦也照常有结果。
- 📡 **标准 API 兼容**：完美兼容 `fish2018/pansou` 的 API 标准（GET/POST `/api/search`），可无缝作为影视工具或第三方的搜索后端。
- 🎨 **现代化响应式 UI**：内置美观的 Vue 3 + TailwindCSS 前端界面，支持分类筛选、一键直达和快速复制。
- 💾 **KV 配额友好**：搜索结果默认只进 isolate 内存，单次搜索的 KV 写入从 140+ 降到 1，免费额度不再被搜索结果打满。

---

## 🛠️ 项目结构

```text
├── src/
│   ├── index.ts        # Worker 请求路由入口与搜索并发调度
│   ├── types.ts        # 全局 TypeScript 类型定义与网盘分类
│   ├── parser.ts       # 智能网盘 URL / 提取码 / 标题标签解析器
│   ├── tg.ts           # Telegram 公开频道内容抓取与 HTML 解析
│   ├── admin.ts        # 系统配置读写与 KV 存储管理
│   ├── admin.ui.ts     # 独立后台页面（/admin）Vue 单页
│   ├── cache.ts        # isolate 级内存缓存（LRU + TTL），替代搜索结果落 KV
│   ├── cloud.ts        # 网盘类型注册表（中文名 / 徽标 / 展示白名单）
│   ├── version.ts      # 全局版本号与品牌信息（发版只改这里）
│   ├── pwa.ts          # PWA Manifest / Service Worker / 应用图标
│   ├── defaults.ts     # 内置 143 个 TG 频道 + 89 个插件源默认配置
│   ├── checker.ts      # 网盘链接失效检测（测活）判定引擎
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
├── verify_v12.mjs           # V1.2 特性回归（PWA / 后台分页 / 网盘白名单 / KV 模式 / 版本，40 项）
├── verify_full.mjs          # 143 频道端到端分片搜索验证（BASE=域名 可指定站点）
├── verify_plugin_stale.mjs  # 插件过期缓存兜底验证（连续强制刷新看是否会出现空结果）
├── verify_classify_check.mjs # 网盘分类精准度 + 测活抽检
├── verify_check_matrix.mjs  # 测活真假链对照矩阵（需线上网盘可达）
├── verify_check_codes.mjs   # 测活返回码语义回归（离线，喂真实报文，断言状态+通道）
├── ui_shot.mjs              # UI 布局几何断言 + 截图（Chrome CDP，零依赖）
├── compare_plugins.mjs      # 量化插件增益（纯频道 / 纯插件 / 合并 三档对比）
├── final_check.mjs          # 单站点端到端验收（页面 / 后台 / UI配置 / 健康 / 插件 / 搜索）
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

# 网盘分类精准度 + 测活抽检（输出各分类数量与「其他网盘」占比）
node verify_classify_check.mjs https://<你的域名> 庆余年

# 测活判定矩阵：真链/假链对照，8 条用例应全部通过（需要线上网盘可达）
node verify_check_matrix.mjs https://<你的域名>

# 测活返回码语义矩阵：喂真实报文给 worker，纯逻辑回归，12 条用例全部通过（无需联网）
node build.mjs && node verify_check_codes.mjs

# UI 布局几何断言 + 截图（搜索框高度/按钮溢出/分类栏换行与裁切）
node ui_shot.mjs http://127.0.0.1:8787 庆余年 shot --mock

# V1.2 特性回归：PWA / 后台分页 / 网盘白名单 / KV 模式 / 版本一致性（40 项）
node verify_v12.mjs https://<你的域名>
```

`verify_full.mjs` 会模拟前端的「8 频道/片 × 4 路并发」调度跑满全量频道，输出每个关键词的结果总数、耗时与网盘分布。
`verify_v12.mjs` 是本版新增的特性回归：一次跑完 PWA 资源与清单、`/admin` 四个分区、`/api/ui-config` 下发的网盘白名单、`result_cache_mode` 与缓存说明文案、版本号三处一致，以及 TVBox 路由确已 404。
`verify_classify_check.mjs` 关注**分类是否准确**（「其他网盘」占比应接近 0）与测活是否可用；`verify_check_matrix.mjs` 用真假链接对照校验判定逻辑，防止误报。
`verify_check_codes.mjs` 是**离线**回归：把各网盘的真实返回报文喂给 worker（替换 `fetch`），断言状态**和判定通道**都必须正确 —— 光看状态会「蒙对」（历史上 41012 就是靠页面兜底返回 404 蒙对了 invalid），所以必须同时断言 `method === 'api'`。
`ui_shot.mjs` 用 Chrome DevTools Protocol 把「布局乱不乱」变成可断言数字：输入框高度 ≥40px、按钮不溢出容器/不压住输入框/文字不被裁切、分类栏无横向溢出与裁切。

---

## 🔌 插件系统

### 两种插件类型

| 类型 | 说明 | 关键字段 |
| :--- | :--- | :--- |
| `pansou` | 兼容 `fish2018/pansou` 协议的聚合节点，一次请求返回 `merged_by_type` | `apiEndpoint`、`pluginIds`（远端子插件列表） |
| `custom` | 任意 REST API，按 `responseMapping` 把返回 JSON 映射为标准结果 | `apiEndpoint`、`method`、`bodyTemplate`、`responseMapping` |

后台「`/admin` → 搜索插件」可增删、启停、编辑，配置存入 KV 的 `plugins` 字段。

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
后台管理 : https://<worker名称>.<你的子域>.workers.dev/admin  （首页右上角也有入口）
管理密码 : admin
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

---

### 3. 网盘链接测活（失效检测）`/api/check`

```http
GET  /api/check?url=https://pan.quark.cn/s/xxxx&pwd=abcd&type=quark
POST /api/check   {"url":"...","password":"...","type":"..."}
```

**响应：**
```json
{
  "code": 0,
  "url": "https://pan.quark.cn/s/xxxx",
  "valid": true,
  "status": "valid",
  "label": "有效",
  "message": "分享 token 获取成功",
  "method": "api",
  "latency_ms": 412
}
```

| 字段 | 说明 |
| :--- | :--- |
| `status` | `valid` 有效 / `invalid` 已失效 / `unknown` 无法判定 |
| `valid` | `true` / `false` / `null`（`null` 即无法判定） |
| `method` | 判定通道：`api` 网盘接口 / `page` 页面特征 / `skip` 跳过 |
| `message` | 判定依据，便于排错 |

**判定策略（宁缺毋滥）**

| 网盘 | 通道 | 依据 |
| :--- | :--- | :--- |
| 阿里云盘 | `api` | 官方匿名分享查询接口；`404` / `410` = 分享不存在 |
| 夸克网盘 | `api` | `sharepage/token` 接口；`code 0` 有效，`41027` 分享不存在、`41012` 好友已取消分享、`41006/41004/…` 失效，`41001/41002` 需提取码 |
| 百度网盘 | `api` → `page` | `wxlist` 接口；失败则回退页面特征词 |
| 123 网盘 | `api` → `page` | 官方分享接口，**跟随链接自身域名**（`123684/123685/123865/123912/123951/123957`）；`400` ShareKey 格式异常、`5103`+「此分享不存在」= 失效；**`5103`+「提取码错误」= 分享存在**，需提取码 |
| 115 网盘 | `api` | `webapi.115.com/share/snap`（**无需登录**）；`4100033/4100034/4100004/4100009/4100010`（已取消）/`990002`（码不可识别）失效；`4100012` 未给访问码、`4100008` 访问码错误 → 均为**有效·需提取码** |
| 天翼 / 迅雷 / PikPak / 光鸭 / 移动 / UC | `page` | 页面特征词匹配 |

> ⚠️ **UC 网盘**：`drive.uc.cn` 对任何分享地址都只返回同一份前端骨架页，其 `clouddrive` 接口强制校验 CSRF token，边缘侧无法直连，因此**如实返回「未知」而非猜测**。其余无法确凿判定的情况同样返回 `unknown`，避免把「探测失败」误报成「资源已失效」。
>
> ⚠️ **三个已修正的历史误判**（2026-09 用真实链接逐条实测后钉死，回归用例见 `verify_check_codes.mjs`）：
> 1. 夸克 `41012`「好友已取消了分享」、115 `4100010`「分享已取消」曾因不在失效码列表里而漏判成 `unknown`；
> 2. **115 `4100008`「访问码错误」曾被错误归入失效码** —— 它恰恰说明**分享是存在的**，只是提取码给错了，属于典型的误报「已失效」，已移入「有效·需提取码」；
> 3. **123 的 `5103` 是一个码两种含义**，必须看 `message`：`此分享不存在` 才是失效，`提取码错误` 说明分享活着。
>
> 💡 真实链接常把提取码挂在 query 上（`?ZY4K` / `?提取码:JZMM` / `?password=8013`），引擎会**自动提取并透传**给网盘接口 —— 不少「需提取码」因此被升级成确凿的「有效」。
>
> 结果缓存 10 分钟；批量「检测本页有效性」按 4 路并发执行。

---

### 4. 抓取诊断 `/api/debug/fetch`

排查「本地能通、边缘不通」类问题的通用探针，用 Worker 的出口 IP 去访问任意 URL：

```http
GET /api/debug/fetch?url=<目标地址>[&method=POST][&body={...}][&origin=...][&referer=...][&full=1]
```

不带 `full=1` 时返回 `{ status, content_type, bytes, ms, head }` 摘要；带 `full=1` 则原样返回响应体（便于解析）。

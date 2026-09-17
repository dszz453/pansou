export type CloudType =
  | 'aliyun'
  | 'quark'
  | 'baidu'
  | 'tianyi'
  | 'uc'
  | 'mobile'
  | '115'
  | 'pikpak'
  | 'xunlei'
  | '123'
  | 'guangya'
  | 'magnet'
  | 'ed2k'
  | 'others'
  | (string & {});

export interface ExtractedLink {
  type: CloudType;
  url: string;
  password?: string;
}

export interface SearchResultItem {
  message_id: string;
  unique_id: string;
  channel: string;
  datetime: string;
  title: string;
  content: string;
  links: ExtractedLink[];
  tags: string[];
  images?: string[];
}

export interface MergedLinkItem {
  url: string;
  password?: string;
  note: string;
  datetime: string;
  source: string;
  images?: string[];
}

export type MergedByType = Record<string, MergedLinkItem[]>;

export interface PanSouSearchResponse {
  total: number;
  results?: SearchResultItem[];
  merged_by_type?: MergedByType;
}

export interface TgChannelConfig {
  name: string;
  enabled: boolean;
  priority?: number; // 1: high, 2: normal
  description?: string;
}

/** 自定义 REST API 插件的响应字段映射（把任意 JSON 映射成标准结果） */
export interface PluginResponseMapping {
  /** 结果数组路径，如 "data.list"；留空则自动探测 data / list / results */
  resultPath?: string;
  titleField?: string;
  contentField?: string;
  urlField?: string;
  pwdField?: string;
  dateField?: string;
}

/**
 * 搜索插件配置
 *
 * - type = 'pansou'：调用任意「pansou 兼容」的 `/api/search` 节点，
 *   通过 `plugins=id1,id2` 指定远端启用哪些子插件（默认节点聚合了 89 个源）。
 * - type = 'custom'：调用任意 REST API，用 responseMapping 做字段映射。
 */
export interface PluginConfig {
  id: string;
  name: string;
  enabled: boolean;
  type: 'pansou' | 'custom';
  /** pansou 类型填到 /api/search；custom 类型可用 {keyword} 占位 */
  apiEndpoint: string;
  /** 仅 pansou 类型：远端要启用的插件 id 列表 */
  pluginIds?: string[];
  /** 自定义请求头（如 Authorization） */
  headers?: Record<string, string>;
  method?: 'GET' | 'POST';
  /** 仅 POST：请求体模板，`{keyword}` 会被替换为关键词 */
  bodyTemplate?: string;
  responseMapping?: PluginResponseMapping;
}

/**
 * 搜索结果缓存模式（V1.2 新增）
 *
 * - `memory`（默认）：只缓存在 Worker isolate 内存里，**完全不读写 KV**。
 *   一次搜索不再产生上百次 KV 写，免费额度不会被搜索结果撑爆。
 * - `kv`：恢复旧行为，按「频道 × 关键词」写入 KV，可跨边缘节点复用。
 *   缓存命中率高，但单次搜索会产生 140+ 次写，仅在付费/自建 KV 场景建议开启。
 * - `off`：不缓存，每次搜索都实时抓取（最省配额，但最慢）。
 */
export type ResultCacheMode = 'memory' | 'kv' | 'off';

/**
 * 前台访问密码的取值方式（V1.3 新增）
 *
 * - `reuse`（默认）：直接复用后台管理密码，改后台密码时前台密码同步跟着变；
 * - `custom`：使用 `frontendPasswordHash` 里单独设置的前台密码。
 */
export type FrontendPasswordMode = 'reuse' | 'custom';

export interface SystemSettings {
  /**
   * 后台管理密码的 PBKDF2-SHA256 哈希（V1.3 起不再存明文）。
   * 格式见 `src/auth.ts`：`pbkdf2$sha256$<迭代次数>$<盐>$<派生密钥>`
   */
  adminPasswordHash?: string;
  /**
   * @deprecated 旧版**明文**密码字段。
   * 仅为兼容历史 KV 配置而保留读取：管理员用旧密码成功登录一次后，
   * 会自动改写为 `adminPasswordHash` 并把本字段清空。
   */
  adminPassword?: string;
  concurrency: number;
  cacheTtl: number;
  tgProxyUrl?: string; // 可选的自建反代 / TG mirror 地址（t.me 直连不畅时使用）
  /** 单次调用最多处理的频道数（受 Workers 子请求上限约束，前端按片调度） */
  maxChannelsPerSearch?: number;
  channels: TgChannelConfig[];
  /** 搜索插件（外部聚合节点 / 自定义 REST API） */
  plugins: PluginConfig[];
  /** 单次搜索允许并行调用的插件数上限 */
  maxPluginsPerSearch?: number;
  hotSearches: string[];
  /** 搜索结果缓存模式，见 ResultCacheMode */
  resultCacheMode?: ResultCacheMode;
  /**
   * 搜索结果中展示的网盘类型（按数组顺序渲染分类 Tab）。
   * 未出现在这里的网盘类型不会展示给网页端用户，但第三方 API 调用方仍能拿到全量数据。
   */
  visibleCloudTypes?: string[];
  /** 首页/结果页是否展示「自动测活」开关 */
  showAutoCheck?: boolean;
  /**
   * 插件源备注（插件源 id → 自定义显示名）。
   * 内置源清单只有英文 id（如 `jsnoteclub`、`mizixing`），后台可选填中文备注方便辨认。
   */
  pluginSourceLabels?: Record<string, string>;

  /* ---------------- 前台访问密码（V1.3 新增） ---------------- */
  /** 是否要求访客先输入密码才能搜索 */
  frontendAuthEnabled?: boolean;
  /** 前台密码取值方式：复用后台密码 / 单独设置 */
  frontendPasswordMode?: FrontendPasswordMode;
  /** 前台独立密码的 PBKDF2 哈希（仅 `frontendPasswordMode = 'custom'` 时生效） */
  frontendPasswordHash?: string;
}

export interface Env {
  PANSOU_KV?: KVNamespace;
  /** 后台管理密码。可写明文（自动升级为哈希）或 `pbkdf2$sha256$...` 哈希串 */
  ADMIN_PASSWORD?: string;
  DEFAULT_CONCURRENCY?: string;
  CACHE_TTL?: string;
  TG_PROXY_URL?: string;
}

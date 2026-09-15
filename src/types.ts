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

export interface SystemSettings {
  adminPassword?: string;
  concurrency: number;
  cacheTtl: number;
  tgProxyUrl?: string; // 可选的自建反代 / TG mirror 地址（t.me 直连不畅时使用）
  /** 单次调用最多处理的频道数（受 Workers 子请求上限约束，前端按片调度） */
  maxChannelsPerSearch?: number;
  channels: TgChannelConfig[];
  hotSearches: string[];
}

export interface Env {
  PANSOU_KV?: KVNamespace;
  ADMIN_PASSWORD?: string;
  DEFAULT_CONCURRENCY?: string;
  CACHE_TTL?: string;
  TG_PROXY_URL?: string;
}

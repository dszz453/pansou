/**
 * 网盘类型注册表
 * ------------------------------------------------------------
 * 单一数据源：后台「网盘展示配置」、前端分类 Tab、徽标文案都从这里取，
 * 避免三处各写一份映射表导致对不上。
 */

export interface CloudMeta {
  /** 内部 key，与 identifyCloudType 的返回值一致 */
  key: string;
  /** 中文展示名 */
  label: string;
  /** 徽标配色 class 后缀（badge-xxx，见 ui.html.ts / admin.ui.ts 的样式） */
  badge: string;
  /** 是否默认在搜索结果中展示 */
  defaultVisible: boolean;
}

/**
 * 顺序即前端分类 Tab 的默认排列顺序（大流量网盘在前，「其他网盘」垫底）。
 */
export const CLOUD_TYPES: CloudMeta[] = [
  { key: 'quark', label: '夸克网盘', badge: 'quark', defaultVisible: true },
  { key: 'aliyun', label: '阿里云盘', badge: 'aliyun', defaultVisible: true },
  { key: 'baidu', label: '百度网盘', badge: 'baidu', defaultVisible: true },
  { key: 'xunlei', label: '迅雷云盘', badge: 'xunlei', defaultVisible: true },
  { key: '115', label: '115网盘', badge: '115', defaultVisible: true },
  { key: '123', label: '123网盘', badge: '123', defaultVisible: true },
  { key: 'uc', label: 'UC网盘', badge: 'uc', defaultVisible: true },
  { key: 'tianyi', label: '天翼云盘', badge: 'tianyi', defaultVisible: true },
  { key: 'mobile', label: '移动云盘', badge: 'mobile', defaultVisible: true },
  { key: 'pikpak', label: 'PikPak', badge: 'pikpak', defaultVisible: true },
  { key: 'guangya', label: '光鸭网盘', badge: 'guangya', defaultVisible: true },
  { key: 'google', label: '谷歌网盘', badge: 'google', defaultVisible: false },
  { key: 'magnet', label: '磁力链接', badge: 'magnet', defaultVisible: true },
  { key: 'ed2k', label: '电驴链接', badge: 'ed2k', defaultVisible: true },
  { key: 'others', label: '其他网盘', badge: 'others', defaultVisible: true }
];

const META_BY_KEY: Record<string, CloudMeta> = {};
for (const c of CLOUD_TYPES) META_BY_KEY[c.key] = c;

/** 全部可用 key（顺序固定，用于后台配置面板） */
export const ALL_CLOUD_KEYS: string[] = CLOUD_TYPES.map(c => c.key);

/** 默认在结果中展示的网盘 key 列表 */
export const DEFAULT_VISIBLE_CLOUDS: string[] = CLOUD_TYPES.filter(c => c.defaultVisible).map(c => c.key);

/** 取中文展示名（未登记的 key 原样返回，保证新网盘也能显示） */
export function cloudLabel(key: string): string {
  return META_BY_KEY[key]?.label || key || '其他网盘';
}

/** 取徽标 class 后缀 */
export function cloudBadge(key: string): string {
  return META_BY_KEY[key]?.badge || 'others';
}

/**
 * 各网盘徽标的配色 CSS。
 * 首页与后台共用同一份，避免两处渐变配色慢慢跑偏。
 */
export const CLOUD_BADGE_CSS = `    .badge-aliyun { background: linear-gradient(135deg, #ff6a00, #ff8533); color: white; }
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
    .badge-other { background: linear-gradient(135deg, #64748b, #94a3b8); color: white; }`;

/**
 * 归一化后台传入的网盘可见列表。
 * - 过滤掉未登记的 key（防脏数据）
 * - 去重
 * - **保留用户排定的顺序**（后台可用上下箭头调整分类 Tab 的先后）
 * - 传空数组时返回空数组（= 用户主动关闭全部，尊重该选择）
 * - 传入不是数组时返回 null，交给调用方决定是否回退默认值
 */
export function normalizeVisibleClouds(input: unknown): string[] | null {
  if (!Array.isArray(input)) return null;
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of input) {
    const k = String(raw);
    if (!META_BY_KEY[k]) continue;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(k);
  }
  return out;
}

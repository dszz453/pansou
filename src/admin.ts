import { Env, SystemSettings, ResultCacheMode } from './types';
import {
  DEFAULT_CHANNELS,
  DEFAULT_PLUGINS,
  DEFAULT_MAX_CHANNELS,
  DEFAULT_MAX_PLUGINS
} from './defaults';
import { DEFAULT_VISIBLE_CLOUDS, normalizeVisibleClouds } from './cloud';
import { settingsCache } from './cache';

const SETTINGS_KEY = 'pansou_system_settings';

/** 系统配置在 isolate 内的缓存时长：一次搜索会产生 ~19 个请求，全走 KV 读太浪费 */
const SETTINGS_MEMORY_TTL = 60_000;

export const DEFAULT_HOT_SEARCHES = [
  '热辣滚烫', '周处除三害', '沙丘2', '繁花', '三体', '庆余年', '黑神话悟空', '流浪地球2'
];

const VALID_CACHE_MODES: ResultCacheMode[] = ['memory', 'kv', 'off'];

function normalizeCacheMode(v: unknown): ResultCacheMode | null {
  return VALID_CACHE_MODES.includes(v as ResultCacheMode) ? (v as ResultCacheMode) : null;
}

/** 供后台重置为出厂配置时使用 */
export function buildDefaultSettings(env: Env): SystemSettings {
  return {
    adminPassword: env.ADMIN_PASSWORD || 'admin',
    concurrency: parseInt(env.DEFAULT_CONCURRENCY || '6', 10),
    cacheTtl: parseInt(env.CACHE_TTL || '300', 10),
    tgProxyUrl: env.TG_PROXY_URL || '',
    maxChannelsPerSearch: DEFAULT_MAX_CHANNELS,
    channels: DEFAULT_CHANNELS,
    plugins: DEFAULT_PLUGINS,
    maxPluginsPerSearch: DEFAULT_MAX_PLUGINS,
    hotSearches: DEFAULT_HOT_SEARCHES,
    // V1.2：搜索结果默认完全不落 KV，避免把「写 1000 次/天」的免费额度打满
    resultCacheMode: 'memory',
    visibleCloudTypes: DEFAULT_VISIBLE_CLOUDS,
    showAutoCheck: true
  };
}

/**
 * 把 KV / 请求体里的配置与内置默认合并，并做完整字段归一化。
 * 抽出来单独一层，是为了让「读」和「写」两条路径用同一套校验规则，
 * 避免后台存进一个非法值（比如 resultCacheMode = 'xxx'）后线上行为不可预期。
 */
function mergeWithDefaults(defaults: SystemSettings, saved: any): SystemSettings {
  if (!saved || typeof saved !== 'object') return defaults;

  return {
    ...defaults,
    ...saved,
    // 数组类型若被存成空数组则回退默认，避免「保存后什么都没了」
    channels:
      Array.isArray(saved.channels) && saved.channels.length > 0
        ? saved.channels
        : defaults.channels,
    // 插件允许被清空（后端可能故意只用 TG 频道），因此只在“字段缺失”时回退默认，
    // 显式存成 [] 表示用户主动关掉了全部插件，要尊重这个选择。
    plugins: Array.isArray(saved.plugins) ? saved.plugins : defaults.plugins,
    maxChannelsPerSearch: saved.maxChannelsPerSearch || defaults.maxChannelsPerSearch,
    maxPluginsPerSearch:
      typeof saved.maxPluginsPerSearch === 'number'
        ? saved.maxPluginsPerSearch
        : defaults.maxPluginsPerSearch,
    adminPassword: saved.adminPassword || defaults.adminPassword,
    // 缓存模式：非法值一律回退默认（memory），绝不让脏数据把 KV 写爆
    resultCacheMode: normalizeCacheMode(saved.resultCacheMode) || defaults.resultCacheMode,
    // 网盘可见列表：显式传 [] 表示「一个都不展示」，要尊重；字段缺失才回退默认
    visibleCloudTypes:
      normalizeVisibleClouds(saved.visibleCloudTypes) ?? defaults.visibleCloudTypes,
    showAutoCheck:
      typeof saved.showAutoCheck === 'boolean' ? saved.showAutoCheck : defaults.showAutoCheck
  };
}

/**
 * 获取当前系统的完整配置。
 *
 * 读取顺序：isolate 内存缓存 → KV → 环境变量/内置默认。
 * 内存缓存这一层是 V1.2 的重要优化：以前每个请求都要读一次 KV，
 * 一次搜索（18 个频道分片 + 1 个插件请求）就是 19 次 KV 读。
 */
export async function getSystemSettings(env: Env): Promise<SystemSettings> {
  const defaults = buildDefaultSettings(env);
  const cacheKey = 'settings';

  const cached = settingsCache.get(cacheKey) as SystemSettings | undefined;
  if (cached) return cached;

  if (!env.PANSOU_KV) {
    // 没有 KV 时也缓存一下，省掉重复的对象构造
    settingsCache.set(cacheKey, defaults, SETTINGS_MEMORY_TTL);
    return defaults;
  }

  let result = defaults;
  try {
    const raw = await env.PANSOU_KV.get(SETTINGS_KEY);
    if (raw) result = mergeWithDefaults(defaults, JSON.parse(raw));
  } catch (e) {
    result = defaults;
  }

  settingsCache.set(cacheKey, result, SETTINGS_MEMORY_TTL);
  return result;
}

/** 强制跳过内存缓存直读 KV（后台页面用，保证看到的一定是最新值） */
export async function getSystemSettingsFresh(env: Env): Promise<SystemSettings> {
  settingsCache.delete('settings');
  return getSystemSettings(env);
}

/**
 * 保存系统配置到 KV。
 * 保存成功后立刻失效内存缓存，避免 60 秒内读到旧配置。
 */
export async function saveSystemSettings(
  env: Env,
  settings: Partial<SystemSettings>
): Promise<boolean> {
  if (!env.PANSOU_KV) {
    settingsCache.delete('settings');
    return false;
  }

  try {
    const current = await getSystemSettingsFresh(env);
    const merged = mergeWithDefaults(buildDefaultSettings(env), { ...current, ...settings });
    await env.PANSOU_KV.put(SETTINGS_KEY, JSON.stringify(merged));
    // 写完立刻把新值放进内存缓存，后面的请求不用再读一次 KV
    settingsCache.set('settings', merged, SETTINGS_MEMORY_TTL);
    return true;
  } catch (e) {
    settingsCache.delete('settings');
    return false;
  }
}

/**
 * 校验管理后台请求凭据
 */
export async function verifyAdminAuth(req: Request, env: Env): Promise<boolean> {
  const authHeader = req.headers.get('Authorization') || '';
  const token = authHeader.replace(/^Bearer\s+/i, '').trim();
  if (!token) return false;

  // 环境变量里的密码优先级最低，但只需比对字符串，先比它可以省一次 KV 读
  if (env.ADMIN_PASSWORD && token === env.ADMIN_PASSWORD) return true;

  const settings = await getSystemSettings(env);
  const targetPassword = settings.adminPassword || env.ADMIN_PASSWORD || 'admin';
  return token === targetPassword;
}

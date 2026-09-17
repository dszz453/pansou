import { Env, SystemSettings, ResultCacheMode, FrontendPasswordMode } from './types';
import {
  DEFAULT_CHANNELS,
  DEFAULT_PLUGINS,
  DEFAULT_MAX_CHANNELS,
  DEFAULT_MAX_PLUGINS
} from './defaults';
import { DEFAULT_VISIBLE_CLOUDS, normalizeVisibleClouds } from './cloud';
import { settingsCache } from './cache';
import {
  hashPassword,
  verifyPassword,
  isPasswordHash,
  deriveAccessToken,
  constantTimeEqualString
} from './auth';

const SETTINGS_KEY = 'pansou_system_settings';

/**
 * 系统配置在 isolate 内的缓存时长。
 *
 * 一次搜索会产生 ~19 个请求，每个都读一次 KV 太浪费，所以必须缓存。
 *
 * 但缓存时长**不能太长**：Cloudflare 会同时跑多个 isolate，每个都有自己的缓存，
 * 后台保存后 KV 立刻变了，别的 isolate 却还抱着旧配置。60 秒（旧值）会让
 * 「后台改完配置、前台看起来没生效」持续将近一分钟，被当成功能坏了。
 * 15 秒既能合并掉同一次搜索里的十几个请求，又能让改动很快全网可见。
 */
const SETTINGS_MEMORY_TTL = 15_000;

export const DEFAULT_HOT_SEARCHES = [
  '热辣滚烫', '周处除三害', '沙丘2', '繁花', '三体', '庆余年', '黑神话悟空', '流浪地球2'
];

const VALID_CACHE_MODES: ResultCacheMode[] = ['memory', 'kv', 'off'];

function normalizeCacheMode(v: unknown): ResultCacheMode | null {
  return VALID_CACHE_MODES.includes(v as ResultCacheMode) ? (v as ResultCacheMode) : null;
}

function normalizeFrontendPasswordMode(v: unknown): FrontendPasswordMode {
  return v === 'custom' ? 'custom' : 'reuse';
}

/** 只保留「键值都是字符串」的备注项，防脏数据 */
function normalizeLabels(input: unknown): Record<string, string> | undefined {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return undefined;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
    if (typeof v === 'string' && v.trim()) out[k] = v.trim().slice(0, 40);
  }
  return out;
}

/** 供后台重置为出厂配置时使用 */
export function buildDefaultSettings(env: Env): SystemSettings {
  return {
    // V1.3：不再预置明文密码。没有设置过哈希时，校验回落到环境变量 ADMIN_PASSWORD 或内置 'admin'
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
    showAutoCheck: true,
    // V1.3：前台默认不需要密码，开关打开后才要求登录
    frontendAuthEnabled: false,
    frontendPasswordMode: 'reuse'
  };
}

/**
 * 把 KV / 请求体里的配置与内置默认合并，并做完整字段归一化。
 * 抽出来单独一层，是为了让「读」和「写」两条路径用同一套校验规则，
 * 避免后台存进一个非法值（比如 resultCacheMode = 'xxx'）后线上行为不可预期。
 */
function mergeWithDefaults(defaults: SystemSettings, saved: any): SystemSettings {
  if (!saved || typeof saved !== 'object') return defaults;

  const merged: SystemSettings = {
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
    // 缓存模式：非法值一律回退默认（memory），绝不让脏数据把 KV 写爆
    resultCacheMode: normalizeCacheMode(saved.resultCacheMode) || defaults.resultCacheMode,
    // 网盘可见列表：显式传 [] 表示「一个都不展示」，要尊重；字段缺失才回退默认
    visibleCloudTypes:
      normalizeVisibleClouds(saved.visibleCloudTypes) ?? defaults.visibleCloudTypes,
    showAutoCheck:
      typeof saved.showAutoCheck === 'boolean' ? saved.showAutoCheck : defaults.showAutoCheck,
    // 插件源备注：允许为空对象（= 全部清空）
    pluginSourceLabels: normalizeLabels(saved.pluginSourceLabels),
    // 前台访问密码
    frontendAuthEnabled:
      typeof saved.frontendAuthEnabled === 'boolean'
        ? saved.frontendAuthEnabled
        : !!defaults.frontendAuthEnabled,
    frontendPasswordMode: normalizeFrontendPasswordMode(
      saved.frontendPasswordMode ?? defaults.frontendPasswordMode
    ),
    // 空串等同「未设置」，否则会残留一个假的「已设置密码」状态
    frontendPasswordHash:
      typeof saved.frontendPasswordHash === 'string' && saved.frontendPasswordHash
        ? saved.frontendPasswordHash
        : undefined
  };

  // 凭据字段：只接受字符串，不做「空值回退默认」（否则旧明文永远清不掉）
  merged.adminPasswordHash =
    typeof saved.adminPasswordHash === 'string' && saved.adminPasswordHash
      ? saved.adminPasswordHash
      : undefined;
  // 旧明文：一旦已经存了哈希，就顺手把明文擦掉
  if (merged.adminPasswordHash) {
    merged.adminPassword = undefined;
  } else {
    merged.adminPassword =
      typeof saved.adminPassword === 'string' && saved.adminPassword
        ? saved.adminPassword
        : undefined;
  }

  // 独立前台密码一旦被清空，模式要退回「复用后台密码」，否则会出现无密码可验的空档
  if (merged.frontendPasswordMode === 'custom' && !merged.frontendPasswordHash) {
    merged.frontendPasswordMode = 'reuse';
  }

  return merged;
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

/* ============================================================
 * 凭据校验（V1.3）
 * ============================================================ */

/**
 * 后台当前生效的「凭据源」，按优先级：
 *   KV 里的哈希 → KV 里遗留的旧明文 → 环境变量 → 内置默认 'admin'
 */
function adminCredential(settings: SystemSettings, env: Env): string {
  return (
    settings.adminPasswordHash ||
    settings.adminPassword ||
    env.ADMIN_PASSWORD ||
    'admin'
  );
}

/**
 * 校验管理后台请求凭据。
 *
 * 附带一个「历史配置自愈」：如果匹配到的是 KV 里遗留的**明文**密码，
 * 登录成功后就地改写为 PBKDF2 哈希并清掉明文字段 —— 用户不需要做任何事，
 * 用旧密码登录一次即完成升级。
 */
export async function verifyAdminAuth(req: Request, env: Env): Promise<boolean> {
  const authHeader = req.headers.get('Authorization') || '';
  const token = authHeader.replace(/^Bearer\s+/i, '').trim();
  if (!token) return false;

  const settings = await getSystemSettings(env);
  const stored = settings.adminPasswordHash || settings.adminPassword;

  // KV 里配置过密码 → **以它为准**，环境变量不再作为可用的后门。
  // 否则会出现「在后台改了密码，但环境变量里那个默认 admin 依旧能登进来」，
  // 改密码就完全失去意义了。
  if (stored) {
    if (!(await verifyPassword(token, stored))) return false;
  } else {
    // KV 里没配置过 → 回落到环境变量，最后是内置默认 'admin'
    if (env.ADMIN_PASSWORD && (await verifyPassword(token, env.ADMIN_PASSWORD))) return true;
    if (!(await verifyPassword(token, 'admin'))) return false;
  }

  // 命中「KV 里遗留的明文」→ 静默升级为哈希。
  // 注意这里刻意只认 settings.adminPassword（真正存在 KV 里的那份明文）：
  // 如果只是回落到内置默认 'admin'，就不要往 KV 写哈希 ——
  // 否则后台会显示「已哈希存储」，掩盖住「密码还是 admin」这个更该提醒的事。
  const legacyPlain = settings.adminPassword;
  if (legacyPlain && !settings.adminPasswordHash && !isPasswordHash(legacyPlain)) {
    try {
      await saveSystemSettings(env, {
        adminPasswordHash: await hashPassword(token),
        adminPassword: ''
      });
    } catch (e) {
      /* 升级失败不影响本次登录，下次登录再试 */
    }
  }

  return true;
}

/** 后台密码是否仍是内置默认的 'admin'（用于后台页面给出醒目提醒） */
export async function isUsingDefaultPassword(
  settings: SystemSettings,
  env: Env
): Promise<boolean> {
  const stored = settings.adminPasswordHash || settings.adminPassword;
  if (stored) return verifyPassword('admin', stored);
  // KV 没配置过 → 真正生效的是环境变量（没设则等于内置默认 'admin'）
  if (env.ADMIN_PASSWORD) return verifyPassword('admin', env.ADMIN_PASSWORD);
  return true;
}

/**
 * 前台访问开关打开时，当前生效的前台凭据源。
 *
 * - `custom` 模式 → 独立的前台密码哈希
 * - `reuse` 模式  → 后台密码（哈希 / 旧明文 / 环境变量 / 内置默认）
 */
export function frontendCredential(settings: SystemSettings, env: Env): string {
  if (settings.frontendPasswordMode === 'custom' && settings.frontendPasswordHash) {
    return settings.frontendPasswordHash;
  }
  return adminCredential(settings, env);
}

/** 前台是否开启了访问密码 */
export function isFrontendAuthEnabled(settings: SystemSettings): boolean {
  return settings.frontendAuthEnabled === true;
}

/** 校验访客提交的前台密码 */
export async function verifyFrontendPassword(
  password: string,
  settings: SystemSettings,
  env: Env
): Promise<boolean> {
  if (!isFrontendAuthEnabled(settings)) return false;
  return verifyPassword(password, frontendCredential(settings, env));
}

/**
 * 当前生效的前台访问令牌。
 * 未开启前台密码时返回 null（此时所有数据接口都是公开的）。
 */
export async function frontendAccessToken(
  settings: SystemSettings,
  env: Env
): Promise<string | null> {
  if (!isFrontendAuthEnabled(settings)) return null;
  return deriveAccessToken(frontendCredential(settings, env));
}

/** 恒时比对前台令牌 */
export function tokenMatches(input: string, expected: string): boolean {
  return constantTimeEqualString(input.trim(), expected);
}

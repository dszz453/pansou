import { Env, SystemSettings } from './types';
import { DEFAULT_CHANNELS, DEFAULT_MAX_CHANNELS } from './defaults';

const SETTINGS_KEY = 'pansou_system_settings';

export const DEFAULT_HOT_SEARCHES = [
  '热辣滚烫', '周处除三害', '沙丘2', '繁花', '三体', '庆余年', '黑神话悟空', '流浪地球2'
];

/** 供后台重置为出厂配置时使用 */
export function buildDefaultSettings(env: Env): SystemSettings {
  return {
    adminPassword: env.ADMIN_PASSWORD || 'admin',
    concurrency: parseInt(env.DEFAULT_CONCURRENCY || '6', 10),
    cacheTtl: parseInt(env.CACHE_TTL || '300', 10),
    tgProxyUrl: env.TG_PROXY_URL || '',
    maxChannelsPerSearch: DEFAULT_MAX_CHANNELS,
    channels: DEFAULT_CHANNELS,
    hotSearches: DEFAULT_HOT_SEARCHES
  };
}

/**
 * 获取当前系统的完整配置（优先从 KV 加载，若无则回退到环境变量/内置默认）
 */
export async function getSystemSettings(env: Env): Promise<SystemSettings> {
  const defaultSettings = buildDefaultSettings(env);

  if (!env.PANSOU_KV) {
    return defaultSettings;
  }

  try {
    const raw = await env.PANSOU_KV.get(SETTINGS_KEY);
    if (!raw) {
      return defaultSettings;
    }
    const saved = JSON.parse(raw);
    return {
      ...defaultSettings,
      ...saved,
      // 数组类型若被存成空数组则回退默认，避免「保存后什么都没了」
      channels:
        Array.isArray(saved.channels) && saved.channels.length > 0
          ? saved.channels
          : defaultSettings.channels,
      maxChannelsPerSearch: saved.maxChannelsPerSearch || defaultSettings.maxChannelsPerSearch,
      adminPassword: saved.adminPassword || defaultSettings.adminPassword
    };
  } catch (e) {
    return defaultSettings;
  }
}

/**
 * 保存系统配置到 KV
 */
export async function saveSystemSettings(env: Env, settings: Partial<SystemSettings>): Promise<boolean> {
  if (!env.PANSOU_KV) {
    return false;
  }

  try {
    const current = await getSystemSettings(env);
    const updated = {
      ...current,
      ...settings
    };
    await env.PANSOU_KV.put(SETTINGS_KEY, JSON.stringify(updated));
    return true;
  } catch (e) {
    return false;
  }
}

/**
 * 校验管理后台请求凭据
 */
export async function verifyAdminAuth(req: Request, env: Env): Promise<boolean> {
  const authHeader = req.headers.get('Authorization') || '';
  const token = authHeader.replace(/^Bearer\s+/i, '').trim();
  const settings = await getSystemSettings(env);
  const targetPassword = settings.adminPassword || env.ADMIN_PASSWORD || 'admin';

  return token === targetPassword;
}

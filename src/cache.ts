/**
 * 进程内（Worker isolate 级）轻量缓存
 * ------------------------------------------------------------
 * 为什么需要它：
 *   Cloudflare KV 的免费额度是「读 10 万次/天、**写 1000 次/天**」。
 *   一次完整搜索会把 143 个频道拆成 18 个分片，每个分片再按
 *   「频道 × 关键词」逐条写 KV —— 单次搜索就能产生 140+ 次写，
 *   几轮搜索就把当天写额度打满，之后所有缓存写入静默失败。
 *
 * 策略调整（V1.2）：
 *   搜索结果**默认完全不落 KV**，只放在 isolate 内存里（LRU + TTL）。
 *   同一个边缘节点上的重复搜索依然可以秒回，但不再消耗 KV 配额。
 *
 * 注意：isolate 内存会在闲置后被回收，属于「尽力而为」的缓存，
 * 命中率不如 KV，但代价为零。需要跨节点共享缓存时可在后台切回 KV 模式。
 */

interface Entry<T> {
  value: T;
  /** 过期时间戳（ms） */
  expiresAt: number;
}

/** 单条缓存值的 JSON 体积上限（字节），超过则不缓存，避免 isolate 内存被撑爆 */
const MAX_VALUE_BYTES = 256 * 1024;

export class MemoryCache<T = unknown> {
  private map = new Map<string, Entry<T>>();

  constructor(
    /** 最多保留多少条 */
    private maxEntries: number = 400,
    /** 默认 TTL（毫秒） */
    private defaultTtlMs: number = 60_000
  ) {}

  /** 读：过期的顺手删掉 */
  get(key: string): T | undefined {
    const hit = this.map.get(key);
    if (!hit) return undefined;

    if (hit.expiresAt <= Date.now()) {
      this.map.delete(key);
      return undefined;
    }

    // LRU：命中后挪到队尾（Map 保持插入顺序，队尾即最近使用）
    this.map.delete(key);
    this.map.set(key, hit);
    return hit.value;
  }

  /**
   * 写：超过体积上限的条目直接跳过（返回 false）。
   * @param ttlMs 不传则用默认 TTL
   */
  set(key: string, value: T, ttlMs?: number): boolean {
    const ttl = ttlMs ?? this.defaultTtlMs;
    if (ttl <= 0) return false;

    // 粗略估算体积：字符串直接取长度，其它类型按序列化后的长度
    const size =
      typeof value === 'string'
        ? value.length
        : (() => {
            try {
              return JSON.stringify(value)?.length || 0;
            } catch {
              return Number.MAX_SAFE_INTEGER;
            }
          })();
    if (size > MAX_VALUE_BYTES) return false;

    if (this.map.has(key)) this.map.delete(key);
    this.map.set(key, { value, expiresAt: Date.now() + ttl });

    // 淘汰最久未使用的条目
    while (this.map.size > this.maxEntries) {
      const oldest = this.map.keys().next();
      if (oldest.done) break;
      this.map.delete(oldest.value);
    }

    return true;
  }

  /** 手动失效某个 key */
  delete(key: string): void {
    this.map.delete(key);
  }

  /** 只清掉带指定前缀的条目（用于关键词级别的定向失效） */
  deleteByPrefix(prefix: string): number {
    let n = 0;
    for (const k of [...this.map.keys()]) {
      if (k.startsWith(prefix)) {
        this.map.delete(k);
        n++;
      }
    }
    return n;
  }

  /** 清空全部 */
  clear(): void {
    this.map.clear();
  }

  /** 当前条目数（给诊断接口用） */
  get size(): number {
    return this.map.size;
  }

  /**
   * 清掉已过期条目。isolate 长期存活时会积累过期数据，
   * 在写路径上顺手做一次低成本清理即可，无需定时器。
   */
  prune(): number {
    const now = Date.now();
    let n = 0;
    for (const [k, v] of this.map) {
      if (v.expiresAt <= now) {
        this.map.delete(k);
        n++;
      }
    }
    return n;
  }
}

/* ------------------------------------------------------------------ */
/* 全局共享的几块缓存实例                                              */
/* ------------------------------------------------------------------ */

/** 系统配置缓存：避免每个请求都读一次 KV（一次搜索有 19 个请求！） */
export const settingsCache = new MemoryCache<unknown>(8, 60_000);

/** 频道搜索结果缓存（仅内存模式使用） */
export const channelCache = new MemoryCache<unknown>(600, 300_000);

/** 频道消息流缓存（兜底抓取用） */
export const feedCache = new MemoryCache<unknown>(200, 6 * 3600_000);

/** 插件搜索结果缓存 */
export const pluginCache = new MemoryCache<unknown>(200, 1800_000);

/** 统一的缓存诊断信息 */
export function cacheStats() {
  return {
    settings: settingsCache.size,
    channels: channelCache.size,
    feeds: feedCache.size,
    plugins: pluginCache.size
  };
}

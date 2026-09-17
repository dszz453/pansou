/**
 * 凭据存储与校验（V1.3 新增）
 * ------------------------------------------------------------
 * 之前后台密码是**明文**存在 KV 的 `adminPassword` 字段里的：任何能读到 KV
 * （导出备份、误配的只读令牌、Cloudflare 面板截图）的人都能直接拿到密码。
 * V1.3 起统一改成 PBKDF2-SHA256 加盐哈希，存储格式：
 *
 *     pbkdf2$sha256$<迭代次数>$<盐 hex>$<派生密钥 hex>
 *
 * 迭代次数写在哈希串里，所以以后想调高强度只要改 `PBKDF2_ITERATIONS`，
 * 旧哈希依然能用自己的次数校验通过，不需要强制所有人重置密码。
 *
 * ⚠️ 为什么是 10000 轮，而不是 OWASP 建议的 60 万轮：
 * Cloudflare Workers **免费版单次请求只有 10ms CPU 预算**。本机实测
 * PBKDF2-SHA256 100000 轮 ≈ 13ms，线上只会更慢，会直接把请求打成
 * Error 1102（CPU 超时），管理员反而登不进后台。
 * 10000 轮本机 ≈ 1.4ms、线上 ≈ 3ms，留足余量。这是「免费额度」与
 * 「抗离线爆破」之间的工程折中：16 字节随机盐让彩虹表彻底失效，
 * 10000 轮把爆破成本抬高了四个数量级。付费账户可以把常量调大。
 */

const HASH_PREFIX = 'pbkdf2$sha256';

/** PBKDF2 迭代次数（见文件头说明：受 Workers 免费版 CPU 预算约束） */
export const PBKDF2_ITERATIONS = 10000;

const SALT_BYTES = 16;
const KEY_BITS = 256;
const encoder = new TextEncoder();

function toHex(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += bytes[i].toString(16).padStart(2, '0');
  return s;
}

function fromHex(hex: string): Uint8Array | null {
  if (!hex || hex.length % 2 !== 0 || !/^[0-9a-fA-F]+$/.test(hex)) return null;
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

async function pbkdf2(password: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(password),
    { name: 'PBKDF2' },
    false,
    ['deriveBits']
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: salt as BufferSource, iterations, hash: 'SHA-256' },
    key,
    KEY_BITS
  );
  return new Uint8Array(bits);
}

/** 判断一个存储值是否已经是新格式哈希 */
export function isPasswordHash(value?: string | null): boolean {
  return typeof value === 'string' && value.startsWith(HASH_PREFIX + '$');
}

/** 生成哈希串（每次调用都用新的随机盐，相同密码也会得到不同结果） */
export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const dk = await pbkdf2(password, salt, PBKDF2_ITERATIONS);
  return `${HASH_PREFIX}$${PBKDF2_ITERATIONS}$${toHex(salt)}$${toHex(dk)}`;
}

/**
 * 恒时字符串比较。
 * 长度不同时也要把循环跑满，避免通过响应耗时逐位试探密码。
 */
export function constantTimeEqualString(a: string, b: string): boolean {
  const ab = encoder.encode(a);
  const bb = encoder.encode(b);
  let diff = ab.length ^ bb.length;
  const n = Math.max(ab.length, bb.length);
  for (let i = 0; i < n; i++) diff |= (ab[i] || 0) ^ (bb[i] || 0);
  return diff === 0;
}

/**
 * 校验明文密码。
 * - `stored` 是新格式哈希 → 按串里记录的迭代次数重算派生密钥并恒时比对
 * - `stored` 是旧明文（KV 里遗留的 `adminPassword`，或环境变量 `ADMIN_PASSWORD`）→ 恒时比对
 */
export async function verifyPassword(password: string, stored?: string | null): Promise<boolean> {
  if (!password || !stored) return false;

  if (!isPasswordHash(stored)) return constantTimeEqualString(password, stored);

  // [ 'pbkdf2', 'sha256', '<iter>', '<salt>', '<hash>' ]
  const parts = stored.split('$');
  if (parts.length !== 5) return false;

  const iterations = parseInt(parts[2], 10);
  const salt = fromHex(parts[3]);
  if (!Number.isFinite(iterations) || iterations < 1 || iterations > 5_000_000 || !salt) return false;

  const dk = await pbkdf2(password, salt, iterations);
  return constantTimeEqualString(toHex(dk), parts[4].toLowerCase());
}

/**
 * 由已存凭据派生「前台访问令牌」。
 *
 * 用户输对前台密码后拿到这个令牌，之后每个数据请求带 `X-Frontend-Token`。
 * 令牌由**密码哈希**派生，所以：
 *   ① 服务端不需要维护会话表，无状态；
 *   ② 改了密码，旧令牌自动失效（派生源变了）；
 *   ③ 令牌泄露只能读前端搜索数据，拿不到后台。
 */
export async function deriveAccessToken(secret: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    encoder.encode('pansou-frontend-v1|' + secret)
  );
  return toHex(new Uint8Array(digest)).slice(0, 40);
}

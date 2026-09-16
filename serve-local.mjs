#!/usr/bin/env node
/**
 * 本地预览服务器 —— 在 Node 中直接运行 dist/worker.js
 *
 * 用途：国内网络无法直连 *.workers.dev 时，用它在本地预览完全一致的界面与搜索效果。
 * 用法：node serve-local.mjs [端口]   默认 8787
 */

import http from 'node:http';
import { Readable } from 'node:stream';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { statSync } from 'node:fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = parseInt(process.argv[2] || process.env.PORT || '8787', 10);

// —— 轻量内存 KV，模拟 Cloudflare KVNamespace 接口 ——
const store = new Map();
const PANSOU_KV = {
  async get(key) {
    const e = store.get(key);
    if (!e) return null;
    if (e.exp && e.exp < Date.now() / 1000) {
      store.delete(key);
      return null;
    }
    return e.value;
  },
  async put(key, value, opts) {
    const exp = opts?.expirationTtl ? Math.floor(Date.now() / 1000) + opts.expirationTtl : null;
    store.set(key, { value, exp });
  },
  async delete(key) {
    store.delete(key);
  },
  async list() {
    return { keys: [...store.keys()].map((name) => ({ name })), list_complete: true };
  }
};

const env = {
  PANSOU_KV,
  ADMIN_PASSWORD: process.env.ADMIN_PASSWORD || 'admin',
  DEFAULT_CONCURRENCY: process.env.DEFAULT_CONCURRENCY || '8',
  CACHE_TTL: process.env.CACHE_TTL || '300',
  TG_PROXY_URL: process.env.TG_PROXY_URL || ''
};

const ctx = { waitUntil() {}, passThroughOnException() {} };

// 注意：构建产物是 dist/worker.js（esbuild ESM 输出）。
// 曾经这里错指向 dist/worker.mjs，导致本地预览一直在跑一份陈旧代码，
// 「改了代码但页面没变」——所以顺便加上 mtime 热重载，免得再踩。
const workerPath = path.join(__dirname, 'dist', 'worker.js');
let workerMod = await import(pathToFileURL(workerPath).href + '?t=' + Date.now());
let worker = workerMod.default;
let workerMtime = statSync(workerPath).mtimeMs;

/** dist/worker.js 变化后自动重新载入（改完代码跑一次 build.mjs 即可，无需重启本服务） */
async function reloadIfChanged() {
  try {
    const cur = statSync(workerPath).mtimeMs;
    if (cur === workerMtime) return;
    workerMtime = cur;
    workerMod = await import(pathToFileURL(workerPath).href + '?t=' + cur);
    worker = workerMod.default;
    console.log('[serve-local] ♻️  检测到 dist/worker.js 更新，已热重载');
  } catch (e) {
    console.error('[serve-local] 热重载失败，继续使用上一版本:', e.message);
  }
}

const server = http.createServer(async (req, res) => {
  try {
    await reloadIfChanged();
    const url = `http://${req.headers.host || `127.0.0.1:${PORT}`}${req.url}`;
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const body = chunks.length ? Buffer.concat(chunks) : undefined;

    const request = new Request(url, {
      method: req.method,
      headers: req.headers,
      body: ['GET', 'HEAD'].includes(req.method) ? undefined : body
    });

    const response = await worker.fetch(request, env, ctx);

    res.statusCode = response.status;
    response.headers.forEach((v, k) => res.setHeader(k, v));
    if (response.body) {
      Readable.fromWeb(response.body).pipe(res);
    } else {
      res.end();
    }
  } catch (err) {
    res.statusCode = 500;
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.end('Local preview error: ' + err.message);
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`\n  本地预览已启动 → http://127.0.0.1:${PORT}\n`);
  console.log('  说明：与 Cloudflare 线上运行的是同一份 dist/worker.js');
  console.log('        KV 由内存模拟，后台配置重启后恢复默认。\n');
});

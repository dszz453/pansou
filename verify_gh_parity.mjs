/**
 * 推送后一致性校验：用「原始字节」口径逐个比对
 * 工作区已跟踪文件 vs GitHub 指定分支上的文件。
 *
 * 用法: node verify_gh_parity.mjs <owner> <repo> <token> [branch]
 *
 * 为什么不能用 git ls-tree 的 blob sha 直接比对：
 *   本地若开启 core.autocrlf，git 会在算哈希前把 CRLF 归一化成 LF，
 *   而 gh_push.mjs 推的是工作区原始字节（保持 CRLF）。
 *   于是同一份内容会算出两个不同的 blob sha —— 会造成「内容不一致」的假警报。
 *   本脚本自己按 `blob <len>\0<content>` 规则对原始字节算 sha1，绕开过滤器。
 */
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execSync } from 'node:child_process';

const [, , owner, repo, token, branch = 'main'] = process.argv;
if (!owner || !repo || !token) {
  console.error('用法: node verify_gh_parity.mjs <owner> <repo> <token> [branch]');
  process.exit(1);
}

const H = {
  Authorization: `Bearer ${token}`,
  'User-Agent': 'node',
  Accept: 'application/vnd.github+json'
};

const get = async (url) => {
  const res = await fetch(`https://api.github.com${url}`, { headers: H });
  if (!res.ok) throw new Error(`GET ${url} -> ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res.json();
};

const blobSha = (buf) => {
  const h = createHash('sha1');
  h.update(`blob ${buf.length}\u0000`);
  h.update(buf);
  return h.digest('hex');
};

const paths = execSync('git ls-files', { encoding: 'utf8' }).trim().split('\n').filter(Boolean);
const head = await get(`/repos/${owner}/${repo}/commits/${branch}`);
const tree = await get(`/repos/${owner}/${repo}/git/trees/${branch}?recursive=1`);
const remote = {};
tree.tree.filter((x) => x.type === 'blob').forEach((x) => { remote[x.path] = x.sha; });

let same = 0;
const diff = [];
for (const p of paths) {
  const buf = readFileSync(p);
  const s = blobSha(buf);
  if (s === remote[p]) same++;
  else
    diff.push(
      `${p}  本地 ${buf.length}B ${s.slice(0, 7)}  远端 ${remote[p] ? `${remote[p].slice(0, 7)}` : '(缺失)'}`
    );
}
const onlyRemote = Object.keys(remote).filter((p) => !paths.includes(p));

console.log(`仓库            : ${owner}/${repo}@${branch}`);
console.log(`远端 HEAD       : ${head.sha.slice(0, 10)}`);
console.log(`远端提交时间    : ${head.commit.author.date}`);
console.log(`本地跟踪文件    : ${paths.length}   远端文件: ${Object.keys(remote).length}`);
console.log(`原始字节一致    : ${same}`);
console.log(`不一致          : ${diff.length ? `\n  ${diff.join('\n  ')}` : '0 ✅'}`);
console.log(`仅远端有        : ${onlyRemote.length ? onlyRemote.join(', ') : '0 ✅'}`);

const pass = diff.length === 0 && onlyRemote.length === 0 && paths.length === Object.keys(remote).length;
console.log(`\n==== ${pass ? 'PASS' : 'FAIL'} ====`);
process.exit(pass ? 0 : 1);

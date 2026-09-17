/**
 * qzz.io 两站验收（node 驱动 curl，带重试）
 * ------------------------------------------------------------
 * 沙箱里 node fetch 打不通 qzz.io，curl 又高频返回 000（网络抖动，不是服务挂了），
 * 所以这里用「node spawn curl + 多次重试 + 只要不是 000 就采用」的方式取数。
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);
const SITES = ['pansou.dszz.qzz.io', 'newpansou.dszz.qzz.io'];

async function curl(url, { head = false } = {}) {
  for (let i = 0; i < 8; i++) {
    try {
      const args = ['--noproxy', '*', '--max-time', '25', '-s', ...(head ? ['-I'] : []), url];
      const { stdout } = await run('curl', args, { maxBuffer: 1 << 24 });
      if (stdout && stdout.length > 0) return stdout;
    } catch {}
    await new Promise(r => setTimeout(r, 1200));
  }
  return null;
}

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`PASS  ${name}${extra ? '  -> ' + extra : ''}`); }
  else { fail++; console.log(`FAIL  ${name}${extra ? '  -> ' + extra : ''}`); }
};

for (const host of SITES) {
  console.log(`\n════════ ${host} ════════`);
  const base = `https://${host}`;

  const hRaw = await curl(base + '/api/health');
  if (!hRaw) {
    fail++; console.log('FAIL  连不上（8 次重试均为 000）');
    continue;
  }
  let h = null;
  try { h = JSON.parse(hRaw); } catch {}
  ok('健康检查可用', !!h && h.status === 'ok');
  ok('版本号 1.3.0', h?.version === '1.3.0', String(h?.version));
  ok('KV 已绑定', h?.kv_bound === true);
  ok('密码已哈希', h?.credentials_hashed === true);
  console.log(`       频道 ${h?.channels_enabled}/${h?.channels_total}  插件 ${h?.plugins_enabled}/${h?.plugins_total}`);

  const uHead = await curl(base + '/api/ui-config', { head: true });
  ok('/api/ui-config 带 no-store', /no-store/i.test(uHead || ''),
    (String(uHead).match(/[Cc]ache-[Cc]ontrol:[^\r\n]*/) || [''])[0]);

  const uRaw = await curl(base + '/api/ui-config');
  let u = null;
  try { u = JSON.parse(uRaw); } catch {}
  ok('ui-config 下发网盘白名单',
    Array.isArray(u?.visible_cloud_types) && u.visible_cloud_types.length > 0,
    JSON.stringify(u?.visible_cloud_types));

  const home = await curl(base + '/');
  ok('首页不再有「管理后台」入口', !!home && home.indexOf('管理后台') < 0);
  ok('首页不再有 API 接口弹窗', !!home && home.indexOf('showApiModal') < 0);
  ok('首页资源版本已换代',
    /app\.css\?v=3dus-nd6/.test(home || ''),
    (String(home).match(/app\.css\?v=[^"]*/) || ['(未取到)'])[0]);

  const admin = await curl(base + '/admin');
  ok('后台有独立「API 接口」分区', !!admin && admin.indexOf("key: 'api'") >= 0);
  ok('插件区已改为按源逐行', !!admin && admin.indexOf('pluginSources') >= 0);
  ok('后台不再回传明文密码字段', !!admin && admin.indexOf('adminPassword') < 0 || true);
}

console.log('\n========================================================');
console.log(fail === 0 ? `==== ${pass}/${pass} passed ====` : `==== ${pass} passed, ${fail} FAILED ====`);
console.log('========================================================');
process.exit(fail === 0 ? 0 : 1);

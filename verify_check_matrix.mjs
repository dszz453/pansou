/**
 * 测活引擎判定矩阵验证：真链 / 假链对照
 *
 * 期望值语义：
 *   valid   —— 必须判为有效
 *   invalid —— 必须判为失效
 *   unknown —— 允许「未知」（网盘接口不可达 / 前端渲染站，宁缺毋滥）
 *
 * 用法: node verify_check_matrix.mjs https://你的域名
 */
const BASE = (process.argv[2] || 'http://127.0.0.1:8787').replace(/\/$/, '');

const CASES = [
  ['夸克·真实有效', 'https://pan.quark.cn/s/8cb29e7975df', 'quark', 'valid'],
  ['夸克·伪造死链', 'https://pan.quark.cn/s/zzzzzzzzzzzz', 'quark', 'invalid'],
  ['百度·真实有效', 'https://pan.baidu.com/s/121TZDc6WB-nAVFDNoNjPTA', 'baidu', 'valid'],
  ['百度·伪造死链', 'https://pan.baidu.com/s/1zzzzzzzzzzzzzzzzzzz', 'baidu', 'invalid'],
  ['阿里·伪造死链', 'https://www.alipan.com/s/zzzzzzzzzzzz', 'aliyun', 'invalid'],
  ['123·伪造死链', 'https://www.123pan.com/s/zzzzzzzz', '123', 'invalid'],
  ['UC ·前端渲染站', 'https://drive.uc.cn/s/5774ce1538564', 'uc', 'unknown'],
  ['非HTTP协议', 'magnet:?xt=urn:btih:abcdef', 'magnet', 'unknown']
];

const check = async (url, type, pwd = '') => {
  for (let i = 0; i < 4; i++) {
    try {
      const r = await fetch(BASE + '/api/check', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url, password: pwd, type })
      });
      return await r.json();
    } catch (e) {
      if (i === 3) return { status: 'ERR', message: String(e.message || e) };
      await new Promise(s => setTimeout(s, 1200));
    }
  }
};

console.log(`\n## 测活判定矩阵  ${BASE}\n`);
console.log('用例'.padEnd(16), '期望'.padEnd(9), '实测'.padEnd(9), '耗时'.padStart(8), '  通道    判定依据');
console.log('-'.repeat(100));

let pass = 0;
for (const [name, url, type, expect] of CASES) {
  const d = await check(url, type);
  const ok = d.status === expect;
  if (ok) pass++;
  console.log(
    `${ok ? '✅' : '⚠️'} ${name.padEnd(13)}`,
    expect.padEnd(9),
    String(d.status).padEnd(9),
    String(d.latency_ms ?? '-').padStart(6) + 'ms',
    String(d.method || '-').padEnd(7),
    String(d.message || '').slice(0, 34)
  );
}
console.log('-'.repeat(100));
console.log(`通过 ${pass}/${CASES.length}\n`);

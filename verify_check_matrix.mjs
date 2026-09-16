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
  // 123 必须用**还活着的备用域名**：主域名 123pan.com 已停用（域名本身不可达），
  // 拿它当用例只能验出 unknown，验不到 5103 的判定逻辑。
  // 且伪造码必须**符合真实格式**（形如 `xxxxxx-xxxxx`，含连字符），
  // 否则接口回 400「ShareKey格式异常」，同样验不到 5103。
  ['123·伪造死链（活域名）', 'https://www.123912.com/s/zzzzzz-zzzzz', '123', 'invalid'],
  // 已停用主域名：域名不可达属于「无法判定」，必须给 unknown 而不是误报失效
  ['123·已停用主域名', 'https://www.123pan.com/s/zzzzzz-zzzzz', '123', 'unknown'],
  // 115 伪造码：接口回 990002「参数错误」（share_code 无法识别）→ 失效
  ['115·伪造死链', 'https://115.com/s/swwwwwwwwww', '115', 'invalid'],
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

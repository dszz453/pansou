import fs from 'node:fs';
import { parseTgHtml } from './dist/testbundle.mjs';

const html = fs.readFileSync('tg_bdbdndn11.html', 'utf8');
const KW = '乡村爱情';

// 解析前：统计原始消息数
const rawMsgs = html.split(/<div class="[^"]*tgme_widget_message_wrap[^"]*"/g).length - 1;
console.log('TG 页面原始消息块数:', rawMsgs);

const items = parseTgHtml(html, 'bdbdndn11', KW);
console.log('解析后通过严格过滤的条目数:', items.length);

let totalLinks = 0;
items.forEach(it => totalLinks += it.links.length);
console.log('提取到的网盘链接数:', totalLinks);

console.log('\n各条目标题与链接类型:');
const norm = s => String(s || '').toLowerCase().replace(/[\s\-_·.,，。、！!?？:：;；"'()（）\[\]【】《》<>/\\|~`@#$%^&*+=—…]/g, '');
const k = norm(KW);
let bad = 0;
items.forEach((it, i) => {
  const ctx = it.links[0]?.contextTitle || '';
  const type = it.links[0]?.type || '?';
  const titleOk = norm(it.title).includes(k);
  const ctxOk = ctx ? norm(ctx).includes(k) : false;
  if (!titleOk && !ctxOk) bad++;
  console.log(
    '  ' + String(i + 1).padStart(2) + '. [' + type + '] ' +
    (titleOk ? '✓' : '✗') + ' title=' + it.title.slice(0, 42) +
    (ctx ? ' | ctx=' + ctx.slice(0, 30) : '')
  );
});
console.log('\n未命中关键词的条目:', bad, '/', items.length);

// 检查是否还有 ?q= 残留
const junk = items.filter(it => it.title.includes('?q=') || it.title.includes('%23'));
console.log('标题含 ?q=/%23 的条目:', junk.length);

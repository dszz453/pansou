import { SearchResultItem, ExtractedLink } from './types';
import {
  extractLinksAndPasswords,
  extractTags,
  extractTitle,
  isTitleRelevant,
  isUnreliableTitle,
  pickKeywordLine,
  contentMentions
} from './parser';

/** 抓取页面时通用的浏览器 UA */
const BROWSER_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8'
};

/**
 * 拉取任意 Telegram 公开频道网页（带超时），失败返回空字符串
 */
async function fetchTgHtml(url: string, timeoutMs: number): Promise<string> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal, headers: BROWSER_HEADERS });
    if (!res.ok) return '';
    return await res.text();
  } catch (err) {
    return '';
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * 抓取单个 Telegram 公开频道搜索页面 (t.me/s/{channel}?q={keyword})
 *
 * ⚠️ 注意：Telegram 网页版搜索是**逐字符松散匹配**（搜「三体」会返回一堆含「三」或「体」的帖子），
 * 因此这里只把它当作「候选集」，真正的精确校验交给 filterItemsByKeyword()。
 */
export async function searchTgChannel(
  channel: string,
  keyword: string,
  tgProxyUrl?: string,
  timeoutMs: number = 6000
): Promise<SearchResultItem[]> {
  const cleanChannel = channel.trim().replace(/^@/, '');
  if (!cleanChannel) return [];

  const baseUrl = tgProxyUrl ? tgProxyUrl.replace(/\/$/, '') : 'https://t.me';
  const html = await fetchTgHtml(
    `${baseUrl}/s/${cleanChannel}?q=${encodeURIComponent(keyword)}`,
    timeoutMs
  );
  if (!html) return [];

  return filterItemsByKeyword(parseTgHtml(html, cleanChannel, keyword), keyword);
}

/**
 * 抓取频道最近消息流（不带关键词），用于搜索页覆盖不到时的兜底
 */
export async function fetchTgChannelFeed(
  channel: string,
  tgProxyUrl?: string,
  timeoutMs: number = 6000
): Promise<SearchResultItem[]> {
  const cleanChannel = channel.trim().replace(/^@/, '');
  if (!cleanChannel) return [];

  const baseUrl = tgProxyUrl ? tgProxyUrl.replace(/\/$/, '') : 'https://t.me';
  const html = await fetchTgHtml(`${baseUrl}/s/${cleanChannel}`, timeoutMs);
  if (!html) return [];

  return parseTgHtml(html, cleanChannel);
}

/**
 * 解析 Telegram 网页版 HTML 输出为结构化消息列表（不做关键词过滤）
 */
export function parseTgHtml(html: string, channel: string, keyword?: string): SearchResultItem[] {
  const items: SearchResultItem[] = [];

  // 分割每条消息容器 tgme_widget_message_wrap
  const msgBlocks = html.split(/<div class="[^"]*tgme_widget_message_wrap[^"]*"/g).slice(1);

  for (const block of msgBlocks) {
    // 1. 提取 message id (data-post="channel/12345")
    const postMatch = block.match(/data-post="([^"]+)"/);
    const fullPostId = postMatch ? postMatch[1] : '';
    const messageId = fullPostId ? fullPostId.split('/')[1] || fullPostId : '';
    const uniqueId = fullPostId || `${channel}_${Math.random().toString(36).substring(2, 9)}`;

    // 2. 提取日期时间 <time datetime="2024-03-20T12:00:00+00:00">
    const timeMatch = block.match(/<time[^>]*datetime="([^"]+)"/);
    const datetime = timeMatch ? timeMatch[1] : new Date().toISOString();

    // 3. 提取消息正文 <div class="tgme_widget_message_text[^"]*">...</div>
    const textMatch = block.match(/<div class="[^"]*tgme_widget_message_text[^"]*"[^>]*>([\s\S]*?)<\/div>/);
    const rawText = textMatch ? textMatch[1] : '';

    if (!rawText) continue;

    // 清洗 HTML 标签得到纯文本，保持换行
    const cleanText = rawText
      .replace(/<br\s*[\/]?>/gi, '\n')
      .replace(/<a\s+[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi, (m: string, href: string, text: string) => {
        // Telegram 的 #标签 会渲染成相对查询链接 href="?q=%23xxx"，
        // 这类链接没有价值，只保留可见文字（如 #乡村爱情），避免标题变成 ?q=%23...
        if (/^[?#]/.test(href) || href.includes('?q=')) return text;
        return `${href} (${text})`;
      })
      .replace(/<[^>]+>/g, '')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .trim();

    // 4. 提取网盘链接（携带局部专属 contextTitle）
    const links = extractLinksAndPasswords(cleanText, keyword);
    if (links.length === 0) continue;

    // 5. 提取全局标题与标签
    const title = extractTitle(cleanText, keyword);
    const tags = extractTags(cleanText);

    // 6. 提取图片 (可选)
    const images: string[] = [];
    const photoMatch = block.match(/background-image:url\('([^']+)'\)/);
    if (photoMatch && photoMatch[1]) {
      images.push(photoMatch[1]);
    }

    items.push({
      message_id: messageId,
      unique_id: uniqueId,
      channel: `tg:${channel}`,
      datetime,
      title,
      content: cleanText,
      links,
      tags,
      images: images.length > 0 ? images : undefined
    });
  }

  return items;
}

/**
 * 关键一步：把「Telegram 松散匹配的候选消息」收敛为**精确命中关键词**的资源列表。
 *
 * 规则：
 *  1. 消息正文必须真正包含关键词（精确子串）——否则整条丢弃；
 *     这能剔除 Telegram 逐字符匹配带来的大量噪声（搜「三体」返回「三对夫妻…集体…」）。
 *  2. 每个链接的标题取「正文中包含关键词的那一行」（通常就是剧名行），
 *     而不是消息首行 —— 因为频道常把多条剧集塞进一条消息。
 *  3. 仍需通过可信度闸门（排除剧情文案 / 标签堆砌 / 元数据行）。
 */
export function filterItemsByKeyword(
  items: SearchResultItem[],
  keyword: string
): SearchResultItem[] {
  if (!keyword || !keyword.trim()) return items;

  const out: SearchResultItem[] = [];

  for (const item of items) {
    if (!contentMentions(item.content, keyword)) continue;

    // 优先使用正文中直接包含关键词的那一行作为本条消息的主题名
    const keywordLine = pickKeywordLine(item.content, keyword);
    const globalTitleUsable = isTitleRelevant(item.title, keyword) && !isUnreliableTitle(item.title);

    const kept: ExtractedLink[] = [];
    for (const link of item.links) {
      const lt = (link as any).contextTitle as string | undefined;

      let useTitle = '';
      if (lt && isTitleRelevant(lt, keyword) && !isUnreliableTitle(lt)) {
        useTitle = lt;
      } else if (keywordLine) {
        useTitle = keywordLine;
      } else if (globalTitleUsable) {
        useTitle = item.title;
      }

      if (!useTitle) continue;
      if (!isTitleRelevant(useTitle, keyword)) continue;
      if (isUnreliableTitle(useTitle)) continue;

      kept.push({
        type: link.type,
        url: link.url,
        password: link.password,
        contextTitle: useTitle
      });
    }

    if (kept.length === 0) continue;

    out.push({
      ...item,
      title: keywordLine || item.title,
      links: kept
    });
  }

  return out;
}

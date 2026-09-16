import { CloudType, ExtractedLink } from './types';

// 网盘匹配规则体系（丰富各大网盘、短链、镜像域名与官方分享路径）
const CLOUD_RULES: Array<{ type: CloudType; reg: RegExp }> = [
  // 阿里云盘 / 阿里网盘 (alipan / aliyundrive)
  {
    type: 'aliyun',
    reg: /(?:https?:\/\/)?(?:www\.)?(?:aliyundrive\.com|alipan\.com|alishare\.com)\/(?:s\/|drive\/share\/|share\/)[a-zA-Z0-9_-]+/i
  },
  // 夸克网盘 (quark.cn / pan.quark.cn / drive.quark.cn)
  {
    type: 'quark',
    reg: /(?:https?:\/\/)?(?:[a-zA-Z0-9-]+\.)?quark\.cn\/(?:s\/|share\/)[a-zA-Z0-9_-]+/i
  },
  // 百度网盘 (pan.baidu.com / yun.baidu.com / baidupan / duan.baidu)
  {
    type: 'baidu',
    reg: /(?:https?:\/\/)?(?:pan|yun|drive|www)?\.?baidu\.com\/(?:s\/|share\/init\?surl=|share\/link\?)[a-zA-Z0-9_-]+(?:\?pwd=[a-zA-Z0-9]+)?/i
  },
  // 天翼云盘 (189.cn / cloud.189.cn)
  {
    type: 'tianyi',
    reg: /(?:https?:\/\/)?(?:cloud|h5|www)?\.?189\.cn\/(?:t|share\.html#[/a-zA-Z0-9]+|web\/share\?code=|\/share\/)\/?[a-zA-Z0-9_-]*/i
  },
  // UC 网盘 (uc.cn / drive.uc.cn / fast.uc.cn)
  {
    type: 'uc',
    reg: /(?:https?:\/\/)?(?:[a-zA-Z0-9-]+\.)?uc\.cn\/(?:s\/|drive\/share\/|share\/)[a-zA-Z0-9_-]+/i
  },
  // 移动云盘 / 和彩云 (139.com / caiyun.139.com / yun.139.com)
  {
    type: 'mobile',
    reg: /(?:https?:\/\/)?(?:caiyun\.139\.com|yun\.139\.com|www\.139\.com|139\.com)\/(?:w|share|s)\/?[a-zA-Z0-9_-]*/i
  },
  // 115 网盘 (115.com / anxia.com / 115cdn)
  {
    type: '115',
    reg: /(?:https?:\/\/)?(?:115\.com|anxia\.com)\/(?:s|web\/lfn)\/[a-zA-Z0-9_-]+/i
  },
  // PikPak (mypikpak.com / pikpak.me / drive.mypikpak.com / pikpak.in)
  {
    type: 'pikpak',
    reg: /(?:https?:\/\/)?(?:[a-zA-Z0-9-]+\.)?(?:mypikpak\.com|pikpak\.me|pikpak\.in|pikpak\.net)\/(?:s\/|drive\/s\/)[a-zA-Z0-9_-]+/i
  },
  // 迅雷云盘 (pan.xunlei.com / mypan.xunlei.com / xunlei.com)
  {
    type: 'xunlei',
    reg: /(?:https?:\/\/)?(?:pan|mypan|drive|www)?\.?xunlei\.com\/(?:s\/|share\/)[a-zA-Z0-9_-]+/i
  },
  // 123 云盘 (123pan.com / 123pan.cn / 123684 / 123865 / 123951 等多备用域名)
  {
    type: '123',
    reg: /(?:https?:\/\/)?(?:www\.)?(?:123pan\.com|123pan\.cn|123684\.com|123865\.com|123951\.com|123pan\.net)\/s\/[a-zA-Z0-9_-]+/i
  },
  // 光鸭网盘 (guangya.net / gypan.com / guangya.cc / guangya.cn)
  {
    type: 'guangya',
    reg: /(?:https?:\/\/)?(?:www\.)?(?:guangya\.net|gypan\.com|guangya\.cc|guangya\.cn|pan\.guangya\.net)\/s\/[a-zA-Z0-9_-]+/i
  },
  // 磁力链接
  { type: 'magnet', reg: /magnet:\?xt=urn:btih:[a-zA-Z0-9]+/i },
  // 电驴链接
  { type: 'ed2k', reg: /ed2k:\/\/\|file\|[^|]+\|\d+\|[a-fA-F0-9]+\|/i }
];

// 提取提取码密码正则
const PWD_REGEX = /(?:提取码|密码|访问码|提取|pwd|code|口令)[：:\s]*([a-zA-Z0-9]{4,8})/i;

/**
 * 元数据行前缀：这些行是影片信息卡片字段，不是资源名称，选取标题时要跳过
 */
const META_LINE_REGEX =
  /^(?:网页|网址|链接|地址|来源|简介|描述|标签|关键词|🔍|🏷|📝|📌|📢|🔗|⭐|导演|编剧|主演|演员|类型|制片|国家|地区|年份|年代|语言|字幕|集数|片长|时长|别名|又名|评分|豆瓣|IMDb|TMDB|上映|首播|更新|状态)/;

/**
 * 归一化文本用于关键词匹配：忽略大小写、空白与标点
 */
export function normalizeForMatch(text: string): string {
  return String(text || '')
    .toLowerCase()
    .replace(/[\s\-_·.,，。、！!?？:：;；"'“”()（）\[\]【】《》<>/\\|~`@#$%^&*+=—…]/g, '');
}

/**
 * 判断某个标题是否真正与搜索关键词相关
 * 规则：归一化后标题必须**精确包含**归一化后的关键词。
 */
export function isTitleRelevant(title: string, keyword: string): boolean {
  const k = normalizeForMatch(keyword);
  if (!k) return true;

  const t = normalizeForMatch(title);
  if (!t) return false;

  return t.includes(k);
}

/**
 * 剧情文案 / 标签堆砌 前缀：这类文本是影片介绍卡片，不是资源名称
 */
const PLOT_BLURB_REGEX =
  /^(?:本片讲述|该片讲述|影片讲述|本剧讲述|该剧讲述|讲述了|讲述一段|剧情简介|故事简介|一句话|简介|描述|亮点|看点|剧情|影评|推荐语|这部|一部)/;

/** 纯标签行，如 "#甜宠 #乡村爱情 #快手" —— 关键词只是众多标签之一，不可作为资源名 */
const TAG_LIST_REGEX = /^(?:#[^\s#]+\s*){2,}$/;

/** 资源标题的结构化标记：集数 / 清晰度 / 年份 / 季数 / 更新状态 / 字幕语言 */
const RESOURCE_MARKER_REGEX =
  /(?:全\s*\d+\s*集|\d+\s*集|完结|更新至|第\s*\d+\s*[季部]|S\d{1,2}\b|EP?\d{1,3}\b|\d{3,4}[PpKk]\b|4K|8K|HDR|BluRay|Blu-ray|WEB[- ]?DL|WEBRip|HDTV|REMUX|MKV|MP4\b|中字|国语|粤语|双语|无删减|(?:19|20)\d{2})/i;

/**
 * 句子式描述特征：成句标点 + 叙事/宣传动词。
 */
const SENTENCE_DESC_REGEX =
  /(?:演绎|饰演|讲述|携手|上演|诠释|呈现|成长|治愈|笑泪|励志|一段|让人|值得|不容错过|好评如潮)/;

/**
 * 判断标题是否「不可信」——剧情文案、标签堆砌、元数据字段等
 */
export function isUnreliableTitle(title: string): boolean {
  const t = String(title || '').trim();
  if (!t) return true;
  if (META_LINE_REGEX.test(t)) return true;
  if (PLOT_BLURB_REGEX.test(t)) return true;
  if (TAG_LIST_REGEX.test(t)) return true;
  if (/关键词[：:]/.test(t)) return true;
  const tags = (t.match(/#[^\s#]+/g) || []).length;
  if (tags >= 3 && tags * 4 >= t.length) return true;
  if (/[。！？；]/.test(t)) return true;
  if (t.length >= 10 && !RESOURCE_MARKER_REGEX.test(t) && SENTENCE_DESC_REGEX.test(t)) return true;
  return false;
}

/**
 * 在一段消息正文中，找出「真正提到关键词」的那一行，作为资源标题。
 */
export function pickKeywordLine(content: string, keyword: string): string {
  const k = normalizeForMatch(keyword);
  if (!k) return '';

  const lines = String(content || '')
    .split(/[\r\n]+/)
    .map(l => l.trim())
    .filter(Boolean);

  const hits = lines.filter(l => normalizeForMatch(l).includes(k) && !isUnreliableTitle(cleanTitleString(l)));
  if (hits.length === 0) return '';

  // ① 书名号/方括号包裹的正式剧名
  const bracketed = hits.find(l => /[【《\[][^】》\]]+[】》\]]/.test(l));
  if (bracketed) return cleanTitleString(bracketed);

  // ② 带资源标记（集数/清晰度/年份）的一行
  const marked = hits.find(l => RESOURCE_MARKER_REGEX.test(l));
  if (marked) return cleanTitleString(marked);

  // ③ 其余取最短的一行
  hits.sort((a, b) => a.length - b.length);
  return cleanTitleString(hits[0]);
}

/**
 * 判断一条消息正文是否真的提到了关键词
 */
export function contentMentions(content: string, keyword: string): boolean {
  const k = normalizeForMatch(keyword);
  if (!k) return true;
  return normalizeForMatch(content).includes(k);
}

/**
 * 从文本或 URL 中高精度识别网盘类型
 */
export function identifyCloudType(urlOrText: string): CloudType {
  const target = String(urlOrText || '');
  for (const rule of CLOUD_RULES) {
    if (rule.reg.test(target)) {
      return rule.type;
    }
  }

  // 兜底：如果 URL 或标题包含特定关键词
  if (/alipan|aliyun|阿里/i.test(target)) return 'aliyun';
  if (/quark|夸克/i.test(target)) return 'quark';
  if (/baidu|百度/i.test(target)) return 'baidu';
  if (/189\.cn|天翼/i.test(target)) return 'tianyi';
  if (/uc\.cn|uc网盘|优视/i.test(target)) return 'uc';
  if (/139\.com|移动云盘|和彩云/i.test(target)) return 'mobile';
  if (/115\.com|115网盘|anxia/i.test(target)) return '115';
  if (/pikpak/i.test(target)) return 'pikpak';
  if (/xunlei|迅雷/i.test(target)) return 'xunlei';
  if (/123pan|123云盘|123网盘/i.test(target)) return '123';
  if (/guangya|光鸭/i.test(target)) return 'guangya';
  if (/magnet:\?/i.test(target)) return 'magnet';
  if (/ed2k:\/\//i.test(target)) return 'ed2k';

  return 'others';
}

/**
 * 结构化的关联链接条目（包含专属上下文标题）
 */
export interface ContextualExtractedLink extends ExtractedLink {
  contextTitle?: string;
}

/**
 * 从一段文本中提取所有网盘链接及提取码，并关联最邻近的具体剧名标题
 */
export function extractLinksAndPasswords(text: string, globalKeyword?: string): ContextualExtractedLink[] {
  const links: ContextualExtractedLink[] = [];
  const lines = text.split(/[\r\n]+/).map(l => l.trim()).filter(Boolean);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    
    // 匹配所有 URL 或 magnet/ed2k
    const urlMatches = line.match(/(https?:\/\/[^\s<>"'()]+|magnet:\?xt=urn:btih:[a-zA-Z0-9]+|ed2k:\/\/[^\s<>"'()]+)/gi);
    if (!urlMatches) continue;

    const candidates: string[] = [];
    const collect = (idx: number) => {
      const raw = lines[idx];
      if (!raw) return;
      if (/^(?:https?:\/\/|magnet:|ed2k:)/i.test(raw)) return;
      if (/^(?:提取码|密码|访问码|解压密码)[：:\s]*[a-zA-Z0-9]+$/i.test(raw)) return;
      if (isUnreliableTitle(cleanTitleString(raw))) return;
      candidates.push(cleanTitleString(raw));
    };

    // 优先向上找
    for (let back = 1; back <= 4 && i - back >= 0; back++) {
      collect(i - back);
    }
    // 其次向下找
    for (let fwd = 1; fwd <= 2 && i + fwd < lines.length; fwd++) {
      collect(i + fwd);
    }

    // 优先选取包含搜索关键词的行
    let contextTitle = '';
    if (globalKeyword) {
      const kwMatch = candidates.find(c => isTitleRelevant(c, globalKeyword));
      if (kwMatch) contextTitle = kwMatch;
    }
    // 其次选取书名号或方括号包裹的正式剧名
    if (!contextTitle) {
      const bracketed = candidates.find(c => /[【《\[][^】》\]]+[】》\]]/.test(c));
      if (bracketed) contextTitle = bracketed;
    }
    // 再次选取带有资源标记的行
    if (!contextTitle) {
      const marked = candidates.find(c => RESOURCE_MARKER_REGEX.test(c));
      if (marked) contextTitle = marked;
    }
    // 兜底取最近的一行候选
    if (!contextTitle && candidates.length > 0) {
      contextTitle = candidates[0];
    }

    for (const rawUrl of urlMatches) {
      let cleanUrl = rawUrl.replace(/[.,;:!?，。；！？)+]+$/, '');
      const type = identifyCloudType(cleanUrl);

      // 尝试在本行或下一行提取密码
      let password = '';
      const inlinePwd = line.match(PWD_REGEX);
      if (inlinePwd && inlinePwd[1]) {
        password = inlinePwd[1];
      } else if (i + 1 < lines.length) {
        const nextLinePwd = lines[i + 1].match(PWD_REGEX);
        if (nextLinePwd && nextLinePwd[1]) {
          password = nextLinePwd[1];
        }
      }

      // 如果 URL 自带百度/夸克等 pwd 参数
      const urlPwdMatch = cleanUrl.match(/[?&]pwd=([a-zA-Z0-9]+)/i);
      if (urlPwdMatch && urlPwdMatch[1]) {
        password = urlPwdMatch[1];
      }

      // 去重添加
      if (!links.some(l => l.url === cleanUrl)) {
        links.push({
          type,
          url: cleanUrl,
          password: password || undefined,
          contextTitle: contextTitle || undefined
        });
      }
    }
  }

  return links;
}

/**
 * 提取文本中的标签 (如 #电影 #4K)
 */
export function extractTags(text: string): string[] {
  const tagMatches = text.match(/#([^\s#]+)/g);
  if (!tagMatches) return [];
  return Array.from(new Set(tagMatches.map(t => t.replace(/^#/, ''))));
}

/**
 * 清洗单行文本为合规标题
 */
export function cleanTitleString(raw: string): string {
  let s = raw.trim();
  s = s.replace(/^\d+[\.、\s\-]+/, '');
  s = s.replace(
    /^(?:【剧名】|【名称】|【片名】|【资源名称】|资源名称[：:]|资源名[：:]|剧名[：:]|片名[：:]|名称[：:]|标题[：:])/i,
    ''
  );
  s = s.replace(/^[\|\-—\s:]+/, '').trim();
  return s.slice(0, 100);
}

/**
 * 智能提取全文主标题
 */
export function extractTitle(text: string, keyword?: string): string {
  const lines = text.split(/[\r\n]+/).map(l => l.trim()).filter(Boolean);
  if (lines.length === 0) return '未命名资源';

  if (keyword) {
    const kwHit = pickKeywordLine(text, keyword);
    if (kwHit) return kwHit;
  }

  const bracketed = lines.find(l => /[【《\[][^】》\]]+[】》\]]/.test(l) && !isUnreliableTitle(cleanTitleString(l)));
  if (bracketed) return cleanTitleString(bracketed);

  const marked = lines.find(l => RESOURCE_MARKER_REGEX.test(l) && !isUnreliableTitle(cleanTitleString(l)));
  if (marked) return cleanTitleString(marked);

  for (const line of lines) {
    const cleaned = cleanTitleString(line);
    if (!isUnreliableTitle(cleaned) && cleaned.length >= 2) {
      return cleaned;
    }
  }

  return cleanTitleString(lines[0]) || '未命名资源';
}

/**
 * 结果相关性打分：用于同一网盘分类内的排序（分越高越靠前）。
 */
export function scoreResultRelevance(title: string, content: string, keyword: string): number {
  if (!keyword || !keyword.trim()) return 100;

  const kw = keyword.trim().toLowerCase();
  const lowerTitle = (title || '').toLowerCase();
  const lowerContent = (content || '').toLowerCase();

  let score = 0;

  // 1. 标题完全包含关键词（最高权重）
  if (lowerTitle.includes(kw)) {
    score += 100;
  }

  // 2. 标题以关键词开头
  if (lowerTitle.startsWith(kw) || lowerTitle.startsWith(`【${kw}`) || lowerTitle.startsWith(`《${kw}`)) {
    score += 30;
  }

  // 3. 内容中包含关键词
  if (lowerContent.includes(kw)) {
    score += 40;
  }

  // 4. 标题中包含典型影视年份/分辨率/季数（如 4K, 1080P, S01, 全集, 第16部）加分
  if (/(?:4k|1080p|全集|合集|第\d+[部季]|202[0-9]|完结)/i.test(lowerTitle)) {
    score += 10;
  }

  // 5. 扣分项：广告、推广、群链接、互推
  if (/(?:赌博|彩票|成人|翻墙|代充|接单|客服|招代理|返利|引流)/i.test(lowerTitle + lowerContent)) {
    score -= 200;
  }

  return score;
}

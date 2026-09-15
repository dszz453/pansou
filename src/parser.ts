import { CloudType, ExtractedLink } from './types';

// 网盘匹配规则体系
const CLOUD_RULES: Array<{ type: CloudType; reg: RegExp }> = [
  { type: 'aliyun', reg: /(?:https?:\/\/)?(?:www\.)?(?:aliyundrive\.com|alipan\.com)\/s\/[a-zA-Z0-9_-]+/i },
  { type: 'quark', reg: /(?:https?:\/\/)?(?:pan|drive|www)?\.?quark\.cn\/s\/[a-zA-Z0-9_-]+/i },
  { type: 'baidu', reg: /(?:https?:\/\/)?(?:pan|yun)\.baidu\.com\/(?:s\/|share\/init\?surl=)[a-zA-Z0-9_-]+(?:\?pwd=[a-zA-Z0-9]+)?/i },
  { type: 'tianyi', reg: /(?:https?:\/\/)?(?:cloud|h5|www)?\.?189\.cn\/(?:t|share\.html#[/a-zA-Z0-9]+|web\/share\?code=)\/?[a-zA-Z0-9_-]*/i },
  { type: 'uc', reg: /(?:https?:\/\/)?(?:drive|fast|www)?\.?uc\.cn\/s\/[a-zA-Z0-9_-]+/i },
  { type: 'mobile', reg: /(?:https?:\/\/)?(?:caiyun\.139\.com|yun\.139\.com|www\.139\.com)\/(?:w|share)\/?[a-zA-Z0-9_-]*/i },
  { type: '115', reg: /(?:https?:\/\/)?(?:115\.com|anxia\.com)\/(?:s|web\/lfn)\/[a-zA-Z0-9_-]+/i },
  { type: 'pikpak', reg: /(?:https?:\/\/)?(?:mypikpak\.com|pikpak\.me|drive\.mypikpak\.com)\/s\/[a-zA-Z0-9_-]+/i },
  { type: 'xunlei', reg: /(?:https?:\/\/)?(?:pan|mypan)\.xunlei\.com\/s\/[a-zA-Z0-9_-]+/i },
  { type: '123', reg: /(?:https?:\/\/)?(?:www\.)?(?:123pan\.com|123pan\.cn|123684\.com|123865\.com|123951\.com)\/s\/[a-zA-Z0-9_-]+/i },
  { type: 'guangya', reg: /(?:https?:\/\/)?(?:www\.)?(?:guangya\.net|gypan\.com|guangya\.cc|guangya\.cn|pan\.guangya\.net)\/s\/[a-zA-Z0-9_-]+/i },
  { type: 'magnet', reg: /magnet:\?xt=urn:btih:[a-zA-Z0-9]+/i },
  { type: 'ed2k', reg: /ed2k:\/\/\|file\|[^|]+\|\d+\|[a-fA-F0-9]+\|/i }
];

// 提取提取码密码正则
const PWD_REGEX = /(?:提取码|密码|访问码|提取|pwd|code)[：:\s]*([a-zA-Z0-9]{4,8})/i;

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
 * （不做首尾模糊匹配——「乡村」+「爱情」的松匹配会放进《红高粱》《无名的裘德》等无关影片）
 */
export function isTitleRelevant(title: string, keyword: string): boolean {
  const k = normalizeForMatch(keyword);
  if (!k) return true;

  const t = normalizeForMatch(title);
  if (!t) return false;

  return t.includes(k);
}

/**
 * 剧情文案 / 标签堆砌 前缀：这类文本是影片介绍卡片，不是资源名称，
 * 即便字面命中关键词，其指向的资源往往也不是用户要的那部，必须剔除。
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
 * 「温暖治愈的乡村爱情故事，孔晓振演绎单亲妈妈的坚韧与成长，笑泪交织…」
 * 这类是影片介绍卡片，字面命中关键词但并非该资源本身。
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
  // 「🔍 关键词：#科幻 #三体 …」这类标签聚合行，关键词只是众多标签之一
  if (/关键词[：:]/.test(t)) return true;
  // 标签占比过高（如 "#a #b #c 标题"），视为标签堆砌
  const tags = (t.match(/#[^\s#]+/g) || []).length;
  if (tags >= 3 && tags * 4 >= t.length) return true;
  // 含句末标点（。！？；）的文本基本不可能是资源名
  if (/[。！？；]/.test(t)) return true;
  // 叙述型文案：既无任何资源结构化标记，又含叙事/宣传动词 —— 判定为剧情简介而非资源名
  if (t.length >= 10 && !RESOURCE_MARKER_REGEX.test(t) && SENTENCE_DESC_REGEX.test(t)) return true;
  return false;
}



/**
 * 在一段消息正文中，找出「真正提到关键词」的那一行，作为资源标题。
 *
 * 背景：Telegram 公开频道的搜索是**逐字符松散匹配**（搜「三体」会返回所有含「三」或「体」的帖子），
 * 因此不能直接采信搜索返回结果；必须回到消息正文里做**精确子串校验**，
 * 并把正文中包含关键词的那一行（通常就是剧名行）提取出来当作标题。
 *
 * 返回值按可信度排序：优先「书名号剧名 + 含关键词」，其次「含关键词的正文行」。
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

  // ③ 其余取最短的一行（剧名行通常比简介行短得多）
  hits.sort((a, b) => a.length - b.length);
  return cleanTitleString(hits[0]);
}

/**
 * 判断一条消息正文是否真的提到了关键词（精确子串，忽略大小写与标点）
 */
export function contentMentions(content: string, keyword: string): boolean {
  const k = normalizeForMatch(keyword);
  if (!k) return true;
  return normalizeForMatch(content).includes(k);
}

/**
 * 从文本中识别网盘类型
 */
export function identifyCloudType(url: string): CloudType {
  for (const rule of CLOUD_RULES) {
    if (rule.reg.test(url)) {
      return rule.type;
    }
  }
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

    // 尝试寻找该链接专属的具体标题（上下各扫几行）
    // 注意：TG 资源卡片常见排版是
    //   第1行：正式剧名（《…》/【…】）
    //   第2行：剧情亮点 / 简介（含关键词但并非资源名）
    //   第3行：网盘链接
    // 因此不能简单取「最近一行」，必须逐行筛掉剧情文案与元数据行，
    // 再优先挑选书名号剧名 / 带资源标记的行。
    const candidates: string[] = [];
    const collect = (idx: number) => {
      const raw = lines[idx];
      if (!raw) return;
      // 排除纯链接行
      if (/^(?:https?:\/\/|magnet:|ed2k:)/i.test(raw)) return;
      // 排除纯密码行
      if (/^(?:提取码|密码|访问码|解压密码)[：:\s]*[a-zA-Z0-9]+$/i.test(raw)) return;
      // 排除影片元数据行（简介/导演/标签…），它们不是资源名
      if (META_LINE_REGEX.test(raw)) return;

      const cleaned = cleanTitleString(raw);
      if (!cleaned || cleaned.length < 2) return;
      // 排除剧情文案、标签堆砌、句子式描述 —— 它们字面命中关键词但并非资源本身
      if (isUnreliableTitle(cleaned)) return;

      candidates.push(cleaned);
    };
    for (let prevIdx = i; prevIdx >= Math.max(0, i - 4); prevIdx--) collect(prevIdx);
    for (let nextIdx = i + 1; nextIdx <= Math.min(lines.length - 1, i + 2); nextIdx++) collect(nextIdx);

    // 按下述优先级锁定该链接的专属标题：
    // ⓪ 直接包含搜索关键词的行（最精准）
    // ① 书名号 / 方括号包裹的正式剧名  ② 带集数/清晰度/年份等资源标记  ③ 最近的有效行
    const kNorm = globalKeyword ? normalizeForMatch(globalKeyword) : '';
    let contextTitle =
      (kNorm ? candidates.find(c => normalizeForMatch(c).includes(kNorm)) : '') ||
      candidates.find(c => /^[【《\[][^】》\]]+[】》\]]/.test(c)) ||
      candidates.find(c => RESOURCE_MARKER_REGEX.test(c)) ||
      candidates[0] ||
      '';

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
  // 去除前置引导词如 "1. ", "01. ", "【剧名】：", "名称："
  s = s.replace(/^\d+[\.、\s\-]+/, '');
  s = s.replace(
    /^(?:【剧名】|【名称】|【片名】|【资源名称】|资源名称[：:]|资源名[：:]|剧名[：:]|片名[：:]|名称[：:]|标题[：:])/i,
    ''
  );
  // 去除前后多余标点但保留有意义的书名号和方括号内容（如 【乡村爱情16】）
  s = s.replace(/^[\|\-—\s:]+/, '').trim();
  return s.slice(0, 100);
}

/**
 * 智能提取全文主标题（优先选取包含关键词或核心特征的行）
 */
export function extractTitle(text: string, keyword?: string): string {
  const lines = text.split(/[\r\n]+/).map(l => l.trim()).filter(Boolean);
  if (lines.length === 0) return '未知资源';

  // 过滤掉纯链接行
  const candidateLines = lines.filter(l => !/^(?:https?:\/\/|magnet:|ed2k:)/i.test(l));
  if (candidateLines.length === 0) return lines[0].slice(0, 100);

  // 非元数据行（优先从这些行里选标题）
  const contentLines = candidateLines.filter(l => !META_LINE_REGEX.test(l));
  const pool = contentLines.length > 0 ? contentLines : candidateLines;

  // 策略 1: 优先寻找包含搜索关键词的行
  if (keyword && keyword.trim()) {
    const matchedLine = pool.find(l => isTitleRelevant(l, keyword) && !/(?:频道|群组|广告|关注|赞助|入群)/.test(l));
    if (matchedLine) {
      return cleanTitleString(matchedLine);
    }
  }

  // 策略 2: 优先找包含【...】或《...》的行（通常为影视剧正式名称）
  const bracketLine = pool.find(l => /^[【《\[][^】》\]]+[】》\]]/.test(l) && !/(?:公告|通知|广告|推广|置顶)/.test(l));
  if (bracketLine) {
    return cleanTitleString(bracketLine);
  }

  // 策略 3: 默认取第一个有效文本行
  return cleanTitleString(pool[0]);
}

/**
 * 严格相关性与质量打分（用于过滤误报和置顶最精准结果）
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

import { PluginConfig, TgChannelConfig } from './types';

/**
 * 单次调用默认处理的频道数上限（前端未指定时使用）。
 * 受 Cloudflare Workers「单请求 50 子请求 / 6 并发连接」限制，保持较小值。
 */
export const DEFAULT_MAX_CHANNELS = 8;

/**
 * 原始 TG 频道清单（来自 pansou-web 的 CHANNELS 配置，含重复项，运行时自动去重）
 */
const RAW_CHANNELS = `tgsearchers7,Aliyun_4K_Movies,bdbdndn11,yunpanx,bsbdbfjfjff,yp123pan,yunpanxunlei,tianyifc,BaiduCloudDisk,txtyzy,
peccxinpd,gotopan,PanjClub,baicaoZY,MCPH01,MCPH02,MCPH03,bdwpzhpd,ysxb48,jdjdn1111,
yggpan,MCPH086,zaihuayun,Q66Share,ucwpzy,shareAliyun,alyp_1,dianyingshare,Quark_Movies,ydypzyfx,
ucquark,xx123pan,yingshifenxiang123,zyfb123,tyypzhpd,tianyirigeng,cloudtianyi,hdhhd21,Lsp115,oneonefivewpfx,
qixingzhenren,taoxgzy,Channel_Shares_115,tyysypzypd,vip115hot,wp123zy,yunpan139,yunpan189,yunpanuc,yydf_hzl,
leoziyuan,Q_dongman,yoyokuakeduanju,TG654TG,WFYSFX02,QukanMovie,yeqingjie_GJG666,movielover8888_film3,Baidu_netdisk,D_wusun,
FLMdongtianfudi,KaiPanshare,QQZYDAPP,rjyxfx,PikPak_Share_Channel,btzhi,newproductsourcing,cctv1211,duan_ju,QuarkFree,
yunpanNB,kkdj001,xxzlzn,pxyunpanxunlei,jxwpzy,kuakedongman,liangxingzhinan,xiangnikanj,guoman4K,zdqxm,
kduanju,cilidianying,CBduanju,SharePanFilms,dzsgx,BooksRealm,Oscar_4Kmovies,douerpan,baidu_yppan,Q_jilupian,
Netdisk_Movies,yunpanquark,ammmziyuan,ciliziyuanku,cili8888,jzmm_123pan,Q_dianying,domgmingapk,dianying4k,q_dianshiju,
tgbokee,ucshare,godupan,gokuapan,gimy115,WFYSFX03,peccxin,Movie888035,xlwpzy,zyywpzy,
wydwpzy,gimy100,gimy115iso,aliyunys,clouddriveresources,XunLeiPinDao,ydwpzy,a123fxme,WPpindao,kuyupan,
djya5,yingshiziyuanpindao,zh_vip,pan_guangya,zyzhpd123,zhenyingsg,gdsharing,weichengduanju666,yingxiangkj,duanjucabian,
kuakenetpan,kelea555,tianyiyunpanpindao,PikPakShareChannel,tgyy678,xuexixiaonengshou1,google_yppan,ayzgzf,tgsearchers5,sbsbsnsqq,
kkxlzy,XiangxiuNBB,solidsexydoll`;

function splitUnique(raw: string, stripAt = false): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const piece of raw.split(/[,\r\n]+/)) {
    let s = piece.trim();
    if (!s) continue;
    if (stripAt) {
      s = s
        .replace(/^@/, '')
        .replace(/^https?:\/\/t\.me\/(?:s\/)?/i, '')
        .replace(/[/?#].*$/, '')
        .trim();
    }
    if (!s) continue;
    const key = s.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(s);
  }
  return out;
}

/** 去重后的全部 TG 频道名 */
export const ALL_CHANNELS: string[] = splitUnique(RAW_CHANNELS, true);

/** 首批优先检索的频道数量：先搜这些并立即渲染，其余在后台继续补齐 */
export const PRIORITY_CHANNEL_COUNT = 24;

/** 根据频道名推断资源类型描述 */
function guessDescription(name: string): string {
  const n = name.toLowerCase();
  if (n.includes('115') || n.includes('oneonefive')) return '115网盘资源';
  if (n.includes('123')) return '123网盘资源';
  if (n.includes('guangya') || n.includes('gypan')) return '光鸭网盘资源';
  if (n.includes('pikpak')) return 'PikPak网盘资源';
  if (n.includes('xunlei') || n.includes('xlwp') || n.includes('mypan')) return '迅雷云盘资源';
  if (n.includes('quark') || n.includes('kuake') || n.includes('qupanshe')) return '夸克网盘资源';
  if (n.includes('aliyun') || n.includes('alyp') || n.includes('alipan')) return '阿里云盘资源';
  if (n.includes('baidu') || n.includes('bdwp') || n.includes('_bd') || n.includes('yppan')) return '百度网盘资源';
  if (n.includes('tianyi') || n.includes('189')) return '天翼云盘资源';
  if (n.includes('uc')) return 'UC网盘资源';
  if (n.includes('139') || n.includes('caiyun')) return '移动云盘资源';
  if (n.includes('cili') || n.includes('bt') || n.includes('magnet')) return '磁力/BT资源';
  if (n.includes('4k') || n.includes('movie') || n.includes('film')) return '4K影视资源';
  if (n.includes('duanju') || n.includes('ju')) return '短剧资源';
  if (n.includes('book') || n.includes('shufa')) return '电子书资源';
  return '综合网盘资源';
}

/**
 * 默认频道配置：**全部频道默认启用**。
 *
 * 自建后端不再受「单请求搜不完」的限制——前端会把全部频道拆成多个分片并发调度，
 * 因此这里可以把 143 个频道全部打开以获得最全覆盖。
 * 优先级：前 PRIORITY_CHANNEL_COUNT 个为高优先（首批检索并立即渲染），其余随后补齐。
 */
export const DEFAULT_CHANNELS: TgChannelConfig[] = ALL_CHANNELS.map((name, index) => ({
  name,
  enabled: true,
  priority: index < PRIORITY_CHANNEL_COUNT ? 1 : 2,
  description: guessDescription(name)
}));

/**
 * 单次搜索默认并行调用的插件数上限。
 * 插件是完整的外部 HTTP 请求（聚合节点一次要跑 5~8 秒），比单个 TG 频道重得多，
 * 因此默认只开很小的并发，避免拖垮整体响应时间。
 */
export const DEFAULT_MAX_PLUGINS = 2;

/**
 * 原始插件源清单（来自 fish2018/pansou 的 plugin/ 目录）。
 *
 * 这些是 pansou 生态里的「搜索插件」，每个对应一个外部资源站的抓取实现。
 * 本 Worker 不自己实现它们（它们是 Go 代码，依赖大量站点特定的反爬逻辑），
 * 而是通过一个「pansou 兼容聚合节点」一次性调用：节点内部并行跑这些插件。
 */
const RAW_PLUGINS = `hunhepan,jikepan,panwiki,pansearch,panta,qupansou,hdr4k,pan666,susu,thepiratebay,
wanou,xuexizhinan,panyq,zhizhen,labi,muou,ouge,shandian,duoduo,huban,
cyg,erxiao,miaoso,fox4k,pianku,clmao,wuji,cldi,xiaozhang,libvio,
leijing,xb6v,xys,ddys,hdmoli,yuhuage,u3c3,javdb,clxiong,jutoushe,
sdso,xiaoji,xdyh,haisou,bixin,djgou,nyaa,xinjuc,aikanzy,qupanshe,
xdpan,discourse,yunsou,qqpd,ahhhhfs,nsgame,gying,quark4k,quarksoo,sousou,
ash,weibo,feikuai,kkmao,alupan,ypfxw,mikuclub,daishudj,dyyj,meitizy,
jsnoteclub,mizixing,lou1,yiove,zxzj,qingying,kkv,yulinshufa,duanjuw,jupansou,
lingjisp,quarktv,dyyjpro,gaoqing888,panlian,panzun,qiwei,melost,yunso`;

/** 去重后的全部插件源 id */
export const ALL_PLUGIN_IDS: string[] = splitUnique(RAW_PLUGINS);

/**
 * 默认插件配置：只放一个「聚合节点」。
 *
 * 之所以不逐个子插件配置，是因为这些插件本质上都是对海外/第三方站点的一次 HTTP 抓取，
 * 由 Cloudflare Worker 直连既慢又容易失败（且每个站点反爬策略不同）；
 * 交给一个已经跑通的 pansou 兼容节点聚合，一次请求就能拿到 89 个源的合并结果。
 *
 * 想换成自建节点，只要把 apiEndpoint 改成你的 pansou 服务地址即可（后台可改）。
 */
export const DEFAULT_PLUGINS: PluginConfig[] = [
  {
    id: 'pansou_aggregate',
    name: `PanSou 聚合节点（${ALL_PLUGIN_IDS.length} 个插件源）`,
    enabled: true,
    type: 'pansou',
    apiEndpoint: 'https://so.252035.xyz/api/search',
    pluginIds: ALL_PLUGIN_IDS
  }
];

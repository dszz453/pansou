/**
 * 自托管图标集（替代 Font Awesome CDN）
 */

const I = (paths: string, extra = ''): string =>
  // eslint-disable-next-line max-len
  `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%23000' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E${paths}%3C/svg%3E")${extra}`;

/** 把 path 数据转成 data-uri 友好的片段 */
const P = (d: string) => `%3Cpath d='${d}'/%3E`;
const C = (cx: string, cy: string, r: string) => `%3Ccircle cx='${cx}' cy='${cy}' r='${r}'/%3E`;

const ICON_MAP: Record<string, string> = {
  // 关闭
  'fa-xmark': I(P('M6 6 18 18M18 6 6 18')),
  // 新增
  'fa-plus': I(P('M12 5v14M5 12h14')),
  // 删除
  'fa-trash': I(
    P('M4 7h16M10 11v6M14 11v6M6 7l1 12a1 1 0 001 1h8a1 1 0 001-1l1-12M9 7V5a1 1 0 011-1h4a1 1 0 011 1v2')
  ),
  // 下载 / 导出
  'fa-download': I(P('M12 3v12M8 11l4 4 4-4M4 21h16')),
  // 搜索
  'fa-magnifying-glass': I(`${C('11', '11', '7')}${P('M16.2 16.2 21 21')}`),
  // 设置 / 参数
  'fa-sliders': I(P('M4 8h8M16 8h4M4 16h4M12 16h8M14 6v4M10 14v4')),
  // 恢复默认 / 刷新
  'fa-rotate-left': I(P('M4 4v6h6M4.9 10A8 8 0 1 1 7 17.7')),
  'fa-arrows-rotate': I(P('M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8M3 3v5h5M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16M21 21v-5h-5')),
  // 批量导入
  'fa-file-import': I(P('M14 3H7a2 2 0 00-2 2v14a2 2 0 002 2h10a2 2 0 002-2V8l-5-5zM14 3v5h5M12 11v6M9 14l3 3 3-3')),
  // 接口文档
  'fa-code': I(P('M9 6 3 12l6 6M15 6l6 6-6 6')),
  // 网盘
  'fa-cloud': I(P('M7 19a5 5 0 01-.4-9.98A6 6 0 0118 10.3 4.5 4.5 0 0117.5 19H7z')),
  // 热门
  'fa-bolt': I(P('M13 2 5 14h6l-1 8 8-12h-6l1-8z')),
  'fa-fire': I(P('M12 2c1.5 3 5 5.5 5 10a5 5 0 01-10 0c0-1.5.5-2.8 1.2-3.8.3.9 1 1.8 2 1.8 0-3 1.8-6.6 1.8-8z')),
  // 目录
  'fa-folder-open': I(
    P('M3 8V6a2 2 0 012-2h4l2 2h7a2 2 0 012 2v2M2.6 10h18.8l-2.1 8.3a2 2 0 01-1.9 1.7H6.6a2 2 0 01-1.9-1.5L2.6 10z')
  ),
  // 警告
  'fa-triangle-exclamation': I(P('M12 4 22 20H2L12 4zM12 10v4.5M12 17.5h.01')),
  // 新窗口打开
  'fa-arrow-up-right-from-square': I(P('M14 4h6v6M20 4l-8 8M18 14v5a1 1 0 01-1 1H5a1 1 0 01-1-1V7a1 1 0 011-1h5')),
  // 加载中
  'fa-circle-notch': I(P('M12 3a9 9 0 109 9')),
  // 复制
  'fa-copy': I(P('M8 4v12a2 2 0 002 2h8a2 2 0 002-2V4a2 2 0 00-2-2h-8a2 2 0 00-2 2zM4 8v12a2 2 0 002 2h8')),
  // 勾选 / 成功
  'fa-check': I(P('M20 6 9 17l-5-5')),
  'fa-circle-check': I(`${C('12', '12', '9')}${P('M8.5 12.5 10.5 14.5 15.5 9.5')}`),
  // 失效 / 叉
  'fa-circle-xmark': I(`${C('12', '12', '9')}${P('M9 9 15 15M15 9 9 15')}`),
  // 盾牌 / 检测
  'fa-shield-halved': I(P('M12 2 4 5v6c0 5.5 3.8 10.7 8 12 4.2-1.3 8-6.5 8-12V5l-8-3zM12 2v20')),
  // 问号 / 未知
  'fa-circle-question': I(`${C('12', '12', '9')}${P('M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3M12 17h.01')}`),
  // 排序
  'fa-arrow-down-wide-short': I(P('M3 6h18M3 12h12M3 18h6')),
  // 听诊器（测活）
  'fa-stethoscope': I(
    P('M6 3v6a5 5 0 0010 0V3M4 3h4M14 3h4M11 14v2a5 5 0 0010 0v-1M21 13h.01')
  ),
  // 时钟
  'fa-clock': I(`${C('12', '12', '9')}${P('M12 7.5V12l3 2')}`),
  // 喇叭 / 来源渠道
  'fa-bullhorn': I(P('M3 11v3l14 5V6L3 11zM7 13v6a2 2 0 004 0v-4M19 10a3 3 0 010 6')),
  // 双向刷新（单项测活）
  'fa-rotate': I(P('M21 12a9 9 0 1 1-2.6-6.4M21 4v5h-5')),
  // 垃圾桶（别名，兼容 fa-trash-can 写法）
  'fa-trash-can': I(
    P('M4 7h16M10 11v6M14 11v6M6 7l1 12a1 1 0 001 1h8a1 1 0 001-1l1-12M9 7V5a1 1 0 011-1h4a1 1 0 011 1v2')
  ),
  // 筛选无结果
  'fa-filter-circle-xmark': I(
    `${C('15', '15', '6')}${P('M3 5h18l-7 8v6l-4 2v-8L3 5zM13.5 13.5l3 3M16.5 13.5l-3 3')}`
  )
};

export const ICONS_CSS = `
/* ===== 自托管图标集（内联 SVG mask，无外部请求）===== */
.fa-solid, .fa-regular {
  display: inline-block;
  width: 1em;
  height: 1em;
  background-color: currentColor;
  -webkit-mask-repeat: no-repeat;
  mask-repeat: no-repeat;
  -webkit-mask-position: center;
  mask-position: center;
  -webkit-mask-size: contain;
  mask-size: contain;
  vertical-align: -0.125em;
  flex: none;
}
.fa-spin {
  animation: fa-icon-spin 0.9s linear infinite;
}
@keyframes fa-icon-spin {
  from { transform: rotate(0deg); }
  to   { transform: rotate(360deg); }
}
${Object.entries(ICON_MAP)
  .map(
    ([cls, uri]) =>
      `.${cls}{-webkit-mask-image:${uri};mask-image:${uri};}`
  )
  .join('\n')}
`;

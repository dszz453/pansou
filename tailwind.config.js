/** @type {import('tailwindcss').Config} */
module.exports = {
  // 首页模板与后台管理页面都要扫，漏掉任何一个都会导致该页面「部分样式丢失」
  content: ['./src/ui.html.ts', './src/admin.ui.ts', './src/pwa.ts'],
  theme: {
    extend: {},
  },
  plugins: [],
};

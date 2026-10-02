# Tools Webpage

个人工具系列的营销站点，纯静态页面（HTML + CSS + 原生 JS），无构建步骤。站点源码在 `public/`——托管的就是这个目录，换任何静态服务器都能直接用。

## 结构

```
tool_webpage/
├── public/                           # 站点根目录：对外托管的就是这里
│   ├── index.html                    # 统一首页：工具列表
│   ├── tools/
│   │   ├── notch-tasks/
│   │   │   └── index.html            # 任务坞 NotchTasks 介绍页（macOS 应用，下载引导）
│   │   ├── watch-your-claude/
│   │   │   └── index.html            # WatchYourClaude 独立介绍页（macOS 应用，下载引导）
│   │   ├── guandan-challenge/
│   │   │   └── index.html            # 大模型掼蛋挑战赛介绍页（网页产品，跳转即玩）
│   │   ├── trippy-wiki/
│   │   │   └── index.html            # 梦游 Wiki 介绍页（网页产品，跳转即逛）
│   │   ├── research-docs/
│   │   │   └── index.html            # 研和讨介绍页（网页产品，跳转即用）
│   │   └── news/
│   │       └── index.html            # 纽斯（新闻知识库）介绍页（Agent Skill，引导装进智能体）
│   └── assets/
│       ├── css/style.css             # 全站共享设计系统（深色主题）
│       ├── js/i18n.js                # 中英双语切换
│       └── img/                      # 各工具图标、favicon
└── project/
    ├── tool_webpage.Caddyfile        # Caddy 静态托管配置（product.yao-yang.cn）
    └── after_push.sh                 # 部署脚本：软链 Caddyfile 并 reload
```

按产品类型区分 CTA：macOS 应用引导去 GitHub Releases 下载；网页产品（无源码引导）直接跳转线上地址使用；Agent Skill 引导把 skill 装进自己的智能体（主 CTA 跳产品站，页面内附安装口令，无下载、无源码引导）。

## 双语机制

默认中文。页面上需要翻译的元素加 `data-i18n-zh` / `data-i18n-en` 两个属性（标签体内是中文默认文案）：

```html
<p data-i18n-zh="中文" data-i18n-en="English">中文</p>
```

`public/assets/js/i18n.js` 会遍历替换内容（属性值里可以写 `<em>`、`<br>` 等 HTML），并把用户选择存进 localStorage。新增文案时两个属性都要写。

## 新增一个工具

1. 新建 `public/tools/<tool-slug>/index.html`，以 WatchYourClaude 的页面为模板（资源路径用 `../../` 相对引用）。
2. 把工具图标放进 `public/assets/img/`。
3. 在 `public/index.html` 的 `.tools-grid` 里复制一张 `.tool-card.featured` 卡片，改链接和文案。
4. 如果新工具有自己的品牌色，在它的 `<body>` 上覆盖 CSS 变量即可（如 `style="--accent: #5ea5fa"`），全站样式自动跟随。

## 本地预览

```bash
python3 -m http.server -d public 8000
# 打开 http://localhost:8000
```

## 部署

线上托管在服务器 Caddy 上，域名 `product.yao-yang.cn`：

- `project/tool_webpage.Caddyfile`：`root * /var/www/tool_webpage/public` + `encode gzip`
- `project/after_push.sh`：把 Caddyfile 软链到 `/etc/caddy/0.tool_webpage.Caddyfile` 并 reload caddy

服务器上仓库放在 `/var/www/tool_webpage`，`git pull` 后执行一次 `./project/after_push.sh` 即可。

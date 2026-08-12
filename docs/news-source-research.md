# 暴雪海外炉石新闻源调研

调研日期：2026-08-11。只检查暴雪与 Battle.net 第一方页面。

## 结论

暴雪目前没有公开、受支持的“炉石新闻 API”。[Battle.net 炉石开发者文档](https://community.developer.battle.net/documentation/hearthstone/game-data-apis)公开的是卡牌、卡背、套牌和元数据能力，没有新闻资源。

可用来源是[暴雪海外炉石新闻页](https://hearthstone.blizzard.com/en-us/news)。该页面服务端直接返回新闻数据，不需要账号或 API 密钥，适合由桌面应用主进程低频读取。

## 页面数据核验

2026-08-11 实测新闻页返回 `200`、`text/html; charset=utf-8`，响应约 160 KB。页面内有两组可交叉降级的数据：

1. `application/ld+json` 中的 `CollectionPage / ItemList / NewsArticle`，包含标题、摘要、发布时间、文章地址和图片地址。
2. 页面内嵌的 `stickyBlogList` JSON，包含官网当前置顶新闻；实测可读到 [36.2 Patch Notes](https://hearthstone.blizzard.com/en-us/news/24290432/36-2-patch-notes) 等更新内容。

`stickyBlogList` 属于官网页面内部结构，不是对外承诺的 API；JSON-LD 更标准，但实测更新可能晚于置顶列表。因此实现合并两者、按发布时间去重排序，任一结构失效时保留另一条解析路径。

## 安全与稳定策略

- 生产环境只请求固定地址 `https://hearthstone.blizzard.com/en-us/news`。
- 不允许跳转；最终响应地址必须与请求地址一致。
- 只接受 HTTPS、HTML/JSON；限制 6 秒超时和 512 KB 解压后响应大小。
- 文章链接只接受 `hearthstone.blizzard.com` 与历史官方域名 `playhearthstone.com`；图片只接受暴雪官网与页面当前使用的暴雪 CDN 主机。
- 页面数据逐字段校验，丢弃危险链接、无效日期、超长文本和结构异常记录。
- 成功结果缓存 5 分钟；并发刷新合并成一次请求。
- 请求或解析失败时返回内置中文提示，不把网络异常直接抛给首页。

## 采用方案

不接入需要密钥的 Battle.net Game Data API，也不依赖第三方聚合站。资讯由 Electron 主进程获取和解析，通过受信任的只读 `tracker:get-home-news` 调用交给主窗口；页面代码不直接请求新闻源。


# 首页数据源

本文记录首页三块联网内容的拥有者、实际请求结果、字段和边界。只采用第一方页面、数据源拥有者的公开端点和数据源拥有者的开源代码。

## 炉石资讯

- 默认页面：[炉石传说国服官网新闻](https://hs.blizzard.cn/news/)
- 所有者：暴雪娱乐与中国大陆运营方网易的炉石传说国服官网。
- 2026-08-12 实测：HTTP 200，简体中文标题，页面直接包含新闻链接、发布日期和网易官方静态资源图片。
- 使用字段：文章地址、`h4` 中文标题、`data-time` 日期、`img src` 图片。
- 返回元数据：`source`、应用抓取时间 `fetchedAt`、本次有效文章数 `sample`。
- 边界：页面没有列表摘要，应用生成“查看《标题》的官方完整内容”作为说明，不伪造新闻正文。若页面结构改变，安全降级为离线提示。

补充核验：暴雪全球站的 [简中入口](https://hearthstone.blizzard.com/zh-cn/news) 在 2026-08-12 实测会跳转英文页；[繁中入口](https://hearthstone.blizzard.com/zh-tw/news) 可用，但不是简体中文，因此不再作为默认来源。

## 天梯热门卡组

- 默认端点：[Firestone 标准模式、传说分段、近 7 天卡组统计](https://static.zerotoheroes.com/api/constructed/stats/decks/standard/legend/past-7/overview-from-hourly.gz.json)
- 所有者说明：[Firestone 开源项目](https://github.com/Zero-to-Heroes/firestone)
- 端点依据：[Firestone 自己的读取实现](https://github.com/Zero-to-Heroes/firestone/blob/master/libs/constructed/common/src/lib/services/constructed-meta-decks-state-builder.service.ts)
- 2026-08-12 实测：HTTP 200，`lastUpdated=2026-08-11T22:59:04.000Z`，`dataPoints=113703`，包含 309 个卡组记录。
- 使用范围：标准/狂野模式，传说分段，近 7 天；只展示至少 800 场的卡组。
- 使用字段：卡组代码、职业、原型名、总场次、胜场、数据更新时间。
- 返回元数据：`source`、应用抓取时间 `fetchedAt`、所选卡组场次 `sample`；来源名称明确标出“传说分段·近7天”。
- 本地化：职业与常见原型词转换为简体中文；无法可靠翻译的名称显示“热门 + 职业”，不把未知英文直接放到首页。
- 边界：这是 Firestone 用户贡献的国际服样本，不代表国服；界面和来源字段必须明确这一点。该端点不是暴雪官方统计。

被替换来源：[HSGuru 卡组页](https://www.hsguru.com/decks) 在 2026-08-12 实测返回 HTTP 403（Cloudflare 验证页），不再作为应用默认抓取源。

## 竞技场英雄胜率

- 默认端点：[Firestone 竞技场当前补丁职业统计](https://static.zerotoheroes.com/api/arena/stats/classes/arena-underground/last-patch/overview.gz.json)
- 端点依据：[Firestone 自己的竞技场职业统计服务](https://github.com/Zero-to-Heroes/firestone/blob/master/libs/arena/common/src/lib/services/arena-class-stats.service.ts)
- 数据范围说明：[Firestone 功能文档](https://github.com/Zero-to-Heroes/firestone/wiki/Firestone-features)
- 2026-08-12 最后一次实测：HTTP 200，`lastUpdated=2026-08-11T23:25:41.869Z`，`dataPoints=950808`，38 条职业/英雄技能组合记录。该值会随数据源更新而增长。
- 计算方式：按职业合并英雄技能组合的 `totalGames` 和 `totalsWins`，再计算职业胜率并排序。
- 返回元数据：`source=Firestone`、应用抓取时间 `fetchedAt`、源统计更新时间 `updatedAt`、源提供的总样本 `sample`。
- 边界：这是 Firestone 用户贡献样本，不是暴雪官方全量数据；胜率只代表该来源覆盖的人群和当前补丁。

## 失效策略

- 三个来源都设超时、格式校验和本地缓存。
- 天梯或竞技场更新失败时，只允许显示明确标注的旧缓存。
- 来源不可信、字段不完整、卡组代码不可解码或图片域名不在白名单时直接丢弃，不显示伪造排行。

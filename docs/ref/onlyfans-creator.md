# 真实 OnlyFans 创作者后台（逆向笔记）

> 2026-10-14。对象是 onlyfans.com 前端 `202610091632-c45cc0ac3f` 版（2026-10-09 构建）。
> 没登录，没调用任何 API，只读了公开的静态 JS、CSS 和英文文案表。

## 0. 怎么拿到的

- onlyfans.com 页面本身拿不到：curl 被 Cloudflare 验证页挡住（403），内置浏览器也不让打开。没有尝试绕过。
- 首页 HTML 用的是 Wayback Machine 2026-10-12 的存档，从里面拿到了静态资源地址。
- `static2.onlyfans.com` 上的 JS/CSS 不用登录就能下载。首屏 62 个文件，再从 webpack 运行时里的分块表递归补全懒加载分块，共 954 个 JS、180 个 CSS（约 30 MB）。
- 界面文案：`texts.onlyfans.com/texts_en.json`，5,722 条。
- 前端是 Vue 2.7 + Vuetify + vue-router，模板编译成了 render 函数。我写了个转换器（`vendor/onlyfans/tools/render.mjs`，用 acorn 解析），把 2,706 个 render 函数还原成伪 HTML，`$t()` 直接换成英文原文。
- REA：MCP 服务器这次没连上，改跑它的 CLI（`rea-agents@6.4.0 analyze-javascript-application`），653 个文件全部解析成功，共 5,839 个模块，路由清单和下文 §2 一致（evidence `ev_330366ce9c24ab85cd99f78317998781d0d229b77aaee5bdb1444792ef8343f0`）。REA 对 Vue 模板没有专门的分析，所以页面结构是靠上面那个转换器还原的。

**可信度**：菜单项、路由、模板结构、文案、颜色都是直接从代码里读出来的。"什么条件下显示"（比如只给创作者看）和字段含义是从变量名推出来的。真实数据长什么样、像素级效果，都要登录才看得到，这次没有。

## 1. 整体布局

- **桌面**：左侧竖导航（`.l-header__menu`，最宽 248px，左右各 16px 内边距），中间内容区（`.l-container` 最宽 999px），收入/统计页再加一个右侧栏（`.l-wrapper__sidebar` 最宽 368px，sticky 吸顶）。
- **手机**：同一个 `<header>` 变成底部固定栏：高 56px，顶边 1px `rgba(138,150,163,.25)`，图标 32px，不显示文字。内容区底部留出 57px + safe-area。
- **头像**：点开后是一个抽屉菜单（`.l-sidebar`），手机上大部分页面要从这里进。
- 有右侧栏的页面用 `<portal to="statistics-right-sidebar">` 把侧栏内容投到右边；手机上同一块内容直接排在页面里。

### 1.1 主导航（创作者账号，桌面）

| # | 文字 | 去哪 | 图标 | 角标 |
|---|---|---|---|---|
| 1 | Home | `/` | icon-home | 新帖数（最多显示 99） |
| 2 | Notifications | `/my/notifications` | icon-notifications | 未读通知（99） |
| 3 | Messages | `/my/chats` | icon-messages | 未读消息（999） |
| 4 | Collections | `/my/collections` | icon-collections-lg | |
| 5 | Vault | `/my/vault` | icon-vault-lg | |
| 6 | Queue | `/my/queue` | icon-calendar-datepicker-lg | |
| 7 | Statements | `/my/statements` | icon-statements-temp-lg | |
| 8 | Statistics | `/my/statistics` | icon-statements-lg | |
| 9 | My profile | `/<username>` | icon-menu | |
| 10 | More | 打开抽屉 | | |
| 11 | **+ New post** | `/posts/create` | icon-add | 有草稿时右上角一个小点 |

- 第 4–9 项只在桌面显示，第 5–8 项只给创作者。粉丝账号会多出 Subscriptions、Add card。
- 手机底栏：Home、Notifications、Messages、发帖（icon-compose）、头像。
- 当前项（`.m-current`）文字变成正文色，其余是灰色；悬停变蓝 `#0091ea`。New post 是一个全圆角的蓝色按钮。

### 1.2 头像抽屉

1. 头像（50px）、名字、@用户名；下面一行是 Fans 数和 Following 数。
2. My profile · Referrals · Discover · Collections · Queue · Vault · Settings · Streaming · Statements · Statistics · Promotions · Release forms
3. Your cards（灰字 "to subscribe"）· Bank（灰字 "to earn"）
4. Help and support · 深色/浅色模式切换 · 语言
5. Log out

## 2. 路由（创作者相关）

完整的 315 条在 `vendor/onlyfans/routes.txt`（路径、路由名、对应的分块文件）。和本项目有关的：

```
/my/chats                      收件箱
  chat/:chatId                 对话
  chat/:chatId/gallery/:filter 对话里的媒体
  chat/:chatId/pinned          置顶消息
  send                         New Message（群发）
/my/statistics
  statements/earnings          收入流水（Tips 可再分 all|profile|post|chat|stream|story）
  statements/payout-request    提现记录
  statements/disputes          退单（Chargebacks）
  statements/referrals/…       推荐
  overview/earnings|streaks|summary|top-highlights
  engagement/posts|messages|streaming|stories
  reach/profile-visitors|promotions|trial-links|tracking-links
  fans/subscriptions|top-fans|activity
/my/statements/earnings|payouts|vat|referrals   旧版收入页，导航里的 Statements 还指向这里
/my/collections/user-lists/:list   粉丝管理（列表）
  subscribers/:type(active|expired|activity)
  subscribers/top/:year?/:month?
  restricted · blocked · promotions · purchased
/my/vault  ·  /my/vault/list/:list  ·  /my/vault/media/:mediaId
/my/queue/:date?  ·  /saved-for-later-posts  ·  /saved-for-later-messages
/my/notifications/:type
/posts/create
/my/settings/subscription      订阅价、套餐、促销
```

## 3. 私信（Messages）

### 3.1 收件箱（桌面左栏，宽 395px）

- **顶栏**：标题 Messages；右边几个图标按钮：Queue、Message statistics、Search、New Message。
- **群发进度条**：最近一次群发显示 "Message sent to {COUNT} people"、时间、状态，和一个带倒计时的 Unsend 按钮。
- **快捷筛选胶囊**：只有满足条件才出现：`who_tipped`（开了打赏）、`priority`、`pinned`、`unread`；后面接自己建的用户列表。
- **筛选/排序下拉**（标题会随排序变成 "Recent" 等）：
  - Filter：All · Priority · Unread · Unread with tips
  - Order：Newest First · Oldest First
  - Mark all as read
  - Select（进入多选，可以批量删除）
- **每一行**（最低 80px）：头像 50px；名字、认证标、徽章、@username；最后一条消息（前面带媒体图标，自己发的显示成灰色，有草稿时显示 `[draft]`，对方在打字时显示 "is typing..."）；右边是时间；未读是一个 10px 的蓝点 `#00aff0`。手机上左滑标记已读。
- **没选中对话时**：显示 "Select any Conversation or send a New Message" 和一个 New message 按钮。

### 3.2 对话

- **顶栏**：返回、对方名字、副标题（在线状态）、对话内搜索（"Find in chat"，结果 1/3，可以上下跳）、视频通话、⋯ 菜单。
- **消息列表**：按日期分组，日期是居中的时间线标签；最上面是 "Conversation started"；有一条新消息分隔线；"{NAME} is typing..."；右下角有回到底部按钮，有新消息时会提示。
- **气泡**：对方的底色 `rgba(138,150,163,.12)`，自己的 `rgba(0,175,240,.12)` 并靠右，行高 24px。打赏消息单独一种样式（打赏文字 + 附言）。
- **气泡下面的一行**：时间 · 喜欢 · 置顶 · 收藏 · 付费状态（`{PRICE} paid` / `{PRICE} not paid yet`）· 创作者专用的 "Add a tag"（给出镜的人打标签）。
- 付费消息在对方付钱之前只显示 `lockedText`。

### 3.3 输入框（和发帖共用同一个 MakePost 组件）

- **工具栏**（按顺序，放不下的收进 ⋯）：Add media · Tip（仅当对方开了打赏）· Add GIF · Record video · Record voice · Add media from vault · Expiration period · Scheduled messages · Your target（众筹）· Message price。
- **PPV 的关键交互**：设了价格之后，输入区上方出现两个标签：
  - 左边 "Free preview"（约占 37.5%）；
  - 右边 "Price to view $X"（浅蓝底 `rgba(0,175,240,.12)`，点击改价，× 取消价格）。
  - 媒体也分成"免费"和"付费"两块，可以在两块之间移动；文字也可以设成锁定。
- 定时发送用日期时间选择器，里面另有一个 "Save for Later"。
- 发送按钮是全圆角的蓝色按钮。
- 提醒：漏了附件时提示 "Don't forget your media attachments!"；对方已经买过同一个素材时会报错提示。

### 3.4 New Message（群发）

1. **选收件人**：搜索框；"列表 / 用户"两个标签；列表是一列勾选框（Fans、Following、Recent（可以按 "Subscribed on" 选日期）、自己建的列表……）；用户是一列"头像 50px + 名字 + 勾选框"；顶上有已选人数；手机上点 Next 进入下一步。
2. **写消息**：同一个 MakePost 输入框，标题是 "New Message"（编辑定时消息时是 "Edit message"）。
3. 发出后回到收件箱，顶部显示进度和 Unsend。
4. 效果在 Statistics → Engagement → Messages 里看：Views、Purchases、Show who bought、Top Message。

## 4. 收入

真实 OF 里收入有两处：导航里的 **Statements**（`/my/statements`，旧版，有流水、提现、VAT、推荐四个子页）和 **Statistics**（`/my/statistics`，新版，一打开就是 Statements → Earnings）。下面写的是新版。

### 4.1 Statistics 外框

- 顶部大标签：**Statements · Overview · Engagement · Reach · Fans**；右上角一个 Support 图标。
- 每个子页顶部都有时间段下拉：上面一行是时间段名称，下面一行是灰色日期范围，可以自定义日期。

### 4.2 Statements → Earnings

- 胶囊标签：**Earnings · Payout Requests · Chargebacks**，有条件时还有 Referrals、VAT documents。
- Earnings 下面再一排胶囊：**All · Subscriptions · Tips · Posts · Messages · Streams**（开了视频通话的还有 Private calls）。选 Tips 时再出一排：all / profile / post / chat / stream / story。
- 汇总：净收入大字 + 毛收入 + 环比百分比（涨显示绿色向上箭头，跌显示红色向下箭头）。
- 双线图（金额和笔数）。
- 流水表：**Date**（"Oct 12, 2026," + "09:41 pm"）· **Amount** · **Fee** · **Net**（加粗）· 描述 · 状态。没有数据时显示 "No data during selected period"。

**右侧栏**：
1. "YOU ARE IN THE TOP {PERCENT}% OF ALL CREATORS!" 徽章。
2. 退单率提示（"Chargeback ratio {VALUE}%"）。
3. 余额块：**Current balance** / **Pending balance**（带说明图标），金额 22px 中粗。下面是提现周期下拉，附一行灰字："Next payout scheduled on: {DATE}" 或 "Minimum withdrawal amount is {AMOUNT}"。再下面是 **Request withdrawal** 按钮。
4. Earnings 小卡（两列网格），每张卡：分类名（灰色 14px）、金额（16px 中粗）、环比（选"全部时间"时不显示）、一条迷你折线。点击跳到对应分类。

**分类颜色**（直接拿来做图表配色）：

| 分类 | 颜色 |
|---|---|
| Total | `#8A96A3` |
| Subscriptions | `#7CB342` |
| Tips | `#9575CD` |
| Messages | `#00AFF0` |
| Posts | `#FFA000` |
| Streams | `#EC407A` |
| Private calls | `#4062EC` |

### 4.3 流水描述文案（可以直接当 ledger 的描述模板）

```
Subscription from {NAME}
Recurring subscription from {NAME}
Tip from {NAME}
Payment for message from {NAME}
Stream purchase by {NAME}
… from deleted user          （对方注销后）
```

### 4.4 Overview

- 胶囊：**Earnings · Streaks · Summary · Top highlights**。
- Earnings：一行一个月（月份 + 当月净收入），点开后是多线图，加一张 Earnings | Gross | Net 表，每个分类一行，用单选切换图上显示哪个分类。
- Top highlights：Top post、Top mass message、Top stream、Top fan。

### 4.5 Fans（统计）

- 胶囊：**Subscriptions · Top fans · Fans activity**。
- Subscriptions：汇总 + 双线图 + 表格（Name · Price · 订阅时长 / 续订），过期的人整行变灰，免费订阅显示 "free"。
- Top fans：Name · 当前分类金额 · Total。
- 右侧栏：汇总块 + "Top Fan" 卡片（可以切时间段，没有时显示 "No Fans yet"）。
- 右上 ⋯ 菜单：Add to list（把表里的人加进列表）。

## 5. 粉丝管理

### 5.1 Collections（`/my/collections`）

- 两栏：左边是列表目录（`.l-sidebar-column`），右边是选中列表的成员。顶部标签是 User lists / Bookmarks / Post labels，带搜索。
- 列表顶栏的按钮：**Send message**（给整个列表群发）、**Add**（加人）、Block user、⋯（重命名、删除、Customize order）。
- 系统列表名：Fans、Following、Favorites、Friends、Renew On、Rebill Off、Restricted、Blocked；另外可以自己建。

### 5.2 Fans 页

- 标签：**All · Active · Expired · Restricted · Blocked · Promotions · Fan Stats**，每个后面跟人数。
- 工具：搜索、Filter、Sort（先选字段，再选升序或降序）。
- 有推荐人参数时，顶上多一条 "Referred by @xxx"。

### 5.3 粉丝卡片（`SubscribersItem`，创作者视角）

- 头部：头像 50px、显示名（被限制的人名字加 `m-muted` 样式）、认证标、自定义昵称（可以编辑）、@username、置顶按钮、⋯ 菜单。
- **备注**（`notice`）：一段可以折叠的文字。
- 操作胶囊：Message · 订阅按钮 · Discount（给个人折扣）· Restrict/Unrestrict · 备注。
- 三个标签，每个标签下面是一列"左边标签、右边数值"的行（行之间有分隔线）：
  - **Subscription**：Current subscription · Previous subscription · New price · Started · Total duration · Renews / Expires / Expired · Rebill · Reason · Referred subscribers · Last Activity
  - **Earnings**：Subscriptions · Posts · Messages · Streams · Tips · Total
  - **Offers**：Free trial 或 "{PERCENT}% subscription discount" · Sent · Offer duration · Expires · Claimed/Unclaimed，带 Cancel / Edit 按钮
- 消费曲线（`SubscriberHistoryChart`）：按月的历史图，可以横向拖动。
- 底部 "View more / Collapse"。
- 已过期或被拉黑的卡片整张换一种底色（`m-bg-colored`）。

## 6. 设计变量

| | 浅色（`:root`） | 深色（`:root.m-mode-dark`） |
|---|---|---|
| 背景 `--bg-color` | `#fff` | `#161618` |
| 正文 `--text-color` | `#242529` | `#f6f7f8` |
| 导航栏背景 `--bg-color-header` | `#fff` | `#18181a` |
| 标题 `--title-color` | `#242529` | `#fefefe` |
| 浅底 `--marked-color` | `#f6f7f8` | `#242529` |
| 遮罩 `--overlay-color` | `rgba(0,0,0,.5)` | `rgba(0,0,0,.6)` |

- 品牌蓝 `#00aff0`（按钮底色），链接和悬停 `#0091ea`，灰字 `#8a96a3`，分隔线 `rgba(138,150,163,.25)`，危险 `#ff6060`。
- 字体：Roboto，`16px/1.3334`。
- 按钮 `.g-btn`：14px/20px，内边距 8px 18px，全大写，最小宽 78px；`.m-rounded` 是全圆角。
- 卡片圆角 6px。

## 7. 对本项目的参考价值（只是建议，没改 plan.md）

- **信息架构**：`plan.md` §8.1 的页面表基本能对上。真实 OF 把收入拆成"流水、余额、提现"（Statements）和"图表、粉丝、互动"（Statistics）两块，Fanzly 则是一个仪表盘。可以考虑 Statements 页照 OF 做成"左边流水表、右边余额卡加分类小卡"，Statistics 照 OF 的 5 个标签做个简版。
- **PPV 私信**：OF 的"Free preview / Price to view"双栏输入框，是最值得照抄的交互。三栏收件箱和右侧粉丝档案可以继续照 Fastt。
- **收件箱筛选**：OF 自带的只有 All / Priority / Unread / Unread with tips，加上动态胶囊。Fastt 的"欠回复"那类是经纪公司自己加的。
- **熟客数据结构**：粉丝卡片的字段可以直接用：按渠道的消费分项（Subscriptions / Posts / Messages / Streams / Tips / Total）、备注、自定义昵称、Rebill 开/关、Started / Renews / Expires、Last Activity、个人折扣。
- **流水描述**直接用 §4.3 的文案模板；**图表配色**直接用 §4.2 的分类颜色。
- **外观**：2026-10-14 定了用 Fanzly 新版的黑紫（`plan.md` §8.3），不用 OF 的白蓝。真实 OF 只参考信息架构和交互；§6 的色值留作参考。

## 8. 没弄清的

- 通知页的分类标签只拿到一部分（Comments、Mentions、Subscriptions、Tags）。
- Fans 页 Filter 弹窗里具体有哪些筛选项，没有展开看。
- 用户 ⋯ 菜单的完整内容没有逐项列。
- 真实数据和截图：要登录才看得到，这次没有。

## 9. 文件

都在 `vendor/onlyfans/`（按 plan，`vendor/` 不进仓库）：

- `templates/*.txt`：每个 JS 分块还原出的伪 HTML，文件名就是分块名，可以对照 `routes.txt` 找到页面。
- `routes.txt`：路由 → 路由名 → 模块 id → 分块文件。
- `texts_en.json`：全部英文文案。
- `all.css`：首屏和懒加载的 CSS 合在一起（scoped 样式带 `[data-v-…]` 后缀）。
- `chunkmap.json`：webpack 分块 id → 文件名。
- `tools/`：下载和转换脚本。重新生成：用 `chunks.py` 列出分块，下载 `https://static2.onlyfans.com/static/prod/f/<版本>/<文件>`，再对每个分块跑 `node tools/render.mjs texts_en.json <chunk.js>`（先在 `tools/` 里 `npm install acorn acorn-walk`）。

# OnlyTavern 规划

> SillyTavern 里独立的 OF 式博主经营模拟插件。每次开始新一步前先读本文件，完成后更新最后的「进度」。
> 2026-10-11 起草，构思来自在 EchoText 会话里的讨论。

## 1. 构思

- 你是一个 OF 式付费平台上的博主。**博主账号是独立的东西，和任何聊天都无关，类比 SillyTavern 的群聊**：你可以建多个账号，每个账号自己拉成员。
- 成员里的角色卡（2026-10-14 加）可以指定成两种身份之一：
  - **协助创作者**：和你一起经营账号（联合博主），可以替你发帖。不拉就是单人博主。
  - **订阅者**：一个有名有姓的粉丝，用这张卡的人设和你私信、评论、打赏、下定制单。
- 赚钱渠道：订阅费、发帖（免费 / 锁定）、私信卖付费内容（PPV）、打赏、定制单。
- 其余粉丝只是背景噪音：由代码和本地预设生成、计算，不用角色卡。只有少数和你真正有来往的粉丝（熟客）才由模型开口说话。
- 素材全部是文字描述，不生图。
- 和主 RP 互通是可选的桥，不是前提：主 RP 里产生的内容可以存进某个账号的素材库；某个账号的情况（收入、熟客、定制单）可以以一小段摘要注入某个聊天，成为剧情钩子（§6）。
- 和 EchoText 完全独立：不共用代码、不互相调用。需要的东西从 EchoText 复制过来。
- 独立界面（全屏面板）、独立提示词，只和 SillyTavern 共用 API 连接（连接配置）。

## 2. 设计原则

1. **代码算数字，模型只写字。** 订阅、流失、打赏、PPV 购买、收入、平台抽成、通知、收入明细全部由脚本按规则计算。模型只做三类事：粉丝互动（熟客私信、定制请求、少量精选评论）、帖子文案、小规模语义搜索。目的是省钱，也避免长上下文让模型变笨。
2. **模型每次调用只干一件小事。** 输入短，输出结构化（JSON 或固定标签），解析宽容，失败有退路：解析不了就用本地语料或跳过，流程不卡住。
3. **熟客的"决定"由引擎做，模型只负责表演。** 买不买、给多少、要不要定制，引擎先算好再告诉模型，模型把它说出来。
4. **群众用统计量表示，不逐个存。** 只有和你有过真实互动的粉丝才"升级"成熟客，拥有一条正式记录。
5. **可重放。** 模拟用带种子的随机数，同样的状态加同样的种子得到同样的结果。方便测试，以后也能做"重来一次"。
6. **先做纯前端，给后端留口。** 原版 SillyTavern 支持后端插件，但 TauriTavern（iPhone 上用）的 README 写明不支持。所以先做完整的纯前端版本："像游戏逻辑一样的后端"做成浏览器里的纯 JS 模块（`engine/`），不碰界面也不碰 SillyTavern，可以直接用 Node 测试，逻辑上就是后端。真正的服务器插件以后可选，接口从第一天就按能换后端来设计（§9.1）。
7. **能抄就抄，自己写的越少越好。** 怎么抄见 `docs/copy-plan.md`：React + Tailwind v4 + TypeScript，Fanvue 组件直接从 npm 装，Fastt 的组件原样复制，应用跑在 iframe 里。
8. **防屎山。** EchoText 的教训是 8,470 行的 `index.js`、1.24 万行的 `style.css`、135 处按类名改页面。所以这次要求：分层清楚；组件只调 hook，hook 只调 `api`；引擎和数据层不碰 DOM；每层都有测试。

## 3. 成员与权限

一个账号就像一个群聊：你建账号，然后把角色卡拉进来，并给每张卡指定身份。

| | 你（persona，你自己打字） | 协助创作者（角色卡，模型扮演） | 订阅者（角色卡，模型扮演） |
|---|---|---|---|
| 发帖 | ✓ | ✓ 可以替你发（从素材库选素材、写文案） | ✗ |
| 私信粉丝、回复评论 | ✓ | ✗ | 和你私信、在帖子下评论 |
| 定价、发 PPV、群发 | ✓ | ✗ | 收到群发和 PPV，买不买由引擎定 |
| 接 / 拒定制单 | ✓ | ✗ | 下定制单 |
| 改主页资料、订阅价 | ✓ | ✗ | ✗ |

- 对粉丝来说账号是同一个发送者；内部每条消息、每个帖子都记作者（你，或哪位协助创作者）。
- 成员是数据：`members = [{ id, 来源: persona | 角色卡, 身份: owner | co-creator | subscriber, 权限 }]`。单人、双人、带几个角色卡粉丝，只是成员不同。
- 同一张角色卡可以在多个账号里，就像可以在多个群聊里；在同一个账号里只有一个身份。
- 角色卡订阅者照样遵守原则 3：买不买、给多少由引擎算，模型只负责用这张卡的人设说出来。拉进来时给它选一个粉丝类型和消费水平（§4.2 的类型），引擎按这个算。
- 两套提示词（单人 / 双人）可以切换：同一个模板按成员生成，模式只覆盖其中几段。

## 4. 模拟（脚本）

### 4.1 时钟

- 最小单位是"天"。帖子热度主要集中在头一两天，订阅按月续费，精确到小时没有意义。
- 引擎是纯函数 `simulate(state, fromDay, toDay, seed) → { events, delta }`，不关心时间是怎么推进的。
- 时钟来源待定（§11）。先做手动"过一天"按钮；以后可以接主 RP 的故事日期、真实时间，或者发帖时自动推进。

### 4.2 群众

- 按类型分群，每群只存人数和参数。
  - 初版类型：潜水党、普通订阅者、舔狗、大款、黑粉、白嫖 / 试用党。
  - 参数：续订概率、打赏概率和金额分布、PPV 购买率、价格敏感度、兴趣标签权重、评论倾向。
- 参数放在 `data/presets/` 的 JSON 里，可以调。
- 新订阅来自帖子曝光、促销和群发；流失按每月的续订概率算。

### 4.3 内容和收益

- 素材：文字描述 + 标签（从预设标签表里选）+ 尺度等级（1–5）+ 出镜的人（你 / 协助创作者 / 一起）+ 来源（手写 / 主 RP 的某条消息）。
- 帖子表现 = 观众兴趣 × 标签匹配 × 尺度 × 新鲜度（同类标签反复用会衰减）× 价格 × 账号类型 × 距上一帖的间隔。
- 收入渠道：订阅费（含套餐、促销）、帖子（免费 / 锁定）、私信 PPV、打赏、定制单。商店待定（§11）。
- 账号类型规则（GPT 说的，未核实，做成可开关的规则）：免费主页可以在动态里发锁定帖；付费订阅主页主要靠私信卖额外内容。
- 平台抽成 20%，记进收入明细；提现只是数字。

### 4.4 熟客

- 升级条件由引擎判定：你回了某个群众粉丝的私信、他下了定制单、打赏超过阈值等。
- 熟客档案用本地预设拼出来，不调用模型：名字池、国家、年龄段、类型、兴趣标签、一句话背景模板。
- 简短记忆由代码维护：累计消费、买过什么、上次聊到哪。"上次聊到哪"可选让模型在私信结束时写一句。
- 上限 5–10 个（可设置）；超出的变成"沉寂"，或者退回群众。
- 角色卡订阅者（§3）一进来就是熟客，不用升级，也不占这个上限；档案就是角色卡，记忆和累计消费照常由代码维护。

### 4.5 评论和通知

- 群众评论来自本地语料库（类型 × 情绪 × 标签）。每个帖子只存一个种子，打开时按种子现场生成，每次都一样。
- 熟客评论：少量由模型写，可关。
- 通知（新订阅、打赏、购买、里程碑、定制单）全部由引擎事件生成，用模板出文字。

### 4.6 事件

引擎输出事件列表，每个事件标明它属于哪一类：

- 只更新数字（大多数事件）；
- 需要模型写字（熟客私信、定制请求、精选评论）；
- 值得告诉主 RP（大额打赏、定制单、黑粉风波、里程碑）。

## 5. 模型调用（只有这些）

| 任务 | 什么时候 | 输入 | 输出 | 失败时 |
|---|---|---|---|---|
| 熟客私信回复 | 你发私信后 | 熟客档案（角色卡订阅者用角色卡摘要）+ 记忆 + 最近 N 条 + 账号一句话现状 + 引擎给的决定 | 消息 | 显示失败，可重试 |
| 熟客主动私信 | 引擎事件 | 同上，加引擎给的意图（想买 / 想定制 / 闲聊） | 消息 | 用语料库的开场白 |
| 定制请求 | 引擎事件 | 熟客档案 + 引擎定好的预算和兴趣 | 请求文字 | 模板句 |
| 协助创作者写帖子文案 | 协助创作者发帖时 | 协助创作者人设（角色卡摘要）+ 素材描述 | 文案 | 你自己写 |
| 精选评论 | 发帖后（可关） | 帖子文案 + 2–3 个熟客档案 | JSON 列表 | 只用语料库 |
| 语义搜索 | 搜素材库、给定制单找素材 | 代码先按标签筛出最多 20 条，模型只排序 | id 列表 | 只用标签筛选的结果 |
| 素材打标签（可选） | 存素材时 | 素材描述 + 标签表 | JSON | 你手动选 |

- 主 RP 的现状摘要不用模型，由代码按模板拼。
- 只走连接配置（在设置里选一个），调用方式照 EchoText 的 `connection_utils.js`（`ConnectionManagerRequestService.sendRequest`）。EchoText 的教训是：默认连接方式会丢掉额外的 system 消息。
- 新增模型任务之前，先问一句：这件事代码能不能算？

## 6. 和主 RP 互通

账号和聊天无关，所以互通是可选的桥：一个聊天可以关联一个账号（聊天元数据里只存一个账号 id，可以不设），不关联就完全不互通。

- **RP → 平台**
  - 手动（先做）：主聊天每条消息上加一个"存进素材库"按钮，选中的文字变成素材（存进关联的账号；没关联就让你选），你再补标签和尺度。
  - 自动（以后再说，默认关）：主 RP 每轮结束后额外调用一次，判断有没有产生能上传的内容（rpg-companion 的 Separate Generation 那种）。每轮都要花钱。
  - 不让主 RP 的模型自己写上传标签，免得污染主 RP 的提示词。
- **平台 → RP**：用 SillyTavern 的扩展提示词注入（`setExtensionPrompt`）一小段现状摘要：订阅数、本周收入、待处理的定制单、一两件大事。由代码按模板生成，有长度上限，可关，插入深度可设。
- **定制单是主要的剧情钩子**：粉丝出价 → 摘要进主 RP → 角色们在剧情里决定接不接、怎么拍 → 用"存进素材库"入库 → 回到平台交付、收钱。

## 7. 数据与存储

### 7.1 数据结构

```
account
├─ meta       schemaVersion、id、种子、创建时间
├─ profile    平台名、名字、头像、封面、简介、账号类型（免费/付费）、订阅价、套餐、促销
├─ members    你 / 协助创作者 / 角色卡订阅者：来源（persona / 角色卡）、身份、权限；订阅者另记粉丝类型和消费水平
├─ clock      当前游戏日
├─ vault      素材：描述、标签、尺度、出镜的人、来源
├─ posts      引用素材、文案、作者、定价、发布日、表现数据、评论种子
├─ queue      定时帖
├─ audience   群众：各类型人数和参数
├─ regulars   熟客：档案、记忆、累计消费
├─ threads    和熟客的私信
├─ requests   定制单：熟客、内容、出价、状态、交付的素材
├─ ledger     每笔收入和抽成
├─ events     通知 / 事件记录（只保留最近 N 天）
└─ settings   本账号的设置（提示词模式、互通开关等）
```

### 7.2 存放

- 账号不跟聊天走，像群聊一样单独存：一个账号一份数据，另有一个账号列表。群众不逐个存，单个账号数据量小。
- **已定（2026-10-14）**：每个账号一个文件 `onlytavern-<id>.json`，走 SillyTavern 的用户文件接口（`/api/files/upload`、`/api/files/delete`，读取走 `/user/files/`），存在 `data/default-user/user/files/`。TauriTavern 实现了同一套接口（见它的 `src/tauri/main/routes/resource-routes.js`）。账号列表和当前账号放在扩展设置 `extensionSettings.onlytavern.index`。存储包在 `store/storage.ts` 的接口后面（`bridge/storage.ts` 里有 SillyTavern 和 localStorage 两种实现），以后能换。
- 导出走 SillyTavern 自带的 `download()`（由 `index.js` 通过 `window.OnlyTavernHost` 提供给 iframe），TauriTavern 把它换成了原生保存，所以 iPhone 上也能导出。
- 聊天元数据里最多只存一个关联的账号 id（§6）。分支 / 另存聊天把它复制过去也没关系，两条聊天关联同一个账号是正常的。
- **导入 / 导出**：一个带 `schemaVersion` 的 JSON 文件。导入时生成新 id（"复刻"），也用来在 Mac 和 iPhone 之间搬存档。
- 数据结构改版时写迁移函数，老存档自动升级。
- 全局设置（连接配置、语料语言、界面偏好）放在扩展设置里，和账号分开。
- 用到的每个 SillyTavern 接口都先在 TauriTavern 上验证一遍。

## 8. 界面

### 8.1 页面（博主侧）

| 页面 | 内容 | 第一版 |
|---|---|---|
| Home | 自己的动态流，每帖带表现数据 | ✓ |
| New Post | 选素材、写文案、免费 / 锁定、价格、立即发 / 定时 | ✓ |
| Messages | 熟客收件箱、私信、从素材库发 PPV、按群群发 | ✓ |
| Vault | 素材库：列表、搜索、标签筛选 | ✓ |
| Notifications | 引擎事件 | ✓ |
| Statements | 收入明细、抽成、提现 | ✓ |
| Statistics | 订阅数、收入趋势、各类型构成 | 简版 |
| Fans / Lists | 各类型群、熟客列表（角色卡订阅者带标记） | 简版 |
| Requests | 定制单 | 第 5 步 |
| Queue | 定时帖 | 以后 |
| My Profile | 封面、头像、简介、订阅价、套餐 | ✓ |
| Accounts | 账号列表：新建、切换、删除、导入导出（类似群聊列表） | ✓ |
| Settings | 成员（拉角色卡、指定身份）、提示词模式、时钟、互通、连接配置 | ✓ |
| Shop | 实物商品（OF 没有，需要自创） | 待定 |

### 8.2 布局

- 一套代码，两种布局：
  - 手机：单栏 + 底部导航。
  - 桌面：左侧导航 + 内容；Messages 页另加右侧粉丝档案栏（照 Fastt）。
- 应用跑在全屏 iframe 里，盖在 SillyTavern 上面，入口放在扩展菜单里（原因见 `docs/copy-plan.md` §1）。iframe 装在一个模态 `<dialog>`（`showModal()`）里，不能用 `position: fixed`：SillyTavern 给 `<html>` 加了 transform，fixed 元素会跟着页面滚动、盖不全屏（第 0 步踩到的）。
- 锁定内容卡：因为没有图片，用按素材 id 生成的渐变色块，加锁、素材数量和价格；解锁后显示文字描述。

### 8.3 外观

- **外观目标是 Fanzly**（Appscrip 卖的商业版"OF 仿站"，[appscrip.com/onlyfans-clone](https://appscrip.com/onlyfans-clone/)，没有源码，只有截图）。之前 GPT 说的 "Fanzey" 就是它。截图有两版：
  - 旧版（`docs/ref/` 下的三张）：深紫黑底，品牌色是紫红到粉的渐变。**只参考布局，不用它的颜色。**
  - **新版（2026-10-14 从销售页存的 16 张，在 `docs/ref/fanzly-2026/`）：配色用这一版**（2026-10-14 定）。下面的色值是从截图像素取的：
    - 页面底 `#0a0a0a`（中性纯黑，没有紫调）；侧栏和内容之间 1px 分隔线 `#171717`。
    - 卡片和折叠行 `#181818`，展开的内层面板 `#121212`，卡片描边 `#222222`–`#262626`。
    - 品牌色是蓝紫渐变，左到右 `#9554f4 → #aa32f6`（钱包卡 `#8c5af1 → #9432ea`），实心按钮和悬浮 + 号 `#9235fa`–`#9e42fc`。基本没有粉色。
    - 次要文字灰 `#7a7978`；未读红点 `#ed3934`；VIP 标签是绿色。
  - 新版截图里有：Messages（All Chats / Bulk Message 两个标签，All / VIP / Viral 筛选胶囊，Newest 排序；聊天里锁定媒体上的白色胶囊 "Unlock for $3"，"Tip Requested" 卡片 + Send Tip 按钮）、My Wallet（Available / Pending / Withdrawal History，渐变余额卡 + Recharge / Withdraw，交易列表带 All / Credit / Debit 筛选）、Vault、CRM 自动回复、帖子数据、定时发帖。桌面导航：Home、Reels、Live、Creators、Posts、Messages、Notifications、Video Call Schedule、My Orders、My Wallet、Virtual Requests、Dashboard、My Profile、More，底部渐变 Create 按钮；手机底栏中间是悬浮的紫色 + 号。
  - 以下是旧版截图里看到的布局，仍然有效：
  - 按钮两种：渐变实心（Subscribe、Create、Custom Request）和渐变描边（Following、当前导航项）。标签页和筛选是胶囊形（Earnings / General Stats、All Posts / Photos / Videos）。
  - 桌面：左侧导航（Home、Live、Explore、Messages、Notification、Video Call Schedule、My Orders、My Vault、My Profile、More，底部渐变 Create 按钮）+ 中间内容 + 右侧推荐栏。
  - 手机：单栏，主页是封面、头像、数据行、简介、一列大按钮、精选圆圈、图标标签行、筛选胶囊。
  - 锁定内容卡：渐变遮罩 + 锁 + 白色胶囊 "Unlock for 10 Coins"（颜色换成新版的蓝紫）。
  - 博主后台：8 个渐变收入卡（Premium Posts、VIP Messages、Tips、Subscriptions、Locked Messages、Video Calls、Live Stream Tickets、Custom Requests）+ 面积图 Sales Insights；手机版 4×2 小卡 + Sales Breakdown + Sales Overview（本月 / 上月 / 总计）。
  - 弹窗：Custom Request（给谁、日期、主题）、Create Post（Teaser / Subscribers / Exclusive 三种帖子）。
- **代码底子**是 `@fanvue/ui`（从 npm 装）和它的设计变量（浅色、深色两套），只把品牌色和深色底色变量换成新版 Fanzly 的黑紫（色值见上）。Fanzly 只有深色截图，浅色版沿用 Fanvue 的浅色变量，品牌色同样换成蓝紫。
- Messages 页：会话列表和聊天气泡的样子照新版 Fanzly 截图；右侧的粉丝档案栏（新版 Fanzly 里没有）照 Fastt 的 `app/` 复制。信息架构（有哪些菜单、每页有什么）照真实 OF（`docs/ref/onlyfans-creator.md`）和 Fanzly。

## 9. 代码结构

```
manifest.json     SillyTavern 扩展清单（js 指向 index.js）
index.js          SillyTavern 侧，纯 JS、不打包：入口按钮、iframe、"存进素材库"按钮、摘要注入
app/              React 应用（Vite + TS + Tailwind v4），在 iframe 里跑
  src/ui/         页面和组件：大部分从 Fastt 复制，Fanvue 组件直接 import
  src/hooks/      TanStack Query hook（照 Fastt，数据源换成 api）
  src/api/        界面唯一的入口：local.ts；以后加 server.ts
  src/engine/     不碰 DOM 和 SillyTavern：rng、audience、content、economy、regulars、simulate、events
  src/store/      账号结构、迁移、存储接口（账号文件 / 扩展设置；聊天元数据只存关联的账号 id）、导入导出
  src/llm/        每个模型任务一个文件：提示词模板 + zod 结构 + 退路；连接配置调用（抄 EchoText）
  src/bridge/     通过 window.parent 访问 SillyTavern
  src/presets/    DeepSeek 生成的预设（JSON）
dist/             构建产物，提交进仓库（TauriTavern 不会帮你构建）
vendor/           抄袭来源的浅克隆，不进仓库
docs/             plan.md（本文件）、copy-plan.md、ref/（Fanzly 截图）、prompts/（生成预设用的提示词）
server-plugin/    以后可选：SillyTavern 后端插件（装法是复制或链接到 SillyTavern 的 plugins/）
```

- 引擎和外界只有一种交流方式：状态进去，事件和变化出来。
- 测试用 vitest：引擎和数据层是单元测试，界面用 Testing Library（配置照 Fastt）。不开 SillyTavern 时，用一个假的 `parent` 打开应用页面开发。
- 浏览器缓存：Vite 的产物文件名自带哈希；iframe 的地址再加一个版本参数。

### 9.1 给后端留口

```
ui/ ──调用──▶ api（全部 async，参数和返回值都是纯 JSON）
               ├─ local：engine/ + store/ 在浏览器里跑（默认；TauriTavern 只有这个）
               └─ server：fetch('/api/plugins/onlytavern/…')（以后，可选）
llm/ 永远在前端：引擎只产出"需要写字"的事件，前端调模型写完，再交回 api。
```

从第一天起遵守这几条，以后加后端就只是"多写一个 `api/server.ts` 和一个 `server-plugin/`"，界面和引擎不用动：

1. 界面只认 `api`，不直接 import `engine/`、`store/`。
2. `api` 的方法全部是 async（本地版也是），参数和返回值都能 JSON 序列化：不放函数、DOM、类实例、Map / Set。
3. 写操作都是"动作"：`api.dispatch({ type: 'post.publish', … }) → { delta, events }`。同一个动作对象原样就能走 HTTP。
4. `engine/` 和 `store/`（含迁移）两边通用：ES 模块，不用 `window`、`document`、`localStorage`；不直接调 `Date.now()`、`Math.random()`，时间和种子都作为参数传进去。能用 Node 测试，就说明能在服务器上跑。
5. id 用字符串，不靠数组下标。
6. 模型调用留在前端：连接配置是前端的东西（`ConnectionManagerRequestService`），服务器插件很难用上。后端只管计算和存储。
7. **功能对齐**：任何功能在本地版都必须完整可用；后端只能加容量（更大的存储、SQLite、全文搜索），不能成为功能门槛，否则 iPhone 上就是残缺版。
8. 启动时探测：请求 `/api/plugins/onlytavern/ping`，有回应就用 server，没有就用 local；设置里可以强制用本地。
9. 不需要后台任务：以后就算时钟改成真实时间，本地版也是打开时从上次的时间 `simulate` 到现在（"追赶"）。引擎是确定性的，结果和"一直在后台跑"一样。

装后端插件需要在 SillyTavern 的 `config.yaml` 里打开 `enableServerPlugins`，插件放在 SillyTavern 的 `plugins/` 目录（不在 extensions 里），路由挂在 `/api/plugins/<id>/`。`engine/` 怎么同时给扩展和插件用（复制脚本还是链接），到时候再定；结构可以参考 st-image-atelier 的 `server-plugin/`。

## 10. 步骤

每一步单独验收，通过了再进下一步。

| # | 内容 | 验收标准 |
|---|---|---|
| 0 | **骨架**：Vite react-ts 模板 + Tailwind v4 + `@fanvue/ui`（品牌色换成 Fanzly 新版的黑紫）；`index.js` 开关 iframe；空页面 + 两种导航（手机底部导航 / 桌面侧栏） | Mac 上的 SillyTavern 和 iPhone 上的 TauriTavern 都能打开；浅色、深色都对；TauriTavern 里 iframe 能拿到 `parent.SillyTavern`；iOS 上滚动和键盘正常 |
| 1 | **数据层 + api 层**：账号结构（独立于聊天，可以有多个）、账号列表、导入导出、迁移框架；`api/local.js` 和 `dispatch` 动作约定（§9.1） | Node 测试通过；能新建、切换、删除账号，刷新后还在；导出再导入后内容一致；界面代码里没有直接 import `engine/`、`store/` |
| 2 | **引擎 v0**：带种子的随机数、群众、订阅和流失、收入明细和抽成、"过一天"；Statements / Statistics 显示数字 | Node 测试：同种子同结果；连跑 90 天，数字在合理范围内 |
| 3 | **素材库 + 发帖 + 动态**：文字素材、标签、帖子表现、按种子生成的评论、通知 | 发帖、过一天，能看到合理的数据和评论；全程不调用模型 |
| 4 | **私信**：熟客升级、收件箱、模型回复（第一个模型任务）、私信 PPV、打赏、群发（结果由引擎算，少数熟客由模型回复） | 熟客回复不跑格式；模型出错时流程不卡 |
| 5 | **定制单**：引擎触发、模型写请求、接 / 拒 / 交付 | 定制单从出现到交付收钱能走完 |
| 6 | **角色卡成员**：拉角色卡进账号、指定身份；协助创作者替你发帖、单人 / 双人提示词切换；角色卡订阅者私信、评论、打赏、下定制单；权限 | 协助创作者发的帖带作者标记；角色卡订阅者用自己的人设说话，消费由引擎算；超出权限的操作做不了 |
| 7 | **和主 RP 互通**：聊天关联账号、"存进素材库"按钮、现状摘要注入 | 关联了账号的聊天，提示词里能看到摘要，长度受控；没关联或关掉后完全消失 |
| 8 | **小规模语义搜索**：搜素材库、给定制单找素材 | 先按标签筛，模型只排序；模型失败时仍有标签结果 |
| 9 | **以后**：其他时钟来源、从主 RP 自动识别内容、定时帖、促销 / 套餐、商店、熟客精选评论 | 每项单独立项 |

## 11. 待决定

- 平台在界面上叫什么（插件名已定为 OnlyTavern，仓库 [TequilaSunset123123/OnlyTavern](https://github.com/TequilaSunset123123/OnlyTavern)，2026-10-14）。
- 时钟来源（先做手动"过一天"）。
- 单人模式是只有你，还是只有她。
- 协助创作者替你发帖：直接发布，还是先存成草稿等你批。
- 私信里粉丝买不买：完全由引擎决定，还是你的话术也能加成。加成的做法可以是模型给"说服度"打个分，引擎再换算成概率加成，代价是多一次结构化输出。
- 粉丝用什么语言（语料库和模型输出）：英文、中文还是混合。
- 账号类型规则要不要照真实 OF（免费主页能发锁定帖，付费主页靠私信卖）。
- 要不要商店（实物商品）。
- 语义搜索用模型排序，还是用 SillyTavern 的向量（Vectors 扩展；TauriTavern 是否支持未知）。
- 角色卡订阅者的私信，要不要也能被"过一天"推进（比如它主动来找你），还是只在你打开对话时说话。
- 同一张角色卡在不同账号里，记忆要不要共享（目前按各账号分开记）。
- 后端插件做不做、做来干什么。按现在的设计（群众不逐个存、数据量小），它能带来的主要是更大的存储、SQLite 和全文搜索；不做，本地版也是完整的（§9.1）。
- 要不要加 Fanzly 里的视频通话、直播门票这两条收入渠道（纯文字模拟里可以做成预约事件）。

## 12. 参考库

### 界面

- [fanvue/fanv-ui](https://github.com/fanvue/fanv-ui)：Fanvue 官方组件库（React + Tailwind v4），2026-10-09 还在更新。已经发到 npm（`@fanvue/ui`），直接装来用。
  - 设计变量：`src/styles/theme.css`（浅色，加上 `.dark` 深色，1,274 行）和 `src/styles/styleTokens.json`。
  - 可参考的组件：`ChatMessage`、`ChatInput`、`CreatorCover`、`CreatorCard`、`SubscribeButton`、`BottomNavigation`、`Chart`、`Demographics`、`TrendPill`、`AnimatedNumber`、`FanFollowerCount`、`MediaStatusIndicator`、`Tabs`、`Drawer`、`Toast`。
  - 品牌色是绿色加黑色按钮（`--color-brand-primary-*`），粉紫色只出现在图表配色里。只有组件，没有页面。
- [BlackPhoenixSlo/inflowwkiller](https://github.com/BlackPhoenixSlo/inflowwkiller)（作者叫它 Fastt）：自托管的 OF 经纪公司后台。只看 `app/`（Next.js），深紫色、桌面风格：
  - 三栏收件箱：全部 / 未读 / 置顶 / 优先 / 欠回复筛选，每个人显示消费额和最近一次购买。
  - 右侧粉丝档案：PPV 购买曲线、自定义昵称、备注、标签、累计消费、订阅状态。
  - 输入区：Vault 按钮、PPV 价格框、快捷表情。
  - "+ New"菜单：New post、Mass message、Mass Online、Premade Mass、Nudge Online。
  - 另有 Stats 页。
  - `service/`（签名、curl_cffi、代理，连真 OF）完全不要。
- [lucasdetoledo4/of-chatter-chrome-extension](https://github.com/lucasdetoledo4/of-chatter-chrome-extension)：给经纪公司代聊人员出 AI 回复建议的 Chrome 扩展。只看 `types/`（粉丝档案字段）和 `mock/`（假数据），给熟客预设当素材。
- **真实 OF**：照它的菜单、页面构成、文案和规则。2026-10-14 已从公开的前端代码逆向（不用登录）：导航、私信、收入、粉丝管理的结构、文案、配色都在 `docs/ref/onlyfans-creator.md`，还原出的模板和文案表在 `vendor/onlyfans/`。
- **Fanzly**（Appscrip 的商业版 OF 仿站，[销售页](https://appscrip.com/onlyfans-clone/)）：外观目标，配色用新版黑紫。截图：`docs/ref/` 下三张旧版（只参考布局）、`docs/ref/fanzly-2026/` 下十六张新版。没有源码，只能照截图取色、量尺寸，细节见 §8.3。
- [ckelimarks/open-membership-site](https://github.com/ckelimarks/open-membership-site)：0 星，原生 HTML 的会员站（`feed.html`、`post.html`、`join.html`），粉丝视角。需要一个纯 HTML 的动态卡片做起点时再看。

### 架构 / 提示词

- [SpicyMarinara/rpg-companion-sillytavern](https://github.com/SpicyMarinara/rpg-companion-sillytavern)（321 星）：Separate Generation，即主回复之后额外调用一次来更新状态，并把状态注回主 RP。第 7、9 步看。
- [luftmenschiv-arch/SillyTavern-Extension-TMRW-Phone](https://github.com/luftmenschiv-arch/SillyTavern-Extension-TMRW-Phone)：主 RP 和手机应用之间怎么同步状态。第 7 步看。
- [CJ67I/momo-phone](https://github.com/CJ67I/momo-phone) 的 `apps/weibo`、[aaliyahaustin791-bit/phone-social-extension](https://github.com/aaliyahaustin791-bit/phone-social-extension) 的 `src/09-chirp-api.js`：让模型写帖子和评论的提示词。第 3、4 步写评论语料和精选评论时只看提示词。
- [SillyTavern/SillyTavern-Chess](https://github.com/SillyTavern/SillyTavern-Chess)：官方、代码少，是"自带界面和状态、把 SillyTavern 当 API 用"的最小例子。第 0 步看。
- [phyllis-0612/st-image-atelier](https://github.com/phyllis-0612/st-image-atelier)：数据分文件存、设置里只放索引的思路。它的后端部分 TauriTavern 用不了；以后做后端插件（§9.1）时，看它的 `server-plugin/` 怎么组织路由和服务。
- [Darkatse/TauriTavern](https://github.com/Darkatse/TauriTavern)：iPhone 上跑的 SillyTavern。后端是 Rust 重写的，不支持 Node 后端插件。
- **EchoText**（同一个 extensions 目录下的 `SillyTavern-EchoText`），可以抄的东西：
  - `connection_utils.js`：连接配置调用。
  - `tests/harness/`：用模拟数据驱动真实渲染函数的测试页做法。
  - TauriTavern 的两个坑：主题文字阴影要用 `:where(#面板) :not(html) { text-shadow: none }` 清掉；刘海屏靠 `env(safe-area-inset-*)` 避让。
  - 加载文件带时间戳防缓存。
  - `LEGACY_PROMPT_DEFAULTS` 的做法：改默认提示词时保留旧值，老用户才能收到新的默认值。

### 看过、不用的

- Bronya-Rand/Prome-VN-Extension、Shin-F/world-info-gallery：和这个项目无关。
- dan0dandeleon11/sillytavern-card-games：relay 服务器，TauriTavern 用不了。
- xenofei/SillyTavern-ScenePulse：Fastt 自带统计页，用不上。
- shiwam-c114/patreon-clone（2022）、deebehygh/HyghForums、ElnurIbrahimov/Streaming-App：质量或方向不合适。
- Vellariel/Fansly-AI：给真实 Fansly 账号自动回私信的桌面程序。

## 13. 约定（给之后的每次会话）

- 用中文交流。
- 只有你明确说了才提交；提交信息用英文，只写一句话，不加署名或 Co-Authored-By，不推送。
- 一次只做一步（或一小步），做完停下来等你看。
- 选界面来源只看质量，不看许可证（私人实验）。
- 不手画界面，能抄就抄（`docs/copy-plan.md`）。复制靠 `cp`，不让模型重打一遍；照清单做的机械活交给便宜模型。
- 提示词里的示例不要带某种特定语言的句子，否则会把模型带成那种语言。
- 解析要宽容（DeepSeek 这类较弱的模型经常不守格式）；发给模型的一律用规范写法。
- 你的环境：Mac 上的 SillyTavern + iPhone 上的 TauriTavern；模型是 DeepSeek，走 electronhub 的连接配置。

## 进度

- [x] 规划（2026-10-11）
- [x] 逆向真实 OF 创作者后台（2026-10-14）→ `docs/ref/onlyfans-creator.md`
- [x] 0 骨架（2026-10-14）：Mac 上的 SillyTavern 和 iPhone 上的 TauriTavern 都验收通过。
- [ ] 1 数据层：代码完成（2026-10-14）。账号结构、迁移框架、导入导出、`api/local.ts` 和 `dispatch`，14 个 Node 测试（含"界面不直接 import store/engine"的检查）。Accounts 页能新建、切换、删除、导出、导入；侧栏和 More 页显示当前账号。Mac 上的 SillyTavern 已验收：账号文件写进 `user/files/`、刷新后还在、中文名正常、导出再导入内容一致、删除后文件消失。**还差 iPhone 上 TauriTavern 的验收**（新建、刷新后还在、导出能保存、导入）。
- [ ] 2 引擎 v0
- [ ] 3 素材库 + 发帖 + 动态
- [ ] 4 私信
- [ ] 5 定制单
- [ ] 6 角色卡成员
- [ ] 7 和主 RP 互通
- [ ] 8 小规模语义搜索

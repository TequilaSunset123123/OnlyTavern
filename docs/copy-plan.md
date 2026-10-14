# 抄袭计划

> 目标：自己写的代码越少越好。能装现成的库就装库，能复制的文件就用 `cp`，不让模型读一遍再重打一遍。
> 和 `plan.md` 冲突的地方以本文件为准（plan.md 已同步）。2026-10-11。

## 1. 关键决定：技术栈跟着抄的来源走

- Fanvue 的组件库和 Fastt 的后台用的是**同一套技术栈**：React + Tailwind v4 + Radix + clsx / tailwind-merge。所以不再把它们翻成普通 HTML/CSS（原来的计划），我们自己也用 React + Tailwind v4 + TypeScript：
  - **Fanvue**：组件库已经发到 npm（`@fanvue/ui` 3.41.0，2026-10-09 更新）。直接 `npm install` 然后 import，一行都不用抄。
  - **Fastt**：组件文件原样复制，只改数据来源。
  - 保留 TypeScript。两边都是 TS，转成 JS 就等于重写。
- **应用跑在 iframe 里**（全屏盖在 SillyTavern 上面）：
  - 样式完全隔离：Tailwind 的全局重置弄不坏 SillyTavern，SillyTavern 和 TauriTavern 的主题样式也进不来（EchoText 碰到过的全局文字阴影就是这类问题）。
  - Radix 的弹窗、下拉菜单、Toast 默认挂在 `body` 上，在 iframe 里自然是好的。
  - 同源，所以 iframe 里可以直接用 `window.parent.SillyTavern.getContext()`。
  - 不开 SillyTavern，也能在浏览器里直接打开应用页面，配上假数据开发和测试。
  - 第 0 步要验证：TauriTavern 里的同源 iframe 能不能访问 `parent`；iOS 上 iframe 里的滚动、键盘和 safe-area 是否正常。如果不行，退路是 Shadow DOM，但 Radix 的弹窗要逐个传 `container`，麻烦一些。
- **工程**：用 Vite 官方的 react-ts 模板起步（`npm create vite@latest`）。`vite build` 的产物 `dist/` 要提交进仓库，因为 TauriTavern 用 git 安装扩展，不会帮你构建。

## 2. 两层结构

```
SillyTavern 页面
└─ index.js（纯 JS，不打包，几十行，自己写）
   ├─ 入口按钮；打开 / 关闭 iframe（关闭时只隐藏、不销毁，状态保留）
   ├─ 聊天消息上的"存进素材库"按钮 → 转给 iframe（iframe 没开就先存进待办）
   └─ 切换聊天时，如果这个聊天关联了账号，把该账号的现状摘要注入提示词（setExtensionPrompt）
      —— 这样应用没打开时，摘要也照样在
iframe：dist/app/index.html（React 应用）
   界面（Fastt 组件 + Fanvue 组件）→ hooks（TanStack Query，照 Fastt）→ api → engine / store / llm / bridge
```

## 3. 抄袭对照表

### 3.1 直接装的库（零代码）

| 需要 | 用什么 |
|---|---|
| 组件、设计变量、图表 | `@fanvue/ui`（含 `@fanvue/ui/charts`；同伴依赖 recharts、motion、react-day-picker） |
| 数据请求、缓存、刷新 | `@tanstack/react-query`（Fastt 同款） |
| 图标 | `lucide-react`（Fastt 同款），加上 Fanvue 的 Icons |
| 页面切换 | `react-router`（MemoryRouter；Fastt 的 Next 页面目录照搬成路由表） |
| 带种子的随机数 | `seedrandom` |
| 熟客名字、用户名、国家 | `@faker-js/faker`（只引入英文 locale；`faker.seed()` 可重放） |
| 修复模型输出的坏 JSON | `jsonrepair` |
| 校验模型输出 | `zod`（Fastt 同款；校验不过就走退路） |
| 素材库模糊搜索（语义搜索的第一层） | `fuse.js` |
| 测试 | `vitest` + Testing Library；配置照 Fastt 的 `vitest.config.ts`、`vitest.setup.ts`、`test-utils.tsx` |

### 3.2 从 Fastt 复制的文件

来源 [BlackPhoenixSlo/inflowwkiller](https://github.com/BlackPhoenixSlo/inflowwkiller)，下面的路径都相对于它的 `app/` 目录。

| 我们的页面 | 复制 |
|---|---|
| 公共 | `app/globals.css`（Fastt 自己的颜色变量，改成映射到 Fanzly 新版的黑紫）、`lib/utils.ts`、`lib/format.ts`、`components/ui/primitives.tsx`、`components/ErrorBoundary.tsx`、`hooks/useTheme.ts` |
| Home 动态 | `components/messages/MyFeedTab.tsx`、`PostCard.tsx`、`TopPostsTab.tsx` |
| New Post | `components/compose/PostComposer.tsx`、`MediaTray.tsx`、`ScheduleField.tsx` |
| Messages | `components/chat/` 下的 `ChatList`、`ChatSurface`、`MessageList`、`Composer`、`FanDrawer`、`VaultPicker`、`EmojiBar`、`ChatSearch`、`PinnedPanel`；`components/messages/FanAvatar.tsx` |
| 群发 | `components/compose/MassMessageComposer.tsx`、`components/audience/BroadcastAudiencePicker.tsx`、`fanLists.tsx` |
| Vault | `app/vault/page.tsx`、`components/vault/VaultTile.tsx`、`VaultManagePanel.tsx` |
| 收入明细 | `components/messages/TipsTab.tsx`、`TipRow.tsx`、`PaidMessagesTab.tsx`、`TopTippersCard.tsx`、`components/MoneyRail.tsx` |
| Statistics | `components/home/TotalRevenueChart.tsx`、`components/stats/DateRangePicker.tsx`、`PerModelKpiGrid.tsx` |
| 定制单 | `components/messages/CustomsTab.tsx` |
| 通知 | `components/NotificationBell.tsx`、`NotificationToaster.tsx` |
| 设置、导入导出 | `components/settings/StickySaveBar.tsx`、`SettingsTransfer.tsx` |
| 以后：促销、试用 | `components/growth/PromotionTab.tsx`、`TrialLinksTab.tsx` |
| 只参考数据形状 | `hooks/useFan.ts`、`useFanSpend.ts`、`useFanPpvHistory.ts`、`useChatMessages.ts`、`usePosts.ts`、`useStats.ts` |

每个复制来的文件都按同样的方法改：

1. 删掉 `'use client'`；`next/link`、`next/navigation` 换成 react-router。
2. 数据 hook 里调用 `relay` 的地方换成我们的 `api`。hook 的名字和返回的数据形状尽量不变，这样组件就不用动。
3. 删掉经纪公司才需要的功能：多账号（AccountChips、ScopeSwitcher）、员工、代理、自动化、AI 助手、真 OF 的媒体地址。
4. 媒体只有文字：`MediaTile` / `VaultTile` 里放图片的位置，换成"渐变色块 + 文字描述"（一个小组件，要自己写）。

### 3.3 Fanvue 组件直接 import（不复制）

| 用在 | 组件 |
|---|---|
| 手机底部导航 | `BottomNavigation` |
| 主页（按 Fanzly 的主页布局拼） | `CreatorCover`、`Avatar`、`UserDisplayName`、`UserHandle`、`FanFollowerCount`、`SubscribeButton`、`Button` |
| 收入卡（Fanzly 的 8 个渐变卡） | `Card`、`AnimatedNumber`、`TrendPill` |
| 统计 | `@fanvue/ui/charts` 里的 `Chart`、`Demographics` |
| 表单、弹窗、提示 | `TextField`、`TextArea`、`Select`、`Switch`、`Tabs`、`Dialog`、`Drawer`、`Toast`、`Pill`、`Chip` |
| 聊天气泡（Fastt 的不顺手时） | `ChatMessage`、`ChatInput` |

换肤只覆盖 Fanvue 的品牌色和深色底色变量，改成 Fanzly 新版的黑紫（色值已经取好，见 `plan.md` §8.3）。新版截图在本机的 `docs/ref/fanzly-2026/`（不进仓库）。

### 3.4 其他来源

| 需要 | 从哪抄 |
|---|---|
| 模型调用（走连接配置） | EchoText 的 `connection_utils.js`，原样复制 |
| 熟客档案字段、假数据 | of-chatter-chrome-extension 的 `types/`、`mock/` |
| 写帖子 / 评论的提示词 | momo-phone 的 `apps/weibo`、phone-social 的 `src/09-chirp-api.js`（只抄提示词） |
| "存进素材库"按钮、提示词注入 | rpg-companion（用到时再找具体文件） |
| 页面布局、配色 | Fanzly 截图（配色看 `docs/ref/fanzly-2026/`，旧版三张只看布局） |

### 3.5 让 DeepSeek 生成：不写，也不抄

这些预设数据一次性生成，审一遍后存成 JSON：

- 各类粉丝的参数（初始值）
- 评论语料（类型 × 情绪 × 标签）
- 标签表
- 通知模板
- 熟客的一句话背景模板

在 SillyTavern 里用你自己的 DeepSeek 跑，只花几分钱，不用 Claude 的 token。生成用的提示词放在 `docs/prompts/`。第 3 步已生成标签表和评论语料（`docs/prompts/run-in-st.js` 自动通过连接配置调用，`app/scripts/build-corpus.mjs` 整理成 JSON）。粉丝参数的初始值是第 2 步手写的。

实际情况补记（第 2、3 步）：Statements、Statistics、Vault、动态、通知这几页没有复制 Fastt 的组件。它们绑着 Fastt 自己的基础组件、请求层和"按粉丝一行"的数据，搬过来要连带一整套基础组件，还会和 Fanvue 的样式打架；所以直接用 Fanvue 的组件拼（`Table`、`ChartCard`、`Card`、`Chip`、`Dialog` 等），示例照抄 Fanvue 的 story。

第 4 步同样没复制 Fastt 的 `components/chat/`、群发和 Fans 组件（加起来约 1.5 万行，同样绑着它自己的基础组件和请求层）。聊天气泡和输入框用的是上表"Fastt 的不顺手时"那一行的 Fanvue `ChatMessage`、`ChatInput`，配色改成 Fanzly 的紫色；收件箱、群发、Fans 页用 Fanvue 的 `Tabs`、`Chip`、`SegmentedControl`、`ProgressBar`、`Table` 拼。从素材库挑东西的弹窗抽成了一个 `VaultPickerDialog`，发帖和私信共用。EchoText 的 `connection_utils.js` 是用 `cp` 复制的（原文件是 CRLF 换行，比对时用 `diff --strip-trailing-cr`），只做了定点修改，见 plan.md §5。

## 4. 真正要自己写的（只剩这些）

| 部分 | 规模 |
|---|---|
| `index.js`（SillyTavern 侧：按钮、iframe、消息按钮、摘要注入） | 小 |
| `engine/`：公式和规则，参数全放在 JSON 里 | 中。唯一真正原创的部分 |
| `api/local.ts`：dispatch 加各种查询，连接 engine 和 store | 小 |
| `store/`：账号结构、账号列表、迁移、存储读写、导入导出 | 小 |
| `llm/`：每个任务的提示词模板 + zod 结构 | 小 |
| 胶水：把 Fastt 的 hook 接到 api、路由表、文字素材卡、拼装 Fanzly 的主页和收入卡 | 中 |

## 5. 省 token 的做法

- 用 `git clone --depth 1` 把源码拉到 `vendor/`（加进 `.gitignore`，不进仓库），复制用 `cp`。
- 改复制来的文件只做定点修改：改 import、换 hook。不通读、不重排、不"顺手优化"。
- 每个复制任务写成一张清单：源路径 → 目标路径 → 要删什么 → 要换什么。照清单做的机械活交给便宜模型（Sonnet / Haiku）的会话；设计和验收再用贵的模型。
- 用不到的功能，连文件都不复制。不要"先抄过来，以后可能用得上"。
- 文案、语料、参数都交给 DeepSeek 生成。

## 6. 对步骤的影响

- **第 0 步**：Vite react-ts 模板 + Tailwind v4 + `@fanvue/ui` + Fanzly 新版黑紫品牌色；`index.js` 负责开关 iframe；先做空页面和两种导航（手机底部导航 / 桌面侧栏）。验收额外加两条：TauriTavern 里 iframe 能拿到 `parent.SillyTavern`；iOS 上滚动和键盘正常。
- **第 1 步起**：每一步开工前先从 §3 里列出"这一步要复制哪些文件"，再写胶水。

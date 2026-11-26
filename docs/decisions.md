# 技术选型与架构决策

本文记录 Argon 立项时的评估过程和最终决定，供后续开发回溯：当初为什么这样选，什么情况下应该重新评估。

评估依据：

- 本机 pi 1.6.1 自带的文档：`docs/rpc.md`、`rpc-commands.md`、`rpc-extension-ui.md`、`sdk.md`、`security.md`。
- pi 的类型定义。
- [percho](https://github.com/Jaxton07/percho) 的架构文档和踩坑记录。
- 第一版的实际冒烟测试结果。

日期：2026-11-26。

---

## D1. 用 Electron，不用 Tauri

**决定**：桌面壳用 Electron + React + Tailwind CSS。

**原因**：pi 的核心是 TypeScript 包（`@earendil-works/pi-coding-agent`），SDK 可以在 Node 进程内直接嵌入。Electron 本身带 Node，后端和前端用同一种语言，类型也能共享。Tauri 的后端是 Rust，只能把 pi 当子进程跑，没法直接用 SDK。

**什么时候重新评估**：如果以后只走 RPC 子进程方案，或者安装包体积、内存占用成了主要矛盾。

---

## D2. 内嵌 pi SDK，不用 RPC 子进程方案

当时有两个方案：

- **A. RPC**：pi 作为子进程运行（`pi --mode rpc`），通过 stdin/stdout 收发 JSONL。
- **B. SDK**：在进程内直接使用 `@earendil-works/pi-coding-agent`。

| 维度     | RPC                                                                                                                                                                                                          | SDK                                                                                                           |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------- |
| 能力覆盖 | 约 35 条命令，覆盖：prompt、steer、follow_up、abort、模型、思考级别、压缩、bash、会话切换/fork/clone/树、导出。**不覆盖**：设置管理、OAuth 登录、跨项目会话列表、MCP 状态、技能/包管理、宿主实现的自定义工具 | 全部能力：`customTools`、自定义 `ResourceLoader` / `SettingsManager`、inline extension、`AgentSessionRuntime` |
| 扩展 UI  | 只支持 `select/confirm/input/editor` 四种弹窗，以及 notify、status、纯文本 widget、title。`custom()` 返回 undefined；主题、footer/header、编辑器组件相关调用都是 no-op                                       | 宿主自己实现 `ExtensionUIContext`，可以扩展协议                                                               |
| 修改 pi  | 只能 fork 后自行构建                                                                                                                                                                                         | 按代价从低到高：inline extension → SDK 参数 → patch-package → fork                                            |
| 多会话   | 每个会话一个进程                                                                                                                                                                                             | 一个进程里可以有多个会话，每个会话有自己的 `cwd`                                                              |
| 版本耦合 | 协议面窄，相对稳定                                                                                                                                                                                           | API 面宽，升级更容易出问题。percho 把版本钉死，并维护一份升级清单                                             |
| 隔离性   | 天然隔离                                                                                                                                                                                                     | 取决于放在哪个进程（见 D3）                                                                                   |

两个容易误解的事实：

- 本机装的 `pi` 不是二进制，而是一个 shell 启动脚本，最终用 Node 跑 npm 包。真正的单文件二进制要靠 Bun 编译（`build:binary`），需要按平台分别打包和分发。
- 如果以后需要 RPC，可以用 `utilityProcess.fork()` 跑 pi 包导出的 `./rpc-entry`，直接用 Electron 自带的 Node，不必附带额外的二进制。

**决定**：选 SDK。pi 版本钉死（当前是 1.6.1），所有 pi 类型只在 backend 的适配层出现（见 CLAUDE.md 边界第 3 条）。等协议稳定后，RPC 可以作为另一种传输方式接入，但不是主路线。

---

## D3. 后端放在独立进程，不放 Electron main

percho 把 SDK 直接跑在 main 进程里，能用，但有几个问题：

- 加载会话 JSONL、用 jiti 编译用户的 TS 扩展、执行压缩、处理大段工具输出，都会阻塞 main 的事件循环，整个窗口会跟着卡住。
- 用户扩展是任意代码。放在 main 里就拥有 main 的权限，一旦死循环或崩溃，整个应用都会挂掉。

**决定**：后端是一个纯 Node 包（`packages/backend`），不依赖任何 Electron API。到 Electron 阶段，它跑在 `utilityProcess` 里，由 main 负责拉起和监控。

---

## D4. 后端按"远程服务"设计（远程优先）

**需求**：以后要支持把 agent 部署在服务器或另一台电脑上，用一个纯客户端来操作。前期不做远程，但设计上从第一天就预留。

**决定**：本地运行就是"连到 localhost 的远程"。下面这些约束已经写进 CLAUDE.md 并在第一版里实现：

1. 协议的每个字段都可以 JSON 序列化，跨边界只有异步消息。前端不做任何文件 IO，选文件夹、补全、diff 都走后端 API。
2. 前端只依赖 `AgentClient` 接口。现在用 WebSocket 实现，以后可以加 IPC 实现。
3. 每个对象都带环境身份。路径对客户端是不透明字符串，只能显示，不能做 IO。
4. 事件流带递增 seq，后端保留回放缓冲区。客户端断线后先补收漏掉的事件，补不上就拿完整快照。
5. agent 的生命周期不依赖客户端：客户端断开，任务照常运行；待决的审批和弹窗由后端持有，重连后可以继续回答。
6. 命令幂等：客户端为每条命令生成 `clientMessageId`。
7. 配置和凭证按环境区分，远端有自己的 provider key。
8. backend 不依赖 Electron；协议有版本号，连接时握手。

**以后再做**：

- 传输层：SSH stdio 或常驻 daemon + WebSocket。
- 远端运行时的安装和升级。
- 多个客户端同时连接时的占用规则。
- 远端文件浏览和终端。

注意：最省事的远程方式是 `ssh host pi --mode rpc`，但这样会丢掉 Argon 在后端加的所有能力。所以要远程化的是 Argon 的后端，而不是 pi 本身。

---

## D5. 前期在浏览器里开发，不急着上 Electron

**决定**：开发阶段的组合是：后端用 `tsx watch` 运行，前端用 Vite 开发服务器，二者通过本地 WebSocket 通信（`npm run dev`）。

**好处**：

- 开发循环快。
- 顺便验证了"纯客户端 + 远程后端"这条路。
- 以后做 web 端或手机端，前端基本不用改。

**浏览器里做不到、需要变通的事**：

| 能力                                       | 当前做法                                       |
| ------------------------------------------ | ---------------------------------------------- |
| 选择项目文件夹                             | 由后端提供目录浏览（`fs.listDir`）             |
| 拖拽或附加文件                             | 浏览器拿不到路径，只能上传文件内容（待实现）   |
| 在 Finder 或编辑器中打开                   | 本地开发时由后端执行 `open` / `code`（待实现） |
| 系统通知                                   | 用 Web Notification（待实现）                  |
| 托盘、全局快捷键、自动更新、深链接、钥匙串 | 到 Electron 阶段再做                           |

**安全**：本地 WebSocket 服务能执行 shell，所以必须：

- 只监听 127.0.0.1；
- 校验 Host 头（防 DNS rebinding）；
- 校验 Origin 白名单；
- 第一帧必须携带 token。

第一版已经全部实现。

**风险**：Electron 打包的坑不能拖到最后才处理，具体包括：pi 是纯 ESM，打包时还涉及 worker 文件、photon 的 wasm、jiti 动态加载、asar 解包，以及 Node 版本必须 ≥ 22.19。应该尽早做一个最小的 Electron 壳，打一次正式包跑通（见 [roadmap](roadmap.md) 阶段 2）。

---

## D6. 传输方式：先用 WebSocket，IPC 以后再说

到 Electron 阶段时有两种选择：

- **继续用本地 WebSocket（带 token）**：只需要一套传输，浏览器和 Electron 行为完全一致。
- **改用 MessagePort / IPC**：不占端口，也不需要 token，攻击面更小。

前端只依赖 `AgentClient`，所以这个决定可以推迟。默认倾向是先继续用 WebSocket，真有需要再加 IPC 实现。

---

## D7. 修改 pi 的优先级

**决定**：按下面的顺序选择修改方式，能用前面的就不用后面的：

1. inline extension（例如权限门 `backend/src/permissions.ts`）
2. SDK 参数（`customTools`、`ResourceLoader`、`SettingsManager`）
3. patch-package（每次升级都要重新核对，percho 维护了两份补丁）
4. fork

**背景**：pi 默认不审批任何工具调用（security.md 明确写了这一点）。Argon 的审批功能用一个扩展来实现：在 `tool_call` 事件里拦截，再转成 GUI 交互。

---

## D8. UI 技术栈

- 采用 shadcn/ui（radix-nova 风格，组件以源码形式放在项目里）。
- 状态管理用 zustand。
- 流式 Markdown 渲染用 streamdown，加 `@streamdown/code`（代码高亮）和 `@streamdown/cjk`（中文排版）插件。
- 不用 next-themes：它在 React 19 客户端渲染时会报 script 标签警告。改为自己写的 `useSystemTheme`，跟随系统深浅色。
- 真正的难点在聊天体验，而不在组件库：流式 Markdown、长对话虚拟滚动、支持 @文件和斜杠命令的输入框（percho 用的是 Lexical）。

---

## 参考：percho 的踩坑记录

以下内容来自 percho 的 `docs/sdk.md` / `architecture.md`，基于 pi 1.5.1。对 Argon 的影响已在第一版中处理或记入 TODO。

- `AgentSession.dispose()` 不会发出 `session_shutdown`，导致 MCP 的 stdio 子进程残留。Argon 的处理：使用 `AgentSessionRuntime.dispose()`。
- `agent_end` 之后仍可能自动重试、压缩或续跑。判断一轮真正结束要以 `agent_settled` 为准。
- 会话数据并不只有一份事实源，需要区分：JSONL 会话树、模型实际看到的上下文（可能已压缩）、UI 投影。不能用模型上下文重建 UI 历史。
- `isIdle` / `isStreaming` / `pendingMessageCount` 不足以证明会话"真正空闲"。percho 为此通过补丁加了 `tryAcquireIdleLease()`。Argon 以后做后台维护（自动卸载、reload）时会遇到同样的问题。
- percho 的其他补丁：`retryLastFailedTurn`、可选的压缩策略、请求前暂停。它们说明这几项能力 SDK 原生不提供。

其他社区 GUI 方案也可以参考：pi-desktop（tanRdev / FaqFirebase，其中有的走 RPC）、piCode（RPC）、pi-gui（SDK）、Pilot（SDK）。

---

## D9. MCP 状态靠补丁暴露（第一个 pi 补丁）

**问题**：pi 内置 MCP 扩展的服务器状态（连接状态、错误、是否需要登录、工具列表）都在扩展闭包里。非 TUI 模式下，`/mcp` 只输出纯文本；完整的管理界面要靠 TUI 的 `ctx.ui.custom()`。按 D7 的优先级逐项排查：inline extension 只能看到已注册的工具；SDK 参数（`createMcpExtension` 的选项）拿不到配置和连接状态，因为 `loadMcpConfig` 没有导出。

**决定**：用 patch-package 给 `dist/extensions/mcp/index.js` 打一个约 60 行的补丁。补丁不改变 MCP 的行为，只在 `pi.events` 上加三个通道：

- `argon:mcp:state`：每次 `emitChange` 时发出一份结构化快照；
- `argon:mcp:request-state`：请求立即发出一份快照；
- `argon:mcp:action`：执行 reconnect / enable / disable / signin / signout / exposure，复用扩展内部的 `runAction` / `setExposure`。登录时需要的 `McpUi`（`status` / `redirectUrl`）由 Argon 实现：`redirectUrl` 变成一个 `oauth` 交互，由前端打开链接。

另外，`openUrl` 通过 SDK 参数设成 no-op，backend 永远不在自己的机器上开浏览器（D4）。

被否决的方案：

- 解析 `/mcp` 的文本输出：太脆弱。
- 做一个通用的"无头 TUI"桥接 `ctx.ui.custom()`：工作量大，而且做出来是终端风格的界面。

**什么时候重新评估**：每次升级 pi 都要检查补丁；如果官方提供了 MCP 状态接口（可以考虑提 PR），就删掉补丁。

## D10. Argon 数据与 pi CLI 隔离

全局 SDK 数据放在 `$ARGON_HOME/agent`（默认 `~/.argon/agent`），项目配置目录使用 `.argon`。不自动迁移 pi 的配置、凭据或历史，移除 ARGON_PI_AGENT_DIR 覆盖。
入口在加载 SDK 前覆盖进程内的 PI_CODING_AGENT_DIR 和 PI_CODING_AGENT_SESSION_DIR，避免 SDK 内部会话创建、列举及扩展回退到 CLI 目录。
SDK 参数无法统一修改项目资源、MCP、信任记录的 CONFIG_DIR_NAME，故补丁增加 PI_CONFIG_DIR_NAME 覆盖；Argon 固定为 .argon，普通 pi 默认行为不变。升级 pi 时需验证此补丁。

## D11. 项目信任由 Argon 处理

**决定**：Argon 在加载项目资源时自行判断信任状态，会话加载不等待用户回答。信任状态未决时，先按不信任模式加载会话，由 GUI 的横幅询问用户。Argon 跳过 pi 的 `project_trust` 扩展事件，信任决定通过 `projects.setTrust` 提交。

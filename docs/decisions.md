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

**2026-11-26 修订**：不再跳过 `project_trust` 事件。pi 在加载项目资源前会先加载用户级扩展，并通过 `resolveProjectTrust({ extensionsResult })` 交给宿主；Argon 用这些扩展按 pi 的顺序判断：本会话的“仅本次”选择 → 第一个回答 yes/no 的 `project_trust` 处理器（`remember: true` 时写入信任记录） → 已保存的决定 → 默认值。处理器拿到的是无 UI 的上下文（`hasUI: false`），因为会话加载仍然不等待用户回答。GUI 在信任菜单里显示是哪个扩展做的决定（`ProjectTrustInfo.decidedBy`）。“仅本次”的决定仍只在内存里，与 pi 的 session-only 语义一致。

## D12. 前端 i18n

**决定**：使用 i18next 和 react-i18next，同步加载内置的英文和简体中文词条。语言偏好保存在客户端的 localStorage 中，同一个后端可同时服务使用不同界面语言的客户端。后端、pi 和扩展提供的原始文本暂不翻译。

## D13. 工具预设与工具显示

**背景**：pi 的工具体系可能大改。Argon 要支持多套“工具预设”：传统模式（read / write / edit / bash 等分开的工具）、pi 的 codemode、codemode only，以后还可能参考 pi-codex-conversion 的几种模式（Structured、Code、TS Notebook、VM Code，工具是 `exec_command`、`apply_patch`、`exec`、`notebook` 等）。每种预设有自己的工具，也要能控制这些工具怎么显示。此前 Argon 对工具的假设是写死的：前端按工具名写摘要、只有 edit/write 有 diff、`READ_ONLY_TOOLS` 固定、“始终允许”规则只认 bash、嵌套调用一律丢掉。

**决定**：

1. **预设是 backend 概念**，负责：启用哪些工具、如何配置 pi（例如 `defaultTools`、`codemode.mode`）、审批策略。全局设置给出默认预设；每个会话可以单独切换，存在会话文件里（与权限模式相同），在两轮之间生效。切换会改变工具列表和系统提示词，下一次请求的缓存会全部失效。
2. **显示描述由 backend 给出，前端按类型渲染，并可按工具覆盖**。backend 的 presenter（`backend/src/tool-display.ts`）把每个调用映射成显示描述 `ToolDisplay`：类型、标题、摘要，以及该类型需要的字段，随 `tool_started` 事件和历史投影下发。类型按语义划分，不按工具名：`shell`、`file_read`、`file_change`（一开始就支持多文件，以容纳 `apply_patch`）、`search`、`script`（带子调用）、`generic`。前端为每种类型提供渲染器；遇到不认识的类型，就用描述里的通用字段（标题、摘要、参数、输出）显示成通用卡片。需要特别定制时，前端可以按“来源 + 工具名”注册专门的渲染器，覆盖按类型的默认渲染。
   这样，新工具只要能归入已有类型，前端不用更新就能完整显示；只有出现新的界面形态时才要更新前端。版本不一致时只会降级，不会显示不出来。
3. **backend 给每个调用附上来源标识**（`source`，取自 pi 的 `ToolInfo.sourceInfo.source`，例如内置工具、`npm:<包名>`；工具已不存在时为空，只是字符串），供前端的覆盖渲染器区分不同预设里的同名工具。
4. **presenter 是所有预设共用的**，按来源和工具名查找，与当前启用哪个预设无关。会话可能中途切换过预设，旧调用也必须能正确显示。预设只能调整显示偏好（例如子调用默认展开还是折叠）。
5. **嵌套调用是一等公民**：`ToolCallState` 记录 `parentToolCallId`，`translate` 不再丢掉嵌套事件，`script` 卡片下列出子调用，每个子调用用各自的渲染器显示。
6. **需要文件读写的部分仍在 backend 计算**（diff 预览、write diff 持久化，见 `write-diff.ts`），前端只显示。
7. **审批不再细化**：按命令文本做静态判断覆盖不了 bash 的各种写法，权限控制以后交给沙箱（见路线图“沙箱”一节）。审批维持现有的基本机制，codemode 的嵌套调用继续随父调用一起审批。

**考虑过的方案**：

- 纯前端按工具名映射：每出现一个新工具（包括用户在 backend 上安装的任意扩展带来的工具）都要更新前端，远程 backend 与前端版本不一致时，新工具只能显示成通用卡片。
- 纯 backend 描述、前端不能覆盖：表达能力受限于类型词汇表，个别工具想做精致的显示也得先扩充协议。

最终采用折中：backend 描述为主，前端可以覆盖。

## D14. 最小 Electron 壳的打包布局

**决定**：electron-vite 构建 main、独立 backend 入口和复用的 web renderer，electron-builder 输出安装包。pi 与第三方运行时依赖不做 JS 合并，保留 npm 包布局。main / renderer 在 app.asar 中；backend 入口、动态 chunk 和 node_modules 显式 asarUnpack，utilityProcess 从 app.asar.unpacked 的真实路径启动。desktop 只声明 `@argon/*` 依赖：Vite 编译 `@argon/*` 的 TS 源码，其他裸导入一律外置；第三方运行时依赖由 electron-builder 经 workspace 从 backend 收集，不在 desktop 重复声明。

**原因**：正式打包冒烟发现，以 asar 内部包路径作为子进程 cwd 会报 ENOTDIR；图像和 Codemode worker、Photon / QuickJS WASM、jiti 也依赖真实文件布局。先整体解包运行时依赖，避免开发模式正常但安装包丢文件或动态加载失败。缩减解包范围和安装包体积留到有完整打包回归后进行。

**传输与页面来源**：按 D6 保留 WebSocket，后端绑定 loopback 随机端口，通过父子进程消息回报 main；main 注入每次启动生成的 token。生产 renderer 使用标准、安全的 `argon://app` 自定义协议，因此可以精确校验 Origin，无需允许 `file://` 的 `null` Origin。页面只使用现有 AgentClient，无 preload API。开发模式只允许 Vite 的精确 Origin。

**生命周期**：CLI 和 utilityProcess 共用纯 Node 的 `startBackend()`。退出先停止连接，再 dispose registry；main 等待退出，超时强制终止。崩溃后最多重启三次并保留连接地址，前端复用既有重连和快照恢复逻辑。运行中的任务仍会中断，不声称能续跑。

**验证范围**：macOS arm64，Electron 45.5.0 / Node 24.22.3；安装包和独立配置冒烟。具体命令、布局和未完成项见 [desktop.md](desktop.md)。签名、公证、更新及其他平台验证仍在阶段 2。

## D15. 沙箱方案

**状态**：macOS 已实现（2026-11-26），Windows 和 Linux 暂缓。调研细节见 [sandbox.md](sandbox.md)。

**背景**：按命令文本做静态审批覆盖不了 bash 的各种写法（D13 第 7 条），安全边界要交给操作系统。pi 不提供沙箱，只推荐把整个进程放进容器或虚拟机，这不适合作为桌面应用的默认方案。

**方向**：

1. **用 inline extension 做 tool 级沙箱**（遵循 D7）。参照 pi 社区扩展的做法：注册同名 bash / powershell 工具，在 `createBashToolDefinition(cwd, { operations })` 里换成沙箱化的 `BashOperations`，接管 `user_bash`，在 `tool_call` 里检查 read / write / edit 的路径。codemode 的嵌套调用最终也走这些工具，自然被覆盖。沙箱在 backend 所在机器上生效，远程 backend 同样适用（D4）。
2. **macOS 用 `@anthropic-ai/sandbox-runtime`**（Seatbelt + 沙箱外的域名代理）。Claude Code 和最流行的 pi 沙箱扩展都基于它，Apache-2.0，可作为库调用。它自称 Beta，API 可能变化，封装在 backend 一处，升级时只改那里。
3. **Windows 分档，按可用性自动选择，结果在 UI 上明确标出**：
   - MXC（Win11 24H2 / 25H2 的较新 build）：不需要管理员，隔离最完整。首选。
   - srt 的 Windows 后端（专用本地账户 + restricted token + WFP，需要一次 UAC 安装）：相当于 Codex 的 elevated 方案，覆盖不支持 MXC 的机器。srt 本身也有实验性的 MXC 后端（要求 Node 24+，桌面版 Electron 45 自带 Node 24，满足）。
   - 都不可用：不进沙箱，退回现有审批，界面上持续提示“未隔离”。不做 Codex unelevated 那种只靠环境变量挡网络的方案，它提供的是虚假的安全感。
   - Windows 上优先用 pi 的 powershell 工具；MXC 下 Git Bash / MSYS2 会崩。
4. **审批只在越界时介入**：沙箱内的命令自动放行；需要写工作区外、访问白名单外的域名，或要求不进沙箱重试时，经 `InteractionBroker` 询问。批准后可以只放开对应的路径或域名（本会话 / 本项目 / 全局），也可以不进沙箱重试一次。与现有权限模式合并设计。
5. **默认策略**：
   - 写：cwd、临时目录和用户添加的目录。
   - 写保护：`.git`（含 `gitdir:` 指向的目标，以及 hooks / config）、`.argon/`、shell rc 文件。
   - 读保护（几家默认都不限制读，必须补上）：`$ARGON_HOME`（尤其 `agent/auth.json`）、`~/.ssh`、云厂商凭据目录。
   - 网络：默认关闭或只开空白名单，由用户添加域名。
6. **沙箱起不来时 fail-closed**：明确报错并退回审批，不静默降级（Claude Code 默认静默降级，这是反面教材）。

**已知限制（要写进用户文档）**：

- MCP 服务器进程、其他扩展自己启动的子进程不受沙箱约束。这是 tool 级隔离的固有局限，要覆盖它们只能把整个 backend 放进沙箱。
- 域名白名单只看主机名，存在 domain fronting；宽泛的白名单（例如 `github.com`）可被用来外传数据。
- 放开 Unix socket（尤其 Docker socket）等于放开整台主机。
- srt Windows 后端有若干已知缺口（DNS、SMB、WSL 流量不受限等），见 sandbox.md。

**考虑过的方案**：

- 整个 pi 进程放进容器、Docker Sandboxes、OpenShell：隔离最彻底，但桌面用户要装 Docker，路径映射、性能和 GUI 体验都差。可以作为以后的可选模式。
- Gondolin 微虚拟机（pi 官方示例）：依赖 QEMU，只路由内置工具，扩展工具仍在宿主上运行。
- 直接依赖社区扩展：carderne 的 pi-sandbox 不支持 Windows；yuru7 的支持 Windows，但不隔离网络、不限制读。Argon 要和 InteractionBroker、权限模式深度整合，自己实现一个 inline extension 更合适，两者的实现可以参考。

**第一版实现（2026-11-26）**：

- 只实现 macOS。`EnvironmentInfo.sandbox` 报告后端机器的支持情况：Windows / Linux 上 `supported: false`，"ask" 模式不可用，会话一律按 "auto" 运行。界面上 Ask 选项置灰，backend 拒绝切换到 "ask"；已保存的 "ask" 和 `ARGON_PERMISSION_MODE=ask` 都按 "auto" 处理。Windows 的分档方案留到以后。
- 沙箱只在 "ask" 模式下生效。"auto" 模式不进沙箱，与 pi 的默认行为一致。
- `argon-sandbox` inline extension（`backend/src/sandbox.ts`）注册同名 bash 工具，给它加一个 `dangerouslyDisableSandbox` 参数。在 "ask" 模式下，命令通过 sandbox-runtime 的 Seatbelt 包装执行，不再询问。命令失败时会附上违规说明，提示模型可以请求在沙箱外重试；请求在沙箱外运行一律询问，saved rules 不覆盖它，"本会话允许" 只对本会话有效。codemode 的嵌套调用请求在沙箱外运行时也会单独询问，不随父调用放行。
- 文件策略在 `backend/src/sandbox-policy.ts`，按会话的 cwd 单独生成，每次调用都传给 `wrapWithSandbox`；read 类工具和 write / edit 在 `tool_call` 里用同一份策略检查（解析符号链接）。
- 网络代理由 sandbox-runtime 全局持有，未知主机通过 ask 回调发起 `network_access` 交互。请求无法可靠归属到会话：只有一个会话在执行沙箱命令时就问它，否则问最近启动命令的会话并记日志。允许的域名保存在 `ArgonSettings.sandbox.allowedDomains`，设置页可以移除。
- 后端启动时初始化沙箱；失败时 `sandbox.reason` 写明原因，bash 在 "ask" 模式下拒绝执行，不降级。
- 其他扩展提供的执行类工具（例如 `exec`）不在沙箱内，"ask" 模式下仍按其他工具询问。

## D16. 项目设置、MCP 配置与会话置顶

**状态**：设计于 2026-11-27。

**背景**：侧栏的“项目”（`ProjectPrefs`，存 `$ARGON_HOME/projects.json`）和设置页的 “This Project”（当前会话 cwd 下的 `.argon/settings.json`）是两套概念；权限模式、工具预设只能全局设置；MCP 服务器只能手写 mcp.json，面板上的启用/停用直接改文件，影响所有对话。

**决定**：

1. **侧栏项目就是 Argon 的项目。** 设置页的项目范围编辑的是某个侧栏项目，可以从项目右键菜单“项目设置…”直接进入，不依赖当前打开的会话。项目路径用 `canonicalProjectPath` 规范化。
2. **项目设置分两层，按“仓库能不能决定它”划分：**
   - 仓库里的 `<cwd>/.argon/`（可提交、可共享，项目受信任才生效）：pi 设置（`settings.json`）和项目自带的 MCP 服务器定义（`mcp.json`）。
   - backend 机器上的 `$ARGON_HOME/settings.json` 的 `projects[<canonical cwd>]`（私有，不需要信任）：权限模式、工具预设、新对话默认开启哪些 MCP 服务器。仓库不能把自己设成“全部执行”，这与 pi 禁止项目 mcp.json 写 `auth` 是同一个理由。
   - 取值顺序：会话自身 > 项目 > 全局（权限模式仍是 `ARGON_PERMISSION_MODE` 最优先）。设置页的项目范围把两层放在一页，逐项可恢复为全局值，并标明存放位置。
   - 不放进 pi 的 `agent/settings.json`：那是 pi 的文件，结构随 pi 版本变化。
3. **MCP 配置有设置页入口。** 全局 mcp.json 可增删改服务器（stdio：command / args / env / cwd；HTTP：url / headers），也可直接编辑 JSON；项目的 `.argon/mcp.json` 在项目范围里编辑（不能写 `auth`，与 pi 一致）。读写复用 pi 的 `extensions/mcp/config.js`（`loadMcpConfig` / `addMcpServerConfig` / `removeMcpServerConfig` / `updateMcpServerConfig`），像 llama 扩展一样按文件 URL 引入，不加补丁。配置变化后，受影响的已加载会话按 `projects.setTrust` 的方式重新加载（运行中的等本轮结束）。
4. **“默认开启”与“本对话开启”分开。** mcp.json 的 `enabled` 是全局默认，项目可在私有设置里覆盖（`projects[cwd].mcpServers[name]`）。对话里的开关只作用于该对话，存为会话自定义条目 `argon.mcp_servers`（`{ [name]: boolean }`），重新打开时恢复。实现用 `createMcpExtension` 的 SDK 参数：`loadConfig` 在 pi 的默认加载结果上依次叠加项目默认和会话条目；`updateConfig` 对 `enabled` 写会话条目，对 `exposure` 仍写文件。被关闭的服务器在该对话里不启动。改了默认值后，已在对话里手动拨过的服务器保持原样。
   扩展用 `pi.registerMcpServer` 注册的服务器不经过 `loadConfig`，pi 切换它们时也不调用 `updateConfig`。现有补丁因此多加两个选项：`registeredServerConfig(name, config)` 在创建这类服务器时让宿主叠加会话条目和项目默认，`updateRegisteredConfig(entry, patch)` 在切换时通知宿主写会话条目（2026-11-27）。考虑过不打补丁、在会话启动后由 Argon 再发一次“停用”：服务器会先启动再关闭（白起子进程、可能闪出登录提示），还要处理竞态，否决。
5. **会话可以置顶。** 置顶记在 `$ARGON_HOME/session-prefs.json`（与 archived 同处，按置顶时间排序），协议 `sessions.setPinned`，`SessionSummary.pinnedAt`。侧栏顶部单独的 Pinned 分区，置顶的会话不再出现在项目分组里；归档会同时取消置顶，删除会清除记录。

**考虑过的方案**：

- 权限模式等写进仓库 `.argon/`：仓库能放宽自己的权限，否决。
- 对话里的开关直接改 mcp.json（现状）：一个对话的选择影响所有对话。
- 扩展补丁导出 `loadMcpConfig`：按文件 URL 引入即可，不必扩大补丁。

## D17. GPT 用 apply_patch 修改文件

**状态**：设计于 2026-11-28。调研见 [tool-modes-comparison.md](tool-modes-comparison.md)。

**背景**：GPT-5 及以上的模型是用 Codex 的 `apply_patch` 格式训练的，用它改文件比用 pi 的 edit / write 更稳定。pi-codex-conversion 提供的 `apply_patch` 是独立的 Rust 程序，不经过 Argon 的审批预览和沙箱检查。

**决定**：

1. **自己用 TS 实现，作为 inline extension 注册。** 文件是 `backend/src/apply-patch.ts`，解析和四级模糊匹配移植自 opencode 的 `packages/util/src/patch.ts`（MIT），Lark 语法取自 Codex（Apache-2.0）。工具声明 `constrainedSampling: { type: "grammar", variants: { openai_lark } }`，支持语法工具的 provider 会把它作为 grammar 工具发给模型，其他 provider 退回成 JSON 参数 `{ input }`。注册为 `builtin:apply-patch`，标记 `replaceable`：可以用 `-builtin:apply-patch` 关闭，第三方的同名工具会替换它。
2. **两阶段执行。** `planPatch` 先在内存里校验全部文件并算出每个文件改后的内容，然后才写盘；任何一个文件校验失败，就一个文件都不写。审批预览和执行用的是同一个 `planPatch`；执行时会重新计算一遍，因为审批期间文件可能已经变了。
3. **审批和沙箱规则与 edit / write 一致。** "ask" 模式下，补丁涉及的所有路径（包括移动的目标路径）都通过 `SandboxPolicy.canWrite` 才自动放行，否则就询问，审批卡片显示完整的多文件 diff，一次审批。补丁解析不了时直接询问。
4. **协议改成按文件给 diff。** `ToolCallState.diffs`、`tool_diff`、`tool_ended` 和 `tool_approval` 里原来单份的 `diff: string` 都换成 `FileDiff[]`（`{ path, diff }`），`path` 与 `display.files[].path` 对应。`PROTOCOL_VERSION` 升到 2。已保存的会话里旧格式（`details.diff`、`argonNestedDiffs` 的字符串值）仍然能读。
5. **按模型切换，与工具预设并列。** `isGpt5Family`（规则参考 opencode：id 包含 `gpt-`，排除 gpt-4 和 oss）为真且 `ArgonSettings.gptApplyPatch` 打开（默认打开）时，激活 `apply_patch`，停用 edit / write；其他情况反过来，但只恢复由这一步停用的工具。加载会话、切换预设、切换模型、reload、修改设置之后都会重新核对一次；正在运行时就等这一轮结束，所以从下一轮开始生效。

**考虑过的方案**：

- 直接用 pi-codex-conversion 的 Rust `apply_patch`：不经过沙箱，也没有审批预览，否决。
- 接管 provider，由 Argon 发送 custom tool：pi 的 `constrainedSampling` 已经能做到，没必要。

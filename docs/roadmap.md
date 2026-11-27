# 路线图与 TODO

完成一项就勾选，新发现的问题加到对应阶段或"技术债"一节。决策背景见 [decisions.md](decisions.md)。

## 阶段 0：骨架（已完成，提交 acff8c4）

- [x] npm workspaces 单仓：`shared` / `backend` / `web`，TypeScript strict，Biome，Vitest
- [x] Argon 协议：请求/响应、会话事件（带 seq）、全局事件、hello/welcome 握手和协议版本
- [x] `AgentClient` 接口和 WebSocket 实现（自动重连、请求超时、致命错误处理）
- [x] 纯 reducer 加 `SessionMirror`（按 seq 排序应用事件、发现缺口、重连后补齐、后端重启后按路径重新打开会话）
- [x] 后端内嵌 pi SDK：所有会话共用一个 `ModelRuntime`，每个会话一个 `AgentSessionRuntime`，pi 事件统一转成 Argon 事件
- [x] 回放缓冲区、prompt 幂等、`InteractionBroker`（审批和弹窗由后端持有）
- [x] 权限门扩展：只读工具直接放行，其余询问；可选"本会话总是允许"；codemode 嵌套调用随父调用一起审批
- [x] 扩展 UI 桥接：select / confirm / input / editor / notify / setStatus / 纯文本 widget
- [x] WebSocket 安全：只监听 loopback，校验 Host 和 Origin，校验 token
- [x] 前端：会话侧边栏（按项目分组）、新建会话的目录浏览、流式 Markdown、思考折叠、工具卡片、审批卡片、输入框（兼容输入法、steer / follow-up 排队、停止）、模型、思考级别、权限模式切换
- [x] `npm run dev` 一键启动，dev token 持久化
- [x] reducer 单元测试；CLAUDE.md

## 阶段 1：Web 版 MVP 打磨（当前阶段）

### 对话体验

- [x] 图片和附件：粘贴、拖拽、附件按钮。图片随 `prompt.images` 发送（pi 负责缩放）；其他文件经 `files.upload` 存到 backend 的 `$ARGON_HOME/uploads`，以 `@"路径"` 引用。用户消息和工具结果里的图片按需经 `sessions.getImages` 加载，不进 `SessionState`
- [x] 编辑重发和"重新生成"会丢掉原消息里的图片（新分支从原消息的父节点分出，图片随原消息离开模型上下文）：`editMessage` 先取出原消息的图片再随新文字重发；`npm run smoke` 的 "Edit keeps images" 覆盖
- [x] `$ARGON_HOME/uploads` 清理：删除会话时清理不再被任何会话引用的上传目录；每天扫描一次，清理超过 24 小时且未被引用的上传目录。仍被引用的文件不会因时间过久而删除
- [x] 斜杠命令：后端提供命令列表（扩展命令、prompt 模板、技能）和参数补全（`sessions.commands` / `sessions.completeCommand`），输入框里做补全；`/mcp` 直接打开 MCP 面板
- [x] pi TUI 的内置命令在 SDK 的 `prompt()` 里不会被处理：`/compact`、`/name`、`/new` 由 Argon 原生实现，其余在输入框里拦截并提示（`web/src/lib/builtin-commands.ts`，名单对应 pi 1.6.1）
- [x] `@文件` 补全：`sessions.completeFile` 直接复用 pi-tui 的 `CombinedAutocompleteProvider`（fd 搜索、引号、目录续补与 pi 编辑器一致）
- [x] edit / write 工具展示 diff 视图：审批卡片里显示预览（backend 读原文件生成，`diff-preview.ts`），执行后用 edit 返回的 `details.diff`；小 diff 默认展开
- [x] write 的 diff 持久化：独立的 inline extension `argon-write-diff`（`backend/src/write-diff.ts`）在 `tool_result` 里把执行前的预览 diff（审批后重新计算）写进 `details.diff`，重新打开会话后和 edit 一样显示。pi 的工具体系变化时整体删除即可；没有 write 工具、参数结构变了或 pi 自带 diff 时它不做任何事。`npm run smoke` 覆盖
- [x] 消息操作：复制；从某条用户消息开始编辑重发（`sessions.editMessage`，经 `navigateTree` 分支，旧分支保留）；重新生成最后一条回复
- [x] 排队消息的取消和编辑（`sessions.clearQueue`；pi 只能整体清空，所以"编辑"是把全部排队消息撤回输入框）
- [x] 上下文用量指示（占 context window 的百分比），提供手动压缩按钮（`sessions.compact`，后台执行；成功压缩的路径还没在真实长会话上验证）
- [x] 长会话的虚拟滚动（列表虚拟化）：virtua 自动测量行高，浏览器页内查找仅覆盖已渲染的行。
- [x] 错误和自动重试的展示优化；被中止的回合给出明确提示（失败卡片支持重试，自动重试显示次数和原因，中止回合显示标记。）
- [x] 键盘快捷键：新建会话、切换会话、停止、聚焦输入框（支持按键切换会话、在输入框内停止、直接打字聚焦，以及 ? 帮助。）

### 会话管理

- [x] 会话重命名、删除或归档，以及搜索（支持内联重命名、删除文件及侧栏搜索。归档用 `sessions.setArchived`，记在 `$ARGON_HOME/session-prefs.json`，pi 没有归档概念；侧栏底部“已归档”进入单独视图，可取消归档）
- [x] 会话树：分叉（fork）、在分支间导航（`navigateTree`）、克隆（用户消息可分叉并带入草稿，可切换同级分支或复制当前分支。）
- [x] 支持扩展发起的 `newSession` / `fork` / `switchSession`（当前会话收到扩展请求后自动打开目标会话。）
- [x] 自动生成会话标题（首轮结束后由后端生成标题。）
- [x] 项目列表管理：固定、移除、"最近项目"（侧栏支持固定、隐藏和恢复项目，新建会话对话框已有最近项目。）
- [x] 先添加项目再建会话：侧栏“Add project”选目录（`ProjectPrefs.addedAt`，没有会话的项目也列出），项目旁的 + 直接新建会话；“New session”/⌘⇧O 在当前项目新建，当前已是空会话时只聚焦输入框
- [x] 侧栏交互（D16）：会话行悬停时右侧显示归档按钮（归档视图里是删除），原 `...` 菜单改为在鼠标位置弹出的右键菜单；项目标题的菜单也改为右键，增加“项目设置…”；每个项目默认显示 5 条会话，其余收进“显示更多”
- [x] 会话置顶（D16）：右键置顶/取消置顶，侧栏顶部独立的 Pinned 分区（`sessions.setPinned`，记在 `session-prefs.json`）

### 设置与账号

- [x] 设置页：侧栏齿轮或 ⌘/Ctrl+, 打开，分 General / Providers / Permissions / Plugins / Resources。pi settings 只编辑全局一级的常用子集；资源列表（全局 + 当前项目）只读
- [x] 设置页：项目级 settings 编辑（通用页顶部切换“所有项目 / 当前项目”，`settings.updateProject` 在 pi 的文件锁下改写 `<cwd>/.argon/settings.json`，可逐项恢复为全局值；项目未信任时提示设置不生效）；`enabledModels` 编辑器（勾选模型或填写匹配模式），模型选择器优先列出已启用的模型（`models.list { cwd }` 返回 `scoped`），模式里的思考级别（如 `:high`）选模型时一并应用
- [x] Provider 与登录：`auth.*` 协议，登录流程由 backend 持有（`AuthFlows`），任何客户端可应答；设置页里加/换/删 API key、OAuth 登录登出，模型选择器里有“Manage providers…”入口；magpie 社区插件的安装/移除（需二次确认）
- [x] 自定义 provider / 模型：设置页“提供方”可添加兼容 OpenAI / Anthropic / Google 的端点（模板：Ollama、LM Studio、vLLM），填写 Base URL、API 协议、密钥（字面量 / `$ENV` / `!command`）、请求头和模型列表，OpenAI 兼容端点可一键获取模型列表；内置 provider 可设自定义端点（Base URL、请求头）。都写入 `$ARGON_HOME/agent/models.json`（`ModelsConfigStore`：先用临时 ModelRuntime 按 pi 的 schema 校验，再原子写入并 `refresh`；表单只改它管的字段，其余字段保留）。另有“编辑 JSON”直接编辑整个 models.json（带版本号防覆盖）。结构化保存会丢掉文件里的注释
- [ ] 用真实浏览器 OAuth（auth_url 回调、device code）完整走一遍登录；目前只验证了 select 提示和取消
- [x] 权限设置持久化：默认权限模式、"总是允许"的规则（`$ARGON_HOME/settings.json`；bash 规则按命令前缀，含管道/重定向等的命令永远询问），审批卡片上可直接添加，设置页里可删除
- [x] 每个会话的模型、思考级别、权限模式，重新打开会话时恢复（模型和思考级别由 pi 从会话文件恢复，权限模式存为 `argon.permission_mode` 自定义条目；恢复失败时作为 model 诊断显示；`npm run smoke` 覆盖）
- [x] 模型选择器支持输入搜索模型和 provider

### pi 能力接入

- [x] SDK 会话加载内置扩展：MCP、codemode、tool-search 按 CLI 的方式以 `builtin` + `replaceable` 注册（`backend/src/builtin-extensions.ts`），可用 `-builtin:<name>` 关闭；`bindExtensions` 之后（以及扩展触发 reload 后）再上报一次 diagnostics
- [x] MCP 状态面板：连接状态、工具列表、错误信息；重连、启用/禁用、exposure 切换、OAuth 登录/登出（pi 的 MCP 状态是私有的，靠 `patches/` 里的小补丁经 `pi.events` 暴露，见 decisions D9）
- [ ] MCP 面板：用真实 OAuth 服务器走一遍登录（目前只验证了 stdio 服务器和失败状态）
- [x] MCP 配置入口（D16）：设置页 MCP 分区，全局 mcp.json 和项目 `.argon/mcp.json` 的服务器增删改、编辑 JSON，“新对话默认开启”开关（全局写 mcp.json，项目写私有设置）
- [x] 对话级 MCP 开关（D16）：输入框工具栏的 MCP 弹层，开关只作用于当前对话（会话条目 `argon.mcp_servers`），MCP 面板的启用/停用也改为对话级
- [x] 项目设置（D16）：设置页项目范围对应侧栏项目，可从项目菜单进入；权限模式、工具预设、MCP 默认开启存在 `$ARGON_HOME/settings.json` 的 `projects` 里，新会话按 会话 > 项目 > 全局 取值
- [x] 项目信任（project trust）流程：信任未决的项目先按不信任加载，对话区顶部横幅询问（信任 / 信任上级目录 / 仅本次 / 不信任），顶栏盾牌图标可随时更改；`projects.setTrust` 会重新加载受影响的会话（运行中的等本轮结束）。见 decisions D11
- [x] 在 GUI 中展示扩展加载诊断（diagnostics）和扩展错误：`SessionState.diagnostics`，顶栏警告图标显示数量，弹层列出来源、信息和路径
- [x] 更丰富地渲染扩展 widget：`SessionState.widgets` 记录 key、行和位置（输入框上方或下方），组件型 widget 由 backend 以 100 列无头渲染成文本（剥离 ANSI，`requestRender` 时重绘）；`setWorkingMessage` 替换“正在处理”提示

### 质量

- [x] backend 测试：用 fake session 测 `translate.ts` 和 `managed-session.ts` 的事件转换
- [x] `SessionMirror` 测试：缺口、重复事件、重连、后端重启
- [x] 带真实会话的端到端冒烟脚本：`npm run smoke`（自带 backend，默认 openai/gpt-6-luna，可用 `ARGON_SMOKE_MODEL=provider/id` 换模型；覆盖发消息、幂等、bash 审批、sinceSeq 重连、重新打开后设置恢复）。注意：冒烟读取 `ARGON_HOME` 的全部配置，装了改变工具集的包（如 pi-codex-conversion）时 bash 审批一步会失败，可另建只含 `agent/auth.json` 和 `environment.json` 的 `ARGON_HOME` 来跑
- [x] CI：typecheck、test、lint
- [x] i18n（中文 / 英文）：内置简体中文和英文，可在通用设置中即时切换。

## 阶段 2：Electron 桌面壳

建议尽早做第 1 项的冒烟验证，不必等阶段 1 全部完成。

- [x] **打包冒烟**：`packages/desktop`（electron-vite + electron-builder），main 拉起 utilityProcess backend，renderer 复用 web；已产出 macOS arm64 `.app` / DMG。`npm run smoke:desktop` 覆盖 ESM、Codemode / 图像 worker、QuickJS / Photon WASM、jiti 用户 TS 扩展、MCP 子进程及退出清理。backend 和依赖显式 asarUnpack，见 [桌面开发与打包](desktop.md) 和 D14
- [x] 确认 Electron 自带的 Node 版本 ≥ 22.19：Electron 45.5.0 的实际 utilityProcess 为 Node 24.22.3
- [x] backend 基础生命周期：崩溃最多重启三次，复用原端口/token，由前端既有离线提示和 SessionMirror 重连；退出等待 dispose，十秒超时 kill，加应用退出同步兜底。冒烟验证 session_shutdown 和 MCP 清理
- [ ] 桌面异常恢复验证：真实运行中 backend 崩溃、连续启动失败、退出超时；启动失败后的原生错误提示与重试入口
- [x] 传输选型（D6）：本地 WebSocket，系统分配随机端口，main 注入 token；`argon://app` 独立 Origin，保留 Host/Origin/token 校验
- [x] 托盘：macOS / Windows 关闭窗口时隐藏，保留 renderer 和后端任务；提供显示 / 退出菜单（打包冒烟覆盖隐藏与恢复，实机验证待完成）
- [ ] 原生能力：文件夹选择、系统通知（任务完成、等待审批）、全局快捷键、在 Finder / 编辑器中打开
- [x] 窗口标题栏：macOS 隐藏系统标题栏，红绿灯融入侧栏顶行；Windows 使用原生 Window Controls Overlay，按钮融入应用右上角并跟随系统主题；应用顶栏可拖拽，交互控件排除拖拽，Windows 控件区留白
- [ ] 窗口：多窗口；Windows 标题栏覆盖、DPI 缩放和系统贴靠行为实机验证
- [ ] 自动更新、代码签名和公证（macOS / Windows）
- [x] GitHub Actions 自动发版：普通推送和 PR 只运行 CI；推送版本 tag 后通过 CI，再打包 Windows x64 / macOS arm64，通过冒烟后发布 Release，预发布 tag 标记为 prerelease（工作流已配置，待 GitHub 实跑验收）
- [x] 安全：renderer 开启 sandbox + contextIsolation，禁用 Node integration；没有 preload API，外链交给系统浏览器

## 沙箱（权限控制的主要手段）

按命令文本做静态审批无法覆盖 bash 的各种写法（管道、子 shell、eval、脚本文件），安全边界交给操作系统。Codex CLI（Seatbelt / Landlock + seccomp，按沙箱模式和审批策略组合）和 Claude Code（沙箱化的 bash）都是这个思路；pi 的 security.md 也明确把隔离交给容器或沙箱。

- [x] 调研与方案（macOS / Windows）：Codex、Claude Code（sandbox-runtime）、pi 社区扩展，见 [sandbox.md](sandbox.md)；方向见 decisions D15
- [x] `argon-sandbox` inline extension：替换 bash 的 `BashOperations`，在 `tool_call` 里检查文件工具路径；codemode 嵌套调用随之覆盖（Argon 没有 `!` 命令，`user_bash` 暂不涉及）
- [x] macOS：接入 `@anthropic-ai/sandbox-runtime` 0.0.83（Seatbelt + 域名代理），默认读写策略按 D15 第 5 条（含 `$ARGON_HOME` 读保护）
- [x] 非 macOS：Ask 模式置灰，只能用 Run everything（D15 第一版实现）
- [x] 桌面模型冒烟断言工作区内 bash 不询问，并检查实际写入内容；macOS 使用 Ask 模式验证沙箱
- [ ] 沙箱命令卡片显示“沙箱内 / 沙箱外”；设置页手动添加允许的域名
- [ ] Windows：可用性探测和分档（MXC → srt Windows 后端 → 不隔离），首次安装 srt 后端的 UAC 引导，UI 显示当前隔离级别
- [ ] Windows 实机验证：MXC 的系统 build 要求、Git Bash 与 powershell 工具、Schannel 工具（`Invoke-WebRequest`）在沙箱内失败
- [x] 审批改为只在越出沙箱边界时介入（例如需要写工作区外、需要网络）；批准可放开域名（本次 / 本会话 / 全局）或不进沙箱重试
- [ ] 按路径放开写权限（目前写工作区外只能单次批准 write / edit，或让命令在沙箱外运行）
- [x] 沙箱起不来时 fail-closed 并明确提示，不静默降级
- [ ] 已知限制写进用户文档：MCP 服务器和扩展自启的子进程不受约束、domain fronting、Unix socket
- [ ] Linux（bubblewrap + seccomp，sandbox-runtime 已支持）：暂缓

## 阶段 3：远程 agent

协议已按远程设计（D4），本阶段只做传输、部署和多环境 UI。

- [ ] SSH stdio 传输：`ssh host argon-backend --stdio`。backend 的 stdout 已经留空（日志写到 stderr）
- [ ] 常驻 daemon 模式：可配置监听地址、token 管理、TLS 或建议放在 Tailscale 后面
- [ ] 多环境 UI：环境切换和状态指示；项目、会话 id 带上环境作用域；断线后不能悄悄回退到本机
- [ ] 远端运行时的安装、升级和版本兼容检查
- [ ] 按环境区分的设置和凭证
- [ ] 多客户端并发：同一会话的占用、接管、只读旁观
- [ ] 托管纯 web 客户端（浏览器或手机直接访问 daemon）

## 工具预设与工具显示（设计见 decisions D13）

本轮只实现传统模式、codemode、codemode only 三个预设，pi-codex-conversion 的模式只在设计上预留。

- [x] 1. 显示层：协议加 `ToolDisplay` 和 `source`；backend presenter（`backend/src/tool-display.ts`，pi 内置工具名和参数结构只在这里出现）；前端 `web/src/tools/` 按类型划分的渲染器，查找顺序为“来源 + 工具名”覆盖 → 工具名覆盖 → 类型 → 通用；审批卡片使用渲染器的预览
- [x] 2. 嵌套调用：嵌套事件带上父 id、显示描述和来源，`script` 卡片在源码（语法高亮）和输出之间列出子调用，折叠时显示调用次数；嵌套调用仍随父调用审批，但有 diff 预览；pi 不记录嵌套结果，独立的 inline extension `argon-nested-diffs` 把子调用的 diff 存进父结果的 details，重新打开时从 pi 的 `nestedCalls` 记录恢复子调用（输出不可恢复，状态、参数、错误、耗时、diff 可以）
- [x] 3. 预设选择：传统 / Codemode / 仅 Codemode（`backend/src/tool-presets.ts`），设置里选默认，顶栏按会话切换（存为 `argon.tool_preset` 记录，运行中切换则本轮结束后生效）。实现上不用 pi 的配置覆盖（reload 会丢）：用 `setActiveToolsByName` 增减 `codemode` 工具，codemode 的 on/only 通过 Argon 注册扩展时传入的 `mode` getter 每轮读取；加载和 reload 后都会按预设校正
- [ ] ~~4. 审批策略按显示类型~~：不做。权限控制交给沙箱（见下一节），审批维持现有的基本机制（只读工具放行、其余询问、本会话允许、简单的命令前缀规则），不再细化；codemode 的嵌套调用继续随父调用一起审批

后续待办（按优先级）：

- [ ] 预设控制显示偏好（D13 第 4 条）：例如“仅 Codemode”下脚本卡片的子调用默认展开；现在所有预设一样，默认折叠、标题显示“N 次调用”
- [ ] shell 显示退出码：`ToolDisplay` 的 shell 类型加退出码（以及是否后台运行），卡片标题和输出区显示
- [ ] 多文件 diff：`file_change.files` 已支持多个文件，但 diff 仍是单份的 `ToolCallState.diff`，每个文件不能单独带 diff。接 pi-codex-conversion 的 `apply_patch` 时需要
- [ ] 各类型的显示细节（按需）：read 内容语法高亮；search 结果做成列表；MCP 工具标题带上服务器名（可用 `source` 或命名空间）；按需注册第一个“来源 + 工具名”覆盖渲染器
- [ ] pi-codex-conversion 的预设（Structured、Code、TS Notebook、VM Code）：设计上已预留，暂不实现
- 已知限制：重新打开会话后看不到子调用的输出（pi 只记录名字、参数、状态、耗时，不记录结果）；diff 已由 `argon-nested-diffs` 保存

## 阶段 4：对 pi 的深度定制（按需）

按 D7 的优先级处理，先确认官方是否已有等价入口。

- [ ] 重试上一次失败的回合（percho 用补丁实现了 `retryLastFailedTurn`）
- [ ] 判断会话"真正空闲"的可靠接口（percho 补丁中的 `tryAcquireIdleLease`），后台卸载、reload 时需要
- [ ] 子代理（subagent）的可视化
- [ ] Argon 专属工具（customTools）：例如在 GUI 中预览文件、打开浏览器预览

## 技术债与已知问题

- [x] 首次 Release 三平台冒烟在备份空剪贴板时失败：Electron 可返回 `types` 为空的条目，构造 `ClipboardItem` 会报错；备份时过滤空条目，保留复制、读取权限和恢复检查。修复后仍需 GitHub 三平台重验

- [x] 扩展自己注册的 MCP 服务器（`registerMcpServer`，不在 mcp.json 里）在对话里关闭只在本次运行时有效：pi 对 `scope: "extension"` 的条目不调用 `updateConfig`。已在补丁里加 `registeredServerConfig` / `updateRegisteredConfig` 两个选项解决（D16）
- [x] Windows 安装 Magpie 插件报 `spawn npm ENOENT`：根因是 magpie-pi 抽取时去掉了上游的 Bun 下载，改成依赖系统 npm 和 Bun。magpie-pi 0.3.0 改为首次使用时下载钉住的 Bun 1.4.2 并用 `bun add` 安装，backend 已升级；`plugins.change` 请求超时放宽到 10 分钟以容纳首次下载。Linux 端到端已验证，Windows 打包版仍待实机验收安装和运行插件
- [x] Windows 打包版安装社区插件后弹出关不掉的终端窗口：magpie-pi 启动插件 supervisor（控制台程序）时没加 `windowsHide`，而 backend 所在的 utilityProcess 没有控制台，Windows 就给它新建了可见窗口，插件启用期间一直存在。magpie-pi 0.3.3 修复，backend 已升级；仅影响 Windows，尚待实机验证
- [x] backend 的 fetch 不认 `HTTP(S)_PROXY`：SDK 嵌入不经过 pi CLI 的 `configureHttpDispatcher`，`http-proxy.ts` 按 pi 的参数装全局 `EnvHttpProxyAgent`
- [ ] 只认环境变量代理：Windows / macOS 的系统代理设置（不导出环境变量的代理客户端）目前不生效，可在 desktop 里用 `session.resolveProxy` 查到后传给 backend
- [ ] Windows backend 全量测试适配：本机运行发现 models-config 的 POSIX mode 断言、sandbox / uploads-gc 的 symlink 权限、session-prefs 的 ENOTDIR 预期失败，并出现文件替换 rename EPERM 日志；需区分平台语义、权限前提和实际文件替换问题

- [x] 系统设置“常规 → 工具”集中展示默认工具模式和默认沙箱模式，保存后用于新会话

- [x] 递归 grep / find 检查受保护路径的父目录，避免从上层目录搜索绕过凭据读保护

- [x] 桌面消息复制被统一拒绝权限的策略拦截：仅向 Argon 主页面开放 `clipboard-sanitized-write`，继续拒绝读取及子框架权限；桌面冒烟覆盖中文、多行复制和读取拒绝

- [x] 其他客户端（或 API）卸载会话时，正在查看该会话的标签页会退回首页：`SessionMirror` 现在保留已保存会话的状态并标为已卸载，任何操作前先 `reopen`（经 `sessions.open`，强制采用新快照）；会话文件已被删除时才退回首页
- [x] 被拒绝的工具调用在历史回放中显示为 error：拒绝时追加 `argon.tool_blocked` 自定义条目，`projectHistory` 回放为 blocked
- [x] 某些机器上 `os.hostname()` 返回 IP：环境名改用 `scutil --get ComputerName`（macOS）/ `hostnamectl --pretty`（Linux），否则去掉 `.local` 的主机名
- [x] 每次 `sessions.list` 都全量解析会话文件：`SessionIndex` 缓存 pi 的列表，以会话目录的指纹（路径、大小、mtime）判断是否失效，只做 stat 不再逐个解析
- [x] 上传清理无法扫描 pi 会话目录之外的未加载会话：现在也扫描已知项目的 `sessionDir`，以及 Argon 打开过的目录外会话文件（记在 `session-prefs.json`）
- [x] 还没写入文件的新会话，在列表里的 createdAt 用的是当前时间：改用会话头的时间戳
- [x] 任一工具事件都会让所有消息组件重新渲染：按消息比较其工具调用引用，只更新关联行。
- [ ] 后端重启会中断正在运行的任务（目前符合预期）。远程 daemon 阶段需要考虑任务能否恢复
- [x] "本会话总是允许"只保存在内存中：现在写成 `argon.session_allow` 自定义条目，重新打开会话后恢复
- [ ] 虚拟滚动：第一次跳到未测量的区域（拖滚动条到顶、按 Home）会因估算高度停在离目标还有一段的位置。已缓解：按会话缓存各行实测高度（最多 20 个会话，切回时恢复），Home / End 改用 `scrollToIndex`。首次打开长会话时拖滚动条仍可能不准，未在真实长会话上验证
- [ ] 虚拟滚动：曾观察到一次流式输出时上滚后被拉回约 470px，之后 3 次复现未再出现，需要继续留意
- [x] 扩展 `newSession({ withSession })` 回调里发出的通知会丢失：没有客户端订阅时发出的通知暂存（最多 20 条、60 秒内），随第一个客户端拿到的快照（`SessionSnapshot.notifications`）补发一次
- [x] pi 没有导出 `builtin:llama.cpp`：按文件路径从已安装的 pi 包动态导入（`exports` 只限制裸模块名），失败时记警告并跳过。升级 pi 时要确认路径仍然存在
- [x] 扩展调用 `ctx.shutdown()`：CLI 会退出进程，Argon 只卸载该会话（等本轮结束），其他会话不受影响
- [x] 编辑重发后，侧栏标题仍取会话文件里的第一条用户消息（pi `SessionInfo.firstMessage`），而不是当前分支的（已加载会话取当前分支的首条消息，并优先显示自动生成的标题。）
- [x] 后端没启动或连接断开时，只在侧边栏底部显示一个黄点，没有明显的离线提示；断线期间点击发送会一直等到请求超时（主区域显示重连倒计时，离线时禁止发送并保留草稿。）

- [x] 项目信任跳过了 pi 的 `project_trust` 扩展事件：现在按 pi 的顺序先问用户级扩展（`remember` 时保存），GUI 显示由哪个扩展决定（decisions D11）。"仅本次"的决定仍只在内存中，backend 重启后失效，这与 pi 的 session-only 语义一致，作为设计保留
- [x] 诊断只能看不能清除：问题面板可清除扩展和模型问题（`sessions.clearDiagnostics`，加载问题保留到修复为止）；同样的错误合并计数，不再刷满 100 条上限

- [x] Argon 全局配置、凭据、会话和项目配置目录与 pi CLI 隔离（D10）
- [ ] 两个 backend 共用同一个 `ARGON_HOME` 时（例如 `npm run dev` 和 `npm run smoke` 同时跑），启动时会并发安装 settings 里的 pi 包，npm 报 `ENOTEMPTY`。可考虑给包安装加锁，或冒烟默认用独立的 `ARGON_HOME`
- [ ] 已卸载且不是当前查看的会话被删除后，前端 mirror 里仍保留它的旧状态，直到刷新页面（不影响显示，只占内存）

- [x] 外观设置（浅色/深色/跟随系统）只在 web 端生效，Windows 标题栏按钮底色仍跟随系统：desktop 加了只暴露 `argonDesktop.setTheme` 的 preload，main 设置 `nativeTheme.themeSource`，标题栏覆盖随 `updated` 事件重绘；桌面冒烟验证该通道
- [ ] 桌面打包：Windows/Linux 尚未实机验证；当前全部运行时依赖解包，后续缩减体积时需保留 worker、WASM、动态扩展及子进程路径兼容性（D14）

- [x] Windows 桌面基础适配：按平台/架构定位冒烟可执行文件，动态 ESM 导入使用 file URL；fd 补全支持 Windows PATH 与 .exe；Web dev runner 通过 Node 启动 npm JS 入口，避免直接 spawn npm.cmd；NSIS 按用户安装；补充 PowerShell 使用说明和 Windows 打包冒烟 CI
- [x] Windows 桌面冒烟剪贴板换行兼容：读回文本将 CRLF 归一化为 LF 后比较，修复 v0.1.1 发布中复制断言失败；待 Windows CI 复验
- [ ] 桌面主题冒烟存在反馈竞争：直接设置原生深色主题时，前端 system 偏好的媒体查询监听可能将其重置；macOS x64 发布日志已出现，需改用真实主题设置流程并等待同步
- [ ] Windows 验收：运行新增 CI，并实机验证中文/空格路径、Git Bash 工具审批、OAuth 回调、MCP 子进程退出、安装/卸载、托盘点击切换及关机/注销时不阻塞（`session-end`）；Windows CI 尚未在本轮运行

- [x] 社区插件开关：设置 → 插件 里启用/停用，首次启用时下载 Bun（进度、失败 URL、换源重试）；下载源可选 GitHub / npmmirror / npmmirror CDN / 自定义 HTTPS 地址，`ARGON_BUN_MIRROR` 可在 backend 固定；保留 SHA-256 校验。可选用 backend 机器上已安装的兼容 Bun（≥ 1.3.14）而不下载。依赖 magpie-pi 0.3.2（`prepareBun` / `bunReady` / `findBun`）。

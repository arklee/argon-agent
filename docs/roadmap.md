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

- [ ] 图片和附件：支持粘贴和拖拽，以内容上传给后端（不能依赖本地路径），写入 `prompt.images`；工具结果里的图片也要能显示
- [x] 斜杠命令：后端提供命令列表（扩展命令、prompt 模板、技能）和参数补全（`sessions.commands` / `sessions.completeCommand`），输入框里做补全；`/mcp` 直接打开 MCP 面板
- [x] pi TUI 的内置命令在 SDK 的 `prompt()` 里不会被处理：`/compact`、`/name`、`/new` 由 Argon 原生实现，其余在输入框里拦截并提示（`web/src/lib/builtin-commands.ts`，名单对应 pi 1.6.1）
- [ ] `@文件` 补全：后端提供按项目搜索文件的 API
- [x] edit / write 工具展示 diff 视图：审批卡片里显示预览（backend 读原文件生成，`diff-preview.ts`），执行后用 edit 返回的 `details.diff`；小 diff 默认展开
- [ ] write 的 diff 不会持久化（pi 的 write 结果没有 details），重新加载会话后只能看到参数。可以考虑在 `tool_result` 钩子里把预览写进 details
- [ ] 消息操作：复制；从某条消息开始编辑重发（会话树分支）
- [ ] 排队消息的取消和编辑（对应 pi 的 `clear_queue`）
- [x] 上下文用量指示（占 context window 的百分比），提供手动压缩按钮（`sessions.compact`，后台执行；成功压缩的路径还没在真实长会话上验证）
- [ ] 长会话的虚拟滚动（列表虚拟化）
- [ ] 错误和自动重试的展示优化；被中止的回合给出明确提示
- [ ] 键盘快捷键：新建会话、切换会话、停止、聚焦输入框

### 会话管理

- [ ] 会话重命名、删除或归档，以及搜索
- [ ] 会话树：分叉（fork）、在分支间导航（`navigateTree`）、克隆
- [ ] 支持扩展发起的 `newSession` / `fork` / `switchSession`（目前直接返回 cancelled）
- [ ] 自动生成会话标题
- [ ] 项目列表管理：固定、移除、"最近项目"

### 设置与账号

- [ ] 设置页：查看和编辑 pi settings（全局 / 项目两级）
- [ ] Provider 与登录：API key 管理，OAuth / 订阅登录（`ModelRuntime.login` 需要一套交互协议）
- [ ] 权限设置持久化：默认权限模式、"总是允许"的规则（按工具或命令模式）
- [ ] 每个会话的模型、思考级别、权限模式，重新打开会话时恢复

### pi 能力接入

- [x] SDK 会话加载内置扩展：MCP、codemode、tool-search 按 CLI 的方式以 `builtin` + `replaceable` 注册（`backend/src/builtin-extensions.ts`），可用 `-builtin:<name>` 关闭；`bindExtensions` 之后（以及扩展触发 reload 后）再上报一次 diagnostics
- [x] MCP 状态面板：连接状态、工具列表、错误信息；重连、启用/禁用、exposure 切换、OAuth 登录/登出（pi 的 MCP 状态是私有的，靠 `patches/` 里的小补丁经 `pi.events` 暴露，见 decisions D9）
- [ ] MCP 面板：用真实 OAuth 服务器走一遍登录（目前只验证了 stdio 服务器和失败状态）
- [ ] 项目信任（project trust）流程：首次打开项目时询问，确认后才加载项目内的扩展和设置
- [ ] 在 GUI 中展示扩展加载诊断（diagnostics）和扩展错误
- [ ] 更丰富地渲染扩展 widget（目前只显示纯文本）

### 质量

- [ ] backend 测试：用 fake session 测 `translate.ts` 和 `managed-session.ts` 的事件转换
- [ ] `SessionMirror` 测试：缺口、重复事件、重连、后端重启
- [ ] 带真实会话的端到端冒烟脚本（参考第一版手动跑过的 smoke 脚本）
- [ ] CI：typecheck、test、lint
- [ ] i18n（中文 / 英文）

## 阶段 2：Electron 桌面壳

建议尽早做第 1 项的冒烟验证，不必等阶段 1 全部完成。

- [ ] **打包冒烟**：最小的 `packages/desktop`（electron-vite）。main 拉起 utilityProcess 里的 backend，renderer 加载 web 构建产物，打一次正式包，验证 pi 在 asar 中能运行：ESM、worker 文件、photon wasm、jiti 加载用户 TS 扩展、MCP 子进程
- [ ] 确认 Electron 自带的 Node 版本 ≥ 22.19
- [ ] backend 生命周期：崩溃后重启并通知前端；应用退出时等待 `runtime.dispose()` 完成（OAuth 写入、MCP 关闭），并提供同步兜底
- [ ] 传输选型（D6）：先沿用本地 WebSocket（随机端口 + token 由 main 注入）；如有需要，再加 MessagePort 实现的 `AgentClient`
- [ ] 原生能力：文件夹选择、系统通知（任务完成、等待审批）、托盘、全局快捷键、在 Finder / 编辑器中打开
- [ ] 窗口：macOS 红绿灯区域、标题栏拖拽、多窗口
- [ ] 自动更新、代码签名和公证（macOS / Windows）
- [ ] 安全：renderer 开启 sandbox + contextIsolation，preload 只暴露最小接口

## 阶段 3：远程 agent

协议已按远程设计（D4），本阶段只做传输、部署和多环境 UI。

- [ ] SSH stdio 传输：`ssh host argon-backend --stdio`。backend 的 stdout 已经留空（日志写到 stderr）
- [ ] 常驻 daemon 模式：可配置监听地址、token 管理、TLS 或建议放在 Tailscale 后面
- [ ] 多环境 UI：环境切换和状态指示；项目、会话 id 带上环境作用域；断线后不能悄悄回退到本机
- [ ] 远端运行时的安装、升级和版本兼容检查
- [ ] 按环境区分的设置和凭证
- [ ] 多客户端并发：同一会话的占用、接管、只读旁观
- [ ] 托管纯 web 客户端（浏览器或手机直接访问 daemon）

## 阶段 4：对 pi 的深度定制（按需）

按 D7 的优先级处理，先确认官方是否已有等价入口。

- [ ] 重试上一次失败的回合（percho 用补丁实现了 `retryLastFailedTurn`）
- [ ] 判断会话"真正空闲"的可靠接口（percho 补丁中的 `tryAcquireIdleLease`），后台卸载、reload 时需要
- [ ] 子代理（subagent）的可视化
- [ ] Argon 专属工具（customTools）：例如在 GUI 中预览文件、打开浏览器预览

## 技术债与已知问题

- [ ] 被拒绝的工具调用在历史回放中显示为 error，而不是 blocked（blocked 状态没有持久化）
- [ ] 某些机器上 `os.hostname()` 返回 IP，环境名应改用 `scutil --get ComputerName` 等更友好的值
- [ ] 每次 `sessions.list` 都全量扫描 `~/.pi/agent/sessions`，会话多了以后需要加索引或缓存
- [ ] 还没写入文件的新会话，在列表里的 createdAt 用的是当前时间
- [ ] 任一工具事件都会让所有消息组件重新渲染（`tools` 引用变化），长会话时需要优化
- [ ] 后端重启会中断正在运行的任务（目前符合预期）。远程 daemon 阶段需要考虑任务能否恢复
- [ ] "本会话总是允许"只保存在内存中，会话卸载后就丢失
- [ ] pi 没有导出 `builtin:llama.cpp`，Argon 暂未加载（CLI 会加载）
- [ ] 扩展调用 `ctx.shutdown()`（`bindExtensions` 的 `shutdownHandler`）还没接
- [ ] 后端没启动或连接断开时，只在侧边栏底部显示一个黄点，没有明显的离线提示；断线期间点击发送会一直等到请求超时

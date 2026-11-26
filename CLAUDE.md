# Argon

Argon 是基于 pi coding agent（`@earendil-works/pi-coding-agent`）的 GUI agent。它不只是给 pi 套一个图形界面，必要时也会改动 pi 的行为。目标外观对标 ChatGPT / Claude 桌面应用。

- 选型和架构决策的来龙去脉：[docs/decisions.md](docs/decisions.md)。要推翻其中某条决定前，先读对应小节。
- 路线图和 TODO：[docs/roadmap.md](docs/roadmap.md)。完成一项就勾选；发现的新问题记到对应阶段或"技术债"一节。

## 架构

```
packages/shared   协议类型、AgentClient 接口与 WebSocket 实现、SessionMirror、事件 reducer
                  —— 纯 TS，不依赖 Node / Electron / React
packages/backend  纯 Node：内嵌 pi SDK，每个会话对应一个 AgentSessionRuntime，经 WebSocket 提供 Argon 协议
packages/web      React 19 + Vite + Tailwind v4 + shadcn/ui（radix-nova）+ zustand + streamdown
```

规划中的后续阶段（还没开始）：

- `packages/desktop`：Electron 壳。只管窗口和原生能力，并负责拉起 backend（放在 utilityProcess），renderer 直接复用 `packages/web`。
- 远程 backend：经 SSH stdio 或 daemon + WebSocket 连接。协议已按远程来设计，但传输、部署、认证都还没做。

## 必须遵守的边界

以下规则保证本地和远程用的是同一套代码。如有违反，以后要大改。

1. **backend 一律视为远程。** 前端只能通过 `AgentClient` 访问后端。前端不准 import Node 模块，也不准自己做文件 IO。路径对前端来说是不透明字符串，属于 backend 所在机器，只能显示、不能拿来做 IO。需要文件能力就在 backend 加方法（参照 `fs.listDir`）。
2. **协议必须可序列化。** `packages/shared/src/protocol.ts` 里的类型只能用 JSON 能表示的值：不能有函数、class 实例、Date、Buffer。新增方法时：先在 `Methods` 里加类型，再在 `backend/src/server.ts` 的 handler 表里实现。
3. **pi 的类型不出 backend。** pi 的消息和事件统一在 `backend/src/translate.ts` 和 `backend/src/managed-session.ts` 里转换成 Argon 类型。shared 和 web 都不准 import `@earendil-works/*`。pi 升级时只改这两处。
4. **会话状态只有一个来源。** backend 用 `shared/src/reducer.ts` 对自己发出的事件求出权威的 `SessionState`，前端的 `SessionMirror` 对同样的事件跑同一个 reducer。所以 reducer 必须是纯函数且不可变更新（有测试保证）。不要在前端另造一套状态机。
5. **事件带序号，断线可恢复。** 每个会话的事件 `seq` 单调递增，backend 保留一个回放缓冲区。客户端用 `sessions.attach { sinceSeq }` 补发漏掉的事件，缓冲区不够时拿完整快照。backend 重启后 seq 会从头计数，此时 mirror 会按 sessionPath 重新打开会话，并强制采用新快照。
6. **agent 生命周期独立于客户端。** 客户端断开不影响任务继续运行。待决交互（工具审批、扩展弹窗）由 backend 的 `InteractionBroker` 持有，任何客户端重连后都能看到并回答，且只接受第一次回答。
7. **命令幂等。** `sessions.prompt` 必须带客户端生成的 `clientMessageId`，重发不会重复执行。
8. **改 pi 的优先级：** inline extension（例如 `backend/src/permissions.ts`）> SDK 参数 > patch-package > fork。能用扩展解决的，就不要打补丁。

## pi SDK 注意事项（当前钉在 1.6.1）

- 用 `createAgentSessionRuntime`，不要直接用 `createAgentSession`。原因是 `runtime.dispose()` 会发出 `session_shutdown`，MCP 等扩展靠这个事件关闭子进程；单独调用 `session.dispose()` 不会发。
- 先 `subscribe` 再 `bindExtensions`，否则 `session_start` 阶段产生的事件会丢。
- `agent_end` 不代表一轮结束，后面还可能有重试、压缩或续跑。判断结束要以 `agent_settled` 为准。
- UI 里的历史从 `sessionManager.getBranch()` 投影得到（包含压缩之前的条目），不能用 `session.messages`，因为那是模型实际看到的、可能已被压缩的上下文。
- pi 默认不审批任何工具调用。Argon 用 `argon-permissions` inline extension 拦截 `tool_call`：只读工具（read/grep/find/ls）直接放行，其他都要询问。codemode 的嵌套调用（带 `parentToolCallId`）随父调用一起审批。
- 所有会话共用同一个 `ModelRuntime`（由 `SessionRegistry` 创建），它读写 `~/.pi/agent/auth.json`，和 pi CLI 共享登录状态与会话目录。
- `patches/` 里有 patch-package 补丁（`postinstall` 自动应用）：给内置 MCP 扩展加了 `argon:mcp:*` 事件通道，由 `backend/src/mcp-bridge.ts` 使用。改 pi 文件后补丁要手动用 `git diff --no-index` 重新生成（patch-package 自己生成会失败）。
- 升级 pi 时：先看 CHANGELOG，确认补丁还能应用（或官方已提供等价接口，可以删掉补丁），再检查 `translate.ts` / `managed-session.ts` 依赖的事件结构，跑一遍真实会话冒烟（发消息、工具审批、重连）。

## 安全

backend 能执行 shell 命令，所以：默认只监听 127.0.0.1；WebSocket upgrade 时校验 Host（防 DNS rebinding）和 Origin 白名单（`ARGON_ALLOWED_ORIGINS`）；第一帧必须带 token，校验用 timingSafeEqual。这几项检查都不要放宽。日志写 stderr，stdout 留给将来的 stdio 传输。

## 常用命令

```bash
npm run dev          # backend (tsx watch, :7878) + web (vite, :5173)，打印带 token 的链接
npm run typecheck    # 所有包
npm test             # vitest
npm run lint         # biome；npm run format 自动修复
```

环境变量（backend）：`ARGON_HOME`（默认 `~/.argon`）、`ARGON_PORT`、`ARGON_HOST`、`ARGON_TOKEN`、`ARGON_ALLOWED_ORIGINS`、`ARGON_PERMISSION_MODE=ask|auto`、`ARGON_PI_AGENT_DIR`、`ARGON_LOG_LEVEL`。dev token 保存在 `$ARGON_HOME/dev-token`。

## 约定

- TypeScript strict（开了 `noUncheckedIndexedAccess`）；ESM；包之间直接引用 TS 源码（`exports` 指向 `src/index.ts`）。
- Biome 负责格式化和 lint（tab 缩进，行宽 120）。`packages/web/src/components/ui` 是 shadcn 生成的代码，不参与 lint，需要时用 `npx shadcn add` 更新。
- 前端输入框处理 Enter 时必须检查 `isComposing`（中文输入法）。
- 界面文字目前是英文，以后统一做 i18n。

# Argon

基于 [pi coding agent](https://github.com/earendil-works/pi) 的 GUI agent。

```
packages/shared   协议类型、AgentClient、事件 reducer（前后端共用，无 Node/React 依赖）
packages/backend  Node 后端：内嵌 pi SDK，经 WebSocket 提供 Argon 协议
packages/web      React 前端（现在跑在浏览器，以后作为 Electron renderer）
```

## 开发

需要 Node ≥ 22.19。Argon 使用独立的 `~/.argon/agent` 保存配置、登录凭据和会话；首次使用需单独配置模型或登录，不会读取或迁移 pi CLI 数据。项目级配置使用 `.argon/`。设置 `ARGON_HOME` 可迁移整个数据根目录；不再支持 `ARGON_PI_AGENT_DIR`。

```bash
npm install
npm run dev
```

启动后会自动在浏览器里打开 `http://127.0.0.1:5173/#token=...`（链接也会打印在终端里）。不想自动打开：`npm run dev -- --no-open` 或 `ARGON_NO_OPEN=1`。默认用系统默认浏览器，可用 `BROWSER` 指定（WSL 下可以是 Windows 程序路径，如 `BROWSER="/mnt/c/Program Files/Google/Chrome/Application/chrome.exe"`）。

## 文档

- [CLAUDE.md](CLAUDE.md)：架构边界与开发约定
- [docs/decisions.md](docs/decisions.md)：技术选型与架构决策
- [docs/roadmap.md](docs/roadmap.md)：路线图与 TODO

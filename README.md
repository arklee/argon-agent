# Argon

基于 [pi coding agent](https://github.com/earendil-works/pi) 的 GUI agent。

```
packages/shared   协议类型、AgentClient、事件 reducer（前后端共用，无 Node/React 依赖）
packages/backend  Node 后端：内嵌 pi SDK，经 WebSocket 提供 Argon 协议
packages/web      React 前端（现在跑在浏览器，以后作为 Electron renderer）
```

## 开发

需要 Node ≥ 22.19，以及已配置好的 pi（`~/.pi/agent` 里的登录/API key）。

```bash
npm install
npm run dev
```

打开终端里打印的 `http://localhost:5173/#token=...` 链接。

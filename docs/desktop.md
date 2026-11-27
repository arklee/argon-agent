# 桌面开发与打包

桌面壳使用 Electron 45.5.0 + electron-vite 6，renderer 直接构建 `packages/web`，backend 仍是纯 Node 包，在 utilityProcess 中运行。

```bash
npm run dev:desktop       # Electron + 前端热更新
npm run pack:desktop      # 当前平台的应用目录
npm run dist:desktop      # 安装包（macOS DMG / Windows NSIS / Linux AppImage）
npm run smoke:desktop     # 按当前平台 / 架构验证已打包应用
# 可显式传入其他平台的可执行文件路径：
node scripts/desktop-smoke.mjs /absolute/path/to/Argon
# 可选真实模型验证（读取现有 Argon 的 auth.json，复制到临时目录）：
ARGON_SMOKE_MODEL=openai-codex/gpt-6-luna npm run smoke:desktop
```

首次安装需下载 Electron 二进制；如果 npm 的脚本策略跳过了下载，可运行 `node node_modules/electron/install.js`。

## 运行与安全

main 生成每次启动独有的 token，backend 绑定 `127.0.0.1:0`，将系统分配的端口通过父子进程消息回报 main。main 将连接信息放入页面 fragment，web 既有逻辑会将其移入 sessionStorage 并清除地址栏中的值。连接与会话恢复仍全部经过 AgentClient / SessionMirror。

生产页面来自 `argon://app`，这是唯一允许的 WebSocket Origin；开发模式只允许 electron-vite 的 renderer 地址。不允许 `null` Origin，也不放宽 Host 和 token 校验。renderer 开启 sandbox、contextIsolation，禁用 Node integration。preload 只暴露 `window.argonDesktop.setTheme(theme)`，用于让原生界面（Windows 标题栏按钮、macOS 菜单）跟随 web 的外观设置：main 只接受来自本窗口主 frame 的 `system` / `light` / `dark`，并设置 `nativeTheme.themeSource`。不提供其他原生能力；新增桥接前先确认它只是展示提示，否则应走 backend 协议。外部 HTTP(S) 链接交给系统浏览器，不允许页面导航到外部来源。

后端崩溃最多重启三次，复用原端口和 token；web 通过既有离线提示和重连逻辑恢复。正在执行的任务不能恢复。退出时发消息等待 backend 关闭服务并 dispose 会话，十秒后强制终止兜底。应用退出还有同步 kill 兜底。macOS / Windows 关闭窗口时隐藏到托盘，renderer 和后端任务继续运行；托盘退出及 macOS Cmd+Q / Dock 退出仍会真正退出。Linux 关闭最后一个窗口即退出应用。

## 打包布局与验证

desktop 只声明 `@argon/backend` 和 `@argon/shared` 运行时依赖；Vite 编译打包 `@argon/*`，外置所有其他裸导入（含 Node 内置模块和 Electron）。electron-builder 通过 workspace 收集 backend 的传递依赖，不再维护重复的第三方依赖清单。

main 与 renderer 在 app.asar 内。backend 入口、动态 chunk 与 node_modules 显式解包到 app.asar.unpacked，utilityProcess 从真实路径启动。这样 pi 的 ESM 相对引用、图像和 Codemode worker、Photon / QuickJS WASM、jiti 及需要真实 cwd 的子进程保持原有布局。不能把 pi 整体打进一个 JS bundle；缩减解包范围需要重新跑打包冒烟。

冒烟创建独立临时 ARGON_HOME，加载一个用户 TS 扩展、运行 Codemode 和图像 worker、启动 stdio MCP、检查 renderer 没有 Node 权限，并检查 session_shutdown 标记和 MCP PID 已退出。默认不联网调用模型；设置 ARGON_SMOKE_MODEL 后增加真实模型回复及 bash 审批，命令只在临时项目中写入测试文件。OAuth 刷新也只写入临时凭据副本。MCP 测试夹具使用运行测试脚本的 Node；这不代表用户配置的任意外部 MCP 命令都已随应用打包。

2026-11-26 验证：macOS arm64 `.app` / DMG、离线打包冒烟、`openai-codex/gpt-6-luna` 真实回复和 bash 审批均通过；typecheck、178 个测试及 lint 通过（lint 保留既有警告）。

当前只验证 macOS arm64。签名、公证、自动更新、应用图标和 Windows/Linux 实机验证仍待完成。

## Windows（原生桌面）

开发环境安装 Node.js 24 LTS 和 Git for Windows。在 PowerShell 中进入项目目录：

```powershell
npm ci
npm run dev:desktop
```

打包和验证也使用相同命令，不需要 Bash 执行 npm 脚本：

```powershell
npm run dist:desktop
npm run smoke:desktop
# 或只生成应用目录后直接运行：
npm run pack:desktop
& ".\packages\desktop\dist\win-unpacked\Argon.exe"
```

x64 的安装程序位于 `packages/desktop/dist/*.exe`，未安装的应用位于 `win-unpacked/Argon.exe`。NSIS 安装器默认按用户安装，可选择安装目录。ARM64 输出目录为 `win-arm64-unpacked`，尚待验证。最终用户运行安装包无需另外安装 Node.js；使用 pi 的 bash 工具需要 Git for Windows，外部 MCP 命令需要它们各自的运行环境。

Magpie 社区插件不需要用户安装 Node.js、npm 或 Bun：magpie-pi（0.3.0 起）首次安装或启动插件时会下载钉住版本的 Bun（一次性约 25–40 MB，校验 SHA-256），既用来 `bun add` 安装插件，也用来运行插件。backend 启动时按 `HTTP(S)_PROXY` / `NO_PROXY` 设置全局 fetch 代理（与 pi CLI 相同），所以这次下载和模型请求都会走代理。

默认配置目录是 `%USERPROFILE%\.argon`，与 macOS 一样和 pi CLI 隔离。需要自定义位置时在启动前设置环境变量：

```powershell
$env:ARGON_HOME = "D:\Argon Data"
npm run dev:desktop
# 可选真实模型冒烟；模型需已在这个 ARGON_HOME 登录
$env:ARGON_SMOKE_MODEL = "openai-codex/gpt-6-luna"
npm run smoke:desktop
```

pi 会寻找 Git for Windows 提供的 Bash；非默认安装无法自动识别时，可在 Argon 设置中配置 `shellPath`，例如 `C:\Program Files\Git\bin\bash.exe`。不要把 WSL 项目路径直接当作 Windows backend 的项目路径：当前桌面 backend 运行在原生 Windows，WSL/SSH backend 切换仍属于远程阶段。

`.github/workflows/desktop-windows.yml` 在 Windows runner 上生成 NSIS 安装包、运行安全与路径测试以及无凭据的桌面冒烟，再上传安装包。该流程已配置，但本轮工作发生在 macOS，尚未运行 Windows CI 或 Windows 实机验收，因此不能将其视为已经通过。

## 集成窗口按钮

macOS 和 Windows 使用 `titleBarStyle: hidden`，去掉独立系统标题栏。macOS 红黄绿按钮位于侧栏顶行，左侧预留 88px；Windows 用 `titleBarOverlay` 保留系统窗口按钮，颜色跟随系统主题，右侧按 Window Controls Overlay 的安全区留白。窄窗口下工具栏可横向滚动，不进入系统按钮区域。Linux 暂保留标准窗口边框。

main 通过页面查询参数 `windowChrome` 传递纯显示提示，不暴露原生能力。普通浏览器没有该参数，布局保持原样。顶栏使用 CSS 拖拽区域，按钮、链接和输入框标记 no-drag；连接页顶部也保留拖拽带。实现参考 [Electron 自定义标题栏](https://www.electronjs.org/docs/latest/tutorial/custom-title-bar)。

修改窗口创建选项后需重启桌面应用，单独刷新前端不会更新原生窗口配置。macOS 打包冒烟和内容截图已验证，Windows 原生按钮、DPI 与贴靠行为仍需 Windows CI / 实机验收。

### 社区插件与 Bun 下载源

社区插件（magpie）默认关闭，在 设置 → 插件 里启用。插件宿主需要 Bun：第一次启用时，
backend 在**它所在的机器**上下载 Bun（约 30–40 MB），面板显示进度；下载失败会显示失败的 URL，
可以换下载源后重试。关闭后 backend 不启动插件宿主，插件提供的模型也会消失。
如果 backend 机器上已经装了 Bun（在 PATH、`$BUN_INSTALL/bin` 或 `~/.bun/bin` 里找到，且版本为
1.x、不低于 1.3.14），启用时可以选择直接使用它，不必下载。选择不会自动切换：已安装的 Bun 之后被删掉或
降级到不兼容的版本时，面板显示原因，由用户决定改为下载。backend 设置了 `MAGPIE_PI_BUN` 时以它为准。
开关、Bun 来源和下载源保存在 `$ARGON_HOME/plugins.json`。升级前就装过插件的用户没有这个文件，
此时视为已启用。

下载源（面板里选择，或用环境变量 `ARGON_BUN_MIRROR` 在 backend 上固定，后者优先，
面板只显示不可改）：

| 值               | 下载源                                                       |
| ---------------- | ------------------------------------------------------------ |
| `github`（默认） | GitHub 官方 releases                                         |
| `npmmirror`      | npmmirror 二进制镜像入口                                     |
| `npmmirror-cdn`  | npmmirror CDN 直连（与上一项为同一镜像服务，不是独立备用源） |
| 自定义 HTTPS URL | 自建或可信镜像的基础地址                                     |

PowerShell 持久化设置环境变量（设置后彻底退出并重新启动 Argon）：

```powershell
[Environment]::SetEnvironmentVariable("ARGON_BUN_MIRROR", "npmmirror", "User")
```

自定义地址会拼接 `/bun-v1.4.2/<平台文件名>.zip`；不要填写压缩包完整地址。
地址不能包含凭证、query 或 fragment。无自动回退，不会静默访问其他第三方源。
所有来源均使用 magpie-pi 内置的固定 SHA-256 校验，镜像不能替换二进制。
已有缓存或设置了 `MAGPIE_PI_BUN` 时不会重新下载；magpie 升级 Bun 版本后，已启用的用户会在
backend 启动时自动重新下载（同样显示在面板里）。
npmmirror 两个入口已检查 Windows x64 baseline 1.4.2 文件的 HEAD 可访问性，
不代表所有版本和平台均可用，也不代表已验证 Windows 运行。
实现依赖 magpie-pi ≥ 0.3.2 的嵌入接口 `prepareBun` / `bunReady` / `findBun`（`backend/src/magpie-host.ts`）。
Windows 上需要 ≥ 0.3.3：更早的版本启动插件宿主时会弹出一个控制台窗口。

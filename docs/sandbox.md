# 沙箱调研（macOS / Windows）

调研日期：2026-11-26。Linux 暂缓，只在相关处顺带提及。结论和方向见 [decisions.md D15](decisions.md#d15-沙箱方案)。

pi 本身不提供沙箱（`docs/security.md`、`docs/containerization.md`），官方推荐整个进程放进容器 / Docker Sandboxes / OpenShell，或用 Gondolin 扩展把内置工具路由进 QEMU 微虚拟机。这些都不适合作为桌面应用的默认方案，所以重点看 Codex、Claude Code 和 pi 社区扩展的进程级沙箱。

## Codex CLI

沙箱模式（`read-only` / `workspace-write` / `danger-full-access`）和审批策略（`on-request` / `never`，另有 granular 形式）是两个独立维度：沙箱是技术边界，审批决定什么时候停下来问。默认 Auto 预设 = `workspace-write` + `on-request`，越界（写工作区外、联网）时请求批准。沙箱作用于所有派生的命令，不只是内置文件工具。

**macOS：Seatbelt。** `sandbox-exec -p <profile>`，profile 按模式动态生成。

- 默认可写：cwd、临时目录，加上 `sandbox_workspace_write.writable_roots`。
- 可写根内仍只读（递归）：`.git`（目录或文件；`gitdir:` 指向的目标也保护）、存在时的 `.agents`、`.codex`、`.aws`。
- 网络默认关闭。`network_access = true` 全开；`[features.network_proxy]` 开启域名代理：allowlist 优先，精确主机只匹配自己，`*.x` 只匹配子域，`**.x` 匹配主域和子域，deny 永远优先；默认禁止本地 / 私网目标（`allow_local_binding = false`），Unix socket 单独配置。

**Windows：三代方案**（来源：OpenAI 的 [Building a safe, effective sandbox to enable Codex on Windows](https://openai.com/index/building-codex-windows-sandbox/) 和 [Windows sandbox 文档](https://developers.openai.com/codex/windows)）。

放弃过的原生方案：AppContainer（面向单一应用，撑不起 shell / Git / Python / 构建工具这类开放负载）、Windows Sandbox（独立桌面、宿主与访客要桥接，Home 版没有）、MIC 完整性标签（把工作区标成低完整性等于让所有低完整性进程都能写，改变真实工作目录的信任模型）。

1. **Unelevated（无需管理员，现为后备）**
   - 合成 SID `sandbox-write`，在 cwd 和 `writable_roots` 上授予写 / 执行 / 删除，在 `.git`、`.codex`、`.agents` 上显式拒绝写。
   - 命令在 write-restricted token 下运行，restricted SID 为 `Everyone`、logon SID、`sandbox-write`；写操作需要用户本身和 restricted SID 两边都允许。只限制写，不限制读。
   - 网络只是“劝告”：`HTTPS_PROXY` / `ALL_PROXY` / `GIT_HTTPS_PROXY` 指向 `127.0.0.1:9`，`GIT_SSH_COMMAND` 直接失败，PATH 前置 `denybin` 放 ssh / scp 桩。不读环境变量、自己开 socket 的程序都能绕过。
   - 代价：ACL 应用耗时随目录结构增长；在用户真实目录上留下 ACE；改变沙箱语义要重写 ACL，远比重新生成 Seatbelt profile 慢。
   - 防火墙解决不了：Windows 防火墙规则不能匹配 restricted token 里的 SID；按程序路径匹配会命中全局的 `python.exe` 等；按用户匹配就是真实用户。
2. **Elevated（需要一次 UAC，现为后备中的首选）**
   - 安装时创建两个本地用户 `CodexSandboxOffline`（防火墙屏蔽全部出站）和 `CodexSandboxOnline`，凭据用 DPAPI 加密存在沙箱用户读不到的位置；异步给 `C:\Users\<真实用户>`、`C:\Windows`、`Program Files`、`ProgramData` 授读权限。
   - 子进程仍是 write-restricted token（`[Everyone, Logon, Synthetic]`），但主体换成沙箱用户，于是可以按用户做防火墙规则。
   - 进程链：`codex.exe` →（`CreateProcessWithLogonW`）`codex-command-runner.exe`（以沙箱用户运行，读自己的 logon SID，`CreateRestrictedToken`）→（`CreateProcessAsUserW`）命令。真实用户无法直接用沙箱用户登录得到的 token 调 `CreateProcessAsUserW`，所以需要这一跳。提权部分单独放在 `codex-windows-sandbox-setup.exe`，只有它跨 UAC。
3. **MXC（Microsoft Execution Containers，2026-10 上线，现为首选）**
   - 系统原生的执行容器：不需要管理员、不建账户、不加防火墙规则，原生支持网络策略和细粒度文件访问。
   - 要求 Windows 11 24H2 build ≥ 26100.9278 或 25H2 build ≥ 26200.9278（微软仍在分批推送），Codex CLI ≥ 0.162。
   - `[features] prefer_mxc = true`：可用时用 MXC，否则退回 elevated / unelevated；`windows.sandbox = "mxc"` 则在不可用时直接失败。企业可用 `allow_mxc = false` 禁止。桌面版对个人账户默认优先 MXC。
   - 探测命令：`codex -c windows.sandbox=mxc sandbox ... -- cmd.exe /d /c echo MXC_OK`。
   - WSL1 自 0.115 起不再支持。

## Claude Code 与 `@anthropic-ai/sandbox-runtime`（srt）

**产品层面**（[Claude Code sandboxing 文档](https://code.claude.com/docs/en/sandboxing)）：只支持 macOS、Linux、WSL2；原生 Windows 不进沙箱，且默认静默降级（`failIfUnavailable: true` 才会拒绝启动）。

**macOS 机制**：Seatbelt，`sandbox-exec` 加动态生成的 profile，profile 只允许连接本机代理所在端口。

**文件系统**：写默认拒绝，允许 cwd、每用户临时目录和额外目录；读默认允许，按 `denyRead` 排除（`allowRead` 可在 deny 区域内重新放开，越具体越优先）。以下路径即使在可写目录内也始终禁写：`.claude`、`.mcp.json`、shell rc 文件、`.gitconfig`、`.git/hooks`、`.git/config`、`~/.claude.json`。另可通过 `credentials.files` / `credentials.envVars` 屏蔽凭据。

**网络**：沙箱外跑 HTTP / SOCKS 代理，按 `allowedDomains`（默认空）逐个主机名判断，deny 优先。代理拒绝解析到 loopback、link-local 或本机地址的域名（`deniedResolvedAddresses` 可扩充）。不认代理的工具对白名单域名也会失败；UDP / QUIC / ICMP 出不去。

**与审批的关系**：

- 默认沙箱内命令仍走正常审批；auto-allow 模式下沙箱内 bash 自动放行。
- 越界时模型可带 `dangerouslyDisableSandbox` 重试，这一步按权限模式审批；`allowUnsandboxedCommands: false` 可关闭这条路。
- `excludedCommands` 按命令文本匹配后完全不进沙箱（脚本内部调用的不算匹配）。

**已知弱点**：代理只看客户端声明的主机名，不检查 TLS，存在 domain fronting，`github.com` 这类宽泛白名单可被用来外传数据；`allowUnixSockets`（尤其 Docker socket）等于放开整台主机；Docker 不兼容，`enableWeakerNestedSandbox` 显著削弱隔离；`allowAppleEvents` 等于放弃代码执行隔离；通过 `$PATH` 目录或 shell rc 文件可以提权。

**作为库使用**（[anthropics/sandbox-runtime](https://github.com/anthropics/sandbox-runtime)，Apache-2.0，自称 Beta Research Preview，API 和配置格式可能变化）：

```ts
await SandboxManager.initialize(config, askCallback); // askCallback 决定规则未覆盖的主机，不传则拒绝
const wrapped = await SandboxManager.wrapWithSandbox(command); // 返回字符串，以 shell: true 启动
await SandboxManager.reset();
```

另有 `annotateStderrWithSandboxFailures`、`getViolationsForCommand`、`registerCommandNetworkLists`、`updateConfig`。

**Windows 后端（alpha，库里已有，Claude Code 产品尚未启用）**：

- 一次性管理员安装 `npx @anthropic-ai/sandbox-runtime windows-install`（一次 UAC）：创建本地账户 `srt-sandbox` 和用户组，安装 WFP 过滤器；`windows-uninstall` 卸载。安装版本升级（v2 → v3）后要重新安装，否则 `initialize()` 拒绝运行。
- 两跳启动：broker 经 `CreateProcessWithLogonW` 启动 runner（`srt-win.exe`，x64 / arm64 随包附带），runner 在 job object 中以 write-restricted token 启动目标。
- 网络：WFP 在 `ALE_AUTH_CONNECT_V4/V6` 屏蔽 `srt-sandbox` SID 的所有出站连接，只放行本机代理端口 60080–60089；`initialize()` 会探测泄漏，发现就拒绝启动。
- 文件系统：附加 `(OI)(CI)` ACE（allowRead / allowWrite 为 ALLOW，denyRead / denyWrite 为 DENY），`reset()` 时移除；保留的写授权跨会话存在。glob 在 `initialize()` 时展开，之后新出现的匹配不受控。
- 已知缺口：先切换到 anonymous token 再建 socket 的线程不受限；从沙箱 token 派生的 token（deny-only SID）不受限；SMB 共享、WSL 流量、系统解析器 DNS（`getaddrinfo`）不受限；`proxyAuthToken` 出现在 runner 命令行中；单次执行的 allowRead / allowWrite 覆盖会抛错（授权是整个会话的）；共享机器上其他本地用户可能用到保留的授权；Windows 上 `allowLocalBinding` 会放开所有 loopback 端口，且需要 `windows-install --allow-loopback`。
- Schannel 工具（`Invoke-WebRequest`、System32 的 `curl.exe`）在沙箱内会失败。
- 另有实验性的 `windows.backend: 'mxc'`（需要 Node 24+）；MXC 后端下 Git Bash / MSYS2 会崩溃，建议用 cmd 或 PowerShell。

## pi 社区沙箱扩展

[pi.dev](https://pi.dev/packages?name=sandbox) 上名字带 sandbox 的包有 70 多个，真正有人用的只有前两个（月下载量取自 2026-11-26 的 pi.dev 目录）。

| 扩展                                                                       | 月下载 | 平台和机制                                                                                                                                                                                     | 覆盖范围                                                                                                                             | 网络                                     | 审批                                                                                                                              |
| -------------------------------------------------------------------------- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| [pi-sandbox](https://pi.dev/packages/pi-sandbox)（carderne）v0.8.2，MIT    | 10.9K  | macOS（sandbox-exec）、Linux（bwrap），实验性 Termux；基于 srt 的 fork `@carderne/sandbox-runtime`                                                                                             | bash 包装；`!` 命令默认也进沙箱；read / write / edit 在进程内按 allow / deny 列表检查                                                | 域名 allow / deny，或 `network.disabled` | 越界时弹窗：中止 / 本会话 / 本项目 / 全局允许；10 分钟无响应自动中止                                                              |
| [@yuru7/pi-sandbox](https://pi.dev/packages/@yuru7/pi-sandbox) v0.5.0，MIT | 821    | Linux（bwrap，或附带的 landlock-run 后备）、macOS（seatbelt）、Windows（`windows-acl`：WRITE_RESTRICTED token + capability SID ACL + Low 完整性标签，不依赖 MXC，在 Win10 LTSC 2019 上验证过） | bash / powershell 包装；write / edit 有进程内写入围栏；读完全不限制；`!` 命令不进沙箱；Windows 上只有 powershell 受限，bash 直接拒绝 | 不隔离                                   | “先拒绝再升级”：必须先有一次记录在案的拒绝才能请求重试；默认交给审查模型自动判断（`auto-review`），也可设为 `human` / `allow-all` |
| [@nqbao/pi-sandbox](https://pi.dev/packages/@nqbao/pi-sandbox) v0.2.0，MIT | 417    | macOS / Linux                                                                                                                                                                                  | bash 加文件工具                                                                                                                      | 只有开 / 关                              | 无，直接拦截                                                                                                                      |
| [@kky42/pi-sandbox](https://pi.dev/packages/@kky42/pi-sandbox) v1.0.2，MIT | 不详   | README 未说明                                                                                                                                                                                  | 照搬 Codex 的三种模式                                                                                                                | 不详                                     | 不详                                                                                                                              |

**接入方式**（看过前两个的源码）：两者都用 `pi.registerTool` 注册同名 bash 工具，在 `createBashToolDefinition(cwd, { operations })` 里换成沙箱化的 `BashOperations`；carderne 另外接管 `user_bash`（`!` 命令），并在 `tool_call` 里检查文件工具的路径；yuru7 对 powershell 用 `createPowerShellToolDefinition` 做同样的替换。都不需要给 pi 打补丁。

**值得借鉴的细节**：

- carderne：项目级配置只在项目受信任时加载；授权可以写回会话、项目或全局配置。
- yuru7：没有可用 runner 时 fail-closed；非英文 Windows 上错误信息本地化，按英文 stderr 判断拒绝原因的逻辑会失效（隔离本身仍生效）；NTFS 硬链接可以绕过工作区边界；`/tmp` 与宿主共享。

## 未核实

- Codex 的 Seatbelt 基础 profile（`seatbelt_base_policy.sbpl`）没有直接读到，profile 细节未核对。
- 一篇第三方的 Codex Windows 沙箱深度分析（Medium）无法访问。
- MXC 的能力描述大多来自二手报道；版本要求和配置项来自 OpenAI 官方文档。
- carderne 的 README 说代码源自 pi 仓库里的一个 sandbox 示例，但在 pi 当前仓库和本机 pi 1.6.1 的 examples 里都没找到。

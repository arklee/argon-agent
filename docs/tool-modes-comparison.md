# 工具模式对比计划

**状态**：计划（2026-11-28），尚未开始对比。结论出来后更新 decisions D13，并决定 Argon 的工具预设。

**目的**：Argon 定位为通用 agent，同时对 GPT 单独优化。在实现新预设之前，先系统对比 pi 现有模式和 pi-codex-conversion（下称 PCC）的模式，弄清各自的提示词设计、工具框架、引擎实现，以及对模型行为的影响。不照搬实现，只借鉴做法。

## 对比对象

| 对象 | 说明 | 主要资料 |
|---|---|---|
| pi 传统模式 | read / bash / edit / write 等分开的工具 | pi `dist/core/system-prompt.js`、各内置工具定义 |
| pi codemode（`on` / `only`） | 一个 `codemode` 工具，QuickJS 里写 JS 调用其他工具 | pi `docs/codemode.md`、`docs/settings.md` |
| PCC Structured | `exec_command`、`write_stdin`、`apply_patch`、`view_image` 直接作为顶层工具 | PCC `src/tools/exec`、`src/tools/apply-patch`、`src/adapter/activation/tool-set.ts` |
| PCC Code | `exec` + `wait`，每个 cell 是全新 JS 环境，运行时为 openai/codex 的 code-mode host | PCC `src/tools/code-mode` |
| PCC VM Code | `exec` + `wait`，会话内保留绑定，有内存上限 | PCC `src/tools/vm-mode` |
| PCC TS Notebook | `exec` + `wait` + `notebook`，持久 TS 笔记本，执行前 tsrs 类型检查 | PCC `src/tools/ts-mode` |
| Codex 官方 CLI | 行为基准，不接入 | openai/codex 仓库 |

PCC 源码可以看本机安装的 `~/.pi/agent/npm/node_modules/@howaboua/pi-codex-conversion`（5.1.2），或 [howaboua-pi-stuff](https://github.com/IgorWarzocha/howaboua-pi-stuff) 仓库的 `packages/pi-codex-conversion`。

## 对比维度

### A. 提示词设计

- 系统提示结构与按模型家族的差异：pi 默认提示、PCC Heavy system prompt overwrite 开 / 关（`src/prompt/`、`src/adapter/prompt/`）、Codex 官方 prompt
- 工具描述与使用指引的写法，各模式给模型的"怎么用工具"说明
- 工具声明如何进入提示：顶层 schema、codemode 描述内联（pi 有 3000 token 预算，`codemode.inlineBudget`）、deferred 暴露、按需 help 调用
- 提示稳定性与缓存：MCP 连接中、切换模式、工具增减时前缀是否变化

### B. 工具框架

- 调用形式：JSON 函数、grammar freeform（`constrainedSampling`）、原始 JS / TS 源码
- 嵌套调用语义：返回值形状、错误如何抛出、`Promise.allSettled`、取消、超时后的行为
- 工具发现：`searchTools` / `describeTool` / `describeNamespace` / `ALL_TOOLS`、PCC 的 help 调用
- 结果形态：截断策略、完整输出落盘、图片、结构化结果（如 bash 的 `output` / `exit_code`）
- 状态：`store` / `load`、跨 cell 保留绑定、checkpoint；会话分支、恢复、压缩后的表现
- shell 会话：前台 / 后台 / 交互式，后台完成通知（PCC 的唤醒机制）
- MCP 和其他扩展工具的暴露方式

### C. 引擎实现

- 运行时：QuickJS（pi）、codex code-mode host（下载）、Node worker / Bun 子进程（VM Code）、tsrs（TS Notebook）
- 隔离强度、内存与超时上限、取消方式、并发
- 首次启动成本：下载内容、体积、离线可用性
- 平台支持：macOS / Linux / Windows，Node 与 Bun 的差异

### D. 对 LLM 行为的影响

- 每个任务的轮数、工具调用次数
- 输入 token（schema、描述）、输出 token（脚本、结果）、缓存命中率
- 编辑正确率、出错后的自我恢复
- 并行程度；是否把简单的事也写成脚本（过度脚本化）
- 模型家族差异：GPT（Luna / Sol）、Claude、一个开源模型

### E. 接入 Argon 的成本

- 审批：嵌套调用随父调用审批（D13 第 7 条）
- 沙箱覆盖：PCC 的 `exec_command` / `apply_patch` 是独立 Rust 程序，不经过 `argon-sandbox`（只替换了 pi 的 bash），需要单独处理（D15）
- 显示：`script` 卡片与子调用、多文件 diff、shell 退出码
- 协议与 reducer 是否要改；远程 backend 下是否可用（D4）
- 与上下文压缩的相互影响

## 步骤

1. **读源码整理 A–C**：每个对象一列，填对比表；摘录关键提示词原文（注明出处和许可）。
2. **准备任务集**（8–10 个，固定仓库和起始状态）：
   - 多文件重构
   - 大仓库中搜索并汇总
   - 跑测试、定位并修复失败
   - 启动长时间运行的进程（dev server）并与之交互
   - 调用 MCP 工具
   - 读取 / 处理图片
   - 产生大量输出的命令（日志、构建）
   - 需要多步依赖调用的数据处理
3. **跑实验测 D**：用 `ARGON_SMOKE_MODEL=provider/id` 或 pi 会话文件记录；指标为轮数、调用数、token、缓存命中、成功率、耗时。PCC 仓库有 `bench:code-modes`（`scripts/bench-code-modes.ts`），可参考或复用。
4. **评估 E**，形成结论：写回本文件，更新 decisions D13，决定 Argon 要实现哪些预设、默认用哪个、是否按模型家族切换。

## 已知的相关结论（来自前期调研）

- `apply_patch` 不需要接管 provider：pi 1.6.1 的工具定义支持 `constrainedSampling: { type: "grammar", variants: { openai_lark } }`，GPT 能拿到原生 grammar 工具。实现上倾向 TS 版本，不引入 Rust 程序：解析和匹配参考 opencode 的 `packages/util/src/patch.ts`（MIT，约 380 行），流程参考 opencode 的 `packages/core/src/tool/plugin/patch.ts`（先在内存里校验全部文件并算出多文件 diff，一次审批后再写盘，校验失败不写任何文件）；按模型切换 edit/write 与 apply_patch 的规则参考 opencode 的 `tool/model-policy.ts`。[pi-apply-patch](https://github.com/code-yeongyu/pi-apply-patch)（MIT）可作为 pi 扩展写法的参考。写路径要走与 edit/write 相同的沙箱检查。
- 上下文压缩候选：[@narumitw/pi-codex-compact](https://www.npmjs.com/package/@narumitw/pi-codex-compact)，只用 pi 公开扩展接口，不替换 provider。其 `docs/codex-compaction-mechanism.md` 可作为研究资料。
- pi 已有图片模型接口（`ctx.modelRegistry.generateImages()`、codemode 的 `models.generateImages`），图片生成可考虑注册进这个接口，而不是单独加工具。

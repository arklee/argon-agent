# vendor

第三方代码的"部分引入"（决定见 [D18](../../../docs/decisions.md)）：只取用到的文件，允许小改动，用三方合并跟随上游。

每个子目录是一份 vendor：

- `vendor.json`：来源（`npm:<包名>` 或 `github:<owner>/<repo>`）、当前基线版本（npm 版本号或 commit）、`files`（本地路径 → 上游路径）、`notes`（删了什么、改了什么、为什么）
- `LICENSE`：上游许可证原样
- `src/`：上游文件，已含 Argon 的改动；不参与 Biome 格式化，保持上游风格，方便合并
- 不在 `files` 里的文件归 Argon 自己维护（例如 `effect-lite.ts` 这类替身），同步时不动

改动原则：越少越好，能放到 Argon 自己的文件里就不要改上游文件；必须改的行加 `// Argon:` 注释说明。

```bash
npm run vendor -- check                 # 哪些 vendor 有新版本
npm run vendor -- diff <name>           # 我们相对基线改了什么
npm run vendor -- sync <name> [版本]    # 三方合并到新版本（默认最新）；有冲突会留下标记并以非零退出
npm run vendor -- add <name> <source> <版本|latest> <本地=上游 | 路径>...   # 引入新的 vendor
```

同步后跑 `npm run typecheck && npm test`。

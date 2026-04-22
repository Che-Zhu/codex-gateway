# Todo

这个文件记录 Codex app-server 已支持、但当前 gateway 还没有暴露的高价值能力。

## P0

### Thread history and resume

Status: initial implementation landed.

Detail: [`docs/todo-p0.md`](todo-p0.md)

App-server methods:

- `thread/list`
- `thread/read`
- `thread/resume`

Why:

- 支持刷新页面后恢复会话。
- 支持历史会话列表。
- 支持读取完整 thread 历史。

Implemented:

- `GET /api/threads`
- `GET /api/threads/:threadId`
- `POST /api/sessions` 支持 `resumeThreadId`
- `POST /api/sessions/:id/thread/resume`
- 内置 Web UI 会保存 `sessionId` 和 `threadId`，刷新后先复用 session，失败后恢复 thread。

Remaining gap:

- Gateway session 仍然只存在内存里，进程重启后需要依赖 app-server thread 历史恢复。
- 历史列表 UI 仍是最小实现，还没有搜索、归档、命名等完整会话管理能力。

## P1

### Steer active turn

App-server method:

- `turn/steer`

Why:

- AI 正在回复时，用户可以追加指令。
- 适合“换个方向”“简短一点”“不要改文件”等场景。

Current gap:

- Gateway 只支持 `turn/start` 和 `turn/interrupt`。
- 不支持对 active turn 追加输入。

### Fork thread

App-server method:

- `thread/fork`

Why:

- 允许用户从当前上下文分叉，尝试另一个方案。
- 原 thread 不被破坏。

Current gap:

- Gateway 当前只能新开空 thread。
- 不支持从已有 thread fork。

### Rollback turns

App-server method:

- `thread/rollback`

Why:

- 用户可以撤销最近 N 个 turns。
- 比新开 thread 更适合修正跑偏的上下文。

Current gap:

- Gateway 没有上下文级撤销能力。

### Review current work

App-server method:

- `review/start`

Why:

- 可以封装成 “Review current changes”。
- 适合本地变更或 PR 前自检。

Current gap:

- Gateway 没有 review API。

## P2

### Thread naming and archive

App-server methods:

- `thread/name/set`
- `thread/archive`
- `thread/unarchive`

Why:

- 历史会话列表需要标题。
- 用户需要归档和恢复旧 thread。

Current gap:

- Gateway 没有 thread 名称、归档、恢复归档 API。

### Compact long thread

App-server method:

- `thread/compact/start`

Why:

- 长会话需要压缩上下文。
- 有助于控制上下文长度和成本。

Current gap:

- Gateway 没有手动 compact API。

## P3

### Command execution API

App-server methods:

- `command/exec`
- `command/exec/write`
- `command/exec/resize`
- `command/exec/terminate`

Why:

- 可以在 Web UI 中运行测试、查看命令输出、管理终端。

Risk:

- 安全边界复杂。
- 需要鉴权、审计、权限策略和沙箱策略。

Current gap:

- Gateway 没有独立命令执行 API。

### Filesystem API

App-server methods:

- `fs/readFile`
- `fs/writeFile`
- `fs/readDirectory`
- `fs/getMetadata`
- `fs/createDirectory`
- `fs/remove`
- `fs/copy`

Why:

- 可以做 Web IDE 文件浏览和编辑。

Risk:

- 对公网暴露风险高。
- 需要严格的路径、权限和审计设计。

Current gap:

- Gateway 没有文件系统 API。

## Capability discovery

这些能力适合后续做控制台或设置页时再接：

- `skills/list`
- `plugin/list`
- `plugin/read`
- `plugin/install`
- `plugin/uninstall`
- `app/list`
- `mcpServerStatus/list`
- `mcpServer/resource/read`
- `mcpServer/oauth/login`
- `config/mcpServer/reload`
- `config/read`
- `config/value/write`
- `config/batchWrite`
- `experimentalFeature/list`
- `collaborationMode/list`

## Notes

- `turn/interrupt` 已经通过 `POST /api/sessions/:id/turn/interrupt` 暴露。
- `command/exec` 和 `fs/*` 很强，但不建议第一批直接对公网开放。
- 上述能力来源于 Codex app-server API overview 和本机 `codex app-server generate-ts` 生成的协议类型。

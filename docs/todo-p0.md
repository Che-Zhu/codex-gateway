# P0: Thread history and resume

本文档展开 `docs/todo.md` 里的 P0：让用户刷新页面后能回到原来的会话，并能查看、读取、恢复历史 thread。

当前状态：初版已实现。Gateway 已暴露 thread list/read/resume API，`POST /api/sessions` 已支持 `resumeThreadId`，内置 Web UI 已支持刷新恢复和轻量历史列表。

## 背景

当前 gateway 已经是多 session 架构：

- 一个 gateway session 对应一个 `CodexAppServerBridge`
- 一个 bridge 会启动并持有一个 `codex app-server` 子进程
- 当前 thread、transcript、turn 状态都保存在这个 session 对应的内存状态里
- 浏览器 demo 打开页面时会自动 `POST /api/sessions` 创建新 session
- 页面关闭或刷新时，demo 会尽量 `DELETE /api/sessions/:id`

这意味着当前 demo 的行为是：刷新页面后，用户基本会进入一个全新的 session，旧 thread 不会自动回到页面。

## 目标

P0 要解决的是会话连续性，而不是泛泛的持久化。

核心目标：

- 页面刷新后可以恢复到刷新前的工作上下文
- 用户可以看到历史 thread 列表
- 用户可以打开某个历史 thread 并读取完整历史
- 用户可以基于历史 thread 继续发送新的 turn

非目标：

- 不在 P0 里做 approval UI
- 不在 P0 里做 fork、rollback、archive、rename
- 不在 P0 里做 Web IDE 文件浏览或命令执行 API
- 不要求 gateway 自己持久化完整 transcript，优先复用 app-server 已有 thread 能力

## 当前缺口

### 1. Gateway session 只存在内存里

`SessionManager` 目前用内存 `HashMap<String, Arc<Session>>` 管理 session。

影响：

- gateway 进程重启后，所有 gateway session 都会消失
- session 过期后，旧 session id 不能再使用
- 页面刷新如果没有复用旧 session id，就会创建新 session

### 2. 前端 demo 不保存 session id

`public/app.js` 当前初始化时总是创建新 session：

```js
await createSession();
connectEvents();
```

影响：

- 页面刷新后不会尝试复用旧 session
- 即使后端旧 session 还没有过期，前端也不会重新连接它

### 3. 前端 demo 在 pagehide 时删除 session

当前 demo 会在 `pagehide` 时尽量删除当前 session。

影响：

- 正常刷新或关闭标签页时，旧 session 很可能被主动关闭
- 这和“刷新恢复”目标冲突

### 4. Gateway 没有暴露 app-server 的 thread 历史能力

app-server 已有这些能力：

- `thread/list`
- `thread/read`
- `thread/resume`

初版实现前，gateway 只暴露：

- `thread/start`
- `turn/start`
- `turn/interrupt`

影响：

- 前端无法列出历史 thread
- 前端无法读取某个 thread 的完整消息
- 前端无法恢复一个已有 thread 继续对话

## 设计原则

### Session 和 thread 要分清楚

Gateway session 是 gateway 的运行时连接和资源边界。

它包含：

- 一个 app-server 子进程
- SSE 订阅能力
- 当前 bridge 状态
- session TTL

Codex thread 是 app-server 里的对话上下文。

它包含：

- 对话历史
- turn 历史
- 工作目录和模型等 thread 相关信息
- 可被 app-server list/read/resume 的持久记录

P0 不应该把这两个概念混成一个东西。刷新恢复可以分两层做：

1. 如果旧 gateway session 还活着，优先复用旧 session。
2. 如果旧 gateway session 已经没了，但 app-server 还能找到旧 thread，则创建新 gateway session 并 resume 旧 thread。

### Gateway 优先做薄封装

thread 历史的事实来源应该是 app-server。

Gateway 不应该在 P0 里重新设计一套 transcript 数据库。除非 app-server 返回的数据不足以支持 UI，再考虑补充极小的 gateway metadata。

### P0 先覆盖刷新恢复，不追求完整产品化会话管理

P0 的完成标准是用户不再因为刷新页面丢上下文。

更完整的能力，例如 thread 命名、归档、fork、rollback，可以放在 P1/P2。

## 建议 API

### GET /api/threads

列出 app-server 可见的历史 thread。

内部调用：

```text
thread/list
```

建议响应：

```json
{
  "ok": true,
  "threads": [
    {
      "id": "thread-id",
      "title": "optional title",
      "cwd": "/workspace",
      "model": "gpt-5.4",
      "createdAt": "2026-04-15T01:00:00Z",
      "updatedAt": "2026-04-15T01:05:00Z"
    }
  ]
}
```

说明：

- 字段以 app-server 实际返回为准
- gateway 可以先透传 `raw`，再逐步稳定成前端需要的结构
- 这个接口不绑定某个 gateway session，因为它查询的是 app-server 的历史 thread 能力

### GET /api/threads/:threadId

读取指定 thread 的完整历史。

内部调用：

```text
thread/read
```

建议响应：

```json
{
  "ok": true,
  "threadId": "thread-id",
  "thread": {},
  "items": []
}
```

说明：

- `thread` 保存 thread metadata
- `items` 保存 app-server 返回的历史消息、turn、工具事件等
- 前端可以用这个接口渲染历史详情

### POST /api/sessions

保留当前创建新 session 的能力，但建议扩展请求体：

```json
{
  "model": "gpt-5.4",
  "resumeThreadId": "thread-id"
}
```

行为：

- 如果没有 `resumeThreadId`，保持现有逻辑：启动新 bridge 和新 thread
- 如果传了 `resumeThreadId`，启动 bridge 后调用 `thread/resume`
- resume 成功后，session 的 `state.threadId` 应该等于这个 thread id
- resume 成功后，session 的 `state.transcript` 应该尽量根据 thread 历史重建

### POST /api/sessions/:id/thread/resume

在现有 session 内切换到一个历史 thread。

内部调用：

```text
thread/resume
```

请求：

```json
{
  "threadId": "thread-id"
}
```

响应：

```json
{
  "ok": true,
  "sessionId": "session-id",
  "session": {},
  "state": {}
}
```

说明：

- 当前 session 如果有 active turn，应返回 `409`
- resume 成功后，后续 `POST /api/sessions/:id/turn` 应继续写入恢复后的 thread
- resume 成功后，gateway 应通过 SSE 发送新的 `state`

## 前端行为

### 刷新恢复

建议前端保存最近使用的 session 和 thread：

```text
localStorage.codexGatewaySessionId
localStorage.codexGatewayThreadId
```

页面加载时：

1. 如果本地有 `sessionId`，先调用 `GET /api/sessions/:id/state`
2. 如果 session 存在，继续连接 `/api/sessions/:id/events`
3. 如果 session 不存在，但本地有 `threadId`，调用 `POST /api/sessions` 并传 `resumeThreadId`
4. 如果两者都没有或恢复失败，则创建新 session

页面刷新时：

- 不应在普通刷新场景主动删除 session
- 可以只关闭 SSE，让后端 TTL 负责清理闲置 session
- 明确点击 “End session” 或类似动作时，再调用 `DELETE /api/sessions/:id`

### 历史列表

UI 可以新增一个轻量历史入口：

- 打开时调用 `GET /api/threads`
- 点击某个 thread 后调用 `GET /api/threads/:threadId` 预览历史
- 选择继续时调用 `POST /api/sessions/:id/thread/resume`

P0 的历史列表只需要可用，不要求命名、归档、搜索。

## 后端实现建议

### Bridge

新增方法：

- `list_threads()`
- `read_thread(thread_id)`
- `resume_thread(thread_id)`

这些方法都应该通过现有 JSON-RPC `request` 机制调用 app-server。

resume 成功后需要更新 bridge state：

- `thread_id`
- `thread_status`
- `current_turn_id`
- `active_turn`
- `last_turn_status`
- `transcript`

其中 `transcript` 可以先做最小映射：只提取用户和 assistant 文本消息。工具调用、文件变化、命令输出等复杂 item 可以后续再完善。

### SessionManager

新增方法：

- `resume_thread(session_id, thread_id)`
- 可选：`create_session_with_resume(model, thread_id)`

注意：

- resume 前检查 active turn
- resume 成功后刷新 TTL
- session 仍然是内存对象，不需要 P0 里持久化 session manager

### HTTP routes

新增路由：

- `GET /api/threads`
- `GET /api/threads/:threadId`
- `POST /api/sessions/:id/thread/resume`

可选扩展：

- `POST /api/sessions` 支持 `resumeThreadId`

### SSE

resume 成功后，现有 `state` 事件就够用。

不需要新增专门的 SSE event，除非前端需要区分“新建 thread”和“恢复 thread”。

## 错误语义

建议错误码：

- `400`：缺少或非法 `threadId`
- `404`：thread 不存在，或 session 不存在
- `409`：当前 session 有 active turn，不能 resume
- `500`：app-server thread/list、thread/read、thread/resume 调用失败

建议错误信息保持可读，例如：

```json
{
  "ok": false,
  "error": "Cannot resume thread while a turn is active"
}
```

## 验收标准

### 刷新恢复

- 用户打开 demo，发送一条 prompt，等待 assistant 回复
- 用户刷新页面
- 页面重新打开后仍显示原 thread id
- 页面重新打开后能看到刷新前的 transcript
- 用户继续发送 prompt，新的 turn 接在原 thread 后面

### session 兜底

- 用户打开 demo，发送一条 prompt
- 手动让原 gateway session 失效或删除
- 刷新页面
- 前端能基于保存的 thread id 创建新 session 并 resume

### 历史读取

- `GET /api/threads` 能返回历史 thread 列表
- `GET /api/threads/:threadId` 能返回指定 thread 的历史内容
- 历史列表点击某个 thread 后，可以恢复并继续对话

### 回归

- 不带 `resumeThreadId` 创建 session 时，现有 demo 行为仍可工作
- `POST /api/sessions/:id/thread/new` 仍能开启新 thread
- active turn 期间 resume 返回 `409`
- SSE 断线重连仍能拿到当前 state

## 推荐实施顺序

1. 后端 bridge 增加 `thread/list`、`thread/read`、`thread/resume` 封装
2. HTTP 暴露 `GET /api/threads` 和 `GET /api/threads/:threadId`
3. HTTP 暴露 `POST /api/sessions/:id/thread/resume`
4. 扩展 `POST /api/sessions` 支持 `resumeThreadId`
5. 前端保存 `sessionId` 和 `threadId`
6. 前端刷新时先复用 session，失败后 resume thread
7. 前端去掉刷新时自动删除 session 的行为，改成显式结束
8. 补充 API 文档和集成说明

## Open questions

- `thread/list` 返回是否已经包含 title、cwd、model、createdAt、updatedAt？
- `thread/read` 返回的 item schema 是否能稳定映射到当前 `TranscriptEntry`？
- `thread/resume` 是否要求传 cwd/model，还是只需要 thread id？
- 不同用户之间的 thread 历史如何隔离？当前 JWT 只做访问控制，还没有 thread owner 语义。
- 如果 gateway 运行在容器或多副本环境，app-server 的 thread 存储路径是否共享？

这些问题不阻塞 P0 设计，但实现前需要用本机 `codex app-server generate-ts` 或实际请求确认 app-server 协议细节。

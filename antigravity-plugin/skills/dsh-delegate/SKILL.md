---
name: dsh-delegate
description: Delegate execution work to DeepSeek Flash running inside DeepSeek Harness. Use when a task is mostly mechanical (bulk edits, running tests, research sweeps, file reading, scaffolding) and the user already has DeepSeek Harness running locally.
---

# Delegating to DeepSeek Flash (DSH bridge)

The `dsh_*` tools run real DeepSeek Harness sessions on this machine. **The user can watch every task live in the DSH window** (it appears as a normal conversation under its own workspace), and can approve or interrupt it there.

## When to delegate

- Bulk or mechanical work: many-file edits, scaffolding, repetitive refactors, running test suites, format conversions.
- Research sweeps that read lots of files or pages before anything can be decided.
- Anything where the answer is "go do this and report back", not "decide what we value".

Keep for yourself: intent, design, taste, naming, final review, and the conversation with the user.

## Task brief (write it once, make it self-contained)

```
【目标】what must be true when done
【范围】files/dirs to touch; what NOT to touch
【要求】constraints, style samples, interfaces
【完成标准】how we verify: tests, commands, artifact paths
```

`cwd` **must be an absolute path** — workspace, another drive, or a cloud-synced folder all work. If the source material lives in Google Docs/Drive, export it to disk first and pass that path.

## Flow

1. `dsh_start(cwd, prompt, title)` → returns `{ sessionId }` immediately.
2. `dsh_wait(sessionId, timeoutSeconds)`:
   - Returns immediately if finished or entered `waiting-approval`.
   - If `state === 'waiting-approval'`, inform the user to click approve in the DSH desktop window, then call `dsh_wait` again to continue.
3. `dsh_result(sessionId)` returns the final text, `filesChanged` array, and `tokenUsage` stats.
4. Follow-ups: `dsh_send(sessionId, message)` keeps the same context (cheaper than starting over).
5. Stop early: `dsh_cancel(sessionId)`.

## Rules

- One session per coherent task; do not fan out more than 3 at once.
- Always tell the user which session to watch in DSH (title + workspace).
- Treat the returned text as evidence, not truth: check files/tests yourself before reporting success.
- If the bridge is unreachable the tool returns `DSH bridge is not running` — ask the user to start DeepSeek Harness with the bridge plugin enabled.

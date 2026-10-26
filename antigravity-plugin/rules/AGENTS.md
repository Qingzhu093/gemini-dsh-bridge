# Delegation to DeepSeek Flash

When the user's local DeepSeek Harness bridge is available (tools `dsh_start`, `dsh_status`, `dsh_wait`, `dsh_send`, `dsh_cancel`, `dsh_result`):

- Prefer delegating **mechanical** work (bulk edits, test runs, long research sweeps, scaffolding) to DeepSeek Flash instead of doing it inline. Keep design, taste, naming and final review for yourself.
- Every delegation needs an **absolute** `cwd` and a self-contained brief; one session per coherent task; at most three sessions running at once.
- Tell the user the **session title** so they can watch the work live in DeepSeek Harness.
- Trust evidence, not claims: check the files, diff, or test output before reporting success.

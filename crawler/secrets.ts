/** Key-shaped strings. Word-boundary guarded so slugs like "risk-assessment-…" or "task-…" don't match "sk-". */
export const SECRET_LIKE =
  /(?<![A-Za-z0-9])sk-(?:ant-|proj-)?[A-Za-z0-9_-]{20,}|(?<![A-Za-z0-9])gh[pousr]_[A-Za-z0-9]{30,}|eyJhbGciOi[A-Za-z0-9_-]{20,}/;

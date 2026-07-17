const STALE_CONTEXT_PATTERN = /\bSTALE_CONTEXT\b/i;
const DELEGATED_TARGET_PATTERN =
  /delegated task target changed before acceptance|page-scoped but the selected profile has no current target/i;

export const STALE_DELEGATED_TASK_SUMMARY =
  "委托绑定的页面在接受前已失效，插件没有执行任何操作。请 Codex 针对当前页面重新发送任务。";

export function isStaleDelegatedTaskTargetError(error: unknown): boolean {
  const detail = error instanceof Error ? error.message : String(error);
  return (
    STALE_CONTEXT_PATTERN.test(detail) && DELEGATED_TARGET_PATTERN.test(detail)
  );
}

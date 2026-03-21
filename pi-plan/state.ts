/**
 * State management and types for pi-plan.
 */

export interface PlanState {
  phase: "idle" | "qa" | "review";
  planFile: string | null;
}

export function createInitialState(): PlanState {
  return {
    phase: "idle",
    planFile: null,
  };
}

export function getPlanFilePath(cwd: string, sessionFile: string | null): string {
  const sessionId = sessionFile
    ? sessionFile.replace(/^.*\//, "").replace(/\.json$/, "")
    : `plan-${Date.now()}`;
  return `${cwd}/.pi/plans/${sessionId}.plan.md`;
}

/**
 * Execution phase logic — approve plan, create new session, implement.
 */

import type { ExtensionAPI, ExtensionCommandContext } from "@mariozechner/pi-coding-agent";
import { readFile } from "node:fs/promises";
import { getExecutionPrompt } from "./prompts.js";
import type { PlanState } from "./state.js";

export function registerExecutionCommands(
  pi: ExtensionAPI,
  getState: () => PlanState,
  setState: (s: Partial<PlanState>) => void,
  persist: () => void,
  restoreAllTools: () => void,
) {
  pi.registerCommand("plan-approve", {
    description: "Approve the plan and begin execution in a fresh session",
    handler: async (_args, ctx) => {
      const state = getState();
      if (state.phase !== "review" || !state.planFile) {
        ctx.ui.notify("No plan to approve. Complete the Q&A phase first.", "warning");
        return;
      }

      await executePlan(pi, ctx, state, setState, persist, restoreAllTools);
    },
  });
}

export async function executePlan(
  pi: ExtensionAPI,
  ctx: ExtensionCommandContext,
  state: PlanState,
  setState: (s: Partial<PlanState>) => void,
  persist: () => void,
  restoreAllTools: () => void,
): Promise<void> {
  let planContent: string;
  try {
    planContent = await readFile(state.planFile!, "utf-8");
  } catch (err) {
    ctx.ui.notify(`Failed to read plan file: ${err}`, "error");
    return;
  }

  await ctx.waitForIdle();

  setState({ phase: "executing" });
  persist();

  ctx.ui.notify("✓ Starting execution in new session...", "info");

  // Restore all tools before creating the new session
  restoreAllTools();

  const result = await ctx.newSession({
    parentSession: ctx.sessionManager.getSessionFile(),
    setup: async (sm) => {
      sm.appendMessage({
        role: "user",
        content: [
          {
            type: "text",
            text: getExecutionPrompt(planContent),
          },
        ],
        timestamp: Date.now(),
      });
    },
  });

  if (result.cancelled) {
    setState({ phase: "review" });
    persist();
    ctx.ui.notify("Execution cancelled.", "warning");
  }
}

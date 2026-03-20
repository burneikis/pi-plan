/**
 * Review phase logic — display plan, suggest changes, direct editing.
 */

import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { readFile } from "node:fs/promises";
import type { PlanState } from "./state.js";

export function registerReviewCommands(
  pi: ExtensionAPI,
  getState: () => PlanState,
) {
  pi.registerCommand("plan-edit", {
    description: "Open the current plan in the editor for direct editing",
    handler: async (_args, ctx) => {
      const state = getState();
      if (state.phase !== "review" || !state.planFile) {
        ctx.ui.notify("No plan to edit. Start planning with /plan first.", "warning");
        return;
      }

      try {
        const content = await readFile(state.planFile, "utf-8");
        const edited = await ctx.ui.editor("Edit plan:", content);

        if (edited !== undefined && edited !== content) {
          const { writeFile } = await import("node:fs/promises");
          await writeFile(state.planFile, edited, "utf-8");
          ctx.ui.notify("📋 Plan updated.", "info");
        } else {
          ctx.ui.notify("No changes made.", "info");
        }
      } catch (err) {
        ctx.ui.notify(`Failed to read plan: ${err}`, "error");
      }
    },
  });

  pi.registerCommand("plan-show", {
    description: "Display the current plan contents",
    handler: async (_args, ctx) => {
      const state = getState();
      if (!state.planFile) {
        ctx.ui.notify("No plan file. Start planning with /plan first.", "warning");
        return;
      }

      try {
        const content = await readFile(state.planFile, "utf-8");
        pi.sendMessage(
          {
            customType: "pi-plan",
            content: `**Plan** (${state.planFile}):\n\n${content}`,
            display: true,
            details: { action: "show" },
          },
          { triggerTurn: false },
        );
      } catch (err) {
        ctx.ui.notify(`Failed to read plan: ${err}`, "error");
      }
    },
  });
}

export async function showReviewPrompt(
  pi: ExtensionAPI,
  ctx: ExtensionContext,
  state: PlanState,
): Promise<"approve" | "edit" | "suggest" | "cancel" | null> {
  if (!ctx.hasUI) return null;

  const choice = await ctx.ui.select("Plan ready for review:", [
    "✅ Approve and execute",
    "✏️  Edit plan directly",
    "💬 Suggest changes (talk to the model)",
    "❌ Cancel planning",
  ]);

  if (!choice) return null;
  if (choice.startsWith("✅")) return "approve";
  if (choice.startsWith("✏️")) return "edit";
  if (choice.startsWith("💬")) return "suggest";
  if (choice.startsWith("❌")) return "cancel";
  return null;
}

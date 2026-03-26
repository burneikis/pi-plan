/**
 * Pi Plan Extension
 *
 * Adds a `/plan` command for structured plan-driven development.
 * The agent creates a plan, the user reviews/edits it, then the agent executes it.
 *
 * Flow:
 * 1. User runs `/plan <description>`
 * 2. Agent analyzes codebase (read-only) and writes a plan.md file
 * 3. User reviews with options: Ready, Edit, Open in $EDITOR, Cancel
 * 4. Agent executes the plan in a new session with full tool access
 */

import type {
  ExtensionAPI,
  ExtensionContext,
} from "@mariozechner/pi-coding-agent";
import { mkdir, readFile, access } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import { spawnSync } from "node:child_process";
import { deriveSessionId, extractPlanTitle, parsePlanSteps } from "./utils.js";

export default function piPlanExtension(pi: ExtensionAPI): void {
  let planFilePath: string | null = null;
  let isPlanMode = false;

  function updateUI(ctx: ExtensionContext): void {
    if (isPlanMode) {
      ctx.ui.setStatus("pi-plan", ctx.ui.theme.fg("warning", "planning"));
    } else {
      ctx.ui.setStatus("pi-plan", undefined);
    }
  }

  function persistState(): void {
    pi.appendEntry("pi-plan", { planFilePath, isPlanMode });
  }

  async function reviewLoop(ctx: ExtensionContext): Promise<void> {
    while (true) {
      let planContent: string;
      try {
        planContent = await readFile(planFilePath!, "utf-8");
      } catch {
        ctx.ui.notify("Could not read plan file.", "error");
        return;
      }

      const steps = parsePlanSteps(planContent);

      const choice = await ctx.ui.select(
        `Plan (${steps.length} steps) — What would you like to do?`,
        [
          "Ready — Execute the plan",
          "Edit — Ask for changes",
          "Open in $EDITOR — Edit manually",
          "Cancel — Discard the plan",
        ],
      );

      if (!choice || choice.startsWith("Cancel")) {
        isPlanMode = false;
        updateUI(ctx);
        persistState();
        ctx.ui.notify("Plan cancelled.", "info");
        return;
      }

      if (choice.startsWith("Ready")) {
        await startExecution(ctx);
        return;
      }

      if (choice.startsWith("Edit")) {
        const changes = await ctx.ui.editor(
          "What changes would you like to the plan?",
          "",
        );
        if (changes?.trim()) {
          pi.sendUserMessage(
            `Update the plan at ${planFilePath} with these changes:\n\n${changes.trim()}\n\n` +
              `Keep the same format.`,
          );
          return; // agent_end will re-trigger the review loop
        }
        continue;
      }

      if (choice.startsWith("Open")) {
        const editor = process.env.EDITOR || process.env.VISUAL || "vi";
        try {
          spawnSync(editor, [planFilePath!], { stdio: "inherit" });
        } catch (err) {
          ctx.ui.notify(`Failed to open editor: ${err}`, "error");
        }
        continue;
      }
    }
  }

  async function startExecution(ctx: ExtensionContext): Promise<void> {
    isPlanMode = false;
    updateUI(ctx);
    persistState();

    let planContent: string;
    try {
      planContent = await readFile(planFilePath!, "utf-8");
    } catch {
      ctx.ui.notify("Could not read plan file for execution.", "error");
      return;
    }

    const title = extractPlanTitle(planContent);
    if (title) {
      pi.setSessionName(`Plan: ${title}`);
    }

    pi.sendUserMessage(
      `Execute the following plan step by step. After completing each step, note which step you just finished.\n\n${planContent}`,
      { deliverAs: "followUp" },
    );
  }

  // --- Command Registration ---

  pi.registerCommand("plan", {
    description: "Create and execute a structured plan",
    handler: async (args, ctx) => {
      if (!args?.trim()) {
        ctx.ui.notify("Usage: /plan <description of what to build>", "warning");
        return;
      }

      // Derive plan file path
      const sessionFile = ctx.sessionManager.getSessionFile();
      const sessionId = deriveSessionId(sessionFile);
      const planDir = join(homedir(), ".pi", "agent", "plans", sessionId);
      await mkdir(planDir, { recursive: true });
      planFilePath = join(planDir, "plan.md");

      // Enter planning mode
      isPlanMode = true;
      updateUI(ctx);
      persistState();

      // Ask the agent to create the plan
      pi.sendUserMessage(
        `Analyze the codebase and create a detailed plan for: ${args.trim()}\n\n` +
          `Write the plan to: ${planFilePath}\n\n` +
          `Use this format:\n\n` +
          `# Plan: <title>\n\n` +
          `## Goal\n<brief description of what we're building>\n\n` +
          `## Steps\n\n` +
          `1. Step one description\n` +
          `2. Step two description\n` +
          `3. Step three description\n...\n\n` +
          `## Notes\n<any additional context, constraints, or decisions>\n\n` +
          `Be specific and actionable in each step.`,
        { deliverAs: "followUp" },
      );
    },
  });

  // --- Event Handlers ---

  // Inject planning instructions
  pi.on("before_agent_start", async () => {
    if (!isPlanMode) return;

    return {
      message: {
        customType: "pi-plan-context",
        content: `[PLANNING MODE ACTIVE]
You are in planning mode. Your job is to explore the codebase and write a detailed, actionable plan.

Focus on reading and understanding the code — do NOT make any changes to the codebase yet.
Write the plan file using the specified format with numbered steps.`,
        display: false,
      },
    };
  });

  // After agent finishes in planning mode, enter review loop
  pi.on("agent_end", async (_event, ctx) => {
    if (!isPlanMode || !planFilePath) return;
    if (!ctx.hasUI) return;

    // Check if the plan file exists
    try {
      await access(planFilePath);
    } catch {
      return; // Plan not written yet
    }

    // Read and validate the plan
    const planContent = await readFile(planFilePath, "utf-8");
    const steps = parsePlanSteps(planContent);

    if (steps.length === 0) {
      ctx.ui.notify(
        "No steps found in the plan. Ask the agent to refine it.",
        "warning",
      );
      return;
    }

    // Enter the review loop
    await reviewLoop(ctx);
  });

  // Filter stale planning context from LLM messages
  pi.on("context", async (event) => {
    if (isPlanMode) return;

    return {
      messages: event.messages.filter((m) => {
        const msg = m as typeof m & { customType?: string };
        return msg.customType !== "pi-plan-context";
      }),
    };
  });

  // Restore state on session start
  pi.on("session_start", async (_event, ctx) => {
    const entries = ctx.sessionManager.getEntries();
    const lastState = entries
      .filter(
        (e: { type: string; customType?: string }) =>
          e.type === "custom" && e.customType === "pi-plan",
      )
      .pop() as
      | { data?: { planFilePath: string | null; isPlanMode: boolean } }
      | undefined;

    if (lastState?.data) {
      planFilePath = lastState.data.planFilePath ?? null;
      isPlanMode = lastState.data.isPlanMode ?? false;
    }

    updateUI(ctx);
  });
}

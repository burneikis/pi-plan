/**
 * pi-plan: Native Planning Extension for pi-coding-agent
 *
 * Structured planning workflow: Q&A → Plan Draft → Review/Edit → Execute in fresh session.
 * Plans stored as markdown files in .pi/plans/<session-id>.plan.md.
 */

import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { Key } from "@mariozechner/pi-tui";
import { Text } from "@mariozechner/pi-tui";
import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";

import { registerExecutionCommands } from "./executor.js";
import { registerPlanTools } from "./planner.js";
import { getQAPrompt, getReviewPrompt } from "./prompts.js";
import { updatePlanStatus } from "./render.js";
import { showReviewPrompt } from "./reviewer.js";
import { registerReviewCommands } from "./reviewer.js";
import { createInitialState, getPlanFilePath, type PlanState } from "./state.js";

// Read-only tools for Q&A and review phases
const READ_ONLY_TOOLS = ["read", "bash", "grep", "find", "ls", "plan_ask", "plan_draft"];
const REVIEW_TOOLS = ["read", "bash", "grep", "find", "ls"];

// Safe bash command patterns (read-only)
const SAFE_PATTERNS = [
  /^\s*cat\b/,
  /^\s*head\b/,
  /^\s*tail\b/,
  /^\s*less\b/,
  /^\s*more\b/,
  /^\s*grep\b/,
  /^\s*rg\b/,
  /^\s*find\b/,
  /^\s*fd\b/,
  /^\s*ls\b/,
  /^\s*pwd\b/,
  /^\s*echo\b/,
  /^\s*printf\b/,
  /^\s*wc\b/,
  /^\s*sort\b/,
  /^\s*uniq\b/,
  /^\s*diff\b/,
  /^\s*file\b/,
  /^\s*stat\b/,
  /^\s*du\b/,
  /^\s*df\b/,
  /^\s*tree\b/,
  /^\s*which\b/,
  /^\s*type\b/,
  /^\s*env\b/,
  /^\s*printenv\b/,
  /^\s*uname\b/,
  /^\s*whoami\b/,
  /^\s*date\b/,
  /^\s*jq\b/,
  /^\s*sed\s+-n/i,
  /^\s*awk\b/,
  /^\s*bat\b/,
  /^\s*exa\b/,
  /^\s*git\s+(status|log|diff|show|branch|remote|config\s+--get|ls-)/i,
  /^\s*npm\s+(list|ls|view|info|search|outdated|audit)/i,
  /^\s*node\s+--version/i,
  /^\s*python\s+--version/i,
  /^\s*curl\s/i,
];

function isSafeCommand(command: string): boolean {
  // Split on pipes and check each segment
  const segments = command.split(/\s*\|\s*/);
  return segments.every((seg) => SAFE_PATTERNS.some((p) => p.test(seg.trim())));
}

export default function piPlanExtension(pi: ExtensionAPI): void {
  let state: PlanState = createInitialState();
  let allToolNames: string[] = [];

  // State accessors for sub-modules
  const getState = () => state;
  const setState = (partial: Partial<PlanState>) => {
    state = { ...state, ...partial };
  };
  const persist = () => {
    pi.appendEntry("pi-plan-state", {
      phase: state.phase,
      planFile: state.planFile,
    });
  };
  const restoreAllTools = () => {
    if (allToolNames.length > 0) {
      pi.setActiveTools(allToolNames);
    }
  };

  // Register CLI flag
  pi.registerFlag("plan", {
    description: "Start pi directly in planning mode",
    type: "boolean",
    default: false,
  });

  // Register custom tools (plan_ask, plan_draft)
  registerPlanTools(pi, getState, setState, persist);

  // Register review commands (/plan-edit, /plan-show)
  registerReviewCommands(pi, getState);

  // Register execution commands (/plan-approve)
  registerExecutionCommands(pi, getState, setState, persist, restoreAllTools);

  // /plan [prompt] — Start a new planning session
  pi.registerCommand("plan", {
    description: "Start a new planning session. Optional: /plan <initial prompt>",
    handler: async (args, ctx) => {
      if (state.phase !== "idle") {
        const ok = await ctx.ui.confirm(
          "Active plan",
          "A planning session is already active. Start a new one?",
        );
        if (!ok) return;
      }

      // Capture all tools before restricting
      allToolNames = pi.getAllTools().map((t) => t.name);

      const planFile = getPlanFilePath(ctx.cwd, ctx.sessionManager.getSessionFile());
      state = {
        phase: "qa",
        planFile,
      };
      persist();

      pi.setActiveTools(READ_ONLY_TOOLS);
      updatePlanStatus(ctx, state);

      ctx.ui.notify("🔍 Plan mode active (Q&A phase)", "info");

      if (args?.trim()) {
        pi.sendUserMessage(args.trim());
      }
    },
  });

  // /plan-cancel — Cancel planning
  pi.registerCommand("plan-cancel", {
    description: "Cancel planning and restore normal mode",
    handler: async (_args, ctx) => {
      if (state.phase === "idle") {
        ctx.ui.notify("No active planning session.", "info");
        return;
      }

      state = createInitialState();
      persist();
      restoreAllTools();
      updatePlanStatus(ctx, state);
      ctx.ui.notify("Planning cancelled. Normal mode restored.", "info");
    },
  });

  // Keyboard shortcut: Ctrl+Alt+P
  pi.registerShortcut(Key.ctrlAlt("p"), {
    description: "Toggle plan mode / show plan status",
    handler: async (ctx) => {
      if (state.phase === "idle") {
        // Start planning — same as /plan without args
        allToolNames = pi.getAllTools().map((t) => t.name);
        const planFile = getPlanFilePath(ctx.cwd, ctx.sessionManager.getSessionFile());
        state = { phase: "qa", planFile };
        persist();
        pi.setActiveTools(READ_ONLY_TOOLS);
        updatePlanStatus(ctx, state);
        ctx.ui.notify("🔍 Plan mode active (Q&A phase)", "info");
      } else {
        // Show status
        const phaseLabel =
          state.phase === "qa"
            ? "Q&A"
            : state.phase === "review"
              ? "Review"
              : state.phase === "executing"
                ? "Executing"
                : "Idle";
        ctx.ui.notify(
          `📋 Planning: ${phaseLabel}${state.planFile ? `\nPlan: ${state.planFile}` : ""}`,
          "info",
        );
      }
    },
  });

  // Block destructive operations during Q&A and review phases
  pi.on("tool_call", async (event, _ctx) => {
    if (state.phase !== "qa" && state.phase !== "review") return;

    // Block edit and write tools
    if (event.toolName === "edit" || event.toolName === "write") {
      return {
        block: true,
        reason: `Planning mode: ${event.toolName} is not available during the ${state.phase} phase. Only read-only tools are allowed.`,
      };
    }

    // Filter bash commands
    if (event.toolName === "bash") {
      const command = (event.input as { command: string }).command;
      if (!isSafeCommand(command)) {
        return {
          block: true,
          reason: `Planning mode: This bash command is not allowed during the ${state.phase} phase. Only read-only commands (cat, grep, find, ls, git status/log/diff, tree, etc.) are permitted.\nCommand: ${command}`,
        };
      }
    }
  });

  // Inject phase-appropriate system prompt
  pi.on("before_agent_start", async (_event, _ctx) => {
    if (state.phase === "qa") {
      return {
        message: {
          customType: "pi-plan",
          content: getQAPrompt(),
          display: false,
        },
      };
    }

    if (state.phase === "review" && state.planFile) {
      return {
        message: {
          customType: "pi-plan",
          content: getReviewPrompt(state.planFile),
          display: false,
        },
      };
    }
  });

  // After agent ends: handle phase transitions
  pi.on("agent_end", async (_event, ctx) => {
    if (!ctx.hasUI) return;

    // After Q&A phase: if we transitioned to review, show review prompt
    if (state.phase === "review" && state.planFile) {
      pi.setActiveTools(REVIEW_TOOLS);
      updatePlanStatus(ctx, state);

      const action = await showReviewPrompt(pi, ctx, state);

      if (action === "approve") {
        // Need to cast since agent_end gives ExtensionContext, but we need command context
        // Use /plan-approve command instead
        pi.sendUserMessage("/plan-approve");
      } else if (action === "edit") {
        // Open editor
        try {
          const content = await readFile(state.planFile, "utf-8");
          const edited = await ctx.ui.editor("Edit plan:", content);
          if (edited !== undefined && edited !== content) {
            await writeFile(state.planFile, edited, "utf-8");
            ctx.ui.notify("📋 Plan updated.", "info");
          }
        } catch (err) {
          ctx.ui.notify(`Failed to edit plan: ${err}`, "error");
        }
      } else if (action === "suggest") {
        ctx.ui.notify(
          "Type your suggestions. The model will propose changes to the plan.",
          "info",
        );
        // User continues chatting in review mode
      } else if (action === "cancel") {
        state = createInitialState();
        persist();
        restoreAllTools();
        updatePlanStatus(ctx, state);
        ctx.ui.notify("Planning cancelled. Normal mode restored.", "info");
      }
    }
  });

  // Restore state on session start
  pi.on("session_start", async (_event, ctx) => {
    // Capture all tools
    allToolNames = pi.getAllTools().map((t) => t.name);

    // Check --plan flag
    if (pi.getFlag("plan") === true && state.phase === "idle") {
      const planFile = getPlanFilePath(ctx.cwd, ctx.sessionManager.getSessionFile());
      state = { phase: "qa", planFile };
      persist();
      pi.setActiveTools(READ_ONLY_TOOLS);
      updatePlanStatus(ctx, state);
      ctx.ui.notify("🔍 Plan mode active (Q&A phase) — started via --plan flag", "info");
      return;
    }

    // Restore persisted state
    const entries = ctx.sessionManager.getEntries();
    let lastPlanState: { phase: string; planFile: string | null } | null = null;

    for (const entry of entries) {
      if (
        entry.type === "custom" &&
        (entry as any).customType === "pi-plan-state" &&
        (entry as any).data
      ) {
        lastPlanState = (entry as any).data;
      }
    }

    if (lastPlanState) {
      state = {
        phase: lastPlanState.phase as PlanState["phase"],
        planFile: lastPlanState.planFile,
      };

      // Verify plan file still exists if in review
      if (state.phase === "review" && state.planFile && !existsSync(state.planFile)) {
        ctx.ui.notify(`Plan file missing: ${state.planFile}. Resetting to idle.`, "warning");
        state = createInitialState();
        persist();
      }

      // Re-apply tool restrictions
      if (state.phase === "qa") {
        pi.setActiveTools(READ_ONLY_TOOLS);
      } else if (state.phase === "review") {
        pi.setActiveTools(REVIEW_TOOLS);
      }
    }

    updatePlanStatus(ctx, state);
  });

  // Custom message renderer for pi-plan messages
  pi.registerMessageRenderer("pi-plan", (message, options, theme) => {
    const { expanded } = options;
    const content = typeof message.content === "string" ? message.content : "";

    let text = "";
    const details = (message as any).details;
    const action = details?.action;

    if (action === "show") {
      // Plan display
      text = theme.fg("accent", "📋 ") + content;
    } else {
      // Phase transition or status message
      text = theme.fg("muted", content);
    }

    if (expanded && details) {
      text += "\n" + theme.fg("dim", JSON.stringify(details, null, 2));
    }

    return new Text(text, 0, 0);
  });
}

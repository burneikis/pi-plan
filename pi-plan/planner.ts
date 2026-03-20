/**
 * Planning phase logic — Q&A, plan generation.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { Text } from "@mariozechner/pi-tui";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { PlanState } from "./state.js";

export function registerPlanTools(
  pi: ExtensionAPI,
  getState: () => PlanState,
  setState: (s: Partial<PlanState>) => void,
  persist: () => void,
) {
  pi.registerTool({
    name: "plan_ask",
    label: "Plan Ask",
    description:
      "Ask the user structured questions during the planning Q&A phase. Use this to gather requirements, preferences, and domain knowledge needed to create a good plan.",
    parameters: Type.Object({
      questions: Type.Array(
        Type.Object({
          question: Type.String({ description: "The question to ask" }),
          context: Type.Optional(Type.String({ description: "Why this question matters for the plan" })),
        }),
      ),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const state = getState();
      if (state.phase !== "qa") {
        throw new Error("plan_ask can only be used during the Q&A phase.");
      }

      const answers: string[] = [];

      for (const q of params.questions) {
        let prompt = q.question;
        if (q.context) {
          prompt += `\n${ctx.ui.theme.fg("muted", `→ ${q.context}`)}`;
        }

        const answer = await ctx.ui.input(prompt, "Type your answer...");
        answers.push(answer ?? "(no answer)");
      }

      const result = params.questions
        .map((q, i) => `Q: ${q.question}\nA: ${answers[i]}`)
        .join("\n\n");

      return {
        content: [{ type: "text", text: result }],
        details: { questions: params.questions, answers },
      };
    },

    renderCall(args: any, theme: any) {
      const count = args.questions?.length ?? 0;
      return new Text(
        theme.fg("toolTitle", theme.bold("plan_ask ")) +
          theme.fg("muted", `${count} question${count !== 1 ? "s" : ""}`),
        0,
        0,
      );
    },
  });

  pi.registerTool({
    name: "plan_draft",
    label: "Plan Draft",
    description:
      "Write the implementation plan as a full markdown document. Call this when you have gathered enough information during Q&A. The content should be a rich, detailed design document.",
    parameters: Type.Object({
      content: Type.String({ description: "The full plan as a markdown document" }),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const state = getState();
      if (state.phase !== "qa") {
        throw new Error("plan_draft can only be used during the Q&A phase.");
      }

      const planFile = state.planFile;
      if (!planFile) {
        throw new Error("No plan file path set. This is a bug.");
      }

      await mkdir(dirname(planFile), { recursive: true });
      await writeFile(planFile, params.content, "utf-8");

      setState({ phase: "review" });
      persist();

      ctx.ui.notify(`📋 Plan written to ${planFile}`, "info");

      return {
        content: [{ type: "text", text: `Plan written to ${planFile}. Entering review phase.` }],
        details: { planFile },
      };
    },

    renderCall(args: any, theme: any) {
      const preview = (args.content ?? "").slice(0, 80).replace(/\n/g, " ");
      return new Text(
        theme.fg("toolTitle", theme.bold("plan_draft ")) +
          theme.fg("dim", preview + (args.content?.length > 80 ? "…" : "")),
        0,
        0,
      );
    },
  });
}

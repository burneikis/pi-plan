/**
 * Custom message renderers and status helpers for pi-plan.
 */

import type { ExtensionContext } from "@mariozechner/pi-coding-agent";
import type { PlanState } from "./state.js";

export function updatePlanStatus(ctx: ExtensionContext, state: PlanState): void {
  const theme = ctx.ui.theme;
  switch (state.phase) {
    case "qa":
      ctx.ui.setStatus("pi-plan", theme.fg("warning", "🔍 planning (Q&A)"));
      break;
    case "review":
      ctx.ui.setStatus("pi-plan", theme.fg("accent", "📋 planning (review)"));
      break;
    case "executing":
      ctx.ui.setStatus("pi-plan", theme.fg("success", "🚀 executing plan"));
      break;
    default:
      ctx.ui.setStatus("pi-plan", undefined);
      break;
  }
}

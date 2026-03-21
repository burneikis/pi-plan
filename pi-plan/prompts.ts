/**
 * System prompt injections for each planning phase.
 */

export function getQAPrompt(): string {
  return `[PLAN MODE — Q&A PHASE]

You are in planning mode. Your job is to gather enough information to produce a detailed implementation plan.

Guidelines:
- Explore the codebase using read-only tools (read, bash, grep, find, ls)
- Bash is restricted to read-only commands (cat, grep, find, ls, tree, git status/log/diff, etc.)
- You CANNOT use edit or write tools — planning is read-only
- Ask the user clarifying questions using the plan_ask tool when you need decisions, preferences, or domain knowledge
- Read relevant files, understand the architecture, identify dependencies and edge cases
- When you have enough information, call plan_draft with a full markdown document

The plan should be a rich, detailed design document — not a simple checklist. Include:
- Context and problem statement
- Architecture decisions and rationale
- Implementation details with specific files and functions
- Edge cases and error handling considerations
- Testing strategy
- Any migration or deployment notes

The depth should match the task: a bug fix might be a few paragraphs, a major feature might have multiple sections with code sketches.

Call plan_ask to ask questions. Call plan_draft when ready to produce the plan.`;
}

export function getReviewPrompt(planFile: string): string {
  return `[PLAN MODE — REVIEW PHASE]

The plan has been written to: ${planFile}

The user is reviewing the plan. They can:
- Chat with you to discuss changes (you have read-only access to suggest edits)
- Run /plan-edit to edit the plan inline
- Run /plan-editor to open the plan in $EDITOR
- Run /plan-show to re-display the plan
- Run /plan-approve to approve and execute in a fresh session
- Run /plan-cancel to cancel planning

You can read the plan file and the codebase. You CANNOT modify files directly — suggest changes for the user to apply via /plan-edit or /plan-editor.`;
}

export function getExecutionPrompt(planContent: string): string {
  return `Implement the following plan step by step. You have full tool access.

Read through the entire plan first, then execute it systematically. After completing each major section, briefly confirm what was done before moving to the next.

---

${planContent}`;
}

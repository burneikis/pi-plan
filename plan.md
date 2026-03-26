# Pi Plan Extension

A pi extension that adds a `/plan` command for structured plan-driven development. The agent creates a plan, the user reviews/edits it, then the agent executes it step by step with progress tracking.

## Usage

```
/plan make a todo app with React and TypeScript
```

## Core Flow

1. User runs `/plan <description>`
2. Agent analyzes the codebase (read-only) and writes a `plan.md` file
3. Extension displays the plan and prompts the user with options:
   - **Ready** → clear context, start a new session, execute the plan
   - **Edit** → ask the user what to change, agent rewrites plan, re-prompt
   - **Open in $EDITOR** → open `plan.md` in the user's editor; on close, re-prompt with same options
4. During execution, track step completion and show progress

## File Structure

```
pi-plan/
├── index.ts          # Extension entry point
├── utils.ts          # Pure utility functions (plan parsing, step tracking)
├── plan.md           # This plan document
├── package.json      # Extension metadata
└── README.md         # User-facing documentation
```

## Plan Storage

- Plans are stored at `~/.pi/agent/plans/<session_id>/plan.md`
- `session_id` is derived from `ctx.sessionManager.getSessionFile()` (the basename without extension, or a fallback hash of the session path)
- The plan directory is created automatically via `node:fs/promises` `mkdir({ recursive: true })`
- Plans persist across session restarts and can be revisited

## Plan Format

The agent writes plans in a consistent markdown format:

```markdown
# Plan: <title>

## Goal
<brief description of what we're building>

## Steps

- [ ] 1. Step one description
- [ ] 2. Step two description
- [ ] 3. Step three description
...

## Notes
<any additional context, constraints, or decisions>
```

## Implementation Details

### Extension Entry Point (`index.ts`)

**Registration:**
- `pi.registerCommand("plan", { ... })` — the `/plan` command
- `pi.registerCommand("plan-status", { ... })` — show current plan progress
- `pi.registerShortcut(Key.ctrlAlt("p"), { ... })` — quick toggle/status shortcut

**State:**
- `planFilePath: string | null` — path to current plan.md
- `planSteps: PlanStep[]` — parsed steps from the plan
- `isExecuting: boolean` — whether we're in execution mode
- `isPlanMode: boolean` — whether we're in planning (read-only) mode

**Session persistence:**
- Use `pi.appendEntry("pi-plan", { planFilePath, planSteps, isExecuting })` to persist state
- Restore on `session_start` by scanning `ctx.sessionManager.getEntries()` for the last `pi-plan` custom entry

### Command Handler (`/plan`)

```typescript
pi.registerCommand("plan", {
  description: "Create and execute a structured plan",
  handler: async (args, ctx) => {
    if (!args?.trim()) {
      ctx.ui.notify("Usage: /plan <description of what to build>", "warning");
      return;
    }

    // 1. Derive plan file path
    const sessionFile = ctx.sessionManager.getSessionFile();
    const sessionId = deriveSessionId(sessionFile);
    const planDir = path.join(os.homedir(), ".pi", "agent", "plans", sessionId);
    await mkdir(planDir, { recursive: true });
    planFilePath = path.join(planDir, "plan.md");

    // 2. Enter planning mode (read-only tools)
    isPlanMode = true;
    pi.setActiveTools(["read", "bash", "grep", "find", "ls"]);
    updateUI(ctx);

    // 3. Send a message to the agent asking it to create the plan
    //    The agent will use read-only tools to explore, then write the plan
    pi.sendUserMessage(
      `Analyze the codebase and create a detailed plan for: ${args.trim()}\n\n` +
      `Write the plan to: ${planFilePath}\n\n` +
      `Use the plan format with checkboxes (- [ ] 1. Step description).\n` +
      `Include a Goal section and a Steps section. Be specific and actionable.`,
      { deliverAs: "followUp" }
    );
  },
});
```

### Plan Review Loop

After the agent finishes writing the plan, prompt the user in the `agent_end` event:

```typescript
pi.on("agent_end", async (event, ctx) => {
  if (!isPlanMode || !planFilePath) return;
  if (!ctx.hasUI) return;

  // Check if the plan file exists
  try {
    await access(planFilePath);
  } catch {
    return; // Plan not written yet, agent may still be working
  }

  // Read and parse the plan
  const planContent = await readFile(planFilePath, "utf-8");
  planSteps = parsePlanSteps(planContent);

  if (planSteps.length === 0) {
    ctx.ui.notify("No steps found in the plan. Ask the agent to refine it.", "warning");
    return;
  }

  // Enter the review loop
  await reviewLoop(ctx);
});
```

**Review Loop Function:**

```typescript
async function reviewLoop(ctx: ExtensionContext): Promise<void> {
  while (true) {
    // Display the plan content
    const planContent = await readFile(planFilePath!, "utf-8");
    planSteps = parsePlanSteps(planContent);

    const choice = await ctx.ui.select(
      `Plan (${planSteps.length} steps) — What would you like to do?`,
      [
        "Ready — Execute the plan",
        "Edit — Ask for changes",
        "Open in $EDITOR — Edit manually",
        "Cancel — Discard the plan",
      ]
    );

    if (!choice || choice.startsWith("Cancel")) {
      // Cancel
      isPlanMode = false;
      pi.setActiveTools(["read", "bash", "edit", "write"]);
      updateUI(ctx);
      ctx.ui.notify("Plan cancelled.", "info");
      return;
    }

    if (choice.startsWith("Ready")) {
      // Ready — execute
      await startExecution(ctx);
      return;
    }

    if (choice.startsWith("Edit")) {
      // Edit — ask for changes via editor dialog
      const changes = await ctx.ui.editor("What changes would you like to the plan?", "");
      if (changes?.trim()) {
        // Send changes to agent, agent rewrites plan.md
        pi.sendUserMessage(
          `Update the plan at ${planFilePath} with these changes:\n\n${changes.trim()}\n\n` +
          `Keep the same format. Rewrite the full plan file.`
        );
        return; // agent_end will re-trigger the review loop
      }
      // If empty, loop back to options
      continue;
    }

    if (choice.startsWith("Open")) {
      // Open in $EDITOR
      const editor = process.env.EDITOR || process.env.VISUAL || "vi";
      const result = await pi.exec(editor, [planFilePath!], {
        stdio: "inherit", // This needs the editor to take over the terminal
      });
      // After editor closes, re-read the plan and loop back
      continue;
    }
  }
}
```

**Note on $EDITOR:** Opening an external editor requires `pi.exec()` with the editor and file path. Since pi's TUI owns the terminal, we may need to use `ctx.ui.custom()` to temporarily yield control, or use `child_process.spawnSync` with `stdio: "inherit"` directly. This needs testing — if `pi.exec` doesn't support interactive terminal handoff, we'll use Node's `child_process` directly and handle terminal state manually.

### Execution Mode

```typescript
async function startExecution(ctx: ExtensionContext): Promise<void> {
  isPlanMode = false;
  isExecuting = true;

  // Restore full tool access
  pi.setActiveTools(["read", "bash", "edit", "write"]);
  updateUI(ctx);
  persistState();

  // Read the plan content to include in the execution message
  const planContent = await readFile(planFilePath!, "utf-8");

  // Start a new session with the plan as context
  const result = await ctx.newSession({
    parentSession: ctx.sessionManager.getSessionFile(),
    setup: async (sm) => {
      // Seed the new session with the plan as context
      sm.appendMessage({
        role: "user",
        content: [{ type: "text", text:
          `Execute the following plan step by step. After completing each step, ` +
          `include a [DONE:n] tag (e.g., [DONE:1]) in your response.\n\n` +
          `${planContent}`
        }],
        timestamp: Date.now(),
      });
    },
  });

  if (result.cancelled) {
    isExecuting = false;
    updateUI(ctx);
    ctx.ui.notify("Execution cancelled.", "warning");
    return;
  }

  // Name the new session after the plan
  const title = extractPlanTitle(planContent);
  if (title) {
    pi.setSessionName(`Plan: ${title}`);
  }
}
```

### Progress Tracking

Track `[DONE:n]` markers in assistant responses during execution:

```typescript
pi.on("turn_end", async (event, ctx) => {
  if (!isExecuting || planSteps.length === 0) return;

  const message = event.message;
  if (message.role !== "assistant" || !Array.isArray(message.content)) return;

  const text = message.content
    .filter((b): b is TextContent => b.type === "text")
    .map((b) => b.text)
    .join("\n");

  const completedCount = markCompletedSteps(text, planSteps);
  if (completedCount > 0) {
    // Update the plan.md file with checked boxes
    await updatePlanFile(planFilePath!, planSteps);
    updateUI(ctx);
    persistState();
  }
});
```

**Update plan.md checkboxes:**
When a step is marked done via `[DONE:n]`, rewrite `- [ ] n.` → `- [x] n.` in the plan file on disk. This keeps the plan.md file as a persistent record of progress.

**Completion detection** in `agent_end`:
```typescript
pi.on("agent_end", async (event, ctx) => {
  if (isExecuting && planSteps.length > 0 && planSteps.every(s => s.completed)) {
    isExecuting = false;
    ctx.ui.notify("Plan complete! All steps finished.", "success");
    ctx.ui.setWidget("pi-plan", undefined);
    ctx.ui.setStatus("pi-plan", undefined);
    persistState();
  }
});
```

### UI Updates

**Footer status:**
- Planning mode: `planning` (warning color)
- Executing: `plan 3/7` (accent color, completed/total)
- Neither: cleared

**Widget (above editor):**
During execution, show a checklist widget:
```
[x] Set up project structure
[x] Create data models
[ ] Implement API routes
[ ] Add authentication
[ ] Write tests
```

```typescript
function updateUI(ctx: ExtensionContext): void {
  if (isExecuting && planSteps.length > 0) {
    const completed = planSteps.filter(s => s.completed).length;
    ctx.ui.setStatus("pi-plan", ctx.ui.theme.fg("accent", `plan ${completed}/${planSteps.length}`));

    const lines = planSteps.map(step => {
      if (step.completed) {
        return ctx.ui.theme.fg("success", "[x] ") +
               ctx.ui.theme.fg("muted", ctx.ui.theme.strikethrough(step.text));
      }
      return ctx.ui.theme.fg("muted", "[ ] ") + step.text;
    });
    ctx.ui.setWidget("pi-plan", lines);
  } else if (isPlanMode) {
    ctx.ui.setStatus("pi-plan", ctx.ui.theme.fg("warning", "planning"));
    ctx.ui.setWidget("pi-plan", undefined);
  } else {
    ctx.ui.setStatus("pi-plan", undefined);
    ctx.ui.setWidget("pi-plan", undefined);
  }
}
```

### Injected Context

Use `before_agent_start` to inject planning/execution instructions:

- **Planning mode:** Inject read-only instructions + plan format requirements
- **Execution mode:** Inject remaining steps and `[DONE:n]` instructions
- **Neither:** No injection

### Tool Restrictions in Planning Mode

During planning, restrict to read-only tools via `pi.setActiveTools()`:
- `read`, `bash`, `grep`, `find`, `ls`

Additionally, filter bash commands via `tool_call` event to block destructive operations (same approach as the existing plan-mode example — use allowlist of safe commands).

### Session Restoration

On `session_start`, restore state from persisted entries:

```typescript
pi.on("session_start", async (_event, ctx) => {
  const entries = ctx.sessionManager.getEntries();
  const lastState = entries
    .filter(e => e.type === "custom" && e.customType === "pi-plan")
    .pop();

  if (lastState?.data) {
    planFilePath = lastState.data.planFilePath;
    planSteps = lastState.data.planSteps ?? [];
    isExecuting = lastState.data.isExecuting ?? false;
    isPlanMode = lastState.data.isPlanMode ?? false;
  }

  // Re-scan messages for [DONE:n] markers to rebuild completion state
  if (isExecuting && planSteps.length > 0) {
    rebuildCompletionState(entries, planSteps);
  }

  if (isPlanMode) {
    pi.setActiveTools(["read", "bash", "grep", "find", "ls"]);
  }
  updateUI(ctx);
});
```

## Utility Functions (`utils.ts`)

### `parsePlanSteps(content: string): PlanStep[]`
Parse the plan.md file and extract steps from `- [ ] n. ...` or `- [x] n. ...` lines.

### `markCompletedSteps(text: string, steps: PlanStep[]): number`
Scan text for `[DONE:n]` markers and mark matching steps as completed. Returns count of newly completed steps.

### `updatePlanFile(filePath: string, steps: PlanStep[]): Promise<void>`
Rewrite the plan.md file, toggling `- [ ]` → `- [x]` for completed steps.

### `extractPlanTitle(content: string): string | null`
Extract the title from `# Plan: <title>` header.

### `deriveSessionId(sessionFile: string | null): string`
Extract a safe directory name from the session file path.

### `isSafeCommand(command: string): boolean`
Check if a bash command is on the read-only allowlist (reuse logic from existing plan-mode example).

### Types

```typescript
interface PlanStep {
  step: number;
  text: string;
  completed: boolean;
  raw: string; // Original line from the plan file for rewriting
}
```

## Edge Cases & Error Handling

- **No args to `/plan`:** Show usage hint via `ctx.ui.notify()`
- **Plan file doesn't exist when review loop runs:** Agent hasn't written it yet; skip the review prompt (handled by `access()` check)
- **Empty plan (no steps parsed):** Notify user and stay in planning mode so agent can try again
- **$EDITOR not set:** Fall back to `vi`
- **$EDITOR fails or is killed:** Catch error, notify user, continue review loop
- **Session has no session file (ephemeral):** Use a hash/timestamp-based fallback for the plan directory name
- **Agent doesn't use `[DONE:n]` markers:** Steps won't auto-complete; user can still see the plan widget and track manually
- **Non-interactive mode (`ctx.hasUI === false`):** Skip the review loop and UI updates; plan file is still written and can be used externally
- **Plan mid-execution when session is compacted:** The `before_agent_start` re-injects remaining steps, so the agent always has context about what's left

## Dependencies

- `node:fs/promises` — file operations (mkdir, readFile, writeFile, access)
- `node:path` — path manipulation
- `node:os` — homedir
- `node:child_process` — for $EDITOR handoff (if `pi.exec` doesn't support interactive stdio)
- `@mariozechner/pi-coding-agent` — extension types
- `@mariozechner/pi-tui` — Key for shortcuts

No external npm dependencies needed.

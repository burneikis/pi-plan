# Pi Plan Extension

A pi extension that adds a `/plan` command for structured plan-driven development. The agent creates a plan, the user reviews/edits it, then the agent executes it.

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
4. Agent executes the plan with full tool access

## File Structure

```
pi-plan/
├── index.ts          # Extension entry point
├── utils.ts          # Pure utility functions (plan parsing)
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

1. Step one description
2. Step two description
3. Step three description
...

## Notes
<any additional context, constraints, or decisions>
```

## Implementation Details

### Extension Entry Point (`index.ts`)

**Registration:**
- `pi.registerCommand("plan", { ... })` — the `/plan` command

**State:**
- `planFilePath: string | null` — path to current plan.md
- `isPlanMode: boolean` — whether we're in planning (read-only) mode

**Session persistence:**
- Use `pi.appendEntry("pi-plan", { planFilePath, isPlanMode })` to persist state
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
      `Use the plan format with numbered steps.\n` +
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
  const steps = parsePlanSteps(planContent);

  if (steps.length === 0) {
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
    const planContent = await readFile(planFilePath!, "utf-8");
    const steps = parsePlanSteps(planContent);

    const choice = await ctx.ui.select(
      `Plan (${steps.length} steps) — What would you like to do?`,
      [
        "Ready — Execute the plan",
        "Edit — Ask for changes",
        "Open in $EDITOR — Edit manually",
        "Cancel — Discard the plan",
      ]
    );

    if (!choice || choice.startsWith("Cancel")) {
      isPlanMode = false;
      pi.setActiveTools(["read", "bash", "edit", "write"]);
      updateUI(ctx);
      ctx.ui.notify("Plan cancelled.", "info");
      return;
    }

    if (choice.startsWith("Ready")) {
      await startExecution(ctx);
      return;
    }

    if (choice.startsWith("Edit")) {
      const changes = await ctx.ui.editor("What changes would you like to the plan?", "");
      if (changes?.trim()) {
        pi.sendUserMessage(
          `Update the plan at ${planFilePath} with these changes:\n\n${changes.trim()}\n\n` +
          `Keep the same format. Rewrite the full plan file.`
        );
        return; // agent_end will re-trigger the review loop
      }
      continue;
    }

    if (choice.startsWith("Open")) {
      const editor = process.env.EDITOR || process.env.VISUAL || "vi";
      const result = await pi.exec(editor, [planFilePath!], {
        stdio: "inherit",
      });
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
      sm.appendMessage({
        role: "user",
        content: [{ type: "text", text:
          `Execute the following plan step by step.\n\n${planContent}`
        }],
        timestamp: Date.now(),
      });
    },
  });

  if (result.cancelled) {
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

### UI Updates

**Footer status:**
- Planning mode: `planning` (warning color)
- Neither: cleared

```typescript
function updateUI(ctx: ExtensionContext): void {
  if (isPlanMode) {
    ctx.ui.setStatus("pi-plan", ctx.ui.theme.fg("warning", "planning"));
  } else {
    ctx.ui.setStatus("pi-plan", undefined);
  }
}
```

### Injected Context

Use `before_agent_start` to inject planning instructions when in plan mode:

- **Planning mode:** Inject read-only instructions + plan format requirements
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
    isPlanMode = lastState.data.isPlanMode ?? false;
  }

  if (isPlanMode) {
    pi.setActiveTools(["read", "bash", "grep", "find", "ls"]);
  }
  updateUI(ctx);
});
```

## Utility Functions (`utils.ts`)

### `parsePlanSteps(content: string): PlanStep[]`
Parse the plan.md file and extract numbered steps from the Steps section.

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
}
```

## Edge Cases & Error Handling

- **No args to `/plan`:** Show usage hint via `ctx.ui.notify()`
- **Plan file doesn't exist when review loop runs:** Agent hasn't written it yet; skip the review prompt (handled by `access()` check)
- **Empty plan (no steps parsed):** Notify user and stay in planning mode so agent can try again
- **$EDITOR not set:** Fall back to `nano`
- **$EDITOR fails or is killed:** Catch error, notify user, continue review loop
- **Session has no session file (ephemeral):** Use a hash/timestamp-based fallback for the plan directory name
- **Non-interactive mode (`ctx.hasUI === false`):** Skip the review loop and UI updates; plan file is still written and can be used externally

## Dependencies

- `node:fs/promises` — file operations (mkdir, readFile, writeFile, access)
- `node:path` — path manipulation
- `node:os` — homedir
- `node:child_process` — for $EDITOR handoff (if `pi.exec` doesn't support interactive stdio)
- `@mariozechner/pi-coding-agent` — extension types
- `@mariozechner/pi-tui` — Key for shortcuts

No external npm dependencies needed.

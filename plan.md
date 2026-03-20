# pi-plan: Native Planning Extension for pi-coding-agent

## Overview

A pi extension that adds a structured planning workflow: generate plans through interactive Q&A, review/edit them, and then approve for execution in a fresh context. Plans are stored as markdown files on disk, acting as the handoff artifact between planning and execution phases.

## Architecture

```
.pi/extensions/pi-plan/
├── index.ts           # Extension entry point, command/event/tool registration
├── planner.ts         # Planning phase logic (Q&A, plan generation)
├── reviewer.ts        # Review phase logic (suggest changes, direct editing)
├── executor.ts        # Execution phase logic (approve, new session, implement)
├── state.ts           # State management, persistence, types
├── prompts.ts         # System prompt injections for each phase
└── render.ts          # Custom message renderers, status helpers
```

## Core Concepts

### Plan Lifecycle

```
┌─────────────┐     ┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│   /plan      │────►│  Q&A Phase   │────►│ Review Phase  │────►│  Execution   │
│  (initiate)  │     │  (generate)  │     │ (edit/refine) │     │  (approve)   │
└─────────────┘     └──────────────┘     └──────────────┘     └──────────────┘
                         │    ▲               │    ▲
                         │    │               │    │
                         └────┘               └────┘
                      (iterative)          (iterative)
```

### Phases

1. **Q&A Phase** — The model gathers context by asking clarifying questions. Only read-only tools are available. The model can read files, search the codebase, and ask the user questions via a `plan_ask` tool. Once the model has enough information, it generates a plan.

2. **Review Phase** — The plan is written to a `.pi/plan.md` file and presented to the user. The user can:
   - Ask the model to suggest changes (model reads the plan, proposes edits)
   - Directly edit the plan file (via `ctx.ui.editor` or their own editor)
   - Request the model regenerate specific sections
   - Iterate as many times as needed

3. **Execution Phase** — The user approves the plan. A **new session** is created via `ctx.newSession()`, the plan content is injected as the initial user message with execution instructions, and full tools are restored. The fresh agent implements the plan step-by-step.

### Plan Files

Plans are stored as `.pi/plans/<session-id>.plan.md` where `<session-id>` is derived from the planning session's ID. This allows multiple pi instances (e.g. across worktrees, parallel projects, or tmux panes) to maintain independent plans without collision. The `.pi/plans/` directory is project-local, so plans are git-trackable and inspectable.

Plans are **full markdown documents** — not simple checklists. They should read like a detailed design document or implementation spec, similar to what a senior engineer would write before handing off work. The model is instructed to produce rich, structured plans with context, rationale, architecture decisions, implementation details, edge cases, and testing strategy as appropriate.

There is no enforced template. The model writes the plan as a natural markdown document tailored to the task. A plan for a small bug fix might be a few paragraphs; a plan for a major feature might have multiple sections with code sketches and diagrams.

## Implementation Details

### Commands

| Command | Description |
|---------|-------------|
| `/plan [prompt]` | Start a new planning session. Optional initial prompt. |
| `/plan-edit` | Open the current plan in the editor for direct editing. |
| `/plan-approve` | Approve the plan and begin execution in a fresh session. |
| `/plan-show` | Display the current plan contents. |
| `/plan-cancel` | Cancel planning, restore normal mode. |

### Keyboard Shortcut

| Key | Action |
|-----|--------|
| `Ctrl+Alt+P` | Toggle plan mode / show plan status |

### CLI Flag

| Flag | Description |
|------|-------------|
| `--plan` | Start pi directly in planning mode |

### Custom Tools (Planning Phase Only)

#### `plan_ask`
Allows the model to ask the user structured questions during the Q&A phase. Uses `ctx.ui.custom()` to present questions and collect answers in a clean UI.

```typescript
parameters: Type.Object({
  questions: Type.Array(Type.Object({
    question: Type.String({ description: "The question to ask" }),
    context: Type.Optional(Type.String({ description: "Why this question matters" })),
  })),
})
```

The tool presents each question to the user, collects answers, and returns them to the model. This gives the model explicit control over what it needs to know.

#### `plan_draft`
Called by the model when it's ready to produce the plan. Writes the plan to `.pi/plans/<session-id>.plan.md` and transitions to the review phase. The model writes a full markdown document — not a structured schema. The content is free-form markdown, as rich and detailed as the task demands.

```typescript
parameters: Type.Object({
  content: Type.String({ description: "The full plan as a markdown document" }),
})
```

### Tool Restrictions

| Phase | Available Tools |
|-------|----------------|
| Q&A | `read`, `bash` (read-only allowlist), `grep`, `find`, `ls`, `plan_ask`, `plan_draft` |
| Review | `read`, `bash` (read-only allowlist), `grep`, `find`, `ls` |
| Execution | All tools (full access in fresh session) |

Bash commands during Q&A and Review phases are filtered through an allowlist (same approach as the existing plan-mode example: git status/log/diff, cat, grep, find, ls, tree, etc.).

### State Management

State is persisted via `pi.appendEntry()` so it survives session resume:

```typescript
interface PlanState {
  phase: "idle" | "qa" | "review" | "executing";
  planFile: string | null;      // Absolute path to the plan file
}
```

The `planFile` path is derived from the session ID: `.pi/plans/<session-id>.plan.md`. This ensures each planning session maps to exactly one file, and multiple pi instances never collide.

On `session_start`, the extension scans entries to reconstruct state. If a plan file exists on disk and the state says we're in review, we resume review mode.

### Event Handlers

#### `before_agent_start`
Injects phase-appropriate system prompt context:
- **Q&A phase**: Instructions to explore the codebase, ask questions via `plan_ask`, and call `plan_draft` when ready. The model is instructed to write a full, rich markdown document — not a checklist.
- **Review phase**: Instructions that the plan is at `.pi/plans/<session-id>.plan.md`, the user may ask for changes, and the model should suggest specific edits.

#### `tool_call`
- Blocks destructive bash commands during Q&A and review phases.
- Blocks `edit`/`write` tools during Q&A and review phases (except `plan_draft` writing to `.pi/plan.md`).

#### `agent_end`
- After Q&A phase: if `plan_draft` was called, transition to review and prompt the user with options (edit, suggest changes, approve, cancel).
- After review phase: prompt the user with the same options again.

#### `session_start`
Restore persisted state. Re-apply tool restrictions if resuming into Q&A or review phase.

### Execution Flow (Approval)

When the user runs `/plan-approve`:

1. Read `.pi/plans/<session-id>.plan.md` contents.
2. Call `ctx.newSession()` with a `setup` callback that:
   - Appends a user message containing the full plan with execution instructions.
3. The new session starts with full tool access and a clear context — only the plan.
4. The model implements the plan in the fresh session.
5. The old planning session remains accessible via `/resume`.

```typescript
// In /plan-approve command handler:
await ctx.waitForIdle();
const planContent = await fs.readFile(planState.planFile, "utf-8");

const result = await ctx.newSession({
  parentSession: ctx.sessionManager.getSessionFile(),
  setup: async (sm) => {
    sm.appendMessage({
      role: "user",
      content: [{
        type: "text",
        text: `Implement the following plan.\n\n${planContent}`,
      }],
      timestamp: Date.now(),
    });
  },
});
```

### UI Elements

#### Status (Footer)
- Q&A phase: `🔍 planning (Q&A)`
- Review phase: `📋 planning (review)`
- Shows in footer via `ctx.ui.setStatus()`

#### Notifications
- Phase transitions announced via `ctx.ui.notify()`
- Plan file location shown when draft is created

### Custom Message Renderer

Register a renderer for `customType: "pi-plan"` messages to display plan-related status updates (phase transitions, Q&A summaries, plan previews) with appropriate styling.

## Design Decisions

### Why files on disk instead of in-memory?
- Users can edit with their preferred editor (`vim`, `code`, etc.)
- Plans are git-trackable
- Survives crashes/restarts
- Inspectable outside of pi
- Clean handoff artifact between planning and execution
- Per-session file naming (`.pi/plans/<session-id>.plan.md`) means multiple pi instances across worktrees or parallel projects never collide

### Why a fresh session for execution?
- Clean context = better execution quality (no Q&A noise)
- The plan is the only context the executing agent needs
- Planning session preserved for reference via `/resume`
- Avoids context window bloat from the planning conversation

### Why `plan_ask` as a tool instead of just chatting?
- Structured Q&A gives the model explicit control over information gathering
- Questions can include context about why they matter
- Answers are collected cleanly and can be persisted
- The model decides when it has enough info (calls `plan_draft`)
- Better than hoping the model asks good questions in free-form chat

### Why restrict tools during planning?
- Prevents accidental modifications during exploration
- Forces the model to plan before acting
- Read-only access is sufficient for understanding a codebase
- Matches the mental model: planning ≠ doing

## Example Workflow

```
$ pi --plan "Add OAuth2 authentication to the API"

🔍 Plan mode active (Q&A phase)

> [Model reads codebase structure, auth files, config]
> [Model calls plan_ask]

┌─ Questions ─────────────────────────────────────┐
│ 1. Which OAuth2 provider(s) should be supported?│
│    → Why: Determines SDK dependencies and flow  │
│                                                  │
│ 2. Should we support refresh tokens?             │
│    → Why: Affects token storage and session mgmt │
└──────────────────────────────────────────────────┘

User answers: "Google and GitHub, yes to refresh tokens"

> [Model continues exploring, may ask more questions]
> [Model calls plan_draft — writes full markdown document]

📋 Plan written to .pi/plans/a3f8b2c1.plan.md

> [User reviews the plan]

> "The callback URL section should mention that we need
>  separate redirect URIs per environment"

> [Model reads the plan, suggests specific edits]

> /plan-edit
> [Opens in ctx.ui.editor for direct editing]

> /plan-approve

✓ Starting execution in new session...
🚀 Executing plan...

> [Fresh agent implements the plan with full tool access]
```

## Future Considerations (Out of Scope for v1)

- **Plan templates** for common workflows (refactor, add feature, fix bug)
- **Plan diffing** — show what changed between plan revisions
- **Sub-agent execution** — sections of the plan executed by separate agent instances
- **Plan listing** — `/plan-list` to browse and manage all plans in `.pi/plans/`
- **Plan reuse** — approve an existing plan file from a previous session for re-execution

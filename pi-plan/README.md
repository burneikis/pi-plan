# pi-plan

A planning extension for [pi-coding-agent](https://github.com/nickarino/pi-coding-agent) that adds a structured planning workflow before code execution.

## Quick Install

```bash
git clone https://github.com/burneikis/pi-plan.git /tmp/pi-plan && \
  cp -r /tmp/pi-plan/pi-plan ~/.pi/agent/extensions/pi-plan && \
  rm -rf /tmp/pi-plan
```

Instead of jumping straight into implementation, `pi-plan` guides the AI through a **Q&A → Plan Draft → Review → Execute** cycle — ensuring alignment before any code is written.

## How It Works

1. **Q&A Phase** — The agent explores the codebase (read-only) and asks you clarifying questions via the `plan_ask` tool to gather requirements and context.
2. **Draft Phase** — Once enough information is gathered, the agent writes a detailed implementation plan as a markdown document using `plan_draft`.
3. **Review Phase** — You review, discuss, and edit the plan until you're satisfied.
4. **Execution** — The approved plan is executed in a fresh session with full tool access.

During planning, all destructive operations (`edit`, `write`, non-read-only `bash` commands) are blocked — the agent can only read files and ask questions.

## Commands

| Command | Description |
|---|---|
| `/plan [prompt]` | Start a new planning session with an optional initial prompt |
| `/plan-show` | Display the current plan contents |
| `/plan-edit` | Edit the plan in the inline editor |
| `/plan-editor` | Open the plan in `$EDITOR` |
| `/plan-approve` | Approve the plan and begin execution in a fresh session |
| `/plan-cancel` | Cancel the planning session and restore normal mode |

## Custom Tools

The extension registers two tools available to the AI during the Q&A phase:

- **`plan_ask`** — Ask the user structured questions with optional context about why each question matters.
- **`plan_draft`** — Write the full implementation plan as a markdown document, transitioning to the review phase.

## Plan Storage

Plans are saved as markdown files at `.pi/plans/<session-id>.plan.md` in your project directory.

## Safety

During Q&A and review phases:

- Only read-only tools are active (`read`, `bash`, `grep`, `find`, `ls`)
- Bash commands are filtered to a safe allowlist (e.g., `cat`, `grep`, `find`, `ls`, `tree`, `git status/log/diff`, `jq`, etc.)
- `edit` and `write` tool calls are blocked entirely
- Full tool access is only restored when the plan is approved and execution begins in a new session

## Manual Installation

Copy the `pi-plan/` directory into your global extensions folder:

```bash
cp -r pi-plan/ ~/.pi/agent/extensions/pi-plan/
```

## Project Structure

```
pi-plan/
├── index.ts      # Extension entry point — commands, event hooks, tool blocking
├── planner.ts    # plan_ask and plan_draft tool registration
├── prompts.ts    # System prompt injections for each phase
├── render.ts     # Status bar updates
└── state.ts      # State types and helpers
```

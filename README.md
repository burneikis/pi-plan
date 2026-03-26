# Pi Plan

A [pi](https://github.com/badlogic/pi-mono) extension that adds a `/plan` command for structured plan-driven development. The agent creates a plan, you review and edit it, then the agent executes it in a fresh session.

## Installation

Copy or symlink this directory into your pi extensions:

```bash
# Global
ln -s ~/Code/pi-plan ~/.pi/agent/extensions/pi-plan

# Or project-local
ln -s /path/to/pi-plan .pi/extensions/pi-plan
```

Or test directly:

```bash
pi -e /path/to/pi-plan/index.ts
```

## Usage

```
/plan make a todo app with React and TypeScript
```

## Flow

1. **Plan** — You run `/plan <description>`. The agent explores the codebase and writes a `plan.md` file.
2. **Review** — You're prompted with options:
   - **Ready** — Execute the plan in a new session
   - **Edit** — Describe changes, agent rewrites the plan
   - **Open in $EDITOR** — Edit the plan file manually
   - **Cancel** — Discard and return to normal mode
3. **Execute** — A new session starts with the plan as context and full tool access.

## Plan Storage

Plans are stored at `~/.pi/agent/plans/<session_id>/plan.md` and persist across restarts.

## Plan Format

```markdown
# Plan: <title>

## Goal
Brief description of what we're building

## Steps

1. First step
2. Second step
3. Third step

## Notes
Additional context, constraints, or decisions
```

# Pi Plan

A [pi](https://github.com/badlogic/pi-mono) extension that brings Claude Code-style plan mode to pi. Run `/plan`, let the agent explore your codebase and draft a step-by-step plan, review and refine it, then execute in a clean session with full context.

## Features

- **Claude Code-style plan mode** — Agent analyzes your codebase read-only, then produces an actionable plan before touching anything
- **Fresh context execution** — Plans execute in a new session so the agent starts clean, with only the plan as context
- **Manual editing via `$EDITOR`** — Open the plan in your preferred editor (vim, nvim, etc.) for hands-on changes
- **Conversational edits** — Describe changes in natural language and the agent rewrites the plan for you
- **Persistent plans** — Plans are saved to `~/.pi/agent/plans/<session_id>/plan.md` and survive restarts

## Installation

```bash
pi install npm:@burneikis/pi-plan
```

Or test without installing:

```bash
pi -e npm:@burneikis/pi-plan
```

## Usage

```
/plan make a todo app with React and TypeScript
```

## Flow

1. **Plan** — You run `/plan <description>`. The agent explores the codebase (read-only) and writes a `plan.md` file.
2. **Review** — You're prompted with options:
   - **Ready** — Execute the plan in a new session with cleared context
   - **Edit** — Describe changes in natural language, agent rewrites the plan
   - **Open in $EDITOR** — Edit the plan file manually in your terminal editor
   - **Cancel** — Discard and return to normal mode
3. **Execute** — A fresh session starts with only the plan as context and full tool access.

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

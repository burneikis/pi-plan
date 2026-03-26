# Pi plan plan

This is an extension that adds plan mode to pi

It keeps session plans in a plan.md file in ~/.pi/agent/plans/session_id/plan.md

Usage is: /plan make a todo app

The agent should then write a plan.md file, then show it and ask the user if they are ready to execute the plan.

Options:

- Ready: clear context, execute the plan
- Edit: ask for changes
- Open in $EDITOR: open the plan.md file in the editor for manual editing, upon closing the editor, ask same question again (ready, edit, open in editor)

---
name: scope
description: Run the SDLC discovery phase. Accepts an RFP, client brief, meeting notes, or any unstructured input. Extracts scope using the business-analyst agent, validates the output, generates scope.docx, and initialises .sdlc/state.json. Pipeline entry point — must complete before /srs.
allowed_tools: ["Read", "Write", "Grep", "Glob", "Shell"]
---

# /scope — SDLC Discovery Phase

This command is defined in `commands/scope.md` in the repo.

If you are reading this from `.claude/commands/`, it exists to make `/scope`
discoverable as a project command without requiring users to manually copy files
into `~/.claude/commands/`.

Open `commands/scope.md` for the full workflow steps.


# ECC-SDLC — Install Guide

An **Everything Claude Code** distribution extended with an SDLC pipeline (scope → requirements → design → test → estimate → proposal) for Claude Code.

This guide walks you through installing it from the public GitHub marketplace in under 2 minutes.

---

## What You Get

- **Agents** — planner, architect, code-reviewer, tdd-guide, security-reviewer, business-analyst, solution-architect, compliance-checker, and more
- **Skills** — TDD, security review, API design, language-specific patterns (TypeScript, Python, Go, Java, Kotlin, Rust, C++, Swift, Perl, PHP)
- **Slash commands** — `/plan`, `/tdd`, `/code-review`, `/build-fix`, `/e2e`, plus the full SDLC pipeline: `/scope`, `/srs`, `/sds`, `/sts`, `/estimate`, `/proposal`
- **Hooks** — session persistence, strategic compaction, safety guards
- **Rules** — coding style, security, git workflow, language-specific conventions (installed separately — see Step 3)

---

## Prerequisites

1. **Claude Code CLI v2.1.0 or later**
   ```bash
   claude --version
   ```
2. **Git** installed and on your PATH
3. **Node.js 18+** (needed for SDLC command dependencies in Step 3 and the rules install in Step 4)

---

## Step 1 — Add the marketplace

Inside a Claude Code session, run one of these (both work):

```
/plugin marketplace add MuhammadAhmad21042002/ECC-SDLC
```

or, using the full git URL (required if the repo ever becomes private, or if GitHub shorthand resolution fails on your network):

```
/plugin marketplace add https://github.com/MuhammadAhmad21042002/ECC-SDLC.git
```

**How Claude Code resolves the argument:**

| What you pass | How Claude Code treats it |
|---|---|
| `owner/repo` (e.g. `MuhammadAhmad21042002/ECC-SDLC`) | Public GitHub — clones from `https://github.com/owner/repo.git` |
| Full URL starting with `https://`, `http://`, or `git@` | Git URL — clones directly from that URL |
| Local filesystem path | Registers a local marketplace (dev use only) |

This registers the GitHub repo as a plugin marketplace. Claude Code clones it to `~/.claude/plugins/marketplaces/ecc-sdlc/` so it can see what plugins are available to install. (The folder is named after the marketplace's `name` field in `marketplace.json`, not the GitHub repo name.)

> **Note:** This step only registers the catalog — no commands or agents are active yet.

---

## Step 2 — Install the plugin

```
/plugin install ecc-sdlc@ecc-sdlc
```

Or use the interactive installer:

```
/plugin
```

→ Go to **Discover** tab → select **ecc-sdlc** → click **Install for you**.

**After install — fully exit and reopen Claude Code.** Commands, agents, and skills are loaded once at startup, so a restart is required before they become available.

---

## Step 3 — Install SDLC command dependencies (required)

The SDLC commands (`/scope`, `/srs`, `/sds`, `/sts`, `/estimate`, `/proposal`) call Node.js scripts that depend on packages like `docx`, `exceljs`, `ajv`, and `sql.js`. Claude Code does **not** automatically install these — you must do it manually once, inside the plugin cache folder.

```bash
# macOS / Linux
cd ~/.claude/plugins/cache/ecc-sdlc/ecc-sdlc/1.9.0
npm install
```

```powershell
# Windows PowerShell
cd "$env:USERPROFILE\.claude\plugins\cache\ecc-sdlc\ecc-sdlc\1.9.0"
npm install
```

```cmd
:: Windows cmd
cd /d %USERPROFILE%\.claude\plugins\cache\ecc-sdlc\ecc-sdlc\1.9.0
npm install
```

This installs ~328 packages (about 10 seconds) into a `node_modules/` folder alongside the plugin's scripts. **Without this step, SDLC commands crash on first use** with errors like `Cannot find module 'docx'`.

> **If the `1.9.0` folder doesn't exist**, the plugin version may have changed. Check the actual path with:
> ```bash
> ls ~/.claude/plugins/cache/ecc-sdlc/ecc-sdlc/
> ```
> Then `cd` into the version folder that exists and run `npm install` there.

> **You only need to do this once per plugin version.** When you update the plugin, Claude Code installs a new version folder — so re-run `npm install` in the new folder after updates (see the Updating section).

---

## Step 4 — Install rules (manual, required)

Claude Code plugins cannot ship `rules/` automatically — this is an upstream limitation. Install them manually:

```bash
# Clone the repo
git clone https://github.com/MuhammadAhmad21042002/ECC-SDLC.git
cd ECC-SDLC

# Install dependencies
npm install

# macOS / Linux
./install.sh typescript         # pick your stack: typescript | python | golang | java | kotlin | rust | cpp | swift | php | perl
# Multiple at once:
# ./install.sh typescript python golang
```

```powershell
# Windows PowerShell
.\install.ps1 typescript
# Multiple at once:
# .\install.ps1 typescript python golang
```

This copies the language-agnostic `common/` rules plus the language-specific rules you selected into `~/.claude/rules/`, where Claude Code reads them on every session.

---

## Step 5 — Verify the install

Open a new Claude Code session and run:

```
/plugin list
```

You should see `ecc-sdlc@ecc-sdlc` listed as installed.

Try a command:

```
/plan "Add user authentication with OAuth"
```

If `/plan` is recognized and the planner agent responds, the install succeeded.

---

## SDLC Pipeline — Quick Start

The SDLC commands run in a fixed sequence. Each command produces an artifact and unlocks the next phase.

```
/scope       → scope-v1.docx        (discovery — RFP/brief → scope)
/srs         → srs-v1.docx          (requirements — REQ-FUNC, REQ-NFUNC, REQ-CON)
/sds         → sds-v1.docx          (design — components, DB schema, API contracts)
/sts         → sts-v1.docx          (test planning — test cases with traceability)
/estimate    → estimate-v1.xlsx     (Function Point Analysis → effort & cost)
/proposal    → proposal-v1.docx     (client-ready technical proposal)
```

All artifacts land in `.sdlc/artifacts/` at your project root. Pipeline state is tracked in `.sdlc/state.json`.

Check pipeline status any time:

```
/sdlc-status
```

---

## Updating

When new versions are released:

```
/plugin marketplace update ecc-sdlc
```

Then reinstall the plugin to pull the latest version:

```
/plugin install ecc-sdlc@ecc-sdlc
```

Restart Claude Code after update.

> **Re-run `npm install` in the new version folder.** Each plugin version gets its own cache folder, so dependencies installed in the old `1.9.0` folder don't carry over to `1.9.1`, `2.0.0`, etc. Repeat Step 3 using the new version's path.

---

## Uninstalling

```
/plugin uninstall ecc-sdlc@ecc-sdlc
/plugin marketplace remove ecc-sdlc
```

To also remove the manually installed rules:

```bash
# macOS / Linux
rm -rf ~/.claude/rules
```

```powershell
# Windows
Remove-Item -Recurse -Force "$env:USERPROFILE\.claude\rules"
```

---

## Troubleshooting

### "Command not found" after install

You forgot to restart Claude Code. Fully exit (all windows) and reopen — commands/agents load only at startup.

### Still seeing old plugin commands after uninstall

The cache may have leftover files. Delete manually:

```bash
# macOS / Linux
rm -rf ~/.claude/plugins/cache/ecc-sdlc
```

```powershell
# Windows
Remove-Item -Recurse -Force "$env:USERPROFILE\.claude\plugins\cache\ecc-sdlc"
```

Then restart Claude Code.

### SDLC command crashes with "Cannot find module 'docx'" / 'exceljs' / 'ajv' / 'sql.js'

You skipped Step 3. The plugin's `node_modules/` hasn't been installed in the cache folder. Run:

```bash
cd ~/.claude/plugins/cache/ecc-sdlc/ecc-sdlc/1.9.0 && npm install
```

(Use the correct version folder if `1.9.0` isn't the one present.)

### Hooks not firing

Ensure you're on Claude Code v2.1.0+. Older versions have incompatible hook loading.

### Rules not applied

Verify they were copied:

```bash
ls ~/.claude/rules/common/
```

If empty, re-run `./install.sh <language>` (or `.\install.ps1 <language>` on Windows) from the cloned repo.

---

## Repository

- **Source:** https://github.com/MuhammadAhmad21042002/ECC-SDLC
- **Issues & feedback:** open an issue on the repo

---

## License

MIT

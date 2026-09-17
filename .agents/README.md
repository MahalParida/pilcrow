# Agent instructions

Shared project context for coding agents lives here, so there is one file to
keep current instead of one per tool.

Every agent hard-codes where it looks for instructions, and none of them look
here. So each tool gets a small stub in the place it *does* look, pointing back
at this folder:

| Tool | Discovers | Points here via |
|---|---|---|
| Claude Code | `CLAUDE.md` (repo root) | `@.agents/CLAUDE.md` — an import |
| Codex | `AGENTS.md` (repo root) | not set up yet |
| Copilot | `.github/copilot-instructions.md` | not set up yet |
| Cursor | `.cursor/rules/*.mdc` | not set up yet |

Only Claude Code supports `@` imports. For the others, symlink the stub at the
discovery path to the file here (`ln -s ../.agents/CLAUDE.md AGENTS.md`) or
keep a copy and sync it — a copy will drift, so prefer the symlink.

If the root `CLAUDE.md` import ever stops resolving, replace it with a symlink:

```sh
rm CLAUDE.md && ln -s .agents/CLAUDE.md CLAUDE.md
```

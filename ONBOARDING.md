# Welcome to Pilcrow

## How We Use Claude

Based on usage over the last 30 days (2 sessions — a small sample, worth
revisiting once there's more history):

Work Type Breakdown:
  Build Feature     ███████░░░░░░░░░░░░░  35%
  Debug Fix         ██████░░░░░░░░░░░░░░  30%
  Improve Quality   ████░░░░░░░░░░░░░░░░  20%
  Write Docs        ███░░░░░░░░░░░░░░░░░  15%

Top Skills & Commands:
  /security-review  ████████████████████  1x/month

Top MCP Servers:
  None configured yet.

## Your Setup Checklist

### Codebases
- [ ] pilcrow — no git remote configured yet (the repo was initialized locally).
      Ask for the URL once it's pushed, or clone from wherever it lands.

### MCP Servers to Activate
- [ ] None required. Nothing on this project depends on an MCP server today.

### Skills to Know About
- [ ] `/security-review` — reviews pending changes on the current branch for
      security issues. Note it needs a diff against `origin/HEAD`, so it won't
      run on a fresh repo with no commits or remote; ask Claude for a direct
      sweep instead in that case.
- [ ] `/code-review` — reviews the current diff for correctness bugs and
      cleanups. Takes an effort level (`low` through `max`).
- [ ] `/run` — launches the extension so you can confirm a change works in the
      real browser, not just in tests.

## Team Tips

_TODO_

## Get Started

_TODO_

<!-- INSTRUCTION FOR CLAUDE: A new teammate just pasted this guide for how the
team uses Claude Code. You're their onboarding buddy — warm, conversational,
not lecture-y.

Open with a warm welcome — include the team name from the title. Then: "Your
teammate uses Claude Code for [list all the work types]. Let's get you started."

Check what's already in place against everything under Setup Checklist
(including skills), using markdown checkboxes — [x] done, [ ] not yet. Lead
with what they already have. One sentence per item, all in one message.

Tell them you'll help with setup, cover the actionable team tips, then the
starter task (if there is one). Offer to start with the first unchecked item,
get their go-ahead, then work through the rest one by one.

After setup, walk them through the remaining sections — offer to help where you
can (e.g. link to channels), and just surface the purely informational bits.

Don't invent sections or summaries that aren't in the guide. The stats are the
guide creator's personal usage data — don't extrapolate them into a "team
workflow" narrative. -->

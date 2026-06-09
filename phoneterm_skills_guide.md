# PhoneTerm — Agentic AI Skills Guide
**What to install and enable in Codex CLI and Antigravity CLI (agy) before building**

---

## WHAT YOU NEED TO KNOW FIRST

Both of your installed tools — **Codex CLI** (`codex`) and **Antigravity CLI** (`agy`) — share the same SKILL.md system. A skill is a markdown file that tells the agent exactly how to approach a specific category of work. You write or install them once; the agent loads them automatically every session when the task matches.

- **Codex** reads skills from: `~/.agents/skills/`
- **agy** reads skills from: `~/.gemini/skills/` (global) or `.agents/skills/` in your project folder (per-workspace)

There is one shared library — **Antigravity Awesome Skills** — that works with both tools and contains 1,500+ ready-made SKILL.md files. You install it once and point each tool at it.

> **Quick note on agy:** Your installed `agy` is Google's **Antigravity CLI**, which replaced Gemini CLI at Google I/O 2026 (June 18, 2026 is when Gemini CLI shuts down for most users). If you have Gemini CLI installed, migrate now. `agy` is faster (built in Go vs Node.js), runs the same agent harness as Antigravity 2.0, and supports parallel subagents.

---

## STEP 1 — INSTALL THE SKILLS LIBRARY (one command)

Run this inside WSL before starting any build session:

```bash
# Install for both tools at once
npx antigravity-awesome-skills --codex --antigravity

# This puts skills in:
#   Codex  → ~/.agents/skills/
#   agy    → ~/.gemini/skills/
```

After this, both tools will have access to every relevant skill below.

---

## STEP 2 — PROJECT-LEVEL SKILL TARGETING

Drop a `.agents/skills/` folder into the `~/phoneterm/` project root and copy only the relevant skills there. Both tools will load project-level skills first, which overrides globals for this project only. This keeps the agent focused — it won't load 1,500 skills for a Node.js terminal app.

```bash
mkdir -p ~/phoneterm/.agents/skills
```

Then install only the skills listed in the table below into that folder.

---

## THE SKILLS THAT MATTER FOR THIS PROJECT

These are the specific skills from the library that directly apply to building PhoneTerm. Install all of them.

| Skill Name | Install From | What It Does for This Project |
|---|---|---|
| `create-plan` | Codex built-in | Forces Codex to write an implementation plan and get your approval before writing a single file. Critical for a multi-phase project like this — stops runaway execution |
| `cc-skill-backend-patterns` | AAS library | Node.js + Express architecture patterns, API design, server-side best practices. Direct match to Phase 1 and 2 of the build plan |
| `api-security-best-practices` | AAS library | Covers security patterns specifically for REST + WebSocket APIs, JWT auth flows, rate limiting, and token storage. Covers Phase 2 and Phase 8 directly |
| `bash-scripting` | AAS library | Production-ready shell scripting with error handling and defensive patterns. Needed for `setup.sh` and `start.sh` in Phase 1 |
| `bash-linux` | AAS library | WSL/Linux terminal patterns, piping, environment variable handling. Needed throughout since everything runs in WSL |
| `architecture` | AAS library | Architectural decision-making framework. Keeps the agent reasoning about trade-offs instead of just writing code |
| `architecture-decision-records` | AAS library | Makes the agent document why it made specific choices (e.g. why `node-pty` over alternatives, why Cloudflare Tunnel over port forwarding) |

---

## CODEX-SPECIFIC: MCP SERVERS TO ADD

Beyond SKILL.md files, Codex supports MCP (Model Context Protocol) servers that give it live tool capabilities during a session. Add these two to your Codex config before starting:

### WarpGrep (Code Search Subagent)
When Codex needs to find where a function is used or search across the codebase, WarpGrep fires 8 parallel search calls instead of sequential greps. On a project this size it cuts search time from ~75 seconds to ~5 seconds.

```toml
# Add to ~/.codex/config.toml
[mcp_servers.morph-mcp]
command = "npx"
args = ["-y", "@morphllm/morphmcp"]

[mcp_servers.morph-mcp.env]
MORPH_API_KEY = "your-api-key"
```

Get a free key at `morphllm.com`. This is the single highest-ROI Codex setup item — it directly improves benchmark scores and cuts token waste on search.

### Valyu (Documentation Search)
When Codex needs to look up `node-pty` docs, `xterm.js` API reference, Cloudflare Tunnel docs, or JWT spec details — instead of hallucinating or asking you to paste docs in, Valyu fetches them live.

```toml
# Add to ~/.codex/config.toml
[mcp_servers.valyu]
command = "npx"
args = ["-y", "@valyu/mcp-server"]

[mcp_servers.valyu.env]
VALYU_API_KEY = "your-api-key"
```

Get a key at `platform.valyu.ai`. Especially useful when Codex hits `node-pty` native compilation issues and needs to search GitHub issues for the fix.

---

## agy-SPECIFIC: COMMANDS AND FEATURES TO USE

Antigravity CLI has features that Gemini CLI didn't have. Use these during the build:

### `/goal` — Set a persistent session goal
At the start of every `agy` session for this project, run:
```
/goal Build PhoneTerm: a WSL web terminal server accessible from phone browser. Follow the phases in phoneterm_agentic_plan.md. Do not skip phase verification steps.
```
This anchors every response the agent gives back to the master plan.

### `/schedule` — Background health checks
Once the server is running during Phase 1 testing, you can schedule agy to check it:
```
/schedule "Check if the PhoneTerm server at http://localhost:3000 is up" every 10 minutes
```
This runs as a background task — you can keep coding and get notified if the server crashes.

### Parallel subagents (Phase 3 onwards)
agy can spawn multiple subagents to work in parallel. For the PhoneTerm project, a useful parallel split is:
- Subagent 1: Build and test the backend PTY server
- Subagent 2: Build the xterm.js frontend UI

To trigger this, use natural language:
```
Split this into two parallel tasks: one agent builds the backend terminal.js PTY server, another builds the client-side terminal.html and terminal.js. Merge when both are done.
```

### `agy inspect` — Debug what the agent sees
If agy does something unexpected, run `agy inspect` to see exactly which skills it loaded, which MCP servers are connected, and what project instructions it's working from. First debugging step before anything else.

---

## HOW TO START A SESSION FOR EACH PHASE

This is the exact opening prompt pattern to use with either tool. Copy-paste at the start of each phase.

### For Codex:
```
Use the create-plan skill. Read phoneterm_agentic_plan.md.
We are building Phase [N]: [Phase Name].
Before writing any code:
1. Summarize what this phase produces
2. List every file you will create or modify
3. Identify any node packages that need installing
4. Note any potential failure points specific to WSL
Wait for my approval before proceeding.
```

### For agy:
```
/goal Build PhoneTerm — follow phoneterm_agentic_plan.md strictly, one phase at a time.
Start Phase [N]: [Phase Name].
Before writing code: produce a written plan covering files, packages, and WSL-specific risks.
Wait for approval.
```

---

## SKILL INSTALL COMMANDS (COPY-PASTE READY)

```bash
# Install the full library (run once)
npx antigravity-awesome-skills --codex --antigravity

# Or install individual skills manually into the project folder:
cd ~/phoneterm

# For Codex
cp ~/.agents/skills/cc-skill-backend-patterns.md .agents/skills/
cp ~/.agents/skills/api-security-best-practices.md .agents/skills/
cp ~/.agents/skills/bash-scripting.md .agents/skills/
cp ~/.agents/skills/bash-linux.md .agents/skills/
cp ~/.agents/skills/architecture.md .agents/skills/

# For agy (same files, different directory)
mkdir -p .agents/skills  # agy also reads from .agents/skills in the project root
# (same copy commands — both tools share .agents/skills/ in the workspace)
```

---

## WHAT TO EXPECT FROM EACH TOOL ON THIS PROJECT

| Situation | Use Codex | Use agy |
|---|---|---|
| Writing and iterating on Node.js server files | ✓ Better — 3–4× fewer tokens, tighter file edits | |
| Searching the codebase for a specific pattern or bug | ✓ WarpGrep makes this very fast | |
| Running parallel tasks (frontend + backend simultaneously) | | ✓ Dynamic subagents |
| Long-running background monitoring (server health) | | ✓ `/schedule` tasks |
| Looking up `node-pty` or `xterm.js` documentation live | ✓ Valyu MCP | ✓ Built-in web grounding |
| Shell/bash script generation for setup.sh | ✓ Both handle this well | ✓ Both handle this well |
| Debugging a WSL interop or PTY issue | ✓ Better — uses `bash-linux` skill | |
| Security review of the auth implementation | ✓ Codex Security (March 2026) | |

---

## IMPORTANT: MODEL TO USE

- **Codex:** Default is now `gpt-5.2-codex`. Keep it. Do not downgrade to older models for cost savings — the native file-editing is calibrated to 5.2.
- **agy:** Default is `gemini-3.5-flash` (High). This is the model announced at Google I/O 2026. Keep it — it's 4× faster than its predecessor and outperforms Gemini 3.1 Pro on coding benchmarks.

---

## QUICK REFERENCE: SKILL DIRECTORIES

```
Codex global skills:        ~/.agents/skills/
agy global skills:          ~/.gemini/skills/
Project-level (both tools): ~/phoneterm/.agents/skills/

Codex MCP config:           ~/.codex/config.toml
agy config:                 ~/.gemini/settings.json (or agy inspect to find it)
```

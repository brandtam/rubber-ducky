# Add Integration

Research and scaffold a new external service integration for Rubber-Ducky.

## Arguments

`$ARGUMENTS` — The name of the service to integrate (e.g., "slack", "linear", "notion", "discord")

## Behavior

### Step 1 — Research the service

Investigate how to connect to the service programmatically. Check in this order:

1. **MCP servers** — Search for an existing MCP server for the service (e.g., search npm for `@modelcontextprotocol/*`, search GitHub for `mcp-server-<service>`). MCP is the preferred connection method because it works natively with Claude Code.
2. **Official CLI** — Check if the service has an official CLI tool (like `gh` for GitHub). CLIs are the next best option — simple to shell out to, no auth libraries needed.
3. **REST/GraphQL API** — Check the service's developer docs for API access. This is the fallback — it works but requires more implementation (auth handling, HTTP calls, response parsing).

For each option found, note:
- How authentication works (OAuth, API key, token, CLI login)
- What operations are available (read, write, comment, status changes, search)
- Any rate limits or restrictions

Present findings to the user and recommend the best connection method.

### Step 2 — Determine capabilities

Based on the research, determine which of the standard Rubber-Ducky capabilities this integration can support:

| Capability | What it means |
|------------|---------------|
| `ingest` | Pull an item from the service into a wiki task page |
| `pull` | Refresh a wiki task page with latest data from the service |
| `push` | Create a new item in the service from a wiki task page |
| `comment` | Add a comment to an existing item in the service |
| `transition` | Change the status of an item in the service |

Some services won't support all capabilities. For example:
- A **read-only** integration (RSS, analytics) might only support `ingest`
- A **messaging** integration (Slack, Discord) might support `push` and `comment` but not `ingest` or `transition`
- A **full project management** integration (Linear, Notion) would support all five

Ask the user to confirm which capabilities they want to implement.

### Step 3 — Create the reference template

Create `references/<service>-ticket-template.md` following the pattern of existing templates. Read one of these for reference:

- @references/github-ticket-template.md (if it exists)
- @references/jira-ticket-template.md (if it exists)
- @references/asana-ticket-template.md (if it exists)

The template should define:
- **Tone** — how content should be written for this service's audience
- **Structure** — the format of items in this service (title/body, fields, etc.)
- **Field mapping** — how wiki frontmatter maps to service fields
- **Status mapping** — how wiki statuses map to service states (if applicable)

For messaging services like Slack, the template describes message formatting instead of ticket formatting.

### Step 4 — Scaffold the backend implementation

Create `src/lib/<service>-backend.ts` following the existing backend pattern. Read `src/lib/backend.ts` for the interface contract — the doc comment at the top describes exactly what a new backend must implement.

Use an existing backend as a structural reference:
- `src/lib/github-backend.ts` — if the new service uses a CLI
- `src/lib/asana-backend.ts` — if the new service uses an MCP server
- `src/lib/jira-backend.ts` — if the new service uses a REST API

The scaffolded file should include:
1. A factory function (`create<Service>Backend`) that returns a `Backend` object
2. Status mapping functions (if the service has statuses)
3. A connectivity check function (`check<Service>Connectivity`)
4. Stub implementations for each supported capability that throw `"Not yet implemented"` with a clear TODO
5. Full TypeScript types — no `any`

### Step 5 — Register the backend

Update `src/lib/backend.ts`:
1. Import the new factory and connectivity functions
2. Add the service to the `getBackend()` switch statement
3. Add the service to the `checkConnectivity()` switch statement

Update `src/lib/templates.ts`:
1. Add the service to the `BackendConfig.type` union type
2. If the service needs special config fields (like Jira's `server_url`), add them to `BackendConfig`
3. Add a case to `generateReferenceFiles()` to produce the ticket template
4. Optionally add a case to `generateBackendSkills()` for an ingest skill

### Step 6 — Create a test file

Create `src/__tests__/<service>-backend.test.ts` with:
- Tests for the status mapping functions
- Tests for the factory function (returns correct name, capabilities)
- Tests for the connectivity check function
- Stub test cases for each capability (marked with `.todo()` or a placeholder)

Use `src/__tests__/github-backend.test.ts` or `src/__tests__/asana-backend.test.ts` as a structural reference.

### Step 7 — Update the init wizard

Update `src/commands/init.ts`:
1. Add the service to `BACKEND_CHOICES`
2. Add default MCP server name to `MCP_DEFAULTS` (if using MCP)
3. Add any service-specific prompts to `collectBackendConfig()` (like Jira's server URL prompt)

### Step 8 — Summary

Present a checklist of everything created and modified:
- [ ] `references/<service>-ticket-template.md` — content formatting template
- [ ] `src/lib/<service>-backend.ts` — backend implementation (stubs)
- [ ] `src/__tests__/<service>-backend.test.ts` — test file
- [ ] `src/lib/backend.ts` — registered in factory and connectivity check
- [ ] `src/lib/templates.ts` — added to type union and reference generation
- [ ] `src/commands/init.ts` — added to init wizard choices

Note which capabilities are stubbed vs. fully implemented, and what the user needs to do next to complete the integration (e.g., "install the MCP server", "set up API credentials", "implement the ingest method").

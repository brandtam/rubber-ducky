# Walkthrough — setting up a Personal Finances project

> A concrete end-to-end example of using Claude Code to wire up a personal-finances project. Everything below is run by *talking to Claude* — the underlying CLI invocations are handled by the bundled skills. You never have to remember command names.
>
> Prereqs: a workspace (created via `rubber-ducky init`) and Claude Code authenticated. If the `printing-press` binary isn't installed yet, that's fine — Claude will tell you when you need it.
>
> Companion: [`telegram-ingest.md`](./telegram-ingest.md) for the bot-token setup used in the optional ingestion path.

---

## What you're building

A `wiki/projects/personal-finances.md` page that:

- Names the accounts and income streams it tracks.
- Lists the data sources feeding it (a `data_sources` frontmatter field using the `pp:` / `external:` / `wishlist:` prefix convention) so Claude knows where to look when you ask about money.
- Has dated `## Notes` entries describing what got wired up.
- Surfaces unresolved gaps as `wishlist:` entries that Claude reminds you about during health checks, plus an `install-gaps` reminder for any `pp:*` source you've named but haven't printed yet.

From there, Claude can help with weekly check-ins, monthly budgeting, and ad-hoc questions like *"how much did I spend on groceries last month?"* by combining the data sources you wired up with the daily-log content it already has.

---

## Goal: what "control of your money" actually means here

Pick the smallest set of feedback loops that genuinely change behavior. A realistic minimum:

1. **Weekly:** *Did I spend more than expected this week?* Requires near-real-time visibility into checking + credit card balances.
2. **Monthly:** *Did income cover expenses? What categories are drifting?* Requires categorized transactions and at least a rough income figure.
3. **Quarterly:** *Are my retirement contributions on track? Net worth moving the right direction?* Requires brokerage / 401k balances.

The order matters: weekly is highest signal, hardest to fake. Get that working first before chasing the 401k integration.

---

## Step 0 — Check that Printing Press is reachable

In Claude Code:

> **You:** *Is Printing Press set up in this workspace? Show me what's already printed and what's available upstream.*

Claude will report the install state and list any printed CLIs you already have. If `printing-press` isn't on your machine yet, Claude will surface the install line — that's the one piece of setup that has to happen outside Claude Code:

```
npx -y @mvanhorn/printing-press install starter-pack
```

Run that in a terminal, then come back. To browse what else is available, ask Claude to run `npx -y @mvanhorn/printing-press list` or `... search <keyword>` — those query PP's published catalog directly.

<details>
<summary>What Claude does behind the scenes</summary>

`rubber-ducky pp status` (binary + library state) and `rubber-ducky pp installed` (the printed-CLI list). Both return JSON; Claude reads it and tells you what matters. Catalog browsing is upstream — Claude shells out to `npx -y @mvanhorn/printing-press list` rather than mirroring it.

</details>

---

## Step 1 — Create the project page

> **You:** `/start-project Personal finances`

The `/start-project` skill creates the page, suggests a one-line description (accept or edit), and asks whether to wire up data sources now or later. Answer **now**. The skill hands off to `/add-data-source personal-finances` automatically.

---

## Step 2 — Answer two elicitation questions

`/add-data-source` will ask you two things. Be specific — the answers steer everything that follows.

**Q: What data would help with this project?**

Good answer:

> *"Day-to-day spending from my checking account and credit cards. Income from my paycheck, and ideally my 401k contributions. Balances on retirement accounts so I can see net worth trend."*

**Q: Are you already using anything for this — a tool, app, or spreadsheet?**

This is the high-signal question. Examples and what they imply:

| You say… | Claude should… |
|---|---|
| *"Monarch"* | Try to wire Monarch up first; fall back to Plaid (Monarch has no public API). Record as `external:monarch`. |
| *"YNAB"* | Same shape as Monarch — no public consumer API; suggest YNAB CSV import or Plaid. |
| *"Just a spreadsheet"* | Recommend Plaid via PP as the upgrade; offer CSV import as fallback. |
| *"Nothing"* | Recommend Plaid first; explain the auth flow. |
| *"Mercury"* | Use the `pp:mercury` catalog entry directly — that's the cleanest path. (Note: Mercury is a business bank — only relevant if you actually bank there.) |

For the walkthrough, assume your answer is *"Just a spreadsheet and I check my bank apps manually."*

---

## Step 3 — What gets recommended, and why

Claude should produce 2–4 grouped recommendations. For personal finance, the realistic shape:

### 3a. Checking + credit card transactions → **Plaid (via PP)**

Plaid is the answer for most US consumer banks and credit cards. Claude will tell you to install it with:

> **You:** `/printing-press plaid`

Once the print finishes, you'll have a `plaid-pp-cli` with local SQLite, balance and transaction commands, the agent-native flags the rest of the toolchain expects, and a paired `plaid-pp-mcp` server Claude Code can talk to directly. First-run auth is a developer-account-and-Link consent flow per institution; Claude will walk you through it.

**Tradeoffs Claude will mention:**

- Plaid sandbox is free; production access requires a developer account that gates real bank linking.
- Some banks rate-limit or break consent periodically. Re-auth is a recurring chore.
- Investment account coverage via Plaid varies — fine for taxable brokerage at Schwab/Fidelity, spotty for 401k providers. See the wishlist below.

When you confirm, Claude records `pp:plaid` in the project page's `data_sources` frontmatter for you.

### 3b. Income → **mostly CSV, sometimes Stripe**

If you're a W-2 employee, your payroll provider almost certainly doesn't have a consumer API. ADP, Gusto, Workday, Paychex — all employer-facing.

Realistic options Claude will lay out:

- **Plaid catches the deposit.** The paycheck shows up in your checking account; `plaid-pp-cli` will see it as a transaction. Covers *"did income land?"* and the dollar amount. Won't break down gross vs. taxes vs. 401k vs. net.
- **Manual pay-stub log.** Tell Claude to append the gross/taxes/contributions to a notes section each cycle. Tedious but accurate.
- **Stripe (via PP).** If you have freelance/contractor income through Stripe, ask Claude to print it with `/printing-press stripe`.

Claude records `external:payroll-csv` and (if applicable) `pp:stripe`.

### 3c. Retirement (401k, IRA, brokerage) → **mixed bag, expect manual**

Honest assessment:

- **Taxable brokerage at Schwab / Fidelity / Vanguard:** Plaid covers this for balance + holdings. Transactions can be flaky. Acceptable for net-worth tracking, weak for *"what trades happened."*
- **401k providers (Fidelity NetBenefits, Empower, Principal, etc.):** Generally no public API. Plaid coverage is unreliable. The honest answer is: log into the web UI on a quarterly cadence, and ask Claude to copy the balance into the project page's `## Notes`.
- **HSA / FSA:** Same shape as 401k. Usually no API. Quarterly manual check-in.

Claude records `pp:plaid` (already there from 3a — re-add is a safe no-op) and `wishlist:401k-api`. The wishlist entry surfaces in Claude's health check (Step 8) so you don't forget the gap exists.

### 3d. Budgeting app data (Monarch / YNAB / Copilot) → **external entry**

None of these expose a clean consumer API. Two options:

- **Treat the app as the source of truth.** Claude records `external:monarch`. It won't fetch from Monarch, but it'll know to defer to it when you mention budget categories.
- **Replace it with Plaid + local categorization.** More work, more control. Worth it only if the app's categorization is consistently wrong for you.

### 3e. (Optional) Ad-hoc capture → **Telegram bot (via PP)**

For everything that doesn't show up in your bank feed — receipts you want to remember, *"check what I spent on this trip"* questions you'd rather text in than open the laptop for — a Telegram bot is the right tool. Claude will suggest:

> **You:** `/printing-press telegram`

Bot creation (talking to `@BotFather`) and token storage are the same as for any Telegram bot; see [`telegram-ingest.md`](./telegram-ingest.md) for the BotFather walkthrough and `.env.local` token-storage step.

After the print finishes, Claude records `pp:telegram` on the project page. Now texting a receipt photo with a caption like *"Trader Joe's $87.42 groceries"* lands in `telegram-pp-cli`'s local store, where Claude can search for it later.

---

## Step 4 — The recommendation summary you should expect

After elicitation, Claude should give you something like:

> **My pick:** Start with `/printing-press plaid` — that's your highest-leverage move. It covers checking + credit cards (your weekly question) and gives you a partial answer on brokerage balances (your quarterly question). Skip Mercury (business banking — not relevant here). Income tracking via Plaid's transaction view is good enough for v1; CSV-import pay stubs only if/when you want gross-vs-net breakdown. 401k stays a wishlist item — no clean path exists. Want to install Plaid now? Run `/printing-press plaid`.

If Claude *doesn't* give you a clean recommendation like that — if it just lists everything in the catalog — push back. The skill's value is the opinionated cut, not the enumeration.

---

## Step 5 — What the page looks like after wiring

You don't write this — `/add-data-source` does. But here's what to expect on disk so you can recognize a healthy project page:

```markdown
---
title: Personal Finances
type: project
status: active
created: "2026-05-10"
data_sources:
  - pp:plaid
  - pp:telegram
  - external:payroll-csv
  - external:monarch
  - wishlist:401k-api
---

## Description

Track spending, income, and savings; weekly check-in, monthly review.
Pulls transaction data from Plaid (checking, credit cards, taxable brokerage).
Ad-hoc receipts captured via Telegram bot. Categories defer to Monarch;
pay-stub breakdown logged manually.

## Notes

- 2026-05-10: Wired up `pp:plaid` (Chase checking, Amex, Fidelity brokerage). Re-auth chore: monthly-ish based on prior experience.
- 2026-05-10: Wired up `pp:telegram` for ad-hoc receipt capture.
- 2026-05-10: Decided to keep Monarch for category management. Will revisit if categorization quality drops.
- 2026-05-10: 401k stays manual until a provider with a real API comes along. Quarterly balance check.
```

---

## Step 6 — Verify the wiring

> **You:** *Is everything wired up correctly for personal-finances?*

Claude will check whether each `pp:*` entry on the project page corresponds to a CLI that's actually printed locally. Healthy looks like:

> *"All referenced PP CLIs are installed. Three non-PP entries (`external:payroll-csv`, `external:monarch`, `wishlist:401k-api`) are informational — not gaps."*

If anything is named but not printed yet, Claude will tell you which `/printing-press <name>` to run.

<details>
<summary>What Claude does behind the scenes</summary>

`rubber-ducky pp gap personal-finances`, which cross-references the project's `data_sources` against `~/printing-press/library/` and reports any missing `pp:*` entries.

</details>

---

## Step 7 — The weekly / monthly / quarterly cadence

This is where it pays off. All three are pure conversations with Claude — no new commands, no slash skills required.

### Weekly check-in

> **You:** *Run through this week's spending — anything weird?*

Claude reads the project page, pulls the last 7 days of transactions via `plaid-pp-cli` (or `plaid-pp-mcp` if registered), compares against your recent baseline, flags outliers, and appends a dated `## Notes` entry to the project page with the summary.

### Monthly review

> **You:** *Monthly review — pull last month's transactions, categorize against Monarch's buckets, tell me where I drifted, and ask me about anything that doesn't fit.*

Claude pulls the full month, cross-references against your `external:monarch` note (you'll need to paste recent Monarch category data, or screenshot it — there's no API), surfaces variance, asks you about ambiguities (*"$340 to AMZN Mktp — groceries, household, or something else?"*), pulls captured receipts from `telegram-pp-cli` if wired, and writes a monthly summary note.

### Quarterly

> **You:** *Quarterly net-worth update — here are this quarter's retirement balances. Compute the trend.*

You manually log into each retirement account and paste the balances; Claude writes them into the project page's `## Notes` and computes net-worth trend across the prior four quarterly entries.

This is the part you wish was automated. It isn't. The `wishlist:401k-api` entry is your standing reminder that the gap is known.

---

## Step 8 — Periodic health check

> **You:** *Run a health check on the workspace.*

Claude runs `/doctor` and surfaces two relevant checks for finance:

- **`wishlist:`** — informational. *"personal-finances → 401k-api"*.
- **`install-gaps`** — informational. Lists any `pp:*` entry that's named in a project but not yet printed.

Neither is a failure. The wishlist entry is a known gap; the install-gaps check is a *"you said you'd install this; you haven't yet"* reminder.

---

## Common pitfalls

- **Plaid re-auth fatigue.** Expect to re-link Chase and Amex more often than you'd like. Some banks intentionally make Plaid relationships brittle.
- **Over-trusting Plaid categories.** They're a starting point, not ground truth. Monarch (or your own rules written into the project page) categorize better.
- **Trying to wire up the 401k.** It's a rabbit hole. Plaid sometimes works for some providers; usually doesn't. The CSV-export quarterly approach is genuinely fine — accept it as v1.
- **Asking Claude to log every transaction in `## Notes`.** Weekly summaries are the right cadence. Daily transaction lists become noise. Let `plaid-pp-cli`'s SQLite hold the transactions; let the project page hold the *summary*.
- **Forgetting `wishlist:` entries.** That's why the health check exists. If something's not yet wirable, ask Claude to record the gap rather than half-implementing.
- **Naming `pp:<name>` without printing.** Easy to do — `/add-data-source` records the intent immediately, but the corresponding `/printing-press <name>` is a separate step. The health check's `install-gaps` line catches this.

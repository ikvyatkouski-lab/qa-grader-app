# Richer Home Pages — Design Spec
_Date: 2026-04-11_

## Overview

Replace the current flat card grid on the Home tab with a richer, role-specific dashboard layout. Each role gets a personalized welcome banner, a hero stats strip, a two-column content section, and a score trend sparkline. CS Leader and Admin also get a review threshold control and a list of flagged tickets for human grader assignment.

## Approach

Full rewrite of `renderHome()` in `public/content.js`. New purpose-built HTML sections per role replace the generic `homeCard()` template. Chart.js (already loaded) renders the sparkline. New CSS classes added to `styles.css`. The `/api/home` endpoint gains additional response fields; two new endpoints handle threshold saves and ticket assignment.

No new files are introduced — all changes stay within the existing three frontend files plus `server.js`.

---

## Layout Structure (all roles)

**Welcome banner** — gradient background, personalized greeting (time-of-day-aware: "Good morning / afternoon / evening, [first name]"), one-line status summary, primary CTA button (role-appropriate action).

**Hero stats strip** — 4-column row of compact stat cards (number + label + sub-label). Content varies by role (see below).

**Two-column section** — left column: category breakdown bars + score trend sparkline. Right column: queue / recent tickets / notifications / leaderboard (varies by role).

**Review panel** (CS Leader + Admin only) — full-width card below the two-column section containing the threshold control and flagged ticket list.

---

## Per-Role Layouts

### Agent
- **Banner**: greeting + "N new graded tickets" CTA → jumps to New Tickets tab
- **Hero strip**: Week Score (coloured), Team Rank, Tickets Graded This Week (team), New Unread Count
- **Left col**: My score trend sparkline (6 weeks, Chart.js bar chart) + Worst Category bar
- **Right col**: Inline notifications (last 2–3, each with score + Open link) + Team leaderboard (top 5, current user highlighted)

### QA Grader
- **Banner**: greeting + "N tickets in queue" CTA → jumps to Grading tab
- **Hero strip**: In Queue (coloured amber if >0), Team Score This Week, Graded This Week (by me), Weekly Progress bar (X / 50 target)
- **Left col**: Category breakdown bars (all categories, team avg) + Team score trend sparkline
- **Right col**: My Queue (top 5 clickable rows → opens ticket) + Recently Graded by Me (last 3 with score) + Notifications (last 1–2)

### CS Leader / Admin
- **Banner**: greeting + team summary ("Team score 85% · 12 graded today · 3 need review") + CTA → review queue
- **Hero strip**: Team Score This Week, Graded Today, Need Review count (coloured amber if >0), Active Sessions
- **Left col**: Category breakdown bars (all categories) + Team score trend sparkline
- **Right col**: Agent leaderboard (all agents) + Recent Activity log (last 3 entries) + Notifications (last 3)
- **Review panel** (full-width, below): see section below

---

## Review Threshold + Assignment Panel (CS Leader + Admin)

A full-width card below the two-column section containing:

**Threshold control row**: label "Flag tickets below [___]% bot score" with an editable number input pre-filled with the current threshold, and a Save button. Saving calls `POST /api/settings/review-threshold`.

**Flagged tickets list**: tickets where `bot_total_percent < threshold AND assigned_grader IS NULL AND submitted = false`, sorted ascending by score. Each row shows:
- Ticket subject + ID
- Agent name
- Bot score (red-coloured)
- "Assign to…" grader dropdown (populated from `available_graders`)
- "Assign" button — calls `POST /api/tickets/:id/assign` with the selected grader

Once assigned, the ticket disappears from the list and appears in the grader's queue on their home page.

---

## New API Fields on `GET /api/home`

| Field | Type | Description | Roles |
|-------|------|-------------|-------|
| `score_trend` | `[{week: string, score: number}]` | Last 6 week-of labels + avg score. For agents: their personal score. For others: team score. | all |
| `leaderboard` | `[{agent: string, avg_score: number, rank: number}]` | Top agents this week by avg bot score, max 5 rows | all |
| `recent_tickets` | `[{id, subject, agent, total_percent, ticket_date}]` | Last 5 tickets graded (grader: graded by me; admin/cs_leader: any) | grader, cs_leader, admin |
| `grader_weekly_completed` | `number` | Tickets graded by this grader in the current ISO week | qa_grader |
| `grader_weekly_target` | `number` | Fixed at 50 (hardcoded default; configurable in a later iteration) | qa_grader |
| `review_threshold` | `number` | Current threshold from `settings` table, default 60 | cs_leader, admin |
| `review_tickets` | `[{id, subject, agent, bot_total_percent}]` | Tickets below threshold not yet assigned, sorted by score asc. `bot_total_percent` is computed server-side by joining tickets → grades and summing bot criterion scores (same logic as existing analytics queries). | cs_leader, admin |

---

## New API Endpoints

### `POST /api/settings/review-threshold`
- Auth: cs_leader or admin only
- Body: `{ threshold: number }` (integer 1–100)
- Upserts `settings` table row where `key = 'review_threshold'`
- Returns: `{ threshold: number }`

### `POST /api/tickets/:id/assign`
- Auth: cs_leader or admin only
- Body: `{ grader: string }` — grader username from `available_graders`
- Sets `assigned_grader = grader` on the ticket row
- Returns: `{ ok: true }`

---

## Database Changes

**New `settings` table** (created if missing on server start):
```sql
CREATE TABLE IF NOT EXISTS settings (
  key   text PRIMARY KEY,
  value text NOT NULL
);
```
Used to store `review_threshold` (and future settings). Single row per key.

No changes to the `tickets` table — `assigned_grader` column already exists.

---

## CSS Changes

New classes added to `styles.css`:

| Class | Purpose |
|-------|---------|
| `.home-banner` | Gradient welcome banner with flex layout |
| `.home-banner-cta` | Primary action button in banner |
| `.home-hero-strip` | 4-column grid of stat cards |
| `.home-hero-card` | Individual stat card (number + label) |
| `.home-two-col` | 2-column grid for left/right sections |
| `.home-section` | White-card-like container within a column |
| `.home-section-title` | Small uppercase label above a section |
| `.home-cat-bar-row` | Single category bar row (label + bar + pct) |
| `.home-sparkline-wrap` | Container sized for Chart.js canvas |
| `.home-leaderboard-row` | Single leaderboard entry row |
| `.home-progress-bar` | Weekly target progress bar wrapper |
| `.home-review-panel` | Full-width review threshold + ticket list card |
| `.home-review-ticket-row` | Single flagged ticket row with assign controls |
| `.home-notif-inline` | Compact notification item on home page |

---

## Behaviour Notes

- **Sparkline**: rendered with Chart.js bar chart, `responsive: false`, fixed height 80px. Labels are week-of strings (e.g. "Mar 31"). Uses existing Chart.js instance management pattern already in `content.js` to avoid canvas reuse errors.
- **Grader weekly target**: hardcoded to 50 for now. Progress bar shows X/50; if no target concept is needed later the bar can be removed without touching the API.
- **Leaderboard highlight**: the current user's row gets a subtle accent background so agents can quickly find themselves.
- **Clickable queue rows**: clicking a ticket row in the grader's queue section switches to the Grading tab and opens that ticket, reusing the existing tab-switch + ticket-open pattern.
- **Threshold save feedback**: after saving the threshold, the review panel refreshes inline without a full page reload.
- **Assignment feedback**: after clicking Assign, the row fades out and a success toast appears (reusing existing toast/notification pattern if one exists, otherwise a simple `setTimeout`-based fade).
- **Assignment notification**: `POST /api/tickets/:id/assign` also inserts a notification row for the assigned grader (same `notifications` table mechanism used elsewhere) so the grader sees a bell alert on their next page load.

---

## Out of Scope (for this iteration)

- Configurable grader weekly target in Admin settings
- CS Leader seeing per-grader workload on home (how many tickets each grader has assigned)
- Mobile-responsive home layout
- Workspace, Docs, and Ticket Folders features (separate specs)

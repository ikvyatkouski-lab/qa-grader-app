# Richer Home Pages Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the generic card grid on the Home tab with a rich, role-specific dashboard featuring a welcome banner, hero stats strip, two-column content section, and a review threshold + assignment panel for CS Leader / Admin.

**Architecture:** Full rewrite of `renderHome()` in `public/content.js`. New SQL queries added inline to the existing `/api/home` handler in `server.js`. Two new endpoints handle threshold saves and single-ticket assignment. All changes stay within the existing three frontend files plus `server.js` — no new files. All user data rendered into the DOM goes through the existing `escapeHtml()` utility before being interpolated into template strings set via innerHTML — this is the established pattern throughout the codebase.

**Tech Stack:** Vanilla JS, Express + PostgreSQL (`pg` pool), Chart.js (already loaded from CDN), plain CSS.

---

## File Map

| File | What changes |
|------|-------------|
| `server.js` | New `ensureSettingsTable()` function; 7 new SQL queries added to `/api/home`; new `POST /api/settings/review-threshold`; new `POST /api/tickets/:id/assign` |
| `public/styles.css` | 14 new CSS classes appended at the end |
| `public/content.js` | `renderHome()` completely replaced; new `homeGreeting()`, `homeCatBars()`, `homeSparklineHtml()`, `homeInitSparkline()` helpers added above it |

---

## No test framework note

This is a vanilla JS / Express app with no test runner. Each task includes a **Manual verification** step describing exactly what to check in the browser and terminal.

---

## Task 1: Create `settings` table

**Files:**
- Modify: `server.js` — add `ensureSettingsTable()` function after `ensureLogsTable()` (~line 381), add to startup chain at line 2674

- [ ] **Step 1: Add `ensureSettingsTable` function**

Open `server.js`. After the closing `}` of `ensureLogsTable()` (around line 381), insert:

```js
async function ensureSettingsTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS settings (
      key   text PRIMARY KEY,
      value text NOT NULL
    )
  `);
}
```

- [ ] **Step 2: Add call to startup chain**

Find this line (~line 2674):
```js
Promise.all([ensureSchema(), ensureReflectionSchema(), ensureLogsTable()])
```
Replace with:
```js
Promise.all([ensureSchema(), ensureReflectionSchema(), ensureLogsTable(), ensureSettingsTable()])
```

- [ ] **Step 3: Manual verification**

Restart the server (`node server.js`). Confirm no errors on startup. Connect to the DB and run:
```sql
SELECT * FROM settings;
```
Expected: empty table, no error.

- [ ] **Step 4: Commit**

```bash
git add server.js
git commit -m "feat: add settings table for configurable review threshold"
```

---

## Task 2: Extend `/api/home` — Agent role

**Files:**
- Modify: `server.js` — extend the `agent` branch of `/api/home` (around line 1086)

Add 2 queries: `score_trend` (personal, last 6 weeks) and `leaderboard` (top 5 agents this week).

- [ ] **Step 1: Add queries to the agent Promise.all**

Find the existing `Promise.all([newCount, weekScore, lastWeekScore, worstCat, teamRank])` in the agent branch. Add 2 more destructured variables and their queries at the end of the array:

```js
  // NEW: personal score trend — last 6 weeks
  pool.query(`
    WITH weeks AS (
      SELECT generate_series(
        date_trunc('week', NOW() AT TIME ZONE 'UTC') - INTERVAL '5 weeks',
        date_trunc('week', NOW() AT TIME ZONE 'UTC'),
        INTERVAL '1 week'
      ) AS ws
    )
    SELECT TO_CHAR(w.ws, 'Mon DD') AS week,
           COALESCE(ROUND(AVG(g.total_percent)), NULL) AS score
    FROM weeks w
    LEFT JOIN tickets t ON t.ticket_date::date >= w.ws::date
                        AND t.ticket_date::date < (w.ws + INTERVAL '1 week')::date
                        AND t.deleted_at IS NULL
    LEFT JOIN grades g ON g.ticket_id = t.id AND g.is_deleted = FALSE
                       AND g.submitted = TRUE
                       AND ${AGENT_KEY_SQL} = $1
    GROUP BY w.ws ORDER BY w.ws`, [agentKey]),

  // NEW: team leaderboard — top 5 agents this week
  pool.query(`
    SELECT MIN(${AGENT_LABEL_SQL}) AS agent,
           ROUND(AVG(g.total_percent)) AS avg_score,
           RANK() OVER (ORDER BY ROUND(AVG(g.total_percent)) DESC NULLS LAST) AS rank
    FROM tickets t JOIN grades g ON g.ticket_id = t.id AND g.is_deleted = FALSE
    WHERE t.deleted_at IS NULL AND g.submitted = TRUE
      AND t.ticket_date >= $1 AND t.ticket_date < $2
    GROUP BY ${AGENT_KEY_SQL}
    ORDER BY avg_score DESC NULLS LAST
    LIMIT 5`, [thisWeekFrom, thisWeekTo])
```

Update the destructuring to:
```js
const [newCount, weekScore, lastWeekScore, worstCat, teamRank, scoreTrendRows, leaderboardRows] = await Promise.all([...]);
```

- [ ] **Step 2: Add new fields to the agent return**

In the existing `return res.json({` for the agent branch, add at the end:

```js
  score_trend: scoreTrendRows.rows.map(r => ({ week: r.week, score: r.score !== null ? parseInt(r.score) : null })),
  leaderboard: leaderboardRows.rows.map(r => ({ agent: r.agent, avg_score: r.avg_score !== null ? parseInt(r.avg_score) : null, rank: parseInt(r.rank) }))
```

- [ ] **Step 3: Manual verification**

Log in as an agent, reload Home tab, check DevTools Network for `/api/home`. Confirm response contains:
- `score_trend`: array of 6 objects with `week` (e.g. `"Mar 31"`) and `score` (number or null)
- `leaderboard`: array of up to 5 objects with `agent`, `avg_score`, `rank`

- [ ] **Step 4: Commit**

```bash
git add server.js
git commit -m "feat: add score_trend and leaderboard to /api/home agent response"
```

---

## Task 3: Extend `/api/home` — QA Grader role

**Files:**
- Modify: `server.js` — extend the `qa_grader` branch of `/api/home`

Add 3 queries: `score_trend` (team, 6 weeks), `leaderboard` (top 5), `grader_weekly_completed`.

- [ ] **Step 1: Add queries to the grader Promise.all**

The existing grader `Promise.all` destructures 10 variables. Extend it to 13:

```js
const [pending, weekTeam, lastWeekTeam, worstCat, bestCat, topInbox, bestAgent, bestAgentLast, toGradeList, gradedList, scoreTrendRows, leaderboardRows, weeklyCompleted] = await Promise.all([
  // ... all existing 10 queries unchanged ...

  // NEW: team score trend — last 6 weeks
  pool.query(`
    WITH weeks AS (
      SELECT generate_series(
        date_trunc('week', NOW() AT TIME ZONE 'UTC') - INTERVAL '5 weeks',
        date_trunc('week', NOW() AT TIME ZONE 'UTC'),
        INTERVAL '1 week'
      ) AS ws
    )
    SELECT TO_CHAR(w.ws, 'Mon DD') AS week,
           COALESCE(ROUND(AVG(g.total_percent)), NULL) AS score
    FROM weeks w
    LEFT JOIN tickets t ON t.ticket_date::date >= w.ws::date
                        AND t.ticket_date::date < (w.ws + INTERVAL '1 week')::date
                        AND t.deleted_at IS NULL
    LEFT JOIN grades g ON g.ticket_id = t.id AND g.is_deleted = FALSE AND g.submitted = TRUE
    GROUP BY w.ws ORDER BY w.ws`),

  // NEW: team leaderboard — top 5 agents this week
  pool.query(`
    SELECT MIN(${AGENT_LABEL_SQL}) AS agent,
           ROUND(AVG(g.total_percent)) AS avg_score,
           RANK() OVER (ORDER BY ROUND(AVG(g.total_percent)) DESC NULLS LAST) AS rank
    FROM tickets t JOIN grades g ON g.ticket_id = t.id AND g.is_deleted = FALSE
    WHERE t.deleted_at IS NULL AND g.submitted = TRUE
      AND t.ticket_date >= $1 AND t.ticket_date < $2
    GROUP BY ${AGENT_KEY_SQL}
    ORDER BY avg_score DESC NULLS LAST
    LIMIT 5`, [thisWeekFrom, thisWeekTo]),

  // NEW: tickets this grader submitted this ISO week
  pool.query(`
    SELECT COUNT(*) AS cnt
    FROM grades g
    JOIN tickets t ON t.id = g.ticket_id AND t.deleted_at IS NULL
    WHERE g.is_deleted = FALSE AND g.submitted = TRUE
      AND g.submitted_at >= $1 AND g.submitted_at < $2
      AND (
        LOWER(BTRIM(COALESCE(g.grader_name, ''))) = ANY($3::text[])
        OR g.grader_user_id = $4
      )`, [thisWeekFrom, thisWeekTo, graderKeys, u.id])
]);
```

- [ ] **Step 2: Add new fields to the grader return**

In the existing `return res.json({` for the grader branch, add at the end:

```js
  score_trend: scoreTrendRows.rows.map(r => ({ week: r.week, score: r.score !== null ? parseInt(r.score) : null })),
  leaderboard: leaderboardRows.rows.map(r => ({ agent: r.agent, avg_score: r.avg_score !== null ? parseInt(r.avg_score) : null, rank: parseInt(r.rank) })),
  grader_weekly_completed: parseInt(weeklyCompleted.rows[0]?.cnt || 0),
  grader_weekly_target: 50
```

- [ ] **Step 3: Manual verification**

Log in as qa_grader. In `/api/home` response confirm `score_trend` (6 items), `leaderboard` (up to 5), `grader_weekly_completed` (a number), `grader_weekly_target: 50`.

- [ ] **Step 4: Commit**

```bash
git add server.js
git commit -m "feat: add score_trend, leaderboard, grader_weekly_completed to /api/home grader response"
```

---

## Task 4: Extend `/api/home` — CS Leader / Admin role

**Files:**
- Modify: `server.js` — extend the `cs_leader`/`admin` branch

Add: `score_trend`, `leaderboard`, `review_threshold` (from settings), `review_tickets` (parameterised by threshold).

- [ ] **Step 1: Add 3 queries to cs_leader/admin Promise.all**

The existing array has 11 queries. Extend to 14:

```js
const [userCount, activeSessionCount, recentLogs, weekTeam, lastWeekTeam, worstCat, bestCat, topInbox, unassigned, bestAgent, bestAgentLast, scoreTrendRows, leaderboardRows, thresholdRow] = await Promise.all([
  // ... all existing 11 queries unchanged ...

  // NEW: team score trend — last 6 weeks
  pool.query(`
    WITH weeks AS (
      SELECT generate_series(
        date_trunc('week', NOW() AT TIME ZONE 'UTC') - INTERVAL '5 weeks',
        date_trunc('week', NOW() AT TIME ZONE 'UTC'),
        INTERVAL '1 week'
      ) AS ws
    )
    SELECT TO_CHAR(w.ws, 'Mon DD') AS week,
           COALESCE(ROUND(AVG(g.total_percent)), NULL) AS score
    FROM weeks w
    LEFT JOIN tickets t ON t.ticket_date::date >= w.ws::date
                        AND t.ticket_date::date < (w.ws + INTERVAL '1 week')::date
                        AND t.deleted_at IS NULL
    LEFT JOIN grades g ON g.ticket_id = t.id AND g.is_deleted = FALSE AND g.submitted = TRUE
    GROUP BY w.ws ORDER BY w.ws`),

  // NEW: leaderboard top 5 this week
  pool.query(`
    SELECT MIN(${AGENT_LABEL_SQL}) AS agent,
           ROUND(AVG(g.total_percent)) AS avg_score,
           RANK() OVER (ORDER BY ROUND(AVG(g.total_percent)) DESC NULLS LAST) AS rank
    FROM tickets t JOIN grades g ON g.ticket_id = t.id AND g.is_deleted = FALSE
    WHERE t.deleted_at IS NULL AND g.submitted = TRUE
      AND t.ticket_date >= $1 AND t.ticket_date < $2
    GROUP BY ${AGENT_KEY_SQL}
    ORDER BY avg_score DESC NULLS LAST
    LIMIT 5`, [thisWeekFrom, thisWeekTo]),

  // NEW: review threshold from settings
  pool.query(`SELECT value FROM settings WHERE key = 'review_threshold'`)
]);
```

- [ ] **Step 2: Compute review_tickets after parallel queries**

After all the sequential follow-up queries (`lastTopInbox`, `lastWorstCat`, `lastBestCat`, `graders`), add:

```js
const threshold = parseInt(thresholdRow.rows[0]?.value ?? 60);

const reviewTicketsRes = await pool.query(`
  SELECT t.id, t.subject, t.agent, t.inbox, t.ticket_date,
         g.total_percent AS bot_total_percent
  FROM tickets t
  LEFT JOIN grades g ON g.ticket_id = t.id AND g.is_deleted = FALSE
  WHERE t.deleted_at IS NULL
    AND (t.assigned_grader IS NULL OR BTRIM(t.assigned_grader) = '')
    AND (g.id IS NULL OR g.submitted = FALSE)
    AND (g.total_percent IS NULL OR g.total_percent < $1)
  ORDER BY g.total_percent ASC NULLS FIRST, t.ticket_date DESC
  LIMIT 50`, [threshold]);
```

- [ ] **Step 3: Add new fields to cs_leader/admin return**

In the existing `return res.json({`, add at the end:

```js
  score_trend: scoreTrendRows.rows.map(r => ({ week: r.week, score: r.score !== null ? parseInt(r.score) : null })),
  leaderboard: leaderboardRows.rows.map(r => ({ agent: r.agent, avg_score: r.avg_score !== null ? parseInt(r.avg_score) : null, rank: parseInt(r.rank) })),
  review_threshold: threshold,
  review_tickets: reviewTicketsRes.rows
```

- [ ] **Step 4: Manual verification**

Log in as cs_leader. In `/api/home` JSON confirm `score_trend`, `leaderboard`, `review_threshold: 60` (default), `review_tickets` (array).

- [ ] **Step 5: Commit**

```bash
git add server.js
git commit -m "feat: add score_trend, leaderboard, review_threshold, review_tickets to cs_leader/admin /api/home"
```

---

## Task 5: Add `POST /api/settings/review-threshold` endpoint

**Files:**
- Modify: `server.js` — add endpoint after the `GET /api/notifications` block (~line 1830)

- [ ] **Step 1: Add the endpoint**

```js
app.post('/api/settings/review-threshold', requireAuth, async (req, res) => {
  try {
    const { role } = req.session.user;
    if (!['cs_leader', 'admin'].includes(role)) return res.status(403).json({ error: 'Forbidden' });
    const { threshold } = req.body;
    const val = parseInt(threshold);
    if (!Number.isInteger(val) || val < 1 || val > 100) return res.status(400).json({ error: 'threshold must be 1–100' });
    await pool.query(
      `INSERT INTO settings (key, value) VALUES ('review_threshold', $1)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
      [String(val)]
    );
    logAction(req, 'review_threshold_updated', { threshold: val });
    res.json({ threshold: val });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: error.message });
  }
});
```

- [ ] **Step 2: Manual verification**

With a cs_leader session cookie:
```bash
curl -s -X POST http://localhost:3000/api/settings/review-threshold \
  -H "Content-Type: application/json" \
  -b "<session-cookie>" \
  -d '{"threshold": 75}' | jq .
```
Expected: `{"threshold":75}`.

Then verify in DB: `SELECT * FROM settings;` → should show `key=review_threshold, value=75`.

Test guard: send `{"threshold": 150}` → expect `{"error":"threshold must be 1–100"}`.

- [ ] **Step 3: Commit**

```bash
git add server.js
git commit -m "feat: add POST /api/settings/review-threshold endpoint"
```

---

## Task 6: Add `POST /api/tickets/:id/assign` endpoint

**Files:**
- Modify: `server.js` — add endpoint after the existing `POST /api/tickets/assign` (bulk, ~line 2410)

Note: existing `POST /api/tickets/assign` (bulk, no `:id`) is unchanged.

- [ ] **Step 1: Add the endpoint**

```js
app.post('/api/tickets/:id/assign', requireAuth, async (req, res) => {
  try {
    const { role } = req.session.user;
    if (!['cs_leader', 'admin'].includes(role)) return res.status(403).json({ error: 'Forbidden' });
    const ticketId = parseInt(req.params.id);
    if (!ticketId) return res.status(400).json({ error: 'invalid ticket id' });
    const { grader } = req.body;
    if (!grader || typeof grader !== 'string') return res.status(400).json({ error: 'grader required' });

    const graderCheck = await pool.query(
      `SELECT id FROM users WHERE username = $1 AND role = 'qa_grader' AND is_active = TRUE`,
      [grader]
    );
    if (!graderCheck.rows.length) return res.status(400).json({ error: 'Unknown or inactive grader' });

    await pool.query(
      `UPDATE tickets SET assigned_grader = $1 WHERE id = $2 AND deleted_at IS NULL`,
      [grader, ticketId]
    );
    logAction(req, 'ticket_assigned', { ticket_id: ticketId, grader });
    res.json({ ok: true });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: error.message });
  }
});
```

- [ ] **Step 2: Manual verification**

```bash
curl -s -X POST http://localhost:3000/api/tickets/123/assign \
  -H "Content-Type: application/json" \
  -b "<cs_leader-session-cookie>" \
  -d '{"grader": "alex.g"}' | jq .
```
Expected: `{"ok":true}`.

Check DB: `SELECT id, assigned_grader FROM tickets WHERE id = 123;` — should be updated.

Test guard: send a non-existent grader name → expect `{"error":"Unknown or inactive grader"}`.

- [ ] **Step 3: Commit**

```bash
git add server.js
git commit -m "feat: add POST /api/tickets/:id/assign endpoint"
```

---

## Task 7: Add CSS classes to `styles.css`

**Files:**
- Modify: `public/styles.css` — append 14 new classes at the end (current file ends around line 492)

- [ ] **Step 1: Append CSS at the end of `public/styles.css`**

```css
/* ── Richer Home Page ─────────────────────────────────────── */
.home-banner{background:linear-gradient(135deg,#1e293b 0%,#0f172a 100%);border-radius:12px;padding:20px 24px;display:flex;align-items:center;justify-content:space-between;gap:16px;margin-bottom:16px}
.home-banner h2{font-size:1.25rem;font-weight:700;color:#f1f5f9;margin:0 0 4px}
.home-banner p{font-size:.85rem;color:#94a3b8;margin:0}
.home-banner-cta{flex-shrink:0;background:var(--ac);color:#fff;border:none;border-radius:8px;padding:9px 18px;font-size:.85rem;font-weight:600;cursor:pointer;white-space:nowrap}
.home-banner-cta:hover{opacity:.88}
.home-hero-strip{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:16px}
.home-hero-card{background:var(--card);border:1px solid var(--bd);border-radius:10px;padding:14px 16px}
.home-hero-card .home-big{font-size:1.6rem;font-weight:700;line-height:1.1;margin-bottom:2px}
.home-hero-card .home-sub{font-size:.75rem;color:var(--mu)}
.home-two-col{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:16px}
.home-section{background:var(--card);border:1px solid var(--bd);border-radius:10px;padding:16px}
.home-section-title{font-size:.7rem;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--mu);margin-bottom:10px}
.home-cat-bar-row{display:flex;align-items:center;gap:8px;margin-bottom:6px;font-size:.8rem}
.home-cat-bar-row .home-cat-label{flex:0 0 110px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--tx)}
.home-cat-bar-row .bar-track{flex:1;background:var(--bd);border-radius:4px;height:6px;overflow:hidden}
.home-cat-bar-row .bar-fill{height:100%;border-radius:4px;background:var(--ac)}
.home-cat-bar-row .bar-pct{flex:0 0 36px;text-align:right;color:var(--mu);font-size:.75rem}
.home-sparkline-wrap{position:relative;height:80px;margin-top:10px}
.home-leaderboard-row{display:flex;align-items:center;gap:8px;padding:6px 8px;border-radius:6px;font-size:.8rem;margin-bottom:2px}
.home-leaderboard-row.me{background:rgba(99,102,241,.12)}
.home-leaderboard-row .lb-rank{flex:0 0 22px;color:var(--mu);font-weight:600}
.home-leaderboard-row .lb-name{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.home-leaderboard-row .lb-score{font-weight:700}
.home-progress-bar{background:var(--bd);border-radius:6px;height:8px;overflow:hidden;margin-top:6px}
.home-progress-bar .bar-fill{height:100%;border-radius:6px;background:var(--ac)}
.home-review-panel{background:var(--card);border:1px solid var(--bd);border-radius:10px;padding:16px;margin-bottom:16px}
.home-review-panel .threshold-row{display:flex;align-items:center;gap:8px;margin-bottom:14px;flex-wrap:wrap}
.home-review-panel .threshold-row label{font-size:.82rem;color:var(--tx)}
.home-review-panel .threshold-row input[type=number]{width:60px;background:var(--bg);border:1px solid var(--bd);border-radius:6px;padding:4px 8px;color:var(--tx);font-size:.85rem;text-align:center}
.home-review-panel .threshold-row button{background:var(--ac);color:#fff;border:none;border-radius:6px;padding:5px 14px;font-size:.82rem;font-weight:600;cursor:pointer}
.home-review-ticket-row{display:flex;align-items:center;gap:10px;padding:8px 10px;border-radius:7px;background:var(--bg);margin-bottom:6px;font-size:.8rem}
.home-review-ticket-row .rt-info{flex:1;min-width:0}
.home-review-ticket-row .rt-subject{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--tx)}
.home-review-ticket-row .rt-meta{color:var(--mu);font-size:.73rem;margin-top:2px}
.home-review-ticket-row .rt-score{font-weight:700;color:var(--rd);flex-shrink:0}
.home-review-ticket-row select{background:var(--bg);border:1px solid var(--bd);border-radius:5px;color:var(--tx);font-size:.78rem;padding:3px 6px;flex-shrink:0}
.home-review-ticket-row .assign-btn{background:#10b981;color:#fff;border:none;border-radius:5px;padding:4px 10px;font-size:.78rem;font-weight:600;cursor:pointer;flex-shrink:0;white-space:nowrap}
.home-notif-inline{display:flex;align-items:flex-start;gap:8px;padding:7px 0;border-bottom:1px solid var(--bd);font-size:.8rem}
.home-notif-inline:last-child{border-bottom:none}
.home-notif-inline .ni-score{font-weight:700;flex-shrink:0}
.home-notif-inline .ni-text{flex:1;color:var(--tx)}
.home-notif-inline a{color:var(--ac);text-decoration:none;font-size:.75rem}
```

- [ ] **Step 2: Manual verification**

Open the app in browser. DevTools → Console — confirm no CSS parse errors. Inspect the DOM for any existing `.home-section` elements to confirm the new styles are loaded.

- [ ] **Step 3: Commit**

```bash
git add public/styles.css
git commit -m "feat: add 14 new home page CSS classes"
```

---

## Task 8: Frontend — shared helpers above `renderHome()`

**Files:**
- Modify: `public/content.js` — add 4 helper functions immediately before `async function renderHome()` (~line 1932)

- [ ] **Step 1: Insert helpers before `renderHome()`**

Find the line `async function renderHome() {`. Immediately before it, insert:

```js
function homeGreeting(firstName) {
  const h = new Date().getHours();
  const tod = h < 12 ? 'morning' : h < 17 ? 'afternoon' : 'evening';
  return `Good ${tod}, ${escapeHtml(firstName || 'there')}`;
}

function homeCatBars(categories) {
  if (!categories || !categories.length) return '<span style="color:var(--mu);font-size:.8rem">No category data yet</span>';
  return categories.map(c => {
    const label = CAT_LABELS[c.category_id] || c.category_id;
    const pct = c.avg_score != null ? Math.round(c.avg_score) : 0;
    return `<div class="home-cat-bar-row">
      <span class="home-cat-label" title="${escapeHtml(label)}">${escapeHtml(label)}</span>
      <div class="bar-track"><div class="bar-fill" style="width:${pct}%"></div></div>
      <span class="bar-pct">${pct}%</span>
    </div>`;
  }).join('');
}

function homeSparklineHtml(canvasId) {
  return `<div class="home-sparkline-wrap"><canvas id="${canvasId}" height="80"></canvas></div>`;
}

function homeInitSparkline(canvasId, trend, chartKey) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;
  if (charts[chartKey]) { try { charts[chartKey].destroy(); } catch(e) {} }
  charts[chartKey] = new Chart(canvas, {
    type: 'bar',
    data: {
      labels: trend.map(p => p.week),
      datasets: [{
        data: trend.map(p => p.score),
        backgroundColor: trend.map(p => p.score == null ? 'rgba(99,102,241,0.2)' : 'rgba(99,102,241,0.7)'),
        borderRadius: 4,
        barPercentage: 0.65
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false }, tooltip: {
        callbacks: { label: ctx => ctx.raw != null ? ctx.raw + '%' : 'No data' }
      }},
      scales: {
        x: { grid: { display: false }, ticks: { font: { size: 10 } } },
        y: { display: false, min: 0, max: 100 }
      }
    }
  });
}
```

- [ ] **Step 2: Manual verification**

Open browser console and confirm:
- `typeof homeGreeting` → `"function"`
- `homeGreeting('Alex')` returns `"Good morning, Alex"` (or afternoon/evening)
- `typeof homeCatBars` → `"function"`
- `typeof homeInitSparkline` → `"function"`

- [ ] **Step 3: Commit**

```bash
git add public/content.js
git commit -m "feat: add homeGreeting, homeCatBars, homeSparklineHtml, homeInitSparkline helpers"
```

---

## Task 9: Frontend — replace `renderHome()` (Agent layout)

**Files:**
- Modify: `public/content.js` — replace the entire `renderHome()` function (~lines 1932–2135)

Delete the old function body and replace with the full new implementation. Build it in stages across Tasks 9–12; after Task 12 it is complete.

- [ ] **Step 1: Replace `renderHome()` with new skeleton + Agent branch**

```js
async function renderHome() {
  const wrap = document.getElementById('home-wrap');
  if (!wrap) return;
  wrap.innerHTML = '<div class="home-loading">Loading\u2026</div>';

  let d;
  try {
    const r = await fetch(`${API_BASE}/api/home`, { credentials: 'include' });
    if (!r.ok) throw new Error(await r.text());
    d = await r.json();
  } catch (e) {
    console.error('Dashboard load failed', e);
    wrap.innerHTML = `<div class="home-loading">Failed to load dashboard</div>`;
    return;
  }

  const role = d.role;
  availableGraders = Array.isArray(d.available_graders) ? d.available_graders : availableGraders;
  const firstName = (user?.name || user?.username || '').split(/[\s.]/)[0];
  let html = '';

  // ── AGENT ──────────────────────────────────────────────────
  if (role === 'agent') {
    const scoreColor = d.week_score != null ? scol(d.week_score) : 'var(--mu)';
    const hasNew = d.new_tickets_count > 0;

    html += `<div class="home-banner">
      <div>
        <h2>${homeGreeting(firstName)}</h2>
        <p>${hasNew
          ? `You have <strong style="color:var(--ac)">${d.new_tickets_count}</strong> new graded ticket${d.new_tickets_count !== 1 ? 's' : ''} to review`
          : `You\u2019re all caught up \u2014 no new graded tickets`}</p>
      </div>
      ${hasNew ? `<button class="home-banner-cta" id="home-go-new">View new tickets</button>` : ''}
    </div>`;

    html += `<div class="home-hero-strip">
      <div class="home-hero-card">
        <div class="home-big" style="color:${scoreColor}">${d.week_score != null ? d.week_score + '%' : '\u2014'}</div>
        <div class="home-sub">Week score</div>
        <div class="home-sub" style="margin-top:3px">${d.week_ticket_count} ticket${d.week_ticket_count !== 1 ? 's' : ''} graded</div>
      </div>
      <div class="home-hero-card">
        <div class="home-big">#${d.rank || '\u2014'}</div>
        <div class="home-sub">Team rank</div>
        <div class="home-sub" style="margin-top:3px">of ${d.rank_total} agents</div>
      </div>
      <div class="home-hero-card">
        <div class="home-big" style="color:${hasNew ? 'var(--ac)' : 'var(--mu)'}">${d.new_tickets_count}</div>
        <div class="home-sub">New unread</div>
        <div class="home-sub" style="margin-top:3px">graded tickets</div>
      </div>
      <div class="home-hero-card">
        <div class="home-big">${d.last_week_score != null ? d.last_week_score + '%' : '\u2014'}</div>
        <div class="home-sub">Last week score</div>
        <div class="home-sub" style="margin-top:3px">${scoreTrend(d.week_score, d.last_week_score)}</div>
      </div>
    </div>`;

    const worstCatBars = d.worst_category ? homeCatBars([d.worst_category]) : '<span style="color:var(--mu);font-size:.8rem">No data yet</span>';

    const notifRows = (notifications?.items || []).slice(0, 3).map(n => {
      const scoreCol = n.total_percent != null ? scol(n.total_percent) : 'var(--mu)';
      return `<div class="home-notif-inline">
        <span class="ni-score" style="color:${scoreCol}">${n.total_percent != null ? n.total_percent + '%' : '\u2014'}</span>
        <span class="ni-text">${escapeHtml(n.subject || 'Ticket')} graded by ${escapeHtml(n.grader_name || '\u2014')}</span>
        <a href="#" class="home-open-ticket-link" data-id="${n.ticket_id}">Open</a>
      </div>`;
    }).join('') || '<span style="color:var(--mu);font-size:.8rem">No new notifications</span>';

    const myName = (user?.name || user?.username || '').toLowerCase();
    const lbRows = (d.leaderboard || []).map(lb => {
      const isMe = lb.agent && lb.agent.toLowerCase().includes(myName);
      return `<div class="home-leaderboard-row${isMe ? ' me' : ''}">
        <span class="lb-rank">#${lb.rank}</span>
        <span class="lb-name">${escapeHtml(lb.agent || '\u2014')}</span>
        <span class="lb-score" style="color:${lb.avg_score != null ? scol(lb.avg_score) : 'var(--mu)'}">${lb.avg_score != null ? lb.avg_score + '%' : '\u2014'}</span>
      </div>`;
    }).join('') || '<span style="color:var(--mu);font-size:.8rem">No data yet</span>';

    html += `<div class="home-two-col">
      <div class="home-section">
        <div class="home-section-title">Score trend (6 weeks)</div>
        ${homeSparklineHtml('home-sparkline-agent')}
        <div style="margin-top:14px">
          <div class="home-section-title">Needs attention</div>
          ${worstCatBars}
        </div>
      </div>
      <div>
        <div class="home-section" style="margin-bottom:12px">
          <div class="home-section-title">Recent grades</div>
          ${notifRows}
        </div>
        <div class="home-section">
          <div class="home-section-title">Team leaderboard</div>
          ${lbRows}
        </div>
      </div>
    </div>`;
  }

  // QA Grader, CS Leader/Admin appended in Tasks 10-11
  // Event wiring and sparklines in Task 11 after closing the if blocks

  wrap.innerHTML = html;

  if (role === 'agent' && d.score_trend?.length) {
    homeInitSparkline('home-sparkline-agent', d.score_trend, 'homeSparklineAgent');
  }

  wrap.querySelectorAll('.home-open-ticket-link').forEach(a => {
    a.addEventListener('click', e => {
      e.preventDefault();
      const tid = parseInt(a.dataset.id);
      const ticket = TICKETS.find(t => t.id === tid);
      if (ticket) pickTicket(ticket);
    });
  });
  document.getElementById('home-go-new')?.addEventListener('click', () => switchTab('n'));
}
```

- [ ] **Step 2: Manual verification**

Log in as agent. Home tab shows:
- Gradient banner with time-of-day greeting and ticket count
- 4-card hero strip (week score, rank, new unread, last week)
- Left column: sparkline bar chart + worst category bar
- Right column: notifications + leaderboard rows

No console errors.

- [ ] **Step 3: Commit**

```bash
git add public/content.js
git commit -m "feat: new agent home layout — banner, hero strip, sparkline, leaderboard"
```

---

## Task 10: Frontend — QA Grader home layout

**Files:**
- Modify: `public/content.js` — add qa_grader branch and update event wiring inside `renderHome()`

- [ ] **Step 1: Add QA Grader branch**

Inside `renderHome()`, find the comment `// QA Grader, CS Leader/Admin appended in Tasks 10-11`. Replace it with:

```js
  // ── QA GRADER ──────────────────────────────────────────────
  if (role === 'qa_grader') {
    const hasQueue = d.pending_grading > 0;
    const completed = d.grader_weekly_completed || 0;
    const target = d.grader_weekly_target || 50;
    const progressPct = Math.min(100, Math.round((completed / target) * 100));

    html += `<div class="home-banner">
      <div>
        <h2>${homeGreeting(firstName)}</h2>
        <p>${hasQueue
          ? `<strong style="color:var(--am)">${d.pending_grading}</strong> ticket${d.pending_grading !== 1 ? 's' : ''} waiting in your queue`
          : `Your queue is empty \u2014 great work!`}</p>
      </div>
      ${hasQueue ? `<button class="home-banner-cta" id="home-go-grading">Go to queue</button>` : ''}
    </div>`;

    html += `<div class="home-hero-strip">
      <div class="home-hero-card">
        <div class="home-big" style="color:${hasQueue ? 'var(--am)' : 'var(--gr)'}">${d.pending_grading}</div>
        <div class="home-sub">In queue</div>
        <div class="home-sub" style="margin-top:3px">tickets to grade</div>
      </div>
      <div class="home-hero-card">
        <div class="home-big">${d.week_team_score != null ? d.week_team_score + '%' : '\u2014'}</div>
        <div class="home-sub">Team score this week</div>
        <div class="home-sub" style="margin-top:3px">${scoreTrend(d.week_team_score, d.last_week_team_score)}</div>
      </div>
      <div class="home-hero-card">
        <div class="home-big">${completed}</div>
        <div class="home-sub">Graded this week</div>
        <div class="home-progress-bar" style="margin-top:6px"><div class="bar-fill" style="width:${progressPct}%"></div></div>
        <div class="home-sub" style="margin-top:4px">${completed} / ${target} target</div>
      </div>
      <div class="home-hero-card">
        <div class="home-big">${d.last_week_team_score != null ? d.last_week_team_score + '%' : '\u2014'}</div>
        <div class="home-sub">Last week team</div>
      </div>
    </div>`;

    const catBarsHtml = [d.worst_category, d.best_category].filter(Boolean).length
      ? homeCatBars([d.worst_category, d.best_category].filter(Boolean))
      : '<span style="color:var(--mu);font-size:.8rem">No category data yet</span>';

    const queueRows = (d.to_grade || []).slice(0, 5).map(t =>
      `<div class="home-list-row" data-id="${t.id}" style="display:flex;gap:8px;padding:7px 4px;cursor:pointer;border-bottom:1px solid var(--bd);font-size:.8rem;align-items:center">
        <div style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(t.subject || String(t.id))}</div>
        <div style="color:var(--mu);flex-shrink:0;font-size:.73rem">${escapeHtml(t.agent || '\u2014')}</div>
        <span style="color:var(--am);font-weight:600;flex-shrink:0;font-size:.73rem">Pending</span>
      </div>`
    ).join('') || '<div style="color:var(--mu);font-size:.8rem;padding:6px 0">Queue is empty</div>';

    const recentRows = (d.recently_graded || []).slice(0, 3).map(t =>
      `<div style="display:flex;gap:8px;padding:5px 4px;border-bottom:1px solid var(--bd);font-size:.8rem;align-items:center">
        <div style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(t.subject || String(t.id))}</div>
        <span style="font-weight:700;color:${t.total_percent != null ? scol(t.total_percent) : 'var(--mu)'};flex-shrink:0">${t.total_percent != null ? t.total_percent + '%' : '\u2014'}</span>
      </div>`
    ).join('') || '<div style="color:var(--mu);font-size:.8rem;padding:6px 0">No recent grades</div>';

    const notifRows = (notifications?.items || []).slice(0, 2).map(n =>
      `<div class="home-notif-inline">
        <span class="ni-text">${escapeHtml(n.subject || 'Ticket')}</span>
      </div>`
    ).join('') || '<span style="color:var(--mu);font-size:.8rem">No notifications</span>';

    html += `<div class="home-two-col">
      <div class="home-section">
        <div class="home-section-title">Category breakdown</div>
        ${catBarsHtml}
        <div class="home-section-title" style="margin-top:14px">Team score trend (6 weeks)</div>
        ${homeSparklineHtml('home-sparkline-grader')}
      </div>
      <div>
        <div class="home-section" style="margin-bottom:12px">
          <div class="home-section-title">My queue <span style="color:var(--am);margin-left:4px">${(d.to_grade || []).length}</span></div>
          ${queueRows}
          ${(d.to_grade || []).length > 5 ? `<div style="text-align:center;margin-top:8px"><button class="btn-p home-action-btn" id="home-go-grading2">View all ${d.pending_grading}</button></div>` : ''}
        </div>
        <div class="home-section" style="margin-bottom:12px">
          <div class="home-section-title">Recently graded by me</div>
          ${recentRows}
        </div>
        <div class="home-section">
          <div class="home-section-title">Notifications</div>
          ${notifRows}
        </div>
      </div>
    </div>`;
  }

  // CS Leader/Admin appended in Task 11
```

- [ ] **Step 2: Update events + sparklines section**

Replace the existing sparkline init and event wiring at the bottom of `renderHome()` with:

```js
  wrap.innerHTML = html;

  if (role === 'agent' && d.score_trend?.length) {
    homeInitSparkline('home-sparkline-agent', d.score_trend, 'homeSparklineAgent');
  }
  if (role === 'qa_grader' && d.score_trend?.length) {
    homeInitSparkline('home-sparkline-grader', d.score_trend, 'homeSparklineGrader');
  }

  wrap.querySelectorAll('.home-list-row[data-id]').forEach(row => {
    row.addEventListener('click', () => {
      const tid = parseInt(row.dataset.id);
      const ticket = TICKETS.find(t => t.id === tid);
      if (ticket) pickTicket(ticket);
    });
  });
  wrap.querySelectorAll('.home-open-ticket-link').forEach(a => {
    a.addEventListener('click', e => {
      e.preventDefault();
      const tid = parseInt(a.dataset.id);
      const ticket = TICKETS.find(t => t.id === tid);
      if (ticket) pickTicket(ticket);
    });
  });
  document.getElementById('home-go-new')?.addEventListener('click', () => switchTab('n'));
  document.getElementById('home-go-grading')?.addEventListener('click', () => switchTab('g'));
  document.getElementById('home-go-grading2')?.addEventListener('click', () => switchTab('g'));
```

- [ ] **Step 3: Manual verification**

Log in as qa_grader. Home tab shows:
- Banner with queue count and "Go to queue" button (or empty state)
- Hero strip: queue size, team score, graded/50 progress bar, last week score
- Left: category breakdown bars + sparkline
- Right: queue top 5 (clickable — clicking opens ticket in Grading tab), recently graded, notifications

- [ ] **Step 4: Commit**

```bash
git add public/content.js
git commit -m "feat: new QA grader home layout with queue, progress bar, sparkline"
```

---

## Task 11: Frontend — CS Leader/Admin home + Review Panel

**Files:**
- Modify: `public/content.js` — add cs_leader/admin branch inside `renderHome()`

- [ ] **Step 1: Add CS Leader/Admin branch**

Inside `renderHome()`, find the comment `// CS Leader/Admin appended in Task 11`. Replace it with:

```js
  // ── CS LEADER / ADMIN ─────────────────────────────────────
  if (['cs_leader', 'admin'].includes(role)) {
    const needReview = (d.review_tickets || []).length;

    html += `<div class="home-banner">
      <div>
        <h2>${homeGreeting(firstName)}</h2>
        <p>Team score <strong>${d.week_team_score != null ? d.week_team_score + '%' : '\u2014'}</strong>
           \u00b7 ${d.week_ticket_count} graded this week
           \u00b7 ${needReview > 0
              ? `<strong style="color:var(--am)">${needReview} need${needReview === 1 ? 's' : ''} review</strong>`
              : 'no tickets need review'}</p>
      </div>
      ${needReview > 0 ? `<button class="home-banner-cta" id="home-go-review-panel">Review queue \u2193</button>` : ''}
    </div>`;

    html += `<div class="home-hero-strip">
      <div class="home-hero-card">
        <div class="home-big">${d.week_team_score != null ? d.week_team_score + '%' : '\u2014'}</div>
        <div class="home-sub">Team score this week</div>
        <div class="home-sub" style="margin-top:3px">${scoreTrend(d.week_team_score, d.last_week_team_score)}</div>
      </div>
      <div class="home-hero-card">
        <div class="home-big">${d.week_ticket_count}</div>
        <div class="home-sub">Graded this week</div>
      </div>
      <div class="home-hero-card">
        <div class="home-big" style="color:${needReview > 0 ? 'var(--am)' : 'var(--gr)'}">${needReview}</div>
        <div class="home-sub">Need review</div>
        <div class="home-sub" style="margin-top:3px">below ${d.review_threshold || 60}% threshold</div>
      </div>
      <div class="home-hero-card">
        <div class="home-big">${d.active_sessions}</div>
        <div class="home-sub">Active sessions</div>
        <div class="home-sub" style="margin-top:3px">${d.user_count} total users</div>
      </div>
    </div>`;

    const catBarsHtml = [d.worst_category, d.best_category].filter(Boolean).length
      ? homeCatBars([d.worst_category, d.best_category].filter(Boolean))
      : '<span style="color:var(--mu);font-size:.8rem">No category data yet</span>';

    const lbRows = (d.leaderboard || []).map(lb =>
      `<div class="home-leaderboard-row">
        <span class="lb-rank">#${lb.rank}</span>
        <span class="lb-name">${escapeHtml(lb.agent || '\u2014')}</span>
        <span class="lb-score" style="color:${lb.avg_score != null ? scol(lb.avg_score) : 'var(--mu)'}">${lb.avg_score != null ? lb.avg_score + '%' : '\u2014'}</span>
      </div>`
    ).join('') || '<span style="color:var(--mu);font-size:.8rem">No data yet</span>';

    const activityRows = (d.recent_logs || []).slice(0, 3).map(l =>
      `<div style="padding:5px 0;border-bottom:1px solid var(--bd);font-size:.78rem;display:flex;gap:6px;align-items:baseline">
        <span style="color:var(--tx);font-weight:600">${escapeHtml(l.username || '\u2014')}</span>
        <span style="color:var(--mu);flex:1">${escapeHtml(l.action)}</span>
        <span style="color:var(--mu);font-size:.7rem;flex-shrink:0">${new Date(l.created_at).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'})}</span>
      </div>`
    ).join('') || '<div style="color:var(--mu);font-size:.8rem;padding:4px 0">No recent activity</div>';

    const notifRows = (notifications?.items || []).slice(0, 1).map(n =>
      `<div class="home-notif-inline">
        <span class="ni-text">${escapeHtml(n.subject || 'Ticket')}</span>
      </div>`
    ).join('') || '<span style="color:var(--mu);font-size:.8rem">No notifications</span>';

    html += `<div class="home-two-col">
      <div class="home-section">
        <div class="home-section-title">Category breakdown</div>
        ${catBarsHtml}
        <div class="home-section-title" style="margin-top:14px">Team score trend (6 weeks)</div>
        ${homeSparklineHtml('home-sparkline-leader')}
      </div>
      <div>
        <div class="home-section" style="margin-bottom:12px">
          <div class="home-section-title">Agent leaderboard</div>
          ${lbRows}
        </div>
        <div class="home-section" style="margin-bottom:12px">
          <div class="home-section-title">Recent activity</div>
          ${activityRows}
        </div>
        <div class="home-section">
          <div class="home-section-title">Notifications</div>
          ${notifRows}
        </div>
      </div>
    </div>`;

    const graderOptions = (availableGraders || []).map(g =>
      `<option value="${escapeHtml(g.username)}">${escapeHtml(g.username)}</option>`
    ).join('');

    const reviewRows = (d.review_tickets || []).map(t =>
      `<div class="home-review-ticket-row" data-ticket-id="${t.id}">
        <div class="rt-info">
          <div class="rt-subject">#${t.id} \u2014 ${escapeHtml(t.subject || '\u2014')}</div>
          <div class="rt-meta">Agent: ${escapeHtml(t.agent || '\u2014')}</div>
        </div>
        <span class="rt-score">${t.bot_total_percent != null ? t.bot_total_percent + '%' : '\u2014'}</span>
        <select class="grader-select">
          <option value="">Assign to\u2026</option>
          ${graderOptions}
        </select>
        <button class="assign-btn">Assign</button>
      </div>`
    ).join('') || '<div style="color:var(--mu);font-size:.82rem;padding:4px 0">No tickets below the threshold \u2014 great job!</div>';

    html += `<div class="home-review-panel" id="home-review-panel">
      <div class="home-section-title">Review threshold + assignment</div>
      <div class="threshold-row">
        <label>Flag tickets below</label>
        <input type="number" id="review-threshold-input" min="1" max="100" value="${d.review_threshold || 60}">
        <label>% bot score</label>
        <button id="review-threshold-save">Save</button>
        <span id="review-threshold-msg" style="font-size:.78rem;color:var(--mu)"></span>
      </div>
      <div class="home-section-title" style="margin-bottom:8px">Tickets for review <span style="background:rgba(245,158,11,.15);color:var(--am);border-radius:4px;padding:1px 6px;margin-left:4px;font-size:.75rem">${needReview}</span></div>
      <div id="review-tickets-list">${reviewRows}</div>
    </div>`;
  }
```

- [ ] **Step 2: Add cs_leader/admin sparkline init**

In the sparkline init block at the bottom of `renderHome()`, add:

```js
  if (['cs_leader', 'admin'].includes(role) && d.score_trend?.length) {
    homeInitSparkline('home-sparkline-leader', d.score_trend, 'homeSparklineLeader');
  }
```

- [ ] **Step 3: Manual verification**

Log in as cs_leader or admin. Home tab shows:
- Banner with team score summary and review count
- 4-card hero strip
- Two-column with category bars + sparkline on left; leaderboard + activity + notifications on right
- Review panel below with threshold input and flagged ticket rows

No console errors.

- [ ] **Step 4: Commit**

```bash
git add public/content.js
git commit -m "feat: new CS leader/admin home layout with review panel"
```

---

## Task 12: Frontend — wire review panel events

**Files:**
- Modify: `public/content.js` — add event listeners at the bottom of `renderHome()`

- [ ] **Step 1: Add threshold save, scroll, and assign events**

After the existing event listener block at the bottom of `renderHome()`, add:

```js
  // Threshold save
  document.getElementById('review-threshold-save')?.addEventListener('click', async () => {
    const input = document.getElementById('review-threshold-input');
    const msg = document.getElementById('review-threshold-msg');
    const val = parseInt(input?.value);
    if (!val || val < 1 || val > 100) { if (msg) msg.textContent = 'Enter 1\u2013100'; return; }
    if (msg) msg.textContent = 'Saving\u2026';
    try {
      const r = await fetch(`${API_BASE}/api/settings/review-threshold`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ threshold: val })
      });
      if (!r.ok) throw new Error(await r.text());
      if (msg) msg.textContent = '\u2713 Saved';
      setTimeout(() => {
        if (msg) msg.textContent = '';
        renderHome();
      }, 1200);
    } catch (e) {
      if (msg) msg.textContent = 'Error: ' + e.message;
    }
  });

  // Scroll banner CTA to review panel
  document.getElementById('home-go-review-panel')?.addEventListener('click', () => {
    document.getElementById('home-review-panel')?.scrollIntoView({ behavior: 'smooth' });
  });

  // Per-ticket assign buttons
  wrap.querySelectorAll('#review-tickets-list .assign-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const row = btn.closest('.home-review-ticket-row');
      if (!row) return;
      const ticketId = row.dataset.ticketId;
      const grader = row.querySelector('.grader-select')?.value;
      if (!grader) { alert('Please select a grader first'); return; }
      btn.disabled = true;
      btn.textContent = '\u2026';
      try {
        const r = await fetch(`${API_BASE}/api/tickets/${ticketId}/assign`, {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ grader })
        });
        if (!r.ok) throw new Error(await r.text());
        row.style.transition = 'opacity .3s';
        row.style.opacity = '0';
        setTimeout(() => row.remove(), 320);
      } catch (e) {
        btn.disabled = false;
        btn.textContent = 'Assign';
        alert('Assignment failed: ' + e.message);
      }
    });
  });
```

- [ ] **Step 2: Manual verification — threshold save**

As cs_leader: change threshold from 60 to 75, click Save. Confirm:
- Message shows "Saving…" then "✓ Saved"
- After ~1.2s, page refreshes with new threshold value shown in hero strip and threshold input

Verify in DB: `SELECT value FROM settings WHERE key = 'review_threshold';` → `75`

- [ ] **Step 3: Manual verification — assign**

Select a grader in a flagged ticket row and click Assign. Confirm:
- Row fades out and disappears
- DB: `SELECT assigned_grader FROM tickets WHERE id = <ticket_id>;` → grader username

- [ ] **Step 4: Manual verification — banner scroll**

If review tickets exist, click "Review queue ↓" in banner — page should scroll smoothly to the review panel.

- [ ] **Step 5: Commit**

```bash
git add public/content.js
git commit -m "feat: wire threshold save and assign events on home review panel"
```

---

## Spec Coverage Self-Review

| Spec requirement | Task |
|-----------------|------|
| Welcome banner — gradient, time-of-day greeting | 9, 10, 11 |
| Hero strip — 4 cards per role | 9, 10, 11 |
| Two-column section | 9, 10, 11 |
| Category breakdown bars | 8, 9, 10, 11 |
| Sparkline (Chart.js bar, 80px, responsive:true) | 8, 9, 10, 11 |
| Agent: inline notifications + leaderboard (right col) | 9 |
| Agent: leaderboard highlights current user row | 9 |
| Grader: queue top 5 + recently graded + notifications (right col) | 10 |
| Grader: clickable queue rows open ticket | 10 |
| Grader: weekly progress bar (X/50) | 10 |
| CS Leader/Admin: leaderboard + activity + notifications (right col) | 11 |
| CS Leader/Admin: review panel full-width | 11 |
| Review threshold control (input + Save) | 11 |
| Assign to grader dropdown per ticket row | 11 |
| Threshold save refreshes panel inline | 12 |
| Assign row fades out after success | 12 |
| Banner CTA scrolls to review panel | 12 |
| score_trend API field (all roles) | 2, 3, 4 |
| leaderboard API field (all roles) | 2, 3, 4 |
| grader_weekly_completed + grader_weekly_target (50) | 3 |
| review_threshold API field | 4 |
| review_tickets API field | 4 |
| POST /api/settings/review-threshold | 5 |
| POST /api/tickets/:id/assign | 6 |
| settings DB table | 1 |
| 14 new CSS classes | 7 |
| Chart.js instance management (charts object) | 8 |

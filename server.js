const https = require('https');
const crypto = require('crypto');
const path = require('path');
require('dotenv').config();

const express = require('express');
const cors = require('cors');
const session = require('express-session');
const pg = require('pg');
const connectPgSimple = require('connect-pg-simple');
const bcrypt = require('bcrypt');

const app = express();
const { Pool } = pg;
const PgStore = connectPgSimple(session);

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

const allowedOrigins = new Set([
  'http://localhost:5500',
  'http://127.0.0.1:5500',
  ...String(process.env.CORS_ALLOWED_ORIGINS || '')
    .split(',')
    .map(origin => origin.trim())
    .filter(Boolean)
]);

function isAllowedOrigin(origin) {
  if (!origin) return true;
  if (allowedOrigins.has(origin)) return true;

  try {
    const parsed = new URL(origin);
    if (parsed.protocol !== 'https:') return false;
    // Allow Cloudflare Pages previews
    if (/\.pages\.dev$/i.test(parsed.hostname)) return true;
    // Allow any *.onrender.com (same service, different subdomain during deploys)
    if (/\.onrender\.com$/i.test(parsed.hostname)) return true;
    return false;
  } catch {
    return false;
  }
}

const corsOptions = {
  origin(origin, callback) {
    if (isAllowedOrigin(origin)) {
      return callback(null, true);
    }
    return callback(new Error(`Not allowed by CORS: ${origin}`));
  },
  credentials: true,
  optionsSuccessStatus: 204
};

app.set('trust proxy', 1);

app.use(cors(corsOptions));
app.options(/.*/, cors(corsOptions));
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin && isAllowedOrigin(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.append('Vary', 'Origin');
  }
  next();
});

app.use(express.json({ limit: '200mb' }));

app.use(session({
  proxy: true,
  store: new PgStore({
    pool,
    tableName: 'session',
    createTableIfMissing: true
  }),
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    secure: true,
    sameSite: 'none',
    maxAge: 1000 * 60 * 60 * 24 * 7
  }
}));

// Serve frontend static files from /public
app.use(express.static(path.join(__dirname, 'public')));

// Token auth (for cross-domain clients where SameSite=None cookies are blocked)
const TOKEN_TTL = 7 * 24 * 60 * 60 * 1000; // 7 days

function createToken(user) {
  const payload = Buffer.from(JSON.stringify({
    id: user.id, email: user.email, username: user.username, role: user.role,
    exp: Date.now() + TOKEN_TTL
  })).toString('base64url');
  const sig = crypto.createHmac('sha256', process.env.SESSION_SECRET).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}

function verifyToken(token) {
  if (!token || typeof token !== 'string') return null;
  const dot = token.lastIndexOf('.');
  if (dot < 1) return null;
  const payload = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = crypto.createHmac('sha256', process.env.SESSION_SECRET).update(payload).digest('base64url');
  if (sig.length !== expected.length) return null;
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString());
    if (data.exp && Date.now() > data.exp) return null;
    return data;
  } catch { return null; }
}

function getAuthUser(req) {
  if (req.session.user) return req.session.user;
  const authHeader = req.headers['authorization'] || '';
  if (authHeader.startsWith('Bearer ')) return verifyToken(authHeader.slice(7));
  return null;
}

function requireAuth(req, res, next) {
  const user = getAuthUser(req);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });
  req.session.user = user; // normalise so downstream middleware works
  next();
}

function requireAdmin(req, res, next) {
  if (!req.session.user || req.session.user.role !== 'admin') {
    return res.status(403).json({ error: 'Admin only' });
  }
  next();
}

// admin + cs_leader can delete individual tickets
function requireDeletePerm(req, res, next) {
  const role = req.session.user?.role;
  if (!['admin', 'cs_leader'].includes(role)) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  next();
}

// admin + cs_leader can manage users
function requireUserMgmt(req, res, next) {
  const role = req.session.user?.role;
  if (!['admin', 'cs_leader'].includes(role)) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  next();
}

function frontHeaders(accept = 'application/json') {
  return {
    Authorization: `Bearer ${process.env.FRONT_TOKEN}`,
    Accept: accept
  };
}

function frontGet(path, accept = 'application/json') {
  return new Promise((resolve, reject) => {
    const target = new URL(`${process.env.FRONT_BASE}${path}`);

    const req = https.request({
      hostname: target.hostname,
      path: target.pathname + target.search,
      method: 'GET',
      headers: frontHeaders(accept)
    }, (resp) => {
      const chunks = [];
      resp.on('data', chunk => chunks.push(chunk));
      resp.on('end', () => {
        resolve({
          statusCode: resp.statusCode || 500,
          headers: resp.headers,
          body: Buffer.concat(chunks)
        });
      });
    });

    req.on('error', reject);
    req.end();
  });
}

const BOT_PERCENT_SQL = `COALESCE(
  NULLIF(t.bot_payload->>'totalPercent', '')::numeric,
  CASE
    WHEN NULLIF(t.bot_payload->>'denominator', '') IS NOT NULL
      AND NULLIF(t.bot_payload->>'numerator', '') IS NOT NULL
      AND NULLIF(t.bot_payload->>'denominator', '')::numeric > 0
    THEN (NULLIF(t.bot_payload->>'numerator', '')::numeric / NULLIF(t.bot_payload->>'denominator', '')::numeric) * 100
    ELSE NULL
  END
)`;

const HUMAN_GRADE_SQL = `LOWER(BTRIM(COALESCE(NULLIF(g.grader_name, ''), NULLIF(g.grader_type, ''), 'bot'))) <> 'bot'`;
const GENERAL_PERCENT_SQL = `COALESCE(
  g.total_percent::numeric,
  CASE
    WHEN g.denominator IS NOT NULL
      AND g.numerator IS NOT NULL
      AND g.denominator::numeric > 0
    THEN (g.numerator::numeric / g.denominator::numeric) * 100
    ELSE NULL
  END
)`;
const AGENT_KEY_SQL = `CASE
  WHEN LOWER(BTRIM(COALESCE(t.agent, ''))) IN ('ed', 'ednalyn.c')
  THEN 'ednalyn.c'
  WHEN POSITION('@' IN LOWER(BTRIM(COALESCE(t.agent, '')))) > 0
    AND SPLIT_PART(LOWER(BTRIM(COALESCE(t.agent, ''))), '@', 2) IN ('usemotion.com', 'wonderly.com')
  THEN SPLIT_PART(LOWER(BTRIM(COALESCE(t.agent, ''))), '@', 1)
  ELSE LOWER(BTRIM(COALESCE(t.agent, '')))
END`;
const AGENT_LABEL_SQL = `CASE
  WHEN LOWER(BTRIM(COALESCE(t.agent, ''))) IN ('ed', 'ednalyn.c')
  THEN 'ednalyn.c@wonderly.com'
  WHEN POSITION('@' IN LOWER(BTRIM(COALESCE(t.agent, '')))) > 0
    AND SPLIT_PART(LOWER(BTRIM(COALESCE(t.agent, ''))), '@', 2) IN ('usemotion.com', 'wonderly.com')
  THEN SPLIT_PART(LOWER(BTRIM(COALESCE(t.agent, ''))), '@', 1) || '@wonderly.com'
  ELSE BTRIM(COALESCE(t.agent, ''))
END`;
const LOW_SCORE_REVIEW_CUTOFF_DATE = '2026-03-30';
const NEW_TICKET_ASSIGNMENT_CUTOFF_DATE = '2026-04-01';

function currentAgentKey(sessionUser) {
  return normalizeAgentIdentity(sessionUser?.email || sessionUser?.username);
}

function currentGraderKeys(sessionUser) {
  return [...new Set(
    [sessionUser?.username, sessionUser?.email]
      .map(value => String(value || '').trim().toLowerCase())
      .filter(Boolean)
  )];
}

function graderTicketAccessSql(ticketAlias, gradeAlias, namesParamIndex, userIdParamIndex) {
  return `(
    LOWER(BTRIM(COALESCE(${ticketAlias}.assigned_grader, ''))) = ANY($${namesParamIndex}::text[])
    OR ${gradeAlias}.grader_user_id = $${userIdParamIndex}
    OR LOWER(BTRIM(COALESCE(NULLIF(${gradeAlias}.grader_name, ''), NULLIF(${gradeAlias}.grader_type, ''), ''))) = ANY($${namesParamIndex}::text[])
  )`;
}

async function ensureSchema() {
  // Core tables — safe to run on every startup (IF NOT EXISTS)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id serial PRIMARY KEY,
      email text UNIQUE NOT NULL,
      username text UNIQUE NOT NULL,
      password_hash text NOT NULL,
      role text NOT NULL DEFAULT 'agent',
      is_active boolean NOT NULL DEFAULT true,
      created_at timestamptz NOT NULL DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS tickets (
      id bigserial PRIMARY KEY,
      conv_id text UNIQUE,
      subject text,
      agent text,
      inbox text,
      ticket_date date,
      week text,
      front_url text UNIQUE,
      created_time text,
      source_file_name text,
      imported_by_user_id integer REFERENCES users(id),
      bot_payload jsonb,
      imported_at timestamptz NOT NULL DEFAULT NOW(),
      deleted_at timestamptz,
      deleted_by_user_id integer REFERENCES users(id)
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS grades (
      id bigserial PRIMARY KEY,
      ticket_id bigint NOT NULL REFERENCES tickets(id),
      grader_user_id integer REFERENCES users(id),
      grader_name text,
      grader_type text,
      numerator integer,
      denominator integer,
      total_percent integer,
      qa_feedback text,
      agent_focus text,
      bot_similar text,
      bot_suggestion text,
      category text,
      brian_notes text,
      fixed text,
      submitted boolean NOT NULL DEFAULT false,
      submitted_at timestamptz,
      reflection_text text,
      reflection_submitted_at timestamptz,
      agent_acknowledged_at timestamptz,
      reflection_read_at timestamptz,
      review_duration_seconds integer,
      is_deleted boolean NOT NULL DEFAULT false,
      created_at timestamptz NOT NULL DEFAULT NOW(),
      updated_at timestamptz NOT NULL DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS grade_breakdown (
      id bigserial PRIMARY KEY,
      grade_id bigint NOT NULL REFERENCES grades(id) ON DELETE CASCADE,
      category_id text NOT NULL,
      score text,
      cause text,
      custom_cause text
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS grade_flags (
      id bigserial PRIMARY KEY,
      grade_id bigint NOT NULL REFERENCES grades(id) ON DELETE CASCADE,
      flag_id text NOT NULL,
      value text,
      cause text,
      custom_cause text
    )
  `);

  // Patch any missing columns on existing tables (safe to run repeatedly)
  await pool.query(`ALTER TABLE tickets ADD COLUMN IF NOT EXISTS created_time text`);
  await pool.query(`ALTER TABLE tickets ADD COLUMN IF NOT EXISTS source_file_name text`);
  await pool.query(`ALTER TABLE tickets ADD COLUMN IF NOT EXISTS imported_by_user_id integer REFERENCES users(id)`);
  await pool.query(`ALTER TABLE tickets ADD COLUMN IF NOT EXISTS deleted_by_user_id integer REFERENCES users(id)`);
  await pool.query(`ALTER TABLE tickets ADD COLUMN IF NOT EXISTS assigned_grader text`);

  // Indexes
  await pool.query(`CREATE INDEX IF NOT EXISTS tickets_agent_idx ON tickets (agent)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS tickets_imported_at_idx ON tickets (imported_at DESC)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS grades_ticket_id_idx ON grades (ticket_id)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS grade_breakdown_grade_id_idx ON grade_breakdown (grade_id)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS grade_flags_grade_id_idx ON grade_flags (grade_id)`);
}

async function ensureLogsTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS user_logs (
      id bigserial PRIMARY KEY,
      user_id integer,
      username text,
      role text,
      action text NOT NULL,
      details jsonb,
      ip text,
      created_at timestamptz NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS user_logs_created_at_idx ON user_logs (created_at DESC)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS user_logs_user_id_idx ON user_logs (user_id)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS user_logs_action_idx ON user_logs (action)`);
}

async function logAction(req, action, details = {}) {
  try {
    const u = req.session?.user;
    const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket?.remoteAddress || null;
    await pool.query(
      `INSERT INTO user_logs (user_id, username, role, action, details, ip) VALUES ($1, $2, $3, $4, $5, $6)`,
      [u?.id || null, u?.username || null, u?.role || null, action, JSON.stringify(details), ip]
    );
  } catch (e) {
    console.error('logAction failed:', e.message);
  }
}

async function ensureReflectionSchema() {
  const columnExists = async columnName => {
    const result = await pool.query(
      `SELECT 1
       FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name = 'grades'
         AND column_name = $1
       LIMIT 1`,
      [columnName]
    );
    return result.rows.length > 0;
  };

  const hadAgentAcknowledgedAt = await columnExists('agent_acknowledged_at');

  await pool.query(`ALTER TABLE grades ADD COLUMN IF NOT EXISTS reflection_text text`);
  await pool.query(`ALTER TABLE grades ADD COLUMN IF NOT EXISTS reflection_submitted_at timestamptz`);
  await pool.query(`ALTER TABLE grades ADD COLUMN IF NOT EXISTS agent_acknowledged_at timestamptz`);
  await pool.query(`ALTER TABLE grades ADD COLUMN IF NOT EXISTS reflection_read_at timestamptz`);
  await pool.query(`ALTER TABLE grades ADD COLUMN IF NOT EXISTS review_duration_seconds integer`);

  if (!hadAgentAcknowledgedAt) {
    await pool.query(
      `UPDATE grades
       SET agent_acknowledged_at = COALESCE(submitted_at, NOW())
       WHERE submitted = TRUE
         AND agent_acknowledged_at IS NULL`
    );
  }
}

async function findAccessibleGrade(ticketId, sessionUser) {
  const role = sessionUser?.role;

  if (role === 'agent') {
    const result = await pool.query(
      `SELECT
         t.id AS ticket_id,
         t.ticket_date,
         t.front_url,
         t.agent,
         t.subject,
         g.id AS grade_id,
         g.grader_user_id,
         g.grader_name,
         g.total_percent,
         g.submitted,
         g.submitted_at,
         g.reflection_text,
         g.reflection_submitted_at,
         g.agent_acknowledged_at,
         g.reflection_read_at
       FROM tickets t
       JOIN grades g ON g.ticket_id = t.id AND g.is_deleted = FALSE
       WHERE t.id = $1
         AND t.deleted_at IS NULL
         AND ${AGENT_KEY_SQL} = $2
       LIMIT 1`,
      [ticketId, currentAgentKey(sessionUser)]
    );
    return result.rows[0] || null;
  }

  if (role === 'qa_grader') {
    const graderKeys = currentGraderKeys(sessionUser);
    const result = await pool.query(
      `SELECT
         t.id AS ticket_id,
         t.ticket_date,
         t.front_url,
         t.agent,
         t.subject,
         g.id AS grade_id,
         g.grader_user_id,
         g.grader_name,
         g.total_percent,
         g.submitted,
         g.submitted_at,
         g.reflection_text,
         g.reflection_submitted_at,
         g.agent_acknowledged_at,
         g.reflection_read_at
       FROM tickets t
       JOIN grades g ON g.ticket_id = t.id AND g.is_deleted = FALSE
       WHERE t.id = $1
         AND t.deleted_at IS NULL
         AND ${graderTicketAccessSql('t', 'g', 2, 3)}
       LIMIT 1`,
      [ticketId, graderKeys, sessionUser.id]
    );
    return result.rows[0] || null;
  }

  const result = await pool.query(
    `SELECT
       t.id AS ticket_id,
       t.ticket_date,
       t.front_url,
       t.agent,
       t.subject,
       g.id AS grade_id,
       g.grader_user_id,
       g.grader_name,
       g.total_percent,
       g.submitted,
       g.submitted_at,
       g.reflection_text,
       g.reflection_submitted_at,
       g.agent_acknowledged_at,
       g.reflection_read_at
     FROM tickets t
     JOIN grades g ON g.ticket_id = t.id AND g.is_deleted = FALSE
     WHERE t.id = $1
       AND t.deleted_at IS NULL
     LIMIT 1`,
    [ticketId]
  );

  return result.rows[0] || null;
}

async function hardDeleteTickets(client, ticketIds) {
  const normalizedIds = [...new Set(
    (Array.isArray(ticketIds) ? ticketIds : [ticketIds])
      .map(value => Number(value))
      .filter(value => Number.isFinite(value))
  )];

  if (!normalizedIds.length) return [];

  const ticketIdTexts = normalizedIds.map(String);

  await client.query(
    `DELETE FROM user_logs
     WHERE details->>'ticket_id' = ANY($1::text[])`,
    [ticketIdTexts]
  );

  await client.query(
    `DELETE FROM grades
     WHERE ticket_id = ANY($1::bigint[])`,
    [normalizedIds]
  );

  const deleted = await client.query(
    `DELETE FROM tickets
     WHERE id = ANY($1::bigint[])
     RETURNING id`,
    [normalizedIds]
  );

  return deleted.rows.map(row => row.id);
}

function analyticsCategoryFilterSql(paramIndex) {
  return `(
    EXISTS (
      SELECT 1
      FROM grade_breakdown gb
      WHERE gb.grade_id = g.id
        AND gb.category_id = ANY($${paramIndex}::text[])
        AND gb.score ~ '^-?\\d+(\\.\\d+)?$'
    )
    OR EXISTS (
      SELECT 1
      FROM grade_flags gf
      WHERE gf.grade_id = g.id
        AND gf.flag_id = ANY($${paramIndex}::text[])
        AND gf.value IS NOT NULL AND gf.value != ''
    )
  )`;
}

function parseMultiQuery(value) {
  if (Array.isArray(value)) return value.flatMap(parseMultiQuery).filter(Boolean);
  if (value === null || value === undefined) return [];
  return String(value)
    .split(',')
    .map(v => v.trim())
    .filter(Boolean);
}

function normalizeAgentIdentity(value) {
  const raw = String(value || '').trim().toLowerCase();
  if (!raw) return '';
  if (raw === 'ed' || raw === 'ednalyn.c') return 'ednalyn.c';

  const [localPart, domain] = raw.split('@');
  if (localPart && ['usemotion.com', 'wonderly.com'].includes(domain)) {
    return localPart;
  }

  return raw;
}

function buildAnalyticsFilters(query = {}, options = {}) {
  const { scopedAgentKey = '', ignoreGrader = false } = options;
  const { grader = '', week = '', month = '', dateFrom = '', dateTo = '' } = query;
  const agents = parseMultiQuery(query.agent);
  const excludedAgents = parseMultiQuery(query.excludeAgent);
  const categories = parseMultiQuery(query.category);
  const inboxes = parseMultiQuery(query.inbox);
  const where = [
    't.deleted_at IS NULL',
    'g.is_deleted = FALSE',
    'g.submitted = TRUE'
  ];
  const params = [];

  if (grader && !ignoreGrader) {
    params.push(grader);
    where.push(`g.grader_name = $${params.length}`);
  }
  if (scopedAgentKey) {
    params.push(scopedAgentKey);
    where.push(`${AGENT_KEY_SQL} = $${params.length}`);
  }
  if (agents.length) {
    params.push(agents);
    where.push(`${AGENT_KEY_SQL} = ANY($${params.length}::text[])`);
  }
  if (excludedAgents.length) {
    params.push(excludedAgents);
    where.push(`NOT (${AGENT_KEY_SQL} = ANY($${params.length}::text[]))`);
  }
  if (categories.length) {
    params.push(categories);
    where.push(analyticsCategoryFilterSql(params.length));
  }
  if (inboxes.length) {
    params.push(inboxes);
    where.push(`t.inbox = ANY($${params.length}::text[])`);
  }
  if (week) {
    params.push(week);
    where.push(`t.week = $${params.length}`);
  }
  if (month) {
    params.push(month);
    where.push(`TO_CHAR(t.ticket_date, 'YYYY-MM') = $${params.length}`);
  }
  if (dateFrom) {
    params.push(dateFrom);
    where.push(`t.ticket_date >= $${params.length}`);
  }
  if (dateTo) {
    params.push(dateTo);
    where.push(`t.ticket_date <= $${params.length}`);
  }

  return { whereSql: where.join(' AND '), params };
}

function analyticsBaseSql(whereSql) {
  return `WITH base AS (
    SELECT
      ${AGENT_KEY_SQL} AS agent_key,
      ${AGENT_LABEL_SQL} AS agent,
      t.week,
      t.inbox,
      t.ticket_date,
      g.grader_name,
      g.category,
      g.total_percent::numeric AS grader_percent,
      ${BOT_PERCENT_SQL} AS bot_percent,
      ${GENERAL_PERCENT_SQL} AS general_percent,
      ${HUMAN_GRADE_SQL} AS is_human_graded
    FROM tickets t
    JOIN grades g ON g.ticket_id = t.id
    WHERE ${whereSql}
  )`;
}

function toDbInteger(value, options = {}) {
  const { scaleFraction = false } = options;
  if (value === null || value === undefined || value === '') return null;

  const n = Number(value);
  if (!Number.isFinite(n)) return null;

  const normalized = scaleFraction && Math.abs(n) <= 1 ? n * 100 : n;
  return Math.round(normalized);
}

function normalizeGradePayload(payload = {}) {
  return {
    ...payload,
    numerator: toDbInteger(payload.numerator),
    denominator: toDbInteger(payload.denominator),
    total_percent: toDbInteger(payload.total_percent, { scaleFraction: true })
  };
}

function cleanImportValue(value) {
  if (value === null || value === undefined) return null;
  const trimmed = String(value).trim();
  if (!trimmed) return null;
  if (trimmed.toUpperCase() === 'NA' || trimmed.toLowerCase() === 'nan') return null;
  return value;
}

async function upsertGrade(client, ticketId, payload, graderUserId) {
  const normalizedPayload = normalizeGradePayload(payload);
  let gradeId;

  const existing = await client.query(
    `SELECT id, submitted
     FROM grades
     WHERE ticket_id = $1 AND is_deleted = FALSE
     LIMIT 1`,
    [ticketId]
  );

  if (existing.rows.length) {
    gradeId = existing.rows[0].id;

    await client.query(
      `UPDATE grades
       SET grader_user_id = $1,
           grader_name = $2,
           grader_type = $3,
           numerator = $4,
           denominator = $5,
           total_percent = $6,
           qa_feedback = $7,
           agent_focus = $8,
           bot_similar = $9,
           bot_suggestion = $10,
           category = $11,
           brian_notes = $12,
           fixed = $13,
           submitted = $14,
           submitted_at = CASE WHEN $14 = TRUE AND submitted = FALSE THEN NOW() ELSE submitted_at END,
           agent_acknowledged_at = CASE WHEN $14 = TRUE AND submitted = FALSE THEN NULL ELSE agent_acknowledged_at END,
           reflection_read_at = CASE WHEN $14 = TRUE AND submitted = FALSE THEN NULL ELSE reflection_read_at END,
           updated_at = NOW()
       WHERE id = $15`,
      [
        graderUserId,
        normalizedPayload.grader_name,
        normalizedPayload.grader_type,
        normalizedPayload.numerator,
        normalizedPayload.denominator,
        normalizedPayload.total_percent,
        normalizedPayload.qa_feedback,
        normalizedPayload.agent_focus,
        normalizedPayload.bot_similar,
        normalizedPayload.bot_suggestion,
        normalizedPayload.category,
        normalizedPayload.brian_notes,
        normalizedPayload.fixed,
        normalizedPayload.submitted,
        gradeId
      ]
    );

    await client.query(`DELETE FROM grade_breakdown WHERE grade_id = $1`, [gradeId]);
    await client.query(`DELETE FROM grade_flags WHERE grade_id = $1`, [gradeId]);
  } else {
    const inserted = await client.query(
      `INSERT INTO grades (
        ticket_id,
        grader_user_id,
        grader_name,
        grader_type,
        numerator,
        denominator,
        total_percent,
        qa_feedback,
        agent_focus,
        bot_similar,
        bot_suggestion,
        category,
        brian_notes,
        fixed,
        submitted,
        submitted_at,
        reflection_text,
        reflection_submitted_at,
        agent_acknowledged_at,
        reflection_read_at
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15, CASE WHEN $15 = TRUE THEN NOW() ELSE NULL END, NULL, NULL, NULL, NULL)
      RETURNING id`,
      [
        ticketId,
        graderUserId,
        normalizedPayload.grader_name,
        normalizedPayload.grader_type,
        normalizedPayload.numerator,
        normalizedPayload.denominator,
        normalizedPayload.total_percent,
        normalizedPayload.qa_feedback,
        normalizedPayload.agent_focus,
        normalizedPayload.bot_similar,
        normalizedPayload.bot_suggestion,
        normalizedPayload.category,
        normalizedPayload.brian_notes,
        normalizedPayload.fixed,
        normalizedPayload.submitted
      ]
    );

    gradeId = inserted.rows[0].id;
  }

  for (const row of normalizedPayload.breakdown || []) {
    await client.query(
      `INSERT INTO grade_breakdown (grade_id, category_id, score, cause, custom_cause)
       VALUES ($1,$2,$3,$4,$5)`,
      [gradeId, row.category_id, row.score, row.cause, row.custom_cause]
    );
  }

  for (const row of normalizedPayload.flags || []) {
    await client.query(
      `INSERT INTO grade_flags (grade_id, flag_id, value, cause, custom_cause)
       VALUES ($1,$2,$3,$4,$5)`,
      [gradeId, row.flag_id, row.value, row.cause, row.custom_cause]
    );
  }

  return gradeId;
}

async function bulkUpsertGrades(client, gradeRows, graderUserId) {
  if (!Array.isArray(gradeRows) || !gradeRows.length) return [];

  const normalizedRows = gradeRows
    .filter(row => row && row.ticket_id && row.grade_payload)
    .map(row => ({
      ticket_id: Number(row.ticket_id),
      grade_payload: normalizeGradePayload(row.grade_payload)
    }));

  if (!normalizedRows.length) return [];

  const ticketIds = normalizedRows.map(row => row.ticket_id);
  const existingResult = await client.query(
    `SELECT id, ticket_id, submitted
     FROM grades
     WHERE ticket_id = ANY($1::bigint[])
       AND is_deleted = FALSE`,
    [ticketIds]
  );

  const existingByTicketId = new Map();
  existingResult.rows.forEach(row => {
    const key = String(row.ticket_id);
    if (!existingByTicketId.has(key)) existingByTicketId.set(key, row);
  });

  const updates = [];
  const inserts = [];

  normalizedRows.forEach(row => {
    const existingGrade = existingByTicketId.get(String(row.ticket_id));
    const gradeId = existingGrade?.id;
    const payload = row.grade_payload || {};
    const target = {
      ticket_id: row.ticket_id,
      grader_user_id: graderUserId,
      grader_name: payload.grader_name || null,
      grader_type: payload.grader_type || null,
      numerator: payload.numerator ?? null,
      denominator: payload.denominator ?? null,
      total_percent: payload.total_percent ?? null,
      qa_feedback: payload.qa_feedback || '',
      agent_focus: payload.agent_focus || '',
      bot_similar: payload.bot_similar || 'No',
      bot_suggestion: payload.bot_suggestion || '',
      category: payload.category || '',
      brian_notes: payload.brian_notes || '',
      fixed: payload.fixed || 'No',
      submitted: !!payload.submitted
    };

    if (gradeId) {
      updates.push({ grade_id: gradeId, was_submitted: !!existingGrade?.submitted, ...target });
    } else {
      inserts.push(target);
    }
  });

  if (updates.length) {
    await client.query(
      `UPDATE grades g
       SET grader_user_id = src.grader_user_id,
           grader_name = src.grader_name,
           grader_type = src.grader_type,
           numerator = src.numerator,
           denominator = src.denominator,
           total_percent = src.total_percent,
           qa_feedback = src.qa_feedback,
           agent_focus = src.agent_focus,
           bot_similar = src.bot_similar,
           bot_suggestion = src.bot_suggestion,
           category = src.category,
           brian_notes = src.brian_notes,
           fixed = src.fixed,
           submitted = src.submitted,
           submitted_at = CASE WHEN src.submitted = TRUE AND src.was_submitted = FALSE THEN NOW() ELSE g.submitted_at END,
           agent_acknowledged_at = CASE WHEN src.submitted = TRUE AND src.was_submitted = FALSE THEN NULL ELSE g.agent_acknowledged_at END,
           reflection_read_at = CASE WHEN src.submitted = TRUE AND src.was_submitted = FALSE THEN NULL ELSE g.reflection_read_at END,
           updated_at = NOW()
       FROM json_to_recordset($1::json) AS src(
         grade_id bigint,
         ticket_id bigint,
         was_submitted boolean,
         grader_user_id bigint,
         grader_name text,
         grader_type text,
         numerator integer,
         denominator integer,
         total_percent integer,
         qa_feedback text,
         agent_focus text,
         bot_similar text,
         bot_suggestion text,
         category text,
         brian_notes text,
         fixed text,
         submitted boolean
       )
       WHERE g.id = src.grade_id`,
      [JSON.stringify(updates)]
    );
  }

  if (inserts.length) {
    const inserted = await client.query(
      `INSERT INTO grades (
         ticket_id,
         grader_user_id,
         grader_name,
         grader_type,
         numerator,
         denominator,
         total_percent,
         qa_feedback,
         agent_focus,
         bot_similar,
         bot_suggestion,
         category,
         brian_notes,
         fixed,
         submitted,
         submitted_at,
         reflection_text,
         reflection_submitted_at,
         agent_acknowledged_at,
         reflection_read_at
       )
       SELECT
         src.ticket_id,
         src.grader_user_id,
         src.grader_name,
         src.grader_type,
         src.numerator,
         src.denominator,
         src.total_percent,
         src.qa_feedback,
         src.agent_focus,
         src.bot_similar,
         src.bot_suggestion,
         src.category,
         src.brian_notes,
         src.fixed,
         src.submitted,
         CASE WHEN src.submitted = TRUE THEN NOW() ELSE NULL END,
         NULL,
         NULL,
         NULL,
         NULL
       FROM json_to_recordset($1::json) AS src(
         ticket_id bigint,
         grader_user_id bigint,
         grader_name text,
         grader_type text,
         numerator integer,
         denominator integer,
         total_percent integer,
         qa_feedback text,
         agent_focus text,
         bot_similar text,
         bot_suggestion text,
         category text,
         brian_notes text,
         fixed text,
         submitted boolean
       )
       RETURNING id, ticket_id`,
      [JSON.stringify(inserts)]
    );

    inserted.rows.forEach(row => {
      existingByTicketId.set(String(row.ticket_id), row.id);
    });
  }

  const allGradeIds = Array.from(existingByTicketId.values());
  if (allGradeIds.length) {
    await client.query(`DELETE FROM grade_breakdown WHERE grade_id = ANY($1::bigint[])`, [allGradeIds]);
    await client.query(`DELETE FROM grade_flags WHERE grade_id = ANY($1::bigint[])`, [allGradeIds]);
  }

  const breakdownRows = [];
  const flagRows = [];

  normalizedRows.forEach(row => {
    const gradeId = existingByTicketId.get(String(row.ticket_id));
    const payload = row.grade_payload || {};

    for (const item of payload.breakdown || []) {
      breakdownRows.push({
        grade_id: gradeId,
        category_id: item.category_id,
        score: item.score === undefined ? null : item.score,
        cause: item.cause || '',
        custom_cause: item.custom_cause || ''
      });
    }

    for (const item of payload.flags || []) {
      flagRows.push({
        grade_id: gradeId,
        flag_id: item.flag_id,
        value: item.value === undefined ? null : item.value,
        cause: item.cause || '',
        custom_cause: item.custom_cause || ''
      });
    }
  });

  if (breakdownRows.length) {
    await client.query(
      `INSERT INTO grade_breakdown (grade_id, category_id, score, cause, custom_cause)
       SELECT
         src.grade_id,
         src.category_id,
         src.score,
         src.cause,
         src.custom_cause
       FROM json_to_recordset($1::json) AS src(
         grade_id bigint,
         category_id text,
         score text,
         cause text,
         custom_cause text
       )`,
      [JSON.stringify(breakdownRows)]
    );
  }

  if (flagRows.length) {
    await client.query(
      `INSERT INTO grade_flags (grade_id, flag_id, value, cause, custom_cause)
       SELECT
         src.grade_id,
         src.flag_id,
         src.value,
         src.cause,
         src.custom_cause
       FROM json_to_recordset($1::json) AS src(
         grade_id bigint,
         flag_id text,
         value text,
         cause text,
         custom_cause text
       )`,
      [JSON.stringify(flagRows)]
    );
  }

  return normalizedRows.map(row => existingByTicketId.get(String(row.ticket_id)));
}

app.get('/api/home', requireAuth, async (req, res) => {
  try {
    const u = req.session.user;
    const role = u.role;

    // Current and previous week Monday dates
    const now = new Date();
    const dayOfWeek = (now.getDay() + 6) % 7; // Mon=0
    const thisMonday = new Date(now); thisMonday.setDate(now.getDate() - dayOfWeek); thisMonday.setHours(0,0,0,0);
    const lastMonday = new Date(thisMonday); lastMonday.setDate(thisMonday.getDate() - 7);
    const nextMonday = new Date(thisMonday); nextMonday.setDate(thisMonday.getDate() + 7);
    const twoMondaysAgo = new Date(lastMonday); twoMondaysAgo.setDate(lastMonday.getDate() - 7);

    const thisWeekFrom = thisMonday.toISOString().slice(0,10);
    const thisWeekTo   = nextMonday.toISOString().slice(0,10);
    const lastWeekFrom = lastMonday.toISOString().slice(0,10);
    const lastWeekTo   = thisMonday.toISOString().slice(0,10);

    if (role === 'agent') {
      const agentKey = currentAgentKey(u);

      const [newCount, weekScore, lastWeekScore, worstCat, teamRank] = await Promise.all([
        // New unread tickets
        pool.query(`
          SELECT COUNT(*) AS cnt FROM tickets t
          JOIN grades g ON g.ticket_id = t.id AND g.is_deleted = FALSE
          WHERE t.deleted_at IS NULL AND g.submitted = TRUE AND g.agent_acknowledged_at IS NULL
            AND ${AGENT_KEY_SQL} = $1`, [agentKey]),

        // This week avg score
        pool.query(`
          SELECT ROUND(AVG(g.total_percent)) AS avg_score, COUNT(*) AS cnt
          FROM tickets t JOIN grades g ON g.ticket_id = t.id AND g.is_deleted = FALSE
          WHERE t.deleted_at IS NULL AND g.submitted = TRUE AND ${AGENT_KEY_SQL} = $1
            AND t.ticket_date >= $2 AND t.ticket_date < $3`, [agentKey, thisWeekFrom, thisWeekTo]),

        // Last week avg score
        pool.query(`
          SELECT ROUND(AVG(g.total_percent)) AS avg_score
          FROM tickets t JOIN grades g ON g.ticket_id = t.id AND g.is_deleted = FALSE
          WHERE t.deleted_at IS NULL AND g.submitted = TRUE AND ${AGENT_KEY_SQL} = $1
            AND t.ticket_date >= $2 AND t.ticket_date < $3`, [agentKey, lastWeekFrom, lastWeekTo]),

        // Worst category this week
        pool.query(`
          SELECT gb.category_id, ROUND(AVG(
            CASE WHEN gb.score ~ '^-?\\d+(\\.\\d+)?$' THEN gb.score::numeric ELSE NULL END
          )) AS avg_score
          FROM tickets t
          JOIN grades g ON g.ticket_id = t.id AND g.is_deleted = FALSE
          JOIN grade_breakdown gb ON gb.grade_id = g.id
          WHERE t.deleted_at IS NULL AND g.submitted = TRUE AND ${AGENT_KEY_SQL} = $1
            AND t.ticket_date >= $2 AND t.ticket_date < $3
          GROUP BY gb.category_id
          ORDER BY avg_score ASC NULLS LAST LIMIT 1`, [agentKey, thisWeekFrom, thisWeekTo]),

        // Rank among team this week
        pool.query(`
          WITH scores AS (
            SELECT ${AGENT_KEY_SQL} AS akey, ROUND(AVG(g.total_percent)) AS avg
            FROM tickets t JOIN grades g ON g.ticket_id = t.id AND g.is_deleted = FALSE
            WHERE t.deleted_at IS NULL AND g.submitted = TRUE
              AND t.ticket_date >= $1 AND t.ticket_date < $2
            GROUP BY akey
          )
          SELECT COUNT(*) AS total,
            (SELECT COUNT(*)+1 FROM scores WHERE avg > (SELECT avg FROM scores WHERE akey=$3)) AS rank
          FROM scores`, [thisWeekFrom, thisWeekTo, agentKey])
      ]);

      return res.json({
        role,
        new_tickets_count: parseInt(newCount.rows[0]?.cnt || 0),
        week_score: weekScore.rows[0]?.avg_score ?? null,
        week_ticket_count: parseInt(weekScore.rows[0]?.cnt || 0),
        last_week_score: lastWeekScore.rows[0]?.avg_score ?? null,
        worst_category: worstCat.rows[0] || null,
        rank: parseInt(teamRank.rows[0]?.rank || 0),
        rank_total: parseInt(teamRank.rows[0]?.total || 0)
      });
    }

    if (role === 'qa_grader') {
      const graderKeys = currentGraderKeys(u);

      const [pending, weekTeam, lastWeekTeam, worstCat, bestCat, topInbox, bestAgent, bestAgentLast] = await Promise.all([
        // Tickets pending grading assigned to this grader
        pool.query(`
          SELECT COUNT(*) AS cnt FROM tickets t
          LEFT JOIN grades g ON g.ticket_id = t.id AND g.is_deleted = FALSE
          WHERE t.deleted_at IS NULL AND (g.id IS NULL OR g.submitted = FALSE)
            AND LOWER(BTRIM(COALESCE(t.assigned_grader, ''))) = ANY($1::text[])`, [graderKeys]),

        // Team avg score this week
        pool.query(`
          SELECT ROUND(AVG(g.total_percent)) AS avg_score, COUNT(*) AS cnt
          FROM tickets t JOIN grades g ON g.ticket_id = t.id AND g.is_deleted = FALSE
          WHERE t.deleted_at IS NULL AND g.submitted = TRUE
            AND t.ticket_date >= $1 AND t.ticket_date < $2`, [thisWeekFrom, thisWeekTo]),

        // Team avg last week
        pool.query(`
          SELECT ROUND(AVG(g.total_percent)) AS avg_score
          FROM tickets t JOIN grades g ON g.ticket_id = t.id AND g.is_deleted = FALSE
          WHERE t.deleted_at IS NULL AND g.submitted = TRUE
            AND t.ticket_date >= $1 AND t.ticket_date < $2`, [lastWeekFrom, lastWeekTo]),

        // Worst category this week
        pool.query(`
          SELECT gb.category_id, ROUND(AVG(
            CASE WHEN gb.score ~ '^-?\\d+(\\.\\d+)?$' THEN gb.score::numeric ELSE NULL END
          )) AS avg_score
          FROM tickets t JOIN grades g ON g.ticket_id = t.id AND g.is_deleted = FALSE
          JOIN grade_breakdown gb ON gb.grade_id = g.id
          WHERE t.deleted_at IS NULL AND g.submitted = TRUE
            AND t.ticket_date >= $1 AND t.ticket_date < $2
          GROUP BY gb.category_id ORDER BY avg_score ASC NULLS LAST LIMIT 1`, [thisWeekFrom, thisWeekTo]),

        // Best category this week
        pool.query(`
          SELECT gb.category_id, ROUND(AVG(
            CASE WHEN gb.score ~ '^-?\\d+(\\.\\d+)?$' THEN gb.score::numeric ELSE NULL END
          )) AS avg_score
          FROM tickets t JOIN grades g ON g.ticket_id = t.id AND g.is_deleted = FALSE
          JOIN grade_breakdown gb ON gb.grade_id = g.id
          WHERE t.deleted_at IS NULL AND g.submitted = TRUE
            AND t.ticket_date >= $1 AND t.ticket_date < $2
          GROUP BY gb.category_id ORDER BY avg_score DESC NULLS LAST LIMIT 1`, [thisWeekFrom, thisWeekTo]),

        // Top inbox this week by ticket count
        pool.query(`
          SELECT t.inbox, COUNT(*) AS cnt FROM tickets t
          JOIN grades g ON g.ticket_id = t.id AND g.is_deleted = FALSE
          WHERE t.deleted_at IS NULL AND g.submitted = TRUE
            AND t.ticket_date >= $1 AND t.ticket_date < $2
          GROUP BY t.inbox ORDER BY cnt DESC LIMIT 1`, [thisWeekFrom, thisWeekTo]),

        // Best agent this week
        pool.query(`
          SELECT MIN(${AGENT_LABEL_SQL}) AS agent, ROUND(AVG(g.total_percent)) AS avg_score, COUNT(*) AS cnt
          FROM tickets t JOIN grades g ON g.ticket_id = t.id AND g.is_deleted = FALSE
          WHERE t.deleted_at IS NULL AND g.submitted = TRUE
            AND t.ticket_date >= $1 AND t.ticket_date < $2
          GROUP BY ${AGENT_KEY_SQL} HAVING COUNT(*) >= 1
          ORDER BY avg_score DESC NULLS LAST LIMIT 1`, [thisWeekFrom, thisWeekTo]),

        // Best agent last week
        pool.query(`
          SELECT MIN(${AGENT_LABEL_SQL}) AS agent, ROUND(AVG(g.total_percent)) AS avg_score
          FROM tickets t JOIN grades g ON g.ticket_id = t.id AND g.is_deleted = FALSE
          WHERE t.deleted_at IS NULL AND g.submitted = TRUE
            AND t.ticket_date >= $1 AND t.ticket_date < $2
          GROUP BY ${AGENT_KEY_SQL} HAVING COUNT(*) >= 1
          ORDER BY avg_score DESC NULLS LAST LIMIT 1`, [lastWeekFrom, lastWeekTo])
      ]);

      // Last week top inbox for comparison
      const lastTopInbox = topInbox.rows[0]?.inbox ? await pool.query(`
        SELECT COUNT(*) AS cnt FROM tickets t
        JOIN grades g ON g.ticket_id = t.id AND g.is_deleted = FALSE
        WHERE t.deleted_at IS NULL AND g.submitted = TRUE
          AND t.ticket_date >= $1 AND t.ticket_date < $2 AND t.inbox = $3`,
        [lastWeekFrom, lastWeekTo, topInbox.rows[0].inbox]) : { rows: [{ cnt: 0 }] };

      // Last week categories for comparison
      const lastWorstCat = worstCat.rows[0]?.category_id ? await pool.query(`
        SELECT ROUND(AVG(CASE WHEN gb.score ~ '^-?\\d+(\\.\\d+)?$' THEN gb.score::numeric ELSE NULL END)) AS avg_score
        FROM tickets t JOIN grades g ON g.ticket_id = t.id AND g.is_deleted = FALSE
        JOIN grade_breakdown gb ON gb.grade_id = g.id
        WHERE t.deleted_at IS NULL AND g.submitted = TRUE
          AND t.ticket_date >= $1 AND t.ticket_date < $2 AND gb.category_id = $3`,
        [lastWeekFrom, lastWeekTo, worstCat.rows[0].category_id]) : { rows: [{}] };

      const lastBestCat = bestCat.rows[0]?.category_id ? await pool.query(`
        SELECT ROUND(AVG(CASE WHEN gb.score ~ '^-?\\d+(\\.\\d+)?$' THEN gb.score::numeric ELSE NULL END)) AS avg_score
        FROM tickets t JOIN grades g ON g.ticket_id = t.id AND g.is_deleted = FALSE
        JOIN grade_breakdown gb ON gb.grade_id = g.id
        WHERE t.deleted_at IS NULL AND g.submitted = TRUE
          AND t.ticket_date >= $1 AND t.ticket_date < $2 AND gb.category_id = $3`,
        [lastWeekFrom, lastWeekTo, bestCat.rows[0].category_id]) : { rows: [{}] };

      return res.json({
        role,
        pending_grading: parseInt(pending.rows[0]?.cnt || 0),
        week_team_score: weekTeam.rows[0]?.avg_score ?? null,
        week_ticket_count: parseInt(weekTeam.rows[0]?.cnt || 0),
        last_week_team_score: lastWeekTeam.rows[0]?.avg_score ?? null,
        worst_category: worstCat.rows[0] || null,
        worst_category_last_week: lastWorstCat.rows[0]?.avg_score ?? null,
        best_category: bestCat.rows[0] || null,
        best_category_last_week: lastBestCat.rows[0]?.avg_score ?? null,
        top_inbox: topInbox.rows[0] || null,
        top_inbox_last_week_count: parseInt(lastTopInbox.rows[0]?.cnt || 0),
        best_agent: bestAgent.rows[0] || null,
        best_agent_last_week: bestAgentLast.rows[0] || null
      });
    }

    if (['cs_leader', 'admin'].includes(role)) {
      const [userCount, activeSessionCount, recentLogs, weekTeam, lastWeekTeam, worstCat, bestCat, topInbox, unassigned, bestAgent, bestAgentLast] = await Promise.all([
        pool.query(`SELECT COUNT(*) AS cnt FROM users WHERE is_active = TRUE`),
        pool.query(`SELECT COUNT(*) AS cnt FROM session`),
        pool.query(`SELECT username, role, action, details, created_at FROM user_logs ORDER BY created_at DESC LIMIT 5`),

        pool.query(`
          SELECT ROUND(AVG(g.total_percent)) AS avg_score, COUNT(*) AS cnt
          FROM tickets t JOIN grades g ON g.ticket_id = t.id AND g.is_deleted = FALSE
          WHERE t.deleted_at IS NULL AND g.submitted = TRUE
            AND t.ticket_date >= $1 AND t.ticket_date < $2`, [thisWeekFrom, thisWeekTo]),

        pool.query(`
          SELECT ROUND(AVG(g.total_percent)) AS avg_score
          FROM tickets t JOIN grades g ON g.ticket_id = t.id AND g.is_deleted = FALSE
          WHERE t.deleted_at IS NULL AND g.submitted = TRUE
            AND t.ticket_date >= $1 AND t.ticket_date < $2`, [lastWeekFrom, lastWeekTo]),

        pool.query(`
          SELECT gb.category_id, ROUND(AVG(
            CASE WHEN gb.score ~ '^-?\\d+(\\.\\d+)?$' THEN gb.score::numeric ELSE NULL END
          )) AS avg_score
          FROM tickets t JOIN grades g ON g.ticket_id = t.id AND g.is_deleted = FALSE
          JOIN grade_breakdown gb ON gb.grade_id = g.id
          WHERE t.deleted_at IS NULL AND g.submitted = TRUE
            AND t.ticket_date >= $1 AND t.ticket_date < $2
          GROUP BY gb.category_id ORDER BY avg_score ASC NULLS LAST LIMIT 1`, [thisWeekFrom, thisWeekTo]),

        pool.query(`
          SELECT gb.category_id, ROUND(AVG(
            CASE WHEN gb.score ~ '^-?\\d+(\\.\\d+)?$' THEN gb.score::numeric ELSE NULL END
          )) AS avg_score
          FROM tickets t JOIN grades g ON g.ticket_id = t.id AND g.is_deleted = FALSE
          JOIN grade_breakdown gb ON gb.grade_id = g.id
          WHERE t.deleted_at IS NULL AND g.submitted = TRUE
            AND t.ticket_date >= $1 AND t.ticket_date < $2
          GROUP BY gb.category_id ORDER BY avg_score DESC NULLS LAST LIMIT 1`, [thisWeekFrom, thisWeekTo]),

        pool.query(`
          SELECT t.inbox, COUNT(*) AS cnt FROM tickets t
          JOIN grades g ON g.ticket_id = t.id AND g.is_deleted = FALSE
          WHERE t.deleted_at IS NULL AND g.submitted = TRUE
            AND t.ticket_date >= $1 AND t.ticket_date < $2
          GROUP BY t.inbox ORDER BY cnt DESC LIMIT 1`, [thisWeekFrom, thisWeekTo]),

        // New tickets imported from 2026-04-01 onward
        // plus reviewed tickets with score <= 60% from 2026-03-30 onward
        pool.query(`
          SELECT t.id, t.subject, t.agent, t.inbox, t.ticket_date, t.week,
            t.assigned_grader, g.total_percent, g.grader_name
          FROM tickets t
          LEFT JOIN grades g ON g.ticket_id = t.id AND g.is_deleted = FALSE
          WHERE t.deleted_at IS NULL
            AND (
              (t.ticket_date >= $1 AND (g.id IS NULL OR g.submitted = FALSE))
              OR
              (t.ticket_date >= $2 AND g.submitted = TRUE AND g.total_percent <= 60)
            )
          ORDER BY t.ticket_date DESC LIMIT 100`, [NEW_TICKET_ASSIGNMENT_CUTOFF_DATE, LOW_SCORE_REVIEW_CUTOFF_DATE]),

        // Best agent this week
        pool.query(`
          SELECT MIN(${AGENT_LABEL_SQL}) AS agent, ROUND(AVG(g.total_percent)) AS avg_score, COUNT(*) AS cnt
          FROM tickets t JOIN grades g ON g.ticket_id = t.id AND g.is_deleted = FALSE
          WHERE t.deleted_at IS NULL AND g.submitted = TRUE
            AND t.ticket_date >= $1 AND t.ticket_date < $2
          GROUP BY ${AGENT_KEY_SQL} HAVING COUNT(*) >= 1
          ORDER BY avg_score DESC NULLS LAST LIMIT 1`, [thisWeekFrom, thisWeekTo]),

        // Best agent last week
        pool.query(`
          SELECT MIN(${AGENT_LABEL_SQL}) AS agent, ROUND(AVG(g.total_percent)) AS avg_score
          FROM tickets t JOIN grades g ON g.ticket_id = t.id AND g.is_deleted = FALSE
          WHERE t.deleted_at IS NULL AND g.submitted = TRUE
            AND t.ticket_date >= $1 AND t.ticket_date < $2
          GROUP BY ${AGENT_KEY_SQL} HAVING COUNT(*) >= 1
          ORDER BY avg_score DESC NULLS LAST LIMIT 1`, [lastWeekFrom, lastWeekTo])
      ]);

      const lastTopInbox = topInbox.rows[0]?.inbox ? await pool.query(`
        SELECT COUNT(*) AS cnt FROM tickets t
        JOIN grades g ON g.ticket_id = t.id AND g.is_deleted = FALSE
        WHERE t.deleted_at IS NULL AND g.submitted = TRUE
          AND t.ticket_date >= $1 AND t.ticket_date < $2 AND t.inbox = $3`,
        [lastWeekFrom, lastWeekTo, topInbox.rows[0].inbox]) : { rows: [{ cnt: 0 }] };

      const lastWorstCat = worstCat.rows[0]?.category_id ? await pool.query(`
        SELECT ROUND(AVG(CASE WHEN gb.score ~ '^-?\\d+(\\.\\d+)?$' THEN gb.score::numeric ELSE NULL END)) AS avg_score
        FROM tickets t JOIN grades g ON g.ticket_id = t.id AND g.is_deleted = FALSE
        JOIN grade_breakdown gb ON gb.grade_id = g.id
        WHERE t.deleted_at IS NULL AND g.submitted = TRUE
          AND t.ticket_date >= $1 AND t.ticket_date < $2 AND gb.category_id = $3`,
        [lastWeekFrom, lastWeekTo, worstCat.rows[0].category_id]) : { rows: [{}] };

      const lastBestCat = bestCat.rows[0]?.category_id ? await pool.query(`
        SELECT ROUND(AVG(CASE WHEN gb.score ~ '^-?\\d+(\\.\\d+)?$' THEN gb.score::numeric ELSE NULL END)) AS avg_score
        FROM tickets t JOIN grades g ON g.ticket_id = t.id AND g.is_deleted = FALSE
        JOIN grade_breakdown gb ON gb.grade_id = g.id
        WHERE t.deleted_at IS NULL AND g.submitted = TRUE
          AND t.ticket_date >= $1 AND t.ticket_date < $2 AND gb.category_id = $3`,
        [lastWeekFrom, lastWeekTo, bestCat.rows[0].category_id]) : { rows: [{}] };

      // Available graders for assignment
      const graders = await pool.query(`SELECT id, username, email FROM users WHERE role = 'qa_grader' AND is_active = TRUE ORDER BY username`);

      return res.json({
        role,
        user_count: parseInt(userCount.rows[0]?.cnt || 0),
        active_sessions: parseInt(activeSessionCount.rows[0]?.cnt || 0),
        recent_logs: recentLogs.rows,
        week_team_score: weekTeam.rows[0]?.avg_score ?? null,
        week_ticket_count: parseInt(weekTeam.rows[0]?.cnt || 0),
        last_week_team_score: lastWeekTeam.rows[0]?.avg_score ?? null,
        worst_category: worstCat.rows[0] || null,
        worst_category_last_week: lastWorstCat.rows[0]?.avg_score ?? null,
        best_category: bestCat.rows[0] || null,
        best_category_last_week: lastBestCat.rows[0]?.avg_score ?? null,
        top_inbox: topInbox.rows[0] || null,
        top_inbox_last_week_count: parseInt(lastTopInbox.rows[0]?.cnt || 0),
        unassigned_low_score: unassigned.rows,
        available_graders: graders.rows,
        best_agent: bestAgent.rows[0] || null,
        best_agent_last_week: bestAgentLast.rows[0] || null
      });
    }

    res.json({ role });
  } catch (error) {
    console.error('GET /api/home failed', {
      role: req.session?.user?.role || null,
      userId: req.session?.user?.id || null,
      message: error.message
    });
    console.error(error);
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/health', async (req, res) => {
  try {
    const r = await pool.query('SELECT NOW()');
    res.json({ ok: true, time: r.rows[0].now });
  } catch (error) {
    console.error(error);
    res.status(500).json({ ok: false, error: error.message });
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const { username, password } = req.body;

    const result = await pool.query(
      'SELECT id, email, username, password_hash, role, is_active FROM users WHERE username = $1 OR email = $1',
      [username]
    );

    const user = result.rows[0];
    if (!user || !user.is_active) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    req.session.user = {
      id: user.id,
      email: user.email,
      username: user.username,
      role: user.role
    };

    req.session.save((saveError) => {
      if (saveError) {
        console.error(saveError);
        return res.status(500).json({ error: 'Failed to persist session' });
      }
      logAction(req, 'login', { username: user.username, role: user.role });
      res.json({ ok: true, user: req.session.user, token: createToken(req.session.user) });
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/auth/logout', (req, res) => {
  logAction(req, 'logout', {});
  req.session.destroy(() => {
    res.clearCookie('connect.sid');
    res.json({ ok: true });
  });
});

app.get('/api/auth/me', (req, res) => {
  const user = getAuthUser(req);
  res.json({ user: user || null });
});

app.get('/api/admin/users', requireUserMgmt, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, email, username, role, is_active, created_at
       FROM users
       ORDER BY created_at DESC`
    );
    res.json(result.rows);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/admin/sql', requireAdmin, async (req, res) => {
  try {
    const sql = String(req.body?.sql || '').trim();
    if (!sql) {
      return res.status(400).json({ error: 'SQL is required' });
    }

    const statementCount = sql
      .split(';')
      .map(part => part.trim())
      .filter(Boolean)
      .length;

    if (statementCount > 1) {
      return res.status(400).json({ error: 'Run one SQL statement at a time' });
    }

    const startedAt = Date.now();
    const result = await pool.query(sql);
    const durationMs = Date.now() - startedAt;

    logAction(req, 'sql_console_query', {
      command: result.command,
      row_count: result.rowCount ?? 0,
      duration_ms: durationMs,
      sql_preview: sql.slice(0, 300)
    });

    res.json({
      ok: true,
      command: result.command || 'OK',
      row_count: result.rowCount ?? 0,
      duration_ms: durationMs,
      fields: Array.isArray(result.fields) ? result.fields.map(field => field.name) : [],
      rows: Array.isArray(result.rows) ? result.rows : []
    });
  } catch (error) {
    console.error('POST /api/admin/sql failed', error);
    res.status(400).json({ error: error.message });
  }
});

app.post('/api/admin/users', requireUserMgmt, async (req, res) => {
  try {
    const { email, username, password, role = 'user' } = req.body;

    const passwordHash = await bcrypt.hash(password, 12);

    const result = await pool.query(
      `INSERT INTO users (email, username, password_hash, role)
       VALUES ($1, $2, $3, $4)
       RETURNING id, email, username, role`,
      [email, username, passwordHash, role]
    );

    const created = result.rows[0];
    logAction(req, 'user_created', { target_username: created.username, target_role: created.role, target_id: created.id });
    res.json({ ok: true, user: created });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: error.message });
  }
});

app.patch('/api/admin/users/:id/status', requireUserMgmt, async (req, res) => {
  try {
    const { is_active } = req.body;

    const result = await pool.query(
      `UPDATE users
       SET is_active = $1
       WHERE id = $2
       RETURNING id, email, username, role, is_active`,
      [!!is_active, req.params.id]
    );

    if (!result.rows.length) {
      return res.status(404).json({ error: 'User not found' });
    }

    const updated = result.rows[0];
    logAction(req, 'user_status_changed', { target_id: updated.id, target_username: updated.username, is_active: !!is_active });
    res.json({ ok: true, user: updated });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: error.message });
  }
});

app.patch('/api/admin/users/:id/password', requireUserMgmt, async (req, res) => {
  try {
    const { password } = req.body;
    const passwordHash = await bcrypt.hash(password, 12);

    const result = await pool.query(
      `UPDATE users
       SET password_hash = $1
       WHERE id = $2
       RETURNING id, email, username`,
      [passwordHash, req.params.id]
    );

    if (!result.rows.length) {
      return res.status(404).json({ error: 'User not found' });
    }

    logAction(req, 'user_password_changed', { target_id: result.rows[0].id, target_username: result.rows[0].username });
    res.json({ ok: true });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/front/conversations/:id/messages', requireAuth, async (req, res) => {
  try {
    const result = await frontGet(`/conversations/${req.params.id}/messages`);
    res.status(result.statusCode).type('application/json').send(result.body);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/front/conversations/:id/comments', requireAuth, async (req, res) => {
  try {
    const result = await frontGet(`/conversations/${req.params.id}/comments`);
    res.status(result.statusCode).type('application/json').send(result.body);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/front/attachment', requireAuth, async (req, res) => {
  try {
    const rawUrl = req.query.url;
    if (!rawUrl) {
      return res.status(400).json({ error: 'Missing url' });
    }

    const decodedUrl = decodeURIComponent(rawUrl);
    const target = new URL(decodedUrl);

    const result = await new Promise((resolve, reject) => {
      const request = https.request({
        hostname: target.hostname,
        path: target.pathname + target.search,
        method: 'GET',
        headers: {
          Authorization: `Bearer ${process.env.FRONT_TOKEN}`,
          Accept: 'image/*'
        }
      }, (resp) => {
        const chunks = [];
        resp.on('data', chunk => chunks.push(chunk));
        resp.on('end', () => {
          resolve({
            statusCode: resp.statusCode || 500,
            headers: resp.headers,
            body: Buffer.concat(chunks)
          });
        });
      });

      request.on('error', reject);
      request.end();
    });

    if (result.headers['content-type']) {
      res.setHeader('Content-Type', result.headers['content-type']);
    }

    res.status(result.statusCode).send(result.body);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/tickets', requireAuth, async (req, res) => {
  try {
    const role = req.session.user.role;
    const isAgent = role === 'agent';
    let params = [];
    let accessWhereSql = '';

    if (isAgent) {
      params = [currentAgentKey(req.session.user)];
      accessWhereSql = `AND ${AGENT_KEY_SQL} = $1`;
    }

    const result = await pool.query(`
      WITH bd AS (
        SELECT grade_id,
          json_agg(
            json_build_object(
              'category_id', gb.category_id,
              'score', gb.score,
              'cause', gb.cause,
              'custom_cause', gb.custom_cause
            )
            ORDER BY gb.category_id
          ) AS data
        FROM grade_breakdown gb
        GROUP BY gb.grade_id
      ),
      fl AS (
        SELECT grade_id,
          json_agg(
            json_build_object(
              'flag_id', gf.flag_id,
              'value', gf.value,
              'cause', gf.cause,
              'custom_cause', gf.custom_cause
            )
            ORDER BY gf.flag_id
          ) AS data
        FROM grade_flags gf
        GROUP BY gf.grade_id
      )
      SELECT
        t.*,
        g.id AS grade_id,
        g.grader_user_id,
        g.grader_name,
        g.grader_type,
        g.numerator,
        g.denominator,
        g.total_percent,
        g.qa_feedback,
        g.agent_focus,
        g.bot_similar,
        g.bot_suggestion,
        g.category,
        g.brian_notes,
        g.fixed,
        g.submitted,
        g.submitted_at,
        g.reflection_text,
        g.reflection_submitted_at,
        g.agent_acknowledged_at,
        g.reflection_read_at,
        g.review_duration_seconds,
        COALESCE(bd.data, '[]'::json) AS breakdown,
        COALESCE(fl.data, '[]'::json) AS flags
      FROM tickets t
      LEFT JOIN grades g ON g.ticket_id = t.id AND g.is_deleted = FALSE
      LEFT JOIN bd ON bd.grade_id = g.id
      LEFT JOIN fl ON fl.grade_id = g.id
      WHERE t.deleted_at IS NULL
      ${accessWhereSql}
      ORDER BY t.imported_at DESC
    `, params);

    res.json(result.rows);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/notifications', requireAuth, async (req, res) => {
  try {
    if (req.session.user.role === 'agent') {
      const result = await pool.query(
        `SELECT
           t.id AS ticket_id,
           t.subject,
           t.front_url,
           t.ticket_date,
           g.submitted_at AS event_at,
           g.grader_name,
           g.total_percent
         FROM tickets t
         JOIN grades g ON g.ticket_id = t.id AND g.is_deleted = FALSE
         WHERE t.deleted_at IS NULL
           AND g.submitted = TRUE
           AND g.agent_acknowledged_at IS NULL
           AND ${AGENT_KEY_SQL} = $1
         ORDER BY g.submitted_at DESC NULLS LAST, t.imported_at DESC`,
        [currentAgentKey(req.session.user)]
      );

      return res.json({
        count: result.rows.length,
        items: result.rows.map(row => ({
          type: 'new_grade',
          ticket_id: row.ticket_id,
          subject: row.subject,
          front_url: row.front_url,
          ticket_date: row.ticket_date,
          event_at: row.event_at,
          grader_name: row.grader_name,
          total_percent: row.total_percent
        }))
      });
    }

    const result = await pool.query(
      `SELECT
         t.id AS ticket_id,
         t.subject,
         t.front_url,
         t.ticket_date,
         t.agent,
         g.reflection_submitted_at AS event_at,
         g.reflection_text
       FROM tickets t
       JOIN grades g ON g.ticket_id = t.id AND g.is_deleted = FALSE
       WHERE t.deleted_at IS NULL
         AND g.grader_user_id = $1
         AND g.reflection_submitted_at IS NOT NULL
         AND g.reflection_read_at IS NULL
       ORDER BY g.reflection_submitted_at DESC, t.imported_at DESC`,
      [req.session.user.id]
    );

    res.json({
      count: result.rows.length,
      items: result.rows.map(row => ({
        type: 'reflection_submitted',
        ticket_id: row.ticket_id,
        subject: row.subject,
        front_url: row.front_url,
        ticket_date: row.ticket_date,
        agent: row.agent,
        event_at: row.event_at,
        reflection_text: row.reflection_text
      }))
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/tickets/:id/agent-acknowledge', requireAuth, async (req, res) => {
  try {
    if (req.session.user.role !== 'agent') {
      return res.status(403).json({ error: 'Agent only' });
    }

    const grade = await findAccessibleGrade(req.params.id, req.session.user);
    if (!grade) return res.status(404).json({ error: 'Ticket not found' });

    await pool.query(
      `UPDATE grades
       SET agent_acknowledged_at = COALESCE(agent_acknowledged_at, NOW())
       WHERE id = $1`,
      [grade.grade_id]
    );

    res.json({ ok: true, agent_acknowledged_at: new Date().toISOString() });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/tickets/:id/reflection', requireAuth, async (req, res) => {
  try {
    if (req.session.user.role !== 'agent') {
      return res.status(403).json({ error: 'Agent only' });
    }

    const grade = await findAccessibleGrade(req.params.id, req.session.user);
    if (!grade) return res.status(404).json({ error: 'Ticket not found' });

    const reflection = String(req.body?.reflection || '').trim();
    const reviewDurationSeconds = Number(req.body?.review_duration_seconds) || null;
    const totalPercent = Number(grade.total_percent);
    if (Number.isFinite(totalPercent) && totalPercent < 100 && !reflection) {
      return res.status(400).json({ error: 'Reflection is required for tickets below 100%.' });
    }

    await pool.query(
      `UPDATE grades
       SET reflection_text = $1,
           reflection_submitted_at = NOW(),
           agent_acknowledged_at = NOW(),
           reflection_read_at = NULL,
           review_duration_seconds = COALESCE($3, review_duration_seconds)
       WHERE id = $2`,
      [reflection, grade.grade_id, reviewDurationSeconds]
    );

    logAction(req, 'reflection_submitted', { ticket_id: req.params.id });
    res.json({
      ok: true,
      reflection_text: reflection,
      reflection_submitted_at: new Date().toISOString()
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/tickets/:id/reflection-read', requireAuth, async (req, res) => {
  try {
    if (req.session.user.role === 'agent') {
      return res.status(403).json({ error: 'Grader only' });
    }

    const grade = await findAccessibleGrade(req.params.id, req.session.user);
    if (!grade) return res.status(404).json({ error: 'Ticket not found' });
    if (grade.grader_user_id !== req.session.user.id && !['admin', 'cs_leader'].includes(req.session.user.role)) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    await pool.query(
      `UPDATE grades
       SET reflection_read_at = COALESCE(reflection_read_at, NOW())
       WHERE id = $1`,
      [grade.grade_id]
    );

    res.json({ ok: true, reflection_read_at: new Date().toISOString() });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/analytics/agents', requireAuth, async (req, res) => {
  try {
    const { category = '', inbox = '', week = '', month = '' } = req.query;
    const where = [
      't.deleted_at IS NULL',
      'g.is_deleted = FALSE',
      'g.submitted = TRUE'
    ];
    const params = [];

    if (category) {
      params.push(category);
      where.push(`g.category = $${params.length}`);
    }
    if (inbox) {
      params.push(inbox);
      where.push(`t.inbox = $${params.length}`);
    }
    if (week) {
      params.push(week);
      where.push(`t.week = $${params.length}`);
    }
    if (month) {
      params.push(month);
      where.push(`TO_CHAR(t.ticket_date, 'YYYY-MM') = $${params.length}`);
    }

    const result = await pool.query(
      `SELECT
         t.agent,
         COUNT(*)::int AS ticket_count,
         ROUND(AVG(g.total_percent))::int AS avg_agent_score,
         ROUND(AVG(
           COALESCE(
             NULLIF(t.bot_payload->>'totalPercent', '')::numeric,
             CASE
               WHEN NULLIF(t.bot_payload->>'denominator', '') IS NOT NULL
                 AND NULLIF(t.bot_payload->>'numerator', '') IS NOT NULL
                 AND NULLIF(t.bot_payload->>'denominator', '')::numeric > 0
               THEN (NULLIF(t.bot_payload->>'numerator', '')::numeric / NULLIF(t.bot_payload->>'denominator', '')::numeric) * 100
               ELSE NULL
             END
           )
         ))::int AS avg_bot_score
       FROM tickets t
       JOIN grades g ON g.ticket_id = t.id
       WHERE ${where.join(' AND ')}
       GROUP BY t.agent
       ORDER BY avg_agent_score DESC NULLS LAST, ticket_count DESC, t.agent ASC`,
      params
    );

    res.json(result.rows);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/analytics/rankings', requireAuth, async (req, res) => {
  try {
    const summaryScopedAgentKey = req.session.user?.role === 'agent'
      ? normalizeAgentIdentity(req.session.user.email || req.session.user.username)
      : '';

    const filteredSummaryFilters = buildAnalyticsFilters(req.query, {
      scopedAgentKey: summaryScopedAgentKey
    });
    const filteredGeneralSummaryFilters = buildAnalyticsFilters(req.query, {
      scopedAgentKey: summaryScopedAgentKey,
      ignoreGrader: true
    });
    const filteredFilters = buildAnalyticsFilters(req.query);
    const filteredGeneralFilters = buildAnalyticsFilters(req.query, {
      ignoreGrader: true
    });
    const allTimeSummaryFilters = buildAnalyticsFilters({}, {
      scopedAgentKey: summaryScopedAgentKey
    });
    const allTimeFilters = buildAnalyticsFilters({});

    const filteredSummary = await pool.query(
      `${analyticsBaseSql(filteredSummaryFilters.whereSql)}
       SELECT
         COUNT(*)::int AS total_tickets,
         COUNT(*) FILTER (WHERE is_human_graded)::int AS grader_ticket_count,
         ROUND(AVG(grader_percent) FILTER (WHERE is_human_graded))::int AS avg_grader_score,
         ROUND(AVG(bot_percent))::int AS avg_bot_score,
         COUNT(*) FILTER (WHERE is_human_graded AND grader_percent = 0)::int AS grader_autofails
       FROM base`,
      filteredSummaryFilters.params
    );

    const filteredGeneralSummary = await pool.query(
      `${analyticsBaseSql(filteredGeneralSummaryFilters.whereSql)}
       SELECT
         COUNT(*) FILTER (WHERE general_percent IS NOT NULL)::int AS general_ticket_count,
         ROUND(AVG(general_percent))::int AS avg_general_score,
         ROUND(AVG(ABS(general_percent - bot_percent)) FILTER (WHERE general_percent IS NOT NULL AND bot_percent IS NOT NULL))::int AS avg_diff
       FROM base`,
      filteredGeneralSummaryFilters.params
    );

    const filteredGeneralAgents = await pool.query(
      `${analyticsBaseSql(filteredGeneralFilters.whereSql)}
       SELECT
         MIN(agent) AS agent,
         COUNT(*)::int AS ticket_count,
         ROUND(AVG(general_percent))::int AS avg_score,
         RANK() OVER (ORDER BY ROUND(AVG(general_percent)) DESC, COUNT(*) DESC, MIN(agent) ASC)::int AS rank
       FROM base
       WHERE general_percent IS NOT NULL
       GROUP BY agent_key
       ORDER BY rank, agent ASC`,
      filteredGeneralFilters.params
    );

    const filteredGraderAgents = await pool.query(
      `${analyticsBaseSql(filteredFilters.whereSql)}
       SELECT
         MIN(agent) AS agent,
         COUNT(*)::int AS ticket_count,
         ROUND(AVG(grader_percent))::int AS avg_score,
         RANK() OVER (ORDER BY ROUND(AVG(grader_percent)) DESC, COUNT(*) DESC, MIN(agent) ASC)::int AS rank
       FROM base
       WHERE is_human_graded
       GROUP BY agent_key
       ORDER BY rank, agent ASC`,
      filteredFilters.params
    );

    const filteredBotAgents = await pool.query(
      `${analyticsBaseSql(filteredFilters.whereSql)}
       SELECT
         MIN(agent) AS agent,
         COUNT(*)::int AS ticket_count,
         ROUND(AVG(bot_percent))::int AS avg_score,
         RANK() OVER (ORDER BY ROUND(AVG(bot_percent)) DESC, COUNT(*) DESC, MIN(agent) ASC)::int AS rank
       FROM base
       WHERE bot_percent IS NOT NULL
       GROUP BY agent_key
       ORDER BY rank, agent ASC`,
      filteredFilters.params
    );

    const weeklyGeneralRanks = await pool.query(
      `${analyticsBaseSql(filteredGeneralFilters.whereSql)}
       , grouped AS (
         SELECT
           week,
           agent_key,
           MIN(agent) AS agent,
           COUNT(*)::int AS ticket_count,
           ROUND(AVG(general_percent))::int AS avg_score
         FROM base
         WHERE general_percent IS NOT NULL
         GROUP BY week, agent_key
       )
       SELECT
         week,
         agent,
         ticket_count,
         avg_score,
         RANK() OVER (
           PARTITION BY week
           ORDER BY avg_score DESC, ticket_count DESC, agent ASC
         )::int AS rank
       FROM grouped
       ORDER BY TO_DATE(week, 'MM/DD/YYYY') DESC NULLS LAST, rank ASC, agent ASC`,
      filteredGeneralFilters.params
    );

    const weeklyGraderRanks = await pool.query(
      `${analyticsBaseSql(filteredFilters.whereSql)}
       , grouped AS (
         SELECT
           week,
           agent_key,
           MIN(agent) AS agent,
           COUNT(*)::int AS ticket_count,
           ROUND(AVG(grader_percent))::int AS avg_score
         FROM base
         WHERE is_human_graded
         GROUP BY week, agent_key
       )
       SELECT
         week,
         agent,
         ticket_count,
         avg_score,
         RANK() OVER (
           PARTITION BY week
           ORDER BY avg_score DESC, ticket_count DESC, agent ASC
         )::int AS rank
       FROM grouped
       ORDER BY TO_DATE(week, 'MM/DD/YYYY') DESC NULLS LAST, rank ASC, agent ASC`,
      filteredFilters.params
    );

    const weeklyBotRanks = await pool.query(
      `${analyticsBaseSql(filteredFilters.whereSql)}
       , grouped AS (
         SELECT
           week,
           agent_key,
           MIN(agent) AS agent,
           COUNT(*)::int AS ticket_count,
           ROUND(AVG(bot_percent))::int AS avg_score
         FROM base
         WHERE bot_percent IS NOT NULL
         GROUP BY week, agent_key
       )
       SELECT
         week,
         agent,
         ticket_count,
         avg_score,
         RANK() OVER (
           PARTITION BY week
           ORDER BY avg_score DESC, ticket_count DESC, agent ASC
         )::int AS rank
       FROM grouped
       ORDER BY TO_DATE(week, 'MM/DD/YYYY') DESC NULLS LAST, rank ASC, agent ASC`,
      filteredFilters.params
    );

    const allTimeSummary = await pool.query(
      `${analyticsBaseSql(allTimeSummaryFilters.whereSql)}
       SELECT
         COUNT(*)::int AS total_tickets,
         COUNT(*) FILTER (WHERE is_human_graded)::int AS grader_ticket_count,
         COUNT(*) FILTER (WHERE general_percent IS NOT NULL)::int AS general_ticket_count,
         ROUND(AVG(general_percent))::int AS avg_general_score,
         ROUND(AVG(grader_percent) FILTER (WHERE is_human_graded))::int AS avg_grader_score,
         ROUND(AVG(bot_percent))::int AS avg_bot_score,
         ROUND(AVG(ABS(general_percent - bot_percent)) FILTER (WHERE general_percent IS NOT NULL AND bot_percent IS NOT NULL))::int AS avg_diff,
         COUNT(*) FILTER (WHERE is_human_graded AND grader_percent = 0)::int AS grader_autofails
       FROM base`,
      allTimeSummaryFilters.params
    );

    const allTimeGeneralAgents = await pool.query(
      `${analyticsBaseSql(allTimeFilters.whereSql)}
       SELECT
         MIN(agent) AS agent,
         COUNT(*)::int AS ticket_count,
         ROUND(AVG(general_percent))::int AS avg_score,
         RANK() OVER (ORDER BY ROUND(AVG(general_percent)) DESC, COUNT(*) DESC, MIN(agent) ASC)::int AS rank
       FROM base
       WHERE general_percent IS NOT NULL
       GROUP BY agent_key
       ORDER BY rank, agent ASC`,
      allTimeFilters.params
    );

    const allTimeGraderAgents = await pool.query(
      `${analyticsBaseSql(allTimeFilters.whereSql)}
       SELECT
         MIN(agent) AS agent,
         COUNT(*)::int AS ticket_count,
         ROUND(AVG(grader_percent))::int AS avg_score,
         RANK() OVER (ORDER BY ROUND(AVG(grader_percent)) DESC, COUNT(*) DESC, MIN(agent) ASC)::int AS rank
       FROM base
       WHERE is_human_graded
       GROUP BY agent_key
       ORDER BY rank, agent ASC`,
      allTimeFilters.params
    );

    const allTimeBotAgents = await pool.query(
      `${analyticsBaseSql(allTimeFilters.whereSql)}
       SELECT
         MIN(agent) AS agent,
         COUNT(*)::int AS ticket_count,
         ROUND(AVG(bot_percent))::int AS avg_score,
         RANK() OVER (ORDER BY ROUND(AVG(bot_percent)) DESC, COUNT(*) DESC, MIN(agent) ASC)::int AS rank
       FROM base
       WHERE bot_percent IS NOT NULL
       GROUP BY agent_key
       ORDER BY rank, agent ASC`,
      allTimeFilters.params
    );

    res.json({
      filtered_summary: {
        ...(filteredSummary.rows[0] || {}),
        ...(filteredGeneralSummary.rows[0] || {})
      },
      filtered_general_agents: filteredGeneralAgents.rows,
      filtered_grader_agents: filteredGraderAgents.rows,
      filtered_bot_agents: filteredBotAgents.rows,
      weekly_general_ranks: weeklyGeneralRanks.rows,
      weekly_grader_ranks: weeklyGraderRanks.rows,
      weekly_bot_ranks: weeklyBotRanks.rows,
      all_time_summary: allTimeSummary.rows[0] || {},
      all_time_general_agents: allTimeGeneralAgents.rows,
      all_time_grader_agents: allTimeGraderAgents.rows,
      all_time_bot_agents: allTimeBotAgents.rows
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/tickets/import', requireAuth, async (req, res) => {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const { tickets, source_file_name } = req.body;
    const saved = [];
    for (const t of tickets) {
      const week = cleanImportValue(t.week);
      const ticketDate = cleanImportValue(t.ticket_date);
      const agent = cleanImportValue(t.agent);
      const createdTime = cleanImportValue(t.created_time);
      const inbox = cleanImportValue(t.inbox);
      const subject = cleanImportValue(t.subject);
      const frontUrl = cleanImportValue(t.front_url) ? String(t.front_url).trim() : null;
      // Grader column (e.g. "Andi") → normalize to username for assignment
      const assignedGrader = cleanImportValue(t.assigned_grader) || null;
      const existing = frontUrl
        ? await client.query(
            `SELECT id
             FROM tickets
             WHERE front_url = $1
             LIMIT 1`,
            [frontUrl]
          )
        : { rows: [] };

      let ticketId;

      if (existing.rows.length) {
        const updated = await client.query(
          `UPDATE tickets
           SET week = $1,
               ticket_date = $2,
               agent = $3,
               created_time = $4,
               inbox = $5,
               front_url = $6,
               subject = $7,
               source_file_name = $8,
               bot_payload = $9,
               assigned_grader = COALESCE($11, assigned_grader),
               deleted_at = NULL,
               deleted_by_user_id = NULL
           WHERE id = $10
           RETURNING id`,
          [
            week,
            ticketDate,
            agent,
            createdTime,
            inbox,
            frontUrl,
            subject,
            cleanImportValue(source_file_name),
            t.bot_payload || {},
            existing.rows[0].id,
            assignedGrader
          ]
        );
        ticketId = updated.rows[0].id;
      } else {
        try {
          const inserted = await client.query(
            `INSERT INTO tickets (
              week,
              ticket_date,
              agent,
              created_time,
              inbox,
              front_url,
              subject,
              source_file_name,
              imported_by_user_id,
              bot_payload,
              assigned_grader
            )
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
            RETURNING id`,
            [
              week,
              ticketDate,
              agent,
              createdTime,
              inbox,
              frontUrl,
              subject,
              cleanImportValue(source_file_name),
              req.session.user.id,
              t.bot_payload || {},
              assignedGrader
            ]
          );
          ticketId = inserted.rows[0].id;
        } catch (error) {
          if (error.code !== '23505' || !frontUrl) throw error;

          const conflicted = await client.query(
            `SELECT id
             FROM tickets
             WHERE front_url = $1
             LIMIT 1`,
            [frontUrl]
          );

          if (!conflicted.rows.length) throw error;

          const recovered = await client.query(
            `UPDATE tickets
             SET week = $1,
                 ticket_date = $2,
                 agent = $3,
                 created_time = $4,
                 inbox = $5,
                 front_url = $6,
                 subject = $7,
                 source_file_name = $8,
                 bot_payload = $9,
                 deleted_at = NULL,
                 deleted_by_user_id = NULL
             WHERE id = $10
             RETURNING id`,
            [
              week,
              ticketDate,
              agent,
              createdTime,
              inbox,
              frontUrl,
              subject,
              cleanImportValue(source_file_name),
              t.bot_payload || {},
              conflicted.rows[0].id
            ]
          );

          ticketId = recovered.rows[0].id;
        }
      }

      saved.push(ticketId);
    }

    await client.query('COMMIT');
    logAction(req, 'tickets_imported', { count: saved.length, source_file_name: source_file_name || null });
    res.json({ ok: true, count: saved.length, ids: saved });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error(error);
    res.status(500).json({ error: error.message });
  } finally {
    client.release();
  }
});

// Assign grader to one or more tickets (CS Leader / Admin only)
app.post('/api/tickets/assign', requireUserMgmt, async (req, res) => {
  try {
    const { ticket_ids, grader_username } = req.body;
    if (!Array.isArray(ticket_ids) || !ticket_ids.length) return res.status(400).json({ error: 'ticket_ids required' });
    await pool.query(
      `UPDATE tickets SET assigned_grader = $1 WHERE id = ANY($2::bigint[])`,
      [grader_username || null, ticket_ids]
    );
    logAction(req, 'tickets_assigned', { count: ticket_ids.length, grader: grader_username });
    res.json({ ok: true, count: ticket_ids.length });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/grades/import', requireAuth, async (req, res) => {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const { grades = [] } = req.body;
    const saved = await bulkUpsertGrades(client, grades, req.session.user.id);

    await client.query('COMMIT');
    res.json({ ok: true, count: saved.length, ids: saved });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error(error);
    res.status(500).json({ error: error.message });
  } finally {
    client.release();
  }
});

app.get('/api/tickets/:id/grade', requireAuth, async (req, res) => {
  try {
    const ticketId = req.params.id;

    const gradeResult = await pool.query(
      `SELECT * FROM grades
       WHERE ticket_id = $1 AND is_deleted = FALSE
       LIMIT 1`,
      [ticketId]
    );

    if (!gradeResult.rows.length) {
      return res.json({ grade: null, breakdown: [], flags: [] });
    }

    const grade = gradeResult.rows[0];

    const breakdown = await pool.query(
      `SELECT category_id, score, cause, custom_cause
       FROM grade_breakdown
       WHERE grade_id = $1`,
      [grade.id]
    );

    const flags = await pool.query(
      `SELECT flag_id, value, cause, custom_cause
       FROM grade_flags
       WHERE grade_id = $1`,
      [grade.id]
    );

    res.json({
      grade,
      breakdown: breakdown.rows,
      flags: flags.rows
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: error.message });
  }
});

app.put('/api/tickets/:id/grade', requireAuth, async (req, res) => {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const ticketId = req.params.id;
    const payload = req.body;

    const gradeId = await upsertGrade(client, ticketId, payload, req.session.user.id);

    await client.query('COMMIT');
    logAction(req, payload.submitted ? 'grade_submitted' : 'grade_saved', { ticket_id: ticketId, grade_id: gradeId });
    res.json({ ok: true, grade_id: gradeId });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error(error);
    res.status(500).json({ error: error.message });
  } finally {
    client.release();
  }
});

app.delete('/api/tickets/:id', requireDeletePerm, async (req, res) => {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    const deletedIds = await hardDeleteTickets(client, [req.params.id]);

    if (!deletedIds.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Ticket not found' });
    }

    await client.query('COMMIT');
    logAction(req, 'ticket_deleted', {});
    res.json({ ok: true });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error(error);
    res.status(500).json({ error: error.message });
  } finally {
    client.release();
  }
});

// Purge all tickets — admin only
app.delete('/api/tickets', requireAdmin, async (req, res) => {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    const existing = await client.query(`SELECT id FROM tickets`);
    const deletedIds = await hardDeleteTickets(client, existing.rows.map(row => row.id));
    await client.query('COMMIT');
    logAction(req, 'tickets_purged', { count: deletedIds.length });
    res.json({ ok: true, count: deletedIds.length });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error(error);
    res.status(500).json({ error: error.message });
  } finally {
    client.release();
  }
});

// Delete a user — admin + cs_leader (cannot delete yourself)
app.delete('/api/admin/users/:id', requireUserMgmt, async (req, res) => {
  try {
    if (String(req.params.id) === String(req.session.user.id)) {
      return res.status(400).json({ error: 'Cannot delete your own account' });
    }
    const lookup = await pool.query(`SELECT username, role FROM users WHERE id = $1`, [req.params.id]);
    const result = await pool.query(
      `DELETE FROM users WHERE id = $1 RETURNING id`,
      [req.params.id]
    );
    if (!result.rows.length) {
      return res.status(404).json({ error: 'User not found' });
    }
    logAction(req, 'user_deleted', { target_id: req.params.id, target_username: lookup.rows[0]?.username });
    res.json({ ok: true });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: error.message });
  }
});

// Edit user credentials (email, username, role) — admin + cs_leader
app.patch('/api/admin/users/:id/credentials', requireUserMgmt, async (req, res) => {
  try {
    const { email, username, role } = req.body;
    const result = await pool.query(
      `UPDATE users SET email = $1, username = $2, role = $3 WHERE id = $4
       RETURNING id, email, username, role`,
      [email, username, role, req.params.id]
    );
    if (!result.rows.length) {
      return res.status(404).json({ error: 'User not found' });
    }
    logAction(req, 'user_credentials_edited', { target_id: req.params.id, target_username: username, new_role: role });
    res.json({ ok: true, user: result.rows[0] });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: error.message });
  }
});

// Logs — admin + cs_leader
app.get('/api/logs', requireUserMgmt, async (req, res) => {
  try {
    const { username, action, dateFrom, dateTo, limit = 200, offset = 0 } = req.query;
    const where = [];
    const params = [];

    if (username) {
      params.push(`%${username}%`);
      where.push(`l.username ILIKE $${params.length}`);
    }
    if (action && action !== 'all') {
      params.push(action);
      where.push(`l.action = $${params.length}`);
    }
    if (dateFrom) {
      params.push(dateFrom);
      where.push(`l.created_at >= $${params.length}::date`);
    }
    if (dateTo) {
      params.push(dateTo);
      where.push(`l.created_at < ($${params.length}::date + interval '1 day')`);
    }

    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    params.push(Math.min(Number(limit) || 200, 500));
    params.push(Number(offset) || 0);

    const result = await pool.query(
      `SELECT l.id, l.user_id, l.username, l.role, l.action, l.details, l.ip, l.created_at
       FROM user_logs l
       ${whereSql}
       ORDER BY l.created_at DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );

    const countResult = await pool.query(
      `SELECT COUNT(*)::int AS total FROM user_logs l ${whereSql}`,
      params.slice(0, params.length - 2)
    );

    res.json({ rows: result.rows, total: countResult.rows[0].total });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: error.message });
  }
});

const port = process.env.PORT || 3001;
app.use((err, req, res, next) => {
  console.error(err);

  if (res.headersSent) {
    return next(err);
  }

  const origin = req.headers.origin;
  if (origin && isAllowedOrigin(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.append('Vary', 'Origin');
  }

  res.status(err.status || 500).json({
    error: err.message || 'Internal Server Error'
  });
});

// Catch-all: serve index.html for any non-API route (SPA fallback)
app.get('/{*path}', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

async function seedAdminIfEmpty() {
  const { rows } = await pool.query('SELECT COUNT(*) AS cnt FROM users');
  if (parseInt(rows[0].cnt, 10) > 0) return;
  const username = process.env.SEED_USERNAME;
  const password = process.env.SEED_PASSWORD;
  const email    = process.env.SEED_EMAIL || `${username}@wonderly.com`;
  if (!username || !password) {
    console.warn('No users exist and SEED_USERNAME/SEED_PASSWORD not set — skipping auto-seed');
    return;
  }
  const hash = await bcrypt.hash(password, 10);
  await pool.query(
    'INSERT INTO users (email, username, password_hash, role) VALUES ($1, $2, $3, $4)',
    [email, username, hash, 'admin']
  );
  console.log(`Seeded admin user: ${username}`);
}

Promise.all([ensureSchema(), ensureReflectionSchema(), ensureLogsTable()])
  .then(() => seedAdminIfEmpty())
  .then(() => {
    app.listen(port, () => {
      console.log(`API listening on http://localhost:${port}`);
    });
  })
  .catch(error => {
    console.error('Failed to initialize database schema', error);
    process.exit(1);
  });

const API_BASE = '';
const FRONT_BASE = `/api/front`;
const TOKEN_KEY = 'qa-auth-token';

// Intercept all fetch calls to API_BASE and inject Bearer token so auth works
// even when cross-site cookies are blocked (Chrome Privacy Sandbox).
const _origFetch = window.fetch.bind(window);
window.fetch = function(url, options = {}) {
  // Inject Bearer token on same-origin /api/ requests (and absolute URLs to the backend)
  const isApiCall = typeof url === 'string' && (url.startsWith('/api/') || (API_BASE && url.startsWith(API_BASE)));
  if (isApiCall) {
    const token = localStorage.getItem(TOKEN_KEY);
    if (token) {
      options = { ...options, headers: { ...(options.headers || {}), 'Authorization': `Bearer ${token}` } };
    }
  }
  return _origFetch(url, options);
};
const THEME_KEY = 'qa-theme';
const ANALYTICS_FILTER_KEY = 'qa-analytics-filters';
// Tickets on or before this date are excluded from reflection requirements and submissions analytics
const REFLECTION_CUTOFF_MS = new Date('2026-03-29T23:59:59').getTime();
function isBeforeCutoff(dateStr) {
  if (!dateStr) return false;
  const ms = new Date(dateStr).getTime();
  return !isNaN(ms) && ms <= REFLECTION_CUTOFF_MS;
}

const C = [
  {
    sec:'Language & Communication',
    id:'grammar',
    label:'Grammar & Language',
    max:5,
    opts:[0,1,2,3,4,5,'NA'],
    causes:[
      'Odd formatting',
      'Wrong grammar',
      'Improper use of punctuations',
      'Incoherent response structure',
      'Too long/Noisy response',
      'NA'
    ]
  },
  {
    sec:'Language & Communication',
    id:'tone',
    label:'Tone & Personalization',
    max:5,
    opts:[0,1,2,3,4,5,'NA'],
    causes:[
      'Failed to address the user by their first name',
      'Lacks empathy statement',
      'Tone mismatch',
      'Robotic response',
      'No HC and Video Overview link in signature',
      'Improper greeting/closing',
      'NA'
    ]
  },
  {
    sec:'Language & Communication',
    id:'timeliness',
    label:'Timeliness & Responsiveness',
    max:10,
    opts:[0,1,2,3,4,5,6,7,8,9,10,'NA'],
    causes:[
      'Failed to send a reply within shift',
      'NA'
    ]
  },
  {
    sec:'Process & Efficiency',
    id:'efficiency',
    label:'Ticket Efficiency',
    max:15,
    opts:[0,3,6,9,12,15,'NA'],
    causes:[
      'Misuse of tools',
      'Failed to follow the IKB',
      'Failed to escalate',
      'Invalid escalation',
      'Unnecessary back-and-forth messages',
      'Comprehension Issue',
      'Missed to address other concern',
      'Missed to address underlying concern',
      'Missed checking duplicate/previous ticket/s',
      'Failed to follow the documented process',
      'Performed improper action',
      'Customer experience',
      'NA'
    ]
  },
  {
    sec:'Process & Efficiency',
    id:'probing',
    label:'Probing & Clarification',
    max:10,
    opts:[0,2,4,6,8,10,'NA'],
    causes:[
      'Failed to probe',
      'Unnecessary probing',
      'Irrelevant probing questions',
      'Incorrect probing questions',
      'Incomplete probing questions',
      'NA'
    ]
  },
  {
    sec:'Quality & Knowledge',
    id:'problem',
    label:'Problem Statement Comprehension',
    max:20,
    opts:[0,4,8,12,16,20,'NA'],
    causes:[
      'No problem statement',
      'Incorrect problem statement',
      'Incomplete problem statement',
      'Confusing problem statement',
      'Irrelevant problem statement',
      'Vague PS',
      'Incorrect format of PS',
      'Unnecessary PS',
      'NA'
    ]
  },
  {
    sec:'Quality & Knowledge',
    id:'education',
    label:'Customer Education',
    max:15,
    opts:[0,3,6,9,12,15,'NA'],
    causes:[
      'Failed to educate the user',
      'Incomplete customer education',
      'Unnecessary/Irrelevant customer education',
      'Misinformation',
      'Customer experience',
      'NA'
    ]
  },
  {
    sec:'Quality & Knowledge',
    id:'resolution',
    label:'Resolution Quality',
    max:20,
    opts:[0,4,8,12,16,20,'NA'],
    causes:[
      'Incomplete Resolution',
      'Improper Resolution',
      'Misinformation',
      'Lacks clarity',
      'Failed to provide available/known workaround',
      'Irrelevant information',
      'No resolution provided',
      'Failed to set proper expectations',
      'Failed to add HC links',
      'Customer experience',
      'NA'
    ]
  },
  {
    sec:'Documentation',
    id:'docs',
    label:'Documentation & Notes',
    max:10,
    opts:[0,2,4,6,8,10,'NA'],
    causes:[
      "Failed to note the user’s email address/es",
      'Failed to note the Feature Request',
      'Failed to leave investigation notes',
      'Incomplete documentation',
      'No notes',
      'Unclear/misleading notes',
      'Failed to add an entry in the fakenews channel',
      'Incorrect note/s',
      'NA'
    ]
  },
  {
    sec:'Documentation',
    id:'chatbot',
    label:'Chatbot Education',
    max:16,
    opts:[0,4,8,12,16,20,'NA'],
    causes:[
      'Did not provide follow up reply when necessary.',
      'Failed to tag Fake News',
      'Incorrectly tagged Fake News',
      'Misidentified Fake News',
      "Didn't correct the bot's misinformation in the message",
      'NA'
    ]
  },
  {
    sec:'Documentation',
    id:'tag_usage',
    label:'Tag Usage',
    max:10,
    opts:[0,2,4,6,8,10,'NA'],
    causes:[
      'Failed to add the necessary tag/s',
      'Incorrect tag',
      'Incomplete tags',
      'NA'
    ]
  }
];

const AFS = [
  {
    id:'autofail',
    label:'Auto-Fail',
    desc:'Automatic failure trigger',
    type:'boolean',
    causes:[
      'Archived & left the ticket unattended',
      'Unreasonable handling',
      'Misconceived resolution',
      'Unapproved troubleshooting steps',
      'Failed to follow 3-message max rule',
      'Sharing of internal information',
      'Unprofessional behavior',
      "Unauthorized sharing of user's info",
      'Processed refund incorrectly',
      'Made unauthorized changes to an account',
      "QA'd the account without consent",
      'QA Score Below 50%',
      'NA'
    ]
  },
  {
    id:'autofail_ov',
    label:'Auto-fail Override',
    desc:'Override the auto-fail',
    type:'boolean',
    causes:[]
  },
  {
    id:'bug_esc',
    label:'Bug Escalation',
    desc:'Bug-related escalation',
    type:'score',
    max:20,
    opts:[0,4,8,12,16,20,'NA'],
    causes:[
      'Delayed bug reporting',
      'Lacks necessary details',
      'Linked to the wrong bug report',
      'Failed to identify an existing bug report',
      "Failed to re-record the user’s video/screenshot in Loom",
      'Loom recording has no voiceover',
      'Poorly written documentation',
      'NA'
    ]
  },
  {
    id:'post_bug',
    label:'Post Bug Escalation',
    desc:'Post-bug follow-up',
    type:'score',
    max:20,
    opts:[0,4,8,12,16,20,'NA'],
    causes:[
      'Failed to update the bug report',
      'Failed to update the user/s',
      'Updated a user incorrectly',
      'Provided inappropriate steps/information',
      'NA'
    ]
  }
];

const ANALYTICS_CATEGORY_OPTIONS = [
  ...C.map(c => ({ id: c.id, label: c.label, type: 'score', max: c.max })),
  { id: 'autofail', label: 'Auto-Fail', type: 'boolean' },
  { id: 'bug_esc', label: 'Bug Esc', type: 'score', max: 20 },
  { id: 'post_bug', label: 'Post Bug Esc', type: 'score', max: 20 }
];

C.forEach(c => {
  if (!c.causes.includes('Other')) c.causes.push('Other');
});

AFS.forEach(a => {
  if (a.causes && a.causes.length && !a.causes.includes('Other')) {
    a.causes.push('Other');
  }
});

const MAX_SCORE = C.reduce((s, c) => s + c.max, 0);

let TICKETS = [];
let user = null;
let sel = null;
let grades = {};
let filter = 'all';

// Dirty flags — tabs only re-render when data has changed since last visit
const tabDirty = { h: true, s: true, n: true, m: true, a: true, u: true, l: true };
function markTabsDirty() { Object.keys(tabDirty).forEach(k => { tabDirty[k] = true; }); tabDirty.h = true; }
let ticketsLoading = false;
let editing = false;
let selectedIds = new Set();
let reviewTimerStart = null;
let reviewTimerInterval = null;
let reviewAccumulated = {};   // { ticketId: totalSeconds } — persists across open/close
let reviewingTicketId = null; // ticket whose timer is currently running
function defaultTicketFilters(){
  return { category:'', inbox:'', agent:'', week:'', convId:'', dateFrom:'', dateTo:'', grader:'', scoreFrom:'', scoreTo:'', autofail:'' };
}

function defaultSubmissionFilters(){
  return { categories:[], inboxes:[], agents:[], weeks:[], convId:'', dateFrom:'', dateTo:'', grader:'', scoreFrom:'', scoreTo:'', autofail:'' };
}

let F = defaultTicketFilters();
let SF = defaultSubmissionFilters();
let qfOpen = false;
let charts = {};
let toastTimer = null;
let bulkGradeImportSupported = null;
let notifications = { count: 0, items: [] };
let currentDetailTicketId = null;
let currentDetailOptions = {};
const PAGE_SIZE_OPTIONS = [25, 50, 100, 250, 500];
let pagination = {
  grading: { page: 1, pageSize: 50 },
  submissions: { page: 1, pageSize: 100 },
  newTickets: { page: 1, pageSize: 100 }
};

function defaultAnalyticsFilters(){
  return {
    grader:'',
    agents:[],
    excludedAgents:[],
    categories:[],
    inboxes:[],
    week:'',
    month:'',
    dateFrom:'',
    dateTo:''
  };
}

function sanitizeStringArray(values){
  if(!Array.isArray(values)) return [];
  return [...new Set(values.map(v => String(v || '').trim()).filter(Boolean))];
}

function sanitizeAnalyticsFilters(value){
  const base = defaultAnalyticsFilters();
  const source = value && typeof value === 'object' ? value : {};
  return {
    grader: String(source.grader || ''),
    agents: sanitizeStringArray(source.agents),
    excludedAgents: sanitizeStringArray(source.excludedAgents),
    categories: sanitizeStringArray(source.categories),
    inboxes: sanitizeStringArray(source.inboxes),
    week: String(source.week || ''),
    month: String(source.month || ''),
    dateFrom: String(source.dateFrom || ''),
    dateTo: String(source.dateTo || '')
  };
}

function loadAnalyticsFilters(){
  try {
    return sanitizeAnalyticsFilters(JSON.parse(localStorage.getItem(ANALYTICS_FILTER_KEY) || 'null'));
  } catch (e) {
    return defaultAnalyticsFilters();
  }
}

function saveAnalyticsFilters(){
  try {
    localStorage.setItem(ANALYTICS_FILTER_KEY, JSON.stringify(AF));
  } catch (e) {}
}

let AF = loadAnalyticsFilters();

function applyThemePreference(theme, persist = true) {
  const valid = ['system', 'light', 'dark', 'contrast', 'grey'];
  const normalized = valid.includes(theme) ? theme : 'system';
  document.documentElement.dataset.theme = normalized;
  if (persist) {
    try { localStorage.setItem(THEME_KEY, normalized); } catch (e) {}
  }
  const select = document.getElementById('theme-switch');
  if (select) select.value = normalized;
}

function showBootLoading(message = 'Fetching your data…') {
  const overlay = document.getElementById('boot-loading');
  const copy = document.getElementById('boot-loading-copy');
  if (copy) copy.textContent = message;
  if (overlay) overlay.classList.add('on');
}

function hideBootLoading() {
  const overlay = document.getElementById('boot-loading');
  if (overlay) overlay.classList.remove('on');
}

function blankG(){
  const g = {
    scores:{},
    causes:{},
    customCauses:{},
    af:{},
    afCauses:{},
    afCustomCauses:{},
    qaFeedback:'',
    agentFocus:'',
    botSimilar:'No',
    botSuggestion:'',
    category:'',
    brianNotes:'',
    fixed:'No',
    numerator:null,
    denominator:null,
    totalPercent:null,
    reflection:'',
    reflectionSubmittedAt:'',
    agentAcknowledgedAt:'',
    reflectionReadAt:'',
    reviewDurationSeconds:null,
    graderUserId:null,
    submitted:false,
    grader:'Bot'
  };

  C.forEach(c => {
    g.scores[c.id] = 'NA';
    g.causes[c.id] = '— select —';
    g.customCauses[c.id] = '';
  });

  AFS.forEach(a => {
    g.af[a.id] = a.type === 'boolean' ? false : 'NA';
    g.afCauses[a.id] = '— select —';
    g.afCustomCauses[a.id] = '';
  });

  return g;
}

function nv(v){
  return v === 'NA' || v === '' || v === undefined || v === null || String(v).startsWith('—')
    ? 0
    : (parseInt(v, 10) || 0);
}

function metricNumber(v){
  if(v === '' || v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function escapeHtml(str){
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function safeHref(url){
  const value = String(url ?? '').trim();
  return /^https?:\/\//i.test(value) ? value : '';
}

function renderInlineMarkdown(text){
  const source = String(text ?? '');
  const linkRe = /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/gi;
  let out = '';
  let last = 0;
  let match;

  while((match = linkRe.exec(source))){
    out += escapeHtml(source.slice(last, match.index));
    const href = safeHref(match[2]);
    const label = escapeHtml(match[1]);
    out += href
      ? `<a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">${label}</a>`
      : label;
    last = match.index + match[0].length;
  }

  out += escapeHtml(source.slice(last));
  return out;
}

function renderMessageBody(text){
  const normalized = String(text ?? '').replace(/\r\n/g, '\n').trim();
  if(!normalized) return '<p></p>';

  const blocks = normalized.split(/\n{2,}/).filter(Boolean);
  return blocks.map(block => {
    if(/^\s*[-*_]{3,}\s*$/.test(block)) return '<hr class="msg-hr">';
    return `<p>${renderInlineMarkdown(block).replace(/\n/g, '<br>')}</p>`;
  }).join('');
}

function botRaw(t){
  const stored = metricNumber(t?.bot?.numerator);
  if(stored !== null) return stored;
  if (!t) return 0;
  return C.reduce((s, c) => s + nv(t.bot?.[c.id]), 0);
}

function agentRawUnfiltered(id){
  const g = grades[id];
  if(!g) return 0;
  return C.reduce((s, c) => s + nv(g.scores[c.id]), 0);
}

function agentRaw(id){
  const g = grades[id];
  if(!g) return 0;
  const useStored = g.submitted && !(editing && sel && String(sel.id) === String(id));
  if(useStored){
    const stored = metricNumber(g.numerator);
    if(stored !== null) return stored;
  }
  if(g.af.autofail && !g.af.autofail_ov) return 0;
  const raw = agentRawUnfiltered(id);
  const denom = agentDenom(id);
  return denom > 0 && pct(raw, denom) < 50 ? 0 : raw;
}

function pct(v, m){
  return m > 0 ? Math.round((v / m) * 100) : 0;
}

function parseDate(s){
  if(!s) return null;
  s = String(s).trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if(m) return new Date(+m[1], +m[2]-1, +m[3]);
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if(m) return new Date(+m[3], +m[1]-1, +m[2]);
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

function weekOf(dateStr){
  const d = parseDate(dateStr);
  if(!d) return '';
  const diff = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - diff);
  return String(d.getMonth()+1).padStart(2,'0') + '/' + String(d.getDate()).padStart(2,'0') + '/' + d.getFullYear();
}

function fmtDate(dateStr){
  const d = parseDate(dateStr);
  if(!d) return String(dateStr || '');
  return String(d.getMonth()+1).padStart(2,'0') + '/' + String(d.getDate()).padStart(2,'0') + '/' + d.getFullYear();
}

function monthKey(dateStr){
  const d = parseDate(dateStr);
  if(!d) return '';
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
}

function normalizeAgentIdentity(value){
  const s = String(value || '').trim().toLowerCase();
  if(!s) return '';
  if(s === 'ed' || s === 'ednalyn.c') return 'ednalyn.c';
  const parts = s.split('@');
  if(parts.length === 2 && ['usemotion.com', 'wonderly.com'].includes(parts[1])) return parts[0];
  return s;
}

function analyticsAgentLabel(value){
  const raw = String(value || '').trim();
  if(!raw) return '';
  const key = normalizeAgentIdentity(raw);
  const parts = raw.toLowerCase().split('@');
  if(key === 'ednalyn.c') return 'ednalyn.c@wonderly.com';
  if(parts.length === 2 && ['usemotion.com', 'wonderly.com'].includes(parts[1])) return `${key}@wonderly.com`;
  return raw;
}

function analyticsCategoryMatch(ticketId, categoryIds = []){
  if(!categoryIds.length) return true;
  const g = grades[ticketId];
  if(!g) return false;

  return categoryIds.some(categoryId => {
    const cat = ANALYTICS_CATEGORY_OPTIONS.find(item => item.id === categoryId);
    if(!cat) return false;
    if(categoryId === 'autofail') return !!g.af.autofail;
    if(categoryId === 'bug_esc' || categoryId === 'post_bug'){
      const value = g.af[categoryId];
      return !isNA(value) && nv(value) < cat.max;
    }
    const score = g.scores[categoryId];
    return !isNA(score) && nv(score) < cat.max;
  });
}

function convIdFromFrontUrl(frontUrl){
  return (String(frontUrl || '').match(/cnv_[^\/\s?#]+/) || [''])[0];
}

function isHumanGradedTicket(ticketId){
  const grader = String(grades[ticketId]?.grader || 'Bot').trim().toLowerCase();
  return !!grades[ticketId]?.submitted && grader !== 'bot';
}

function isNA(v){
  return v === 'NA' || v === '' || v === undefined || v === null || String(v).startsWith('—');
}

function botDenom(t){
  const stored = metricNumber(t?.bot?.denominator);
  if(stored !== null) return stored;
  if(!t) return 0;
  const d = C.reduce((s, c) => (c.id === 'tag_usage' || isNA(t.bot?.[c.id])) ? s : s + c.max, 0);
  return Math.min(d, 110);
}

function botPercent(t){
  const stored = metricNumber(t?.bot?.totalPercent);
  if(stored !== null) return stored;
  const numerator = metricNumber(t?.bot?.numerator);
  const denominator = metricNumber(t?.bot?.denominator);
  if(numerator !== null && denominator !== null && denominator > 0){
    return Math.round((numerator / denominator) * 100);
  }
  const denom = botDenom(t);
  return denom > 0 ? pct(botRaw(t), denom) : null;
}

function agentDenom(id){
  const g = grades[id];
  if(!g) return 0;
  const useStored = g.submitted && !(editing && sel && String(sel.id) === String(id));
  if(useStored){
    const stored = metricNumber(g.denominator);
    if(stored !== null) return stored;
  }
  return Math.min(C.reduce((s, c) => (c.id === 'tag_usage' || isNA(g.scores[c.id])) ? s : s + c.max, 0), 110);
}

function scol(p){
  return p >= 80 ? '#1ec97a' : p >= 50 ? '#4f7cff' : '#f04e4e';
}

function isAF(id){
  const g = grades[id];
  if(!g) return false;
  if(g.af.autofail && !g.af.autofail_ov) return true;
  const useStored = g.submitted && !(editing && sel && String(sel.id) === String(id));
  if(useStored){
    const numerator = metricNumber(g.numerator);
    const denominator = metricNumber(g.denominator);
    const totalPercent = metricNumber(g.totalPercent);
    if(numerator !== null && denominator !== null){
      const pctValue = totalPercent !== null ? totalPercent : pct(numerator, denominator);
      return denominator > 0 && pctValue === 0 && agentRawUnfiltered(id) > 0;
    }
  }
  const rawU = agentRawUnfiltered(id);
  const denom = agentDenom(id);
  return denom > 0 && pct(rawU, denom) < 50 && rawU > 0;
}

function generalPercent(ticketId){
  const g = grades[ticketId];
  if(!g?.submitted) return null;
  const stored = metricNumber(g.totalPercent);
  if(stored !== null) return stored;
  const numerator = metricNumber(g.numerator);
  const denominator = metricNumber(g.denominator);
  if(numerator !== null && denominator !== null && denominator > 0){
    return Math.round((numerator / denominator) * 100);
  }
  return null;
}

function avgRounded(values){
  const nums = values.filter(v => typeof v === 'number' && Number.isFinite(v));
  if(!nums.length) return 0;
  return Math.round(nums.reduce((sum, v) => sum + v, 0) / nums.length);
}

function ticketMatchesAnalyticsFilters(t, options = {}){
  const { ignoreGrader = false } = options;
  const g = grades[t.id];
  const agentKey = normalizeAgentIdentity(t.agent);
  if (!ignoreGrader && AF.grader && (g?.grader || '') !== AF.grader) return false;
  if (AF.agents.length && !AF.agents.includes(agentKey)) return false;
  if (AF.excludedAgents.length && AF.excludedAgents.includes(agentKey)) return false;
  if (!analyticsCategoryMatch(t.id, AF.categories)) return false;
  if (AF.inboxes.length && !AF.inboxes.includes(t.inbox || '')) return false;
  if (AF.week && t.week !== AF.week) return false;
  const ticketMonth = monthKey(t.date || t.createdTime);
  if (AF.month && ticketMonth !== AF.month) return false;
  if (AF.dateFrom && t.date && t.date < AF.dateFrom) return false;
  if (AF.dateTo && t.date && t.date > AF.dateTo) return false;
  return true;
}

function summarizeGeneralAnalytics(tickets){
  const generalScores = [];
  const gaps = [];

  tickets.forEach(t => {
    const general = generalPercent(t.id);
    if(general === null) return;
    generalScores.push(general);
    const bot = botPercent(t);
    if(bot !== null) gaps.push(Math.abs(general - bot));
  });

  return {
    count: generalScores.length,
    avgScore: avgRounded(generalScores),
    avgGap: avgRounded(gaps)
  };
}

function buildAgentRankingRows(tickets, scoreGetter){
  const buckets = new Map();

  tickets.forEach(t => {
    const score = scoreGetter(t);
    if(score === null || !Number.isFinite(score)) return;
    const key = normalizeAgentIdentity(t.agent);
    if(!key) return;
    if(!buckets.has(key)){
      buckets.set(key, {
        ag: analyticsAgentLabel(t.agent) || t.agent || 'Unknown',
        n: 0,
        total: 0
      });
    }
    const bucket = buckets.get(key);
    bucket.n += 1;
    bucket.total += score;
  });

  const rows = [...buckets.values()]
    .map(row => ({
      ag: row.ag,
      n: row.n,
      aA: Math.round(row.total / row.n),
      rank: 0
    }))
    .sort((a, b) => b.aA - a.aA || b.n - a.n || a.ag.localeCompare(b.ag));

  let rank = 0;
  let prevKey = '';
  rows.forEach((row, index) => {
    const currentKey = `${row.aA}|${row.n}`;
    if(currentKey !== prevKey){
      rank = index + 1;
      prevKey = currentKey;
    }
    row.rank = rank;
  });

  return rows;
}

function buildWeeklyRankingRows(tickets, scoreGetter){
  const weeks = new Map();

  tickets.forEach(t => {
    const score = scoreGetter(t);
    if(score === null || !Number.isFinite(score)) return;
    const week = t.week || weekOf(t.date || t.createdTime) || '—';
    if(!weeks.has(week)) weeks.set(week, []);
    weeks.get(week).push(t);
  });

  return [...weeks.entries()]
    .sort((a, b) => {
      const da = parseDate(a[0]);
      const db = parseDate(b[0]);
      return (db?.getTime() || 0) - (da?.getTime() || 0);
    })
    .flatMap(([week, weekTickets]) => buildAgentRankingRows(weekTickets, scoreGetter).map(row => ({
      week,
      ...row
    })));
}

function parseImportedValue(v){
  if(v === null || v === undefined) return 'NA';
  const s = String(v).trim();
  if(!s || s.toLowerCase() === 'nan') return 'NA';
  if(s.toUpperCase() === 'NA') return 'NA';
  if(s.toUpperCase() === 'TRUE') return true;
  if(s.toUpperCase() === 'FALSE') return false;
  const normalized = s.replace(/,/g, '');
  const n = Number(normalized);
  if(!Number.isNaN(n)) return n;
  const ni = parseInt(normalized, 10);
  return !Number.isNaN(ni) ? ni : s;
}

function parseImportedMetric(v){
  const parsed = parseImportedValue(v);
  return typeof parsed === 'number' && Number.isFinite(parsed) ? parsed : null;
}

function pickOverride(baseVal, overrideVal){
  const ov = parseImportedValue(overrideVal);
  if(ov !== 'NA' && ov !== '' && ov !== null && ov !== undefined) return ov;
  return parseImportedValue(baseVal);
}

function parseYesNo(v){
  const s = String(v ?? '').trim().toUpperCase();
  if(s === 'YES') return 'Yes';
  if(s === 'NO') return 'No';
  return 'No';
}

function safeCell(row, key){
  return row[key] ?? '';
}

function shouldSkipImportedRow(row){
  const created = String(safeCell(row, 'Created Time') ?? '').trim();
  if(!created) return true;
  if(created.toUpperCase() === 'NA' || created.toLowerCase() === 'nan') return true;
  if(/\bNA\b/i.test(created)) return true;
  return !ticketDateFromCreatedTime(created);
}

function parseDelimitedLine(line, sep = ';'){
  const out = [];
  let cur = '';
  let inQuotes = false;

  for(let i = 0; i < line.length; i++){
    const ch = line[i];
    const next = line[i + 1];

    if(ch === '"'){
      if(inQuotes && next === '"'){
        cur += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if(ch === sep && !inQuotes){
      out.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }

  out.push(cur);
  return out.map(v => v.trim());
}

function parseDelimitedRecords(text){
  const rows = [];
  let cur = '';
  let inQuotes = false;

  for(let i = 0; i < text.length; i++){
    const ch = text[i];
    const next = text[i + 1];

    cur += ch;

    if(ch === '"'){
      if(inQuotes && next === '"'){
        cur += next;
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    }

    if(ch === '\n' && !inQuotes){
      const row = cur.replace(/\r?\n$/, '');
      if(row.trim()) rows.push(row);
      cur = '';
    }
  }

  if(cur.trim()) rows.push(cur);
  return rows;
}

function mapImportedRow(row, importedIndex, options = {}){
  const { submitted = false } = options;
  const tid = 'IMP-' + String(Date.now() + importedIndex).slice(-8);
  const created = safeCell(row, 'Created Time');
  const inbox = safeCell(row, 'Inbox');
  const agent = safeCell(row, 'Agent');
  const graderName = safeCell(row,'Grader') || 'Bot';
  const normalizedGrader = String(graderName).trim().toLowerCase();
  const allowManualOverrides = normalizedGrader && normalizedGrader !== 'bot';
  const botAFVal = parseImportedValue(safeCell(row, 'Auto-Fail'));
  const botAFOvVal = parseImportedValue(safeCell(row, 'Auto-fail override')) === true || parseImportedValue(safeCell(row, 'Auto-Fail (Manual Override)')) === true;
  const botNumerator = parseImportedMetric(safeCell(row, 'Bot Numerator'));
  const botDenominator = parseImportedMetric(safeCell(row, 'Bot Denominator'));
  const botTotalPercent = parseImportedMetric(safeCell(row, "Bot's score"));
  const andiNumerator = parseImportedMetric(safeCell(row, "Andi's Numerator"));
  const andiDenominator = parseImportedMetric(safeCell(row, "Andi's Denominator"));
  const andiTotalPercent = parseImportedMetric(safeCell(row, "Andi's score"));
  const hasImportedValue = (value) => {
    const parsed = parseImportedValue(value);
    return parsed !== 'NA' && parsed !== '' && parsed !== null && parsed !== undefined;
  };
  const firstImportedText = (...values) => {
    for(const value of values){
      const s = String(value ?? '').trim();
      if(s && s.toUpperCase() !== 'NA') return s;
    }
    return '';
  };
  const resolveImportedScore = (baseScore, ...overrideValues) => {
    if(!allowManualOverrides) return baseScore;
    for(const value of overrideValues){
      if(hasImportedValue(value)) return parseImportedValue(value);
    }
    return baseScore;
  };
  const resolveImportedCause = (baseCause, ...overrideValues) => {
    if(!allowManualOverrides) return baseCause;
    const overrideCause = firstImportedText(...overrideValues);
    return overrideCause || baseCause;
  };

  const botPayload = {
    grammar: parseImportedValue(safeCell(row,'Grammar & Language (5)')),
    grammarCause: safeCell(row,'Grammar & Language Cause'),

    tone: parseImportedValue(safeCell(row,'Tone & Personalization (5)')),
    toneCause: safeCell(row,'Tone & Personalization Cause'),

    timeliness: parseImportedValue(safeCell(row,'Timeliness & Responsiveness (10)')),
    timelinessCause: safeCell(row,'Timeliness & Responsiveness Cause'),

    efficiency: parseImportedValue(safeCell(row,'Ticket Efficiency (15)')),
    efficiencyCause: safeCell(row,'Ticket Efficiency Cause'),

    probing: parseImportedValue(safeCell(row,'Probing & Clarification (10)')),
    probingCause: safeCell(row,'Probing & Clarification Cause'),

    problem: parseImportedValue(safeCell(row,'Problem Statement Comprehension (20)')),
    problemCause: safeCell(row,'Problem Statement Comprehension Cause'),

    education: parseImportedValue(safeCell(row,'Customer Education (15)')),
    educationCause: safeCell(row,'Customer Education Cause'),

    resolution: parseImportedValue(safeCell(row,'Resolution Quality (20)')),
    resolutionCause: safeCell(row,'Resolution Quality Cause'),

    docs: parseImportedValue(safeCell(row,'Documentation & Notes (10)')),
    docsCause: safeCell(row,'Documentation & Notes Cause'),

    chatbot: 'NA',
    chatbotCause: '',

    numerator: botNumerator,
    denominator: botDenominator,
    totalPercent: botTotalPercent,

    tag_usage: parseImportedValue(safeCell(row,'Tag Usage (10)') || safeCell(row,'Tag Usage')),
    tag_usageCause: safeCell(row,'Tag Usage Cause') || '',

    af: {
      autofail: botAFVal === true || String(safeCell(row,'Auto-Fail')).trim().toUpperCase() === 'TRUE',
      autofail_ov: botAFOvVal,
      bug_esc: parseImportedValue(safeCell(row,'Bug Escalation')),
      post_bug: parseImportedValue(safeCell(row,'Post Bug Escalation'))
    },
    afCauses: {
      autofail: safeCell(row,'Auto-Fail Cause'),
      bug_esc: safeCell(row,'Bug Escalation Cause'),
      post_bug: safeCell(row,'Post Bug Escalation Cause')
    }
  };

  const ticketDate = ticketDateFromCreatedTime(created);
  const ticket = {
    id: tid,
    subject: inbox || `Imported ticket ${importedIndex}`,
    agent,
    priority: 'mid',
    inbox,
    date: ticketDate || '',
    week: weekMondayFromDate(ticketDate),
    createdTime: created,
    frontUrl: safeCell(row, 'Front URL'),
    conv: [],
    bot: botPayload
  };

  const g = blankG();
  g.submitted = submitted;
  g.grader = graderName;
  g.numerator = andiNumerator ?? botNumerator;
  g.denominator = andiDenominator ?? botDenominator;
  g.totalPercent = andiTotalPercent ?? botTotalPercent;

  g.scores.grammar = botPayload.grammar;
  g.causes.grammar = botPayload.grammarCause || '— select —';

  g.scores.tone = botPayload.tone;
  g.causes.tone = botPayload.toneCause || '— select —';

  g.scores.timeliness = botPayload.timeliness;
  g.causes.timeliness = botPayload.timelinessCause || '— select —';

  g.scores.efficiency = resolveImportedScore(
    botPayload.efficiency,
    safeCell(row,'Ticket Efficiency (Manual Override) (15)')
  );
  g.causes.efficiency = resolveImportedCause(
    botPayload.efficiencyCause || '— select —',
    safeCell(row,'Ticket Efficiency (Manual Override) Cause')
  ) || '— select —';

  g.scores.probing = resolveImportedScore(
    botPayload.probing,
    safeCell(row,'Probing & Clarification (Manual Override) (10)')
  );
  g.causes.probing = resolveImportedCause(
    botPayload.probingCause || '— select —',
    safeCell(row,'Probing & Clarification (Manual Override) Cause')
  ) || '— select —';

  g.scores.problem = resolveImportedScore(
    botPayload.problem,
    safeCell(row,'Problem Statement Comprehension (Manual Override) (20)')
  );
  g.causes.problem = resolveImportedCause(
    botPayload.problemCause || '— select —',
    safeCell(row,'Problem Statement Comprehension Cause (Manual Override)')
  ) || '— select —';

  g.scores.education = resolveImportedScore(
    botPayload.education,
    safeCell(row,'Customer Education (Manual Override) (15)')
  );
  g.causes.education = resolveImportedCause(
    botPayload.educationCause || '— select —',
    safeCell(row,'Customer Education Cause (Manual Override)')
  ) || '— select —';

  g.scores.resolution = resolveImportedScore(
    botPayload.resolution,
    safeCell(row,'Resolution Quality (Manual Override) (20)')
  );
  g.causes.resolution = resolveImportedCause(
    botPayload.resolutionCause || '— select —',
    safeCell(row,'Resolution Quality Cause (Manual Override)')
  ) || '— select —';

  g.scores.docs = resolveImportedScore(
    botPayload.docs,
    safeCell(row,'Documentation & Notes (Manual Override) (10)'),
    safeCell(row,'"Documentation & Notes \n(Manual Override) (10)"')
  );
  g.causes.docs = resolveImportedCause(
    botPayload.docsCause || '— select —',
    safeCell(row,'Documentation & Notes (Manual Override) Cause'),
    safeCell(row,'"Documentation & Notes \n(Manual Override) Cause"')
  ) || '— select —';

  g.scores.chatbot = resolveImportedScore(
    botPayload.chatbot,
    safeCell(row,'Chatbot Education (Manual Override) (16)')
  );
  g.causes.chatbot = resolveImportedCause(
    botPayload.chatbotCause || '— select —',
    safeCell(row,'Chatbot Education Cause (Manual Override)'),
    safeCell(row,'"Chatbot Education Cause \n(Manual Override)"')
  ) || '— select —';

  g.scores.tag_usage = parseImportedValue(safeCell(row,'Tag Usage (10)') || safeCell(row,'Tag Usage'));
  if (g.scores.tag_usage === 'NA') g.scores.tag_usage = botPayload.tag_usage;
  g.causes.tag_usage = safeCell(row,'Tag Usage Cause') || botPayload.tag_usageCause || '— select —';

  g.af.autofail = botAFVal === true || String(safeCell(row,'Auto-Fail')).trim().toUpperCase() === 'TRUE';
  g.af.autofail_ov = botAFOvVal;
  g.af.bug_esc = parseImportedValue(safeCell(row,'Bug Escalation'));
  g.af.post_bug = parseImportedValue(safeCell(row,'Post Bug Escalation'));

  g.afCauses.autofail = safeCell(row,'Auto-Fail Cause') || '— select —';
  g.afCauses.bug_esc = safeCell(row,'Bug Escalation Cause') || '— select —';
  g.afCauses.post_bug = safeCell(row,'Post Bug Escalation Cause') || '— select —';

  g.qaFeedback = safeCell(row,'QA Feedback');
  g.agentFocus = safeCell(row,"Agent's focus");
  g.botSimilar = parseYesNo(safeCell(row,"Bot's qualitative feedback is similar to Andi"));
  g.botSuggestion = safeCell(row,"Suggestion on the bot's prompt");
  g.category = safeCell(row,'Category');
  g.brianNotes = safeCell(row,"Brian's notes");
  g.fixed = parseYesNo(safeCell(row,'Fixed'));

  return { ticket, grade: g };
}

function buildServerTicket(t, gradePayload = null){
  const ticket = {
    week: t.week || null,
    ticket_date: t.date || null,
    agent: t.agent || null,
    created_time: t.createdTime || null,
    inbox: t.inbox || null,
    front_url: t.frontUrl || null,
    subject: t.subject || null,
    bot_payload: t.bot || {},
    assigned_grader: t.grader && t.grader.toLowerCase() !== 'bot' ? t.grader : null
  };

  if (gradePayload) ticket.grade_payload = gradePayload;
  return ticket;
}

async function saveTicketBatch(fileName, tickets) {
  const resp = await fetch(`${API_BASE}/api/tickets/import`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({
      source_file_name: fileName,
      tickets
    })
  });

  if (!resp.ok) {
    const errBody = await resp.json().catch(() => ({}));
    console.error('Import server error:', errBody);
    throw new Error(errBody.error || 'Ticket import failed');
  }

  const data = await resp.json().catch(() => ({}));
  return data;
}

async function resolveImportedTicketIds(tickets) {
  const resp = await fetch(`${API_BASE}/api/tickets`, {
    credentials: 'include'
  });

  if (!resp.ok) {
    throw new Error('Could not resolve imported ticket IDs');
  }

  const rows = await resp.json();
  const byFrontUrl = new Map();
  const byComposite = new Map();

  rows.forEach(row => {
    if (row.front_url) byFrontUrl.set(String(row.front_url).trim(), row.id);
    const composite = [
      row.created_time || '',
      row.agent || '',
      row.inbox || '',
      row.subject || '',
      row.ticket_date || ''
    ].join('||');
    byComposite.set(composite, row.id);
  });

  return tickets.map(t => {
    const frontUrl = t.front_url ? String(t.front_url).trim() : '';
    if (frontUrl && byFrontUrl.has(frontUrl)) return byFrontUrl.get(frontUrl);

    const composite = [
      t.created_time || '',
      t.agent || '',
      t.inbox || '',
      t.subject || '',
      t.ticket_date || ''
    ].join('||');

    return byComposite.get(composite) || null;
  });
}

async function saveGradeBatch(gradesBatch) {
  if (bulkGradeImportSupported === false) {
    for (const row of gradesBatch) {
      const gradeResp = await fetch(`${API_BASE}/api/tickets/${row.ticket_id}/grade`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(row.grade_payload)
      });

      if (!gradeResp.ok) {
        const errBody = await gradeResp.json().catch(() => ({}));
        console.error('Fallback grade import server error:', errBody);
        throw new Error(errBody.error || 'Grade import failed');
      }
    }

    return { ok: true, count: gradesBatch.length, fallback: true };
  }

  const resp = await fetch(`${API_BASE}/api/grades/import`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({
      grades: gradesBatch
    })
  });

  if (resp.status === 404) {
    bulkGradeImportSupported = false;
    for (const row of gradesBatch) {
      const gradeResp = await fetch(`${API_BASE}/api/tickets/${row.ticket_id}/grade`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(row.grade_payload)
      });

      if (!gradeResp.ok) {
        const errBody = await gradeResp.json().catch(() => ({}));
        console.error('Fallback grade import server error:', errBody);
        throw new Error(errBody.error || 'Grade import failed');
      }
    }

    return { ok: true, count: gradesBatch.length, fallback: true };
  }

  if (!resp.ok) {
    const errBody = await resp.json().catch(() => ({}));
    console.error('Grade import server error:', errBody);
    throw new Error(errBody.error || 'Grade import failed');
  }

  bulkGradeImportSupported = true;
  return resp.json();
}

const HEADERLESS_BOT_CSV_HEADER = [
  'Ticket Date','Week','Agent','Created Time','Inbox','Front URL',
  "Bot Denominator","Bot Numerator","Bot's score",
  "Andi's Denominator","Andi's Numerator","Andi's score",
  'Diff','Grader',
  'Grammar & Language (5)','Grammar & Language Cause',
  'Tone & Personalization (5)','Tone & Personalization Cause',
  'Timeliness & Responsiveness (10)','Timeliness & Responsiveness Cause',
  'Ticket Efficiency (15)','Ticket Efficiency Cause','_ov1','_ov2',
  'Probing & Clarification (10)','Probing & Clarification Cause','_ov3','_ov4',
  'Problem Statement Comprehension (20)','Problem Statement Comprehension Cause','_ov5','_ov6',
  'Customer Education (15)','Customer Education Cause','_ov7','_ov8',
  'Resolution Quality (20)','Resolution Quality Cause','_ov9','_ov10',
  'Documentation & Notes (10)','Documentation & Notes Cause','_ov11','_ov12',
  'Chatbot Education','Chatbot Education Cause',
  'Auto-Fail','Auto-Fail Cause','Bug Escalation','Bug Escalation Cause'
].join(';');

function parseImportedCsv(text, options = {}){
  const { submitted = false } = options;
  const records = parseDelimitedRecords(String(text).replace(/^\uFEFF/, ''));
  if(!records.length) throw new Error('Import error');

  const sep = ';';

  const firstField = (parseDelimitedLine(records[0], sep)[0] || '').trim();
  if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(firstField)) {
    records.unshift(HEADERLESS_BOT_CSV_HEADER);
  }

  const headers = parseDelimitedLine(records[0], sep).map(h => h.replace(/^"|"$/g, '').trim());
  const parsedTickets = [];
  const localGrades = {};
  let skippedRows = 0;

  for(let i = 1; i < records.length; i++){
    const raw = records[i];
    if(!raw.trim()) continue;

    const cols = parseDelimitedLine(raw, sep).map(c => c.replace(/^"|"$/g, '').trim());
    const row = {};
    headers.forEach((h, idx) => {
      row[h] = cols[idx] ?? '';
    });

    if(shouldSkipImportedRow(row)){
      skippedRows++;
      continue;
    }

    const { ticket, grade } = mapImportedRow(row, parsedTickets.length + 1, { submitted });
    parsedTickets.push(ticket);
    localGrades[ticket.id] = grade;
  }

  return {
    imported: parsedTickets.length,
    parsedTickets,
    localGrades,
    skippedRows
  };
}

async function importCsvFile(file, options = {}){
  const {
    submitted = false,
    chunkSize = 100,
    successLabel = submitted ? 'Imported and submitted' : 'Imported and saved'
  } = options;

  const text = await file.text();
  const { imported, parsedTickets, localGrades, skippedRows } = parseImportedCsv(text, { submitted });

  const serverTickets = parsedTickets.map(t => buildServerTicket(t));

  const total = serverTickets.length;
  const batchSize = Math.max(1, chunkSize);
  let uploaded = 0;

  const progressMsg = count => {
    const pctDone = total ? Math.round((count / total) * 100) : 100;
    return `${submitted ? 'Uploading grader tickets' : 'Uploading tickets'} ${count}/${total} (${pctDone}%)…`;
  };

  const inflightMsg = (start, end) => {
    const pctDone = total ? Math.round((uploaded / total) * 100) : 0;
    return `${submitted ? 'Uploading grader tickets' : 'Uploading tickets'} ${start}-${end} of ${total} (${pctDone}%)…`;
  };

  toast(progressMsg(0), null, { sticky: true });

  for(let i = 0; i < total; i += batchSize){
    const chunk = serverTickets.slice(i, i + batchSize);
    const chunkTickets = parsedTickets.slice(i, i + batchSize);
    const start = i + 1;
    const end = Math.min(i + chunk.length, total);
    toast(inflightMsg(start, end), null, { sticky: true });

    const ticketData = await saveTicketBatch(file.name, chunk);
    const ticketIds = Array.isArray(ticketData.ids) && ticketData.ids.length === chunk.length
      ? ticketData.ids
      : await resolveImportedTicketIds(chunk);

    if (submitted) {
      toast(`Saving grades ${start}-${end} of ${total}…`, null, { sticky: true });
      const gradesBatch = chunkTickets.map((t, idx) => ({
        ticket_id: ticketIds[idx],
        grade_payload: buildGradePayload(t.id, localGrades, localGrades[t.id]?.grader || 'Bot', {
          preserveStoredTotals: true
        })
      }));
      if (gradesBatch.some(g => !g.ticket_id)) {
        throw new Error('Imported tickets were saved, but some ticket IDs could not be resolved. Please restart the server and try again.');
      }
      await saveGradeBatch(gradesBatch);
    }

    uploaded += chunk.length;
    toast(progressMsg(uploaded), null, { sticky: true });
  }

  TICKETS = parsedTickets;
  grades = localGrades;
  sel = null;
  document.getElementById('panel').innerHTML = '<div class="empty"><div class="empty-ic">☑</div><p>Select a ticket to grade</p></div>';

  await loadTicketsFromServer();
  if (submitted) switchTab('s');
  const skippedSuffix = skippedRows ? `, skipped ${skippedRows} row${skippedRows !== 1 ? 's' : ''} with invalid Created Time` : '';
  toast(`${successLabel} ${imported} ticket${imported !== 1 ? 's' : ''}${skippedSuffix} ✓`);
}

function finalCause(g, id){
  if(g.causes[id] === 'Other') return g.customCauses[id] || 'NA';
  if(!g.causes[id] || g.causes[id].startsWith('—')) return 'NA';
  return g.causes[id];
}

function finalAFCause(g, id){
  if(g.afCauses[id] === 'Other') return g.afCustomCauses[id] || 'NA';
  if(!g.afCauses[id] || g.afCauses[id].startsWith('—')) return 'NA';
  return g.afCauses[id];
}

function applyRoleUI() {
  const role = user?.role;
  const isAgent    = role === 'agent';
  const canAdmin   = ['admin', 'cs_leader'].includes(role);
  const canPurge   = role === 'admin';
  const canImport  = ['qa_grader', 'cs_leader', 'admin'].includes(role);

  // Grading + Submissions — hidden for agents
  document.querySelector('.tab[data-tab="g"]')?.style.setProperty('display', isAgent ? 'none' : '');
  document.querySelector('.tab[data-tab="s"]')?.style.setProperty('display', isAgent ? 'none' : '');

  // Agent tabs
  document.querySelector('.tab[data-tab="n"]')?.style.setProperty('display', isAgent ? '' : 'none');
  document.querySelector('.tab[data-tab="m"]')?.style.setProperty('display', isAgent ? '' : 'none');

  // Admin tab
  document.querySelector('.tab[data-tab="u"]')?.style.setProperty('display', canAdmin ? '' : 'none');
  const adminView = document.getElementById('vu');
  if (adminView) adminView.style.display = canAdmin ? '' : 'none';

  // Logs tab — cs_leader + admin
  document.querySelector('.tab[data-tab="l"]')?.style.setProperty('display', canAdmin ? '' : 'none');

  const purgeBtn = document.getElementById('purge-btn');
  if (purgeBtn) purgeBtn.style.display = canPurge ? '' : 'none';

  const importLabel = document.getElementById('import-csv-label');
  if (importLabel) importLabel.style.display = canImport ? '' : 'none';

  const graderImportLabel = document.getElementById('import-grader-label');
  if (graderImportLabel) graderImportLabel.style.display = canImport ? '' : 'none';

  const notifMenu = document.getElementById('notif-menu');
  if (notifMenu) notifMenu.style.display = user ? '' : 'none';

  // All roles land on Home
  document.querySelectorAll('.tab').forEach(b => b.classList.remove('on'));
  document.querySelectorAll('.view').forEach(v => v.classList.remove('on'));
  document.querySelector('.tab[data-tab="h"]')?.classList.add('on');
  document.getElementById('vh')?.classList.add('on');
  renderHome();
  tabDirty.h = false;

  if (isAgent) {
    renderNewTickets();
    renderMyFilters();
    renderMyTickets();
    tabDirty.n = false;
    tabDirty.m = false;
  }
}

function normalizeTicketFromServer(row) {
  return {
    id: String(row.id),
    dbId: row.id,
    subject: row.subject || row.inbox || 'Untitled ticket',
    agent: row.agent || '',
    priority: 'mid',
    inbox: row.inbox || '',
    date: row.ticket_date || '',
    week: row.week || '',
    createdTime: row.created_time || '',
    frontUrl: row.front_url || '',
    sourceFileName: row.source_file_name || '',
    conv: [],
    bot: row.bot_payload || {},
    submitted: !!row.submitted
  };
}

function hydrateGradeFromServerRow(row) {
  const g = blankG();
  g.submitted = !!row.submitted || !!row.grade_id;
  g.grader = row.grader_name || 'Bot';
  g.graderUserId = row.grader_user_id ?? null;
  g.numerator = metricNumber(row.numerator);
  g.denominator = metricNumber(row.denominator);
  g.totalPercent = metricNumber(row.total_percent);
  g.qaFeedback = row.qa_feedback || '';
  g.agentFocus = row.agent_focus || '';
  g.botSimilar = row.bot_similar || 'No';
  g.botSuggestion = row.bot_suggestion || '';
  g.category = row.category || '';
  g.brianNotes = row.brian_notes || '';
  g.fixed = row.fixed || 'No';
  g.reflection = row.reflection_text || '';
  g.reflectionSubmittedAt = row.reflection_submitted_at || '';
  g.agentAcknowledgedAt = row.agent_acknowledged_at || '';
  g.reflectionReadAt = row.reflection_read_at || '';
  g.reviewDurationSeconds = row.review_duration_seconds ?? null;

  (row.breakdown || []).forEach(item => {
    g.scores[item.category_id] = item.score;
    g.causes[item.category_id] = item.cause || '— select —';
    g.customCauses[item.category_id] = item.custom_cause || '';
  });

  (row.flags || []).forEach(item => {
    let value = item.value;
    if (value === 'true' || value === true) value = true;
    if (value === 'false' || value === false) value = false;
    g.af[item.flag_id] = value;
    g.afCauses[item.flag_id] = item.cause || '— select —';
    g.afCustomCauses[item.flag_id] = item.custom_cause || '';
  });

  return g;
}

function renderNotifications() {
  const badge = document.getElementById('notif-badge');
  const itemsHost = document.getElementById('notif-items');
  if (badge) {
    badge.style.display = notifications.count ? '' : 'none';
    badge.textContent = String(notifications.count || 0);
  }
  if (!itemsHost) return;

  if (!notifications.items.length) {
    itemsHost.innerHTML = `<div class="notif-empty">No new notifications.</div>`;
    return;
  }

  itemsHost.innerHTML = notifications.items.map(item => {
    if (item.type === 'reflection_submitted') {
      return `<div class="notif-item">
        <div class="notif-item-top">
          <div class="notif-item-title">${escapeHtml(item.agent || 'Agent')} submitted a reflection</div>
          <div class="notif-item-meta">${fmtDate(item.ticket_date || item.event_at)}</div>
        </div>
        <div class="notif-item-meta">Ticket date: ${fmtDate(item.ticket_date)}${item.front_url ? ` · <a class="notif-link" href="${escapeHtml(item.front_url)}" target="_blank" rel="noopener noreferrer">Front link</a>` : ''}</div>
        <div class="notif-item-actions">
          <button class="notif-open" data-notif-open="${item.ticket_id}">Open ticket</button>
        </div>
      </div>`;
    }

    return `<div class="notif-item">
      <div class="notif-item-top">
        <div class="notif-item-title">${escapeHtml(item.subject || 'New graded ticket')}</div>
        <div class="notif-item-meta">${fmtDate(item.ticket_date || item.event_at)}</div>
      </div>
      <div class="notif-item-meta">Grader: ${escapeHtml(item.grader_name || 'Bot')}${item.front_url ? ` · <a class="notif-link" href="${escapeHtml(item.front_url)}" target="_blank" rel="noopener noreferrer">Front link</a>` : ''}</div>
      <div class="notif-item-actions">
        <button class="notif-open" data-notif-open="${item.ticket_id}">Open ticket</button>
      </div>
    </div>`;
  }).join('');

  itemsHost.querySelectorAll('[data-notif-open]').forEach(btn => {
    btn.addEventListener('click', () => {
      setNotifMenuOpen(false);
      openTicketDetail(btn.dataset.notifOpen, { fromNotification: true });
    });
  });
}

async function loadNotifications() {
  if (!user) {
    notifications = { count: 0, items: [] };
    renderNotifications();
    return;
  }

  try {
    const r = await fetch(`${API_BASE}/api/notifications`, {
      credentials: 'include'
    });
    if (!r.ok) throw new Error('Notification load failed');
    const data = await r.json().catch(() => ({}));
    notifications = {
      count: Number(data.count) || 0,
      items: Array.isArray(data.items) ? data.items : []
    };
  } catch (e) {
    console.error(e);
    notifications = { count: 0, items: [] };
  }

  renderNotifications();
}

async function loadTicketsFromServer() {
  ticketsLoading = true;
  renderList();

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);

  try {
    const r = await fetch(`${API_BASE}/api/tickets`, {
      credentials: 'include',
      signal: controller.signal
    });
    clearTimeout(timeout);

    if (!r.ok) {
      ticketsLoading = false;
      renderList();
      toast('Failed to load tickets', 'err');
      return;
    }

    const rows = await r.json();
    ticketsLoading = false;

    TICKETS = rows.map(normalizeTicketFromServer);
    grades = {};

    for (const row of rows) {
      if (row.grade_id || row.submitted) {
        grades[String(row.id)] = hydrateGradeFromServerRow(row);
      } else {
        grades[String(row.id)] = blankG();
      }
    }

    renderQueueFilters();
    renderList();
    markTabsDirty();
    // Re-render whichever tab the user is currently viewing (e.g. agents land on New Tickets)
    const activeTab = document.querySelector('.tab.on')?.dataset?.tab;
    if (activeTab && activeTab !== 'g') switchTab(activeTab);
    await loadNotifications();
  } catch (e) {
    clearTimeout(timeout);
    ticketsLoading = false;
    renderList();
    if (e.name === 'AbortError') {
      toast('Ticket load timed out — try refreshing', 'err');
    } else {
      toast('Failed to load tickets', 'err');
    }
  }
}

async function loadGradeForTicket(ticketId) {
  const r = await fetch(`${API_BASE}/api/tickets/${ticketId}/grade`, {
    credentials: 'include'
  });

  if (!r.ok) {
    grades[String(ticketId)] = blankG();
    return;
  }

  const data = await r.json();

  if (!data.grade) {
    grades[String(ticketId)] = blankG();
    return;
  }

  const g = blankG();

  g.submitted = !!data.grade.submitted || !!data.grade.id;
  g.grader = data.grade.grader_name || 'Bot';
  g.graderUserId = data.grade.grader_user_id ?? null;
  g.numerator = metricNumber(data.grade.numerator);
  g.denominator = metricNumber(data.grade.denominator);
  g.totalPercent = metricNumber(data.grade.total_percent);
  g.qaFeedback = data.grade.qa_feedback || '';
  g.agentFocus = data.grade.agent_focus || '';
  g.botSimilar = data.grade.bot_similar || 'No';
  g.botSuggestion = data.grade.bot_suggestion || '';
  g.category = data.grade.category || '';
  g.brianNotes = data.grade.brian_notes || '';
  g.fixed = data.grade.fixed || 'No';
  g.reflection = data.grade.reflection_text || '';
  g.reflectionSubmittedAt = data.grade.reflection_submitted_at || '';
  g.agentAcknowledgedAt = data.grade.agent_acknowledged_at || '';
  g.reflectionReadAt = data.grade.reflection_read_at || '';

  (data.breakdown || []).forEach(row => {
    g.scores[row.category_id] = row.score;
    g.causes[row.category_id] = row.cause || '— select —';
    g.customCauses[row.category_id] = row.custom_cause || '';
  });

  (data.flags || []).forEach(row => {
    let value = row.value;
    if (value === 'true' || value === true) value = true;
    if (value === 'false' || value === false) value = false;
    g.af[row.flag_id] = value;
    g.afCauses[row.flag_id] = row.cause || '— select —';
    g.afCustomCauses[row.flag_id] = row.custom_cause || '';
  });

  grades[String(ticketId)] = g;
}

function buildGradePayload(ticketId, sourceGrades = grades, fallbackGrader = user?.username || user?.email || 'Bot', options = {}) {
  const { preserveStoredTotals = false } = options;
  const g = sourceGrades[ticketId];
  const t = TICKETS.find(tk => String(tk.id) === String(ticketId));

  // Resolve each criterion's score/cause: use grader's value if changed, else fall back to bot's
  const resolvedScores = {};
  const resolvedCauses = {};
  C.forEach(c => {
    const graderScore = g.scores[c.id];
    const graderCause = g.causes[c.id];
    resolvedScores[c.id] = isNA(graderScore) ? (t?.bot?.[c.id] ?? graderScore) : graderScore;
    resolvedCauses[c.id] = (!graderCause || graderCause === '— select —') ? (t?.bot?.[c.id + 'Cause'] || graderCause) : graderCause;
  });

  const rawUnfiltered = C.reduce((s, c) => s + nv(resolvedScores[c.id]), 0);
  const isAutoFail = g.af.autofail && !g.af.autofail_ov;
  const computedDenominator = Math.min(C.reduce((s, c) => (c.id === 'tag_usage' || isNA(resolvedScores[c.id])) ? s : s + c.max, 0), 110);
  const computedNumerator = (!isAutoFail && computedDenominator > 0 && pct(rawUnfiltered, computedDenominator) < 50 && rawUnfiltered > 0) ? 0 : (isAutoFail ? 0 : rawUnfiltered);
  const storedNumerator = metricNumber(g.numerator);
  const storedDenominator = metricNumber(g.denominator);
  const storedTotalPercent = metricNumber(g.totalPercent);
  const denominator = preserveStoredTotals && storedDenominator !== null ? storedDenominator : computedDenominator;
  const numerator = preserveStoredTotals && storedNumerator !== null ? storedNumerator : computedNumerator;
  const totalPercent = preserveStoredTotals && storedTotalPercent !== null
    ? storedTotalPercent
    : pct(numerator, denominator);

  g.numerator = numerator;
  g.denominator = denominator;
  g.totalPercent = totalPercent;

  return {
    grader_name: g.grader || fallbackGrader,
    grader_type: g.grader || fallbackGrader,
    numerator,
    denominator,
    total_percent: totalPercent,
    qa_feedback: g.qaFeedback || '',
    agent_focus: g.agentFocus || '',
    bot_similar: g.botSimilar || 'No',
    bot_suggestion: g.botSuggestion || '',
    category: g.category || '',
    brian_notes: g.brianNotes || '',
    fixed: g.fixed || 'No',
    submitted: true,
    breakdown: C.map(c => ({
      category_id: c.id,
      score: resolvedScores[c.id],
      cause: resolvedCauses[c.id],
      custom_cause: g.customCauses[c.id] || ''
    })),
    flags: AFS.map(a => ({
      flag_id: a.id,
      value: g.af[a.id],
      cause: g.afCauses[a.id],
      custom_cause: g.afCustomCauses[a.id] || ''
    }))
  };
}

async function saveTicketGrade(ticketId) {
  const payload = buildGradePayload(ticketId);

  const r = await fetch(`${API_BASE}/api/tickets/${ticketId}/grade`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(payload)
  });

  if (!r.ok) {
    const data = await r.json().catch(() => ({}));
    throw new Error(data.error || 'Failed to save grade');
  }
}

async function deleteTicket(ticketId) {
  const r = await fetch(`${API_BASE}/api/tickets/${ticketId}`, {
    method: 'DELETE',
    credentials: 'include'
  });

  if (!r.ok) {
    const data = await r.json().catch(() => ({}));
    throw new Error(data.error || 'Delete failed');
  }
}

const ACTION_LABELS = {
  login: 'Login',
  logout: 'Logout',
  grade_submitted: 'Grade submitted',
  grade_saved: 'Grade saved',
  reflection_submitted: 'Reflection submitted',
  tickets_imported: 'Tickets imported',
  ticket_deleted: 'Ticket deleted',
  tickets_purged: 'Tickets purged',
  user_created: 'User created',
  user_deleted: 'User deleted',
  user_credentials_edited: 'Credentials edited',
  user_password_changed: 'Password changed',
  user_status_changed: 'Status changed',
};

let logsPage = 1;
const LOGS_PAGE_SIZE = 50;

function formatLogDetails(details) {
  if (!details || typeof details !== 'object') return '—';
  return Object.entries(details)
    .filter(([, v]) => v !== null && v !== undefined && v !== '')
    .map(([k, v]) => `<span style="color:var(--mu)">${k}:</span> ${escapeHtml(String(v))}`)
    .join(' &nbsp;·&nbsp; ') || '—';
}

// ── Homepage ──────────────────────────────────────────────────────────────
const CAT_LABELS = Object.fromEntries([...C, ...AFS].map(c => [c.id, c.label]));

function scoreTrend(cur, prev) {
  if (cur == null || prev == null) return '';
  const diff = Math.round(cur - prev);
  if (diff > 0) return `<span class="home-trend up">▲ ${diff}%</span>`;
  if (diff < 0) return `<span class="home-trend dn">▼ ${Math.abs(diff)}%</span>`;
  return `<span class="home-trend eq">→ same</span>`;
}

function homeCard(title, body, opts = {}) {
  return `<div class="home-card${opts.wide ? ' home-card-wide' : ''}${opts.accent ? ' home-card-accent' : ''}">
    <div class="home-card-title">${title}</div>
    <div class="home-card-body">${body}</div>
  </div>`;
}

async function renderHome() {
  const wrap = document.getElementById('home-wrap');
  if (!wrap) return;
  wrap.innerHTML = '<div class="home-loading">Loading…</div>';

  let d;
  try {
    const r = await fetch(`${API_BASE}/api/home`, { credentials: 'include' });
    if (!r.ok) throw new Error(await r.text());
    d = await r.json();
  } catch (e) {
    wrap.innerHTML = `<div class="home-loading">Failed to load dashboard</div>`;
    return;
  }

  const role = d.role;
  let cards = '';

  if (role === 'agent') {
    const scoreColor = d.week_score != null ? scol(d.week_score) : 'var(--mu)';
    cards += homeCard('New Tickets',
      `<div class="home-big" style="color:${d.new_tickets_count > 0 ? 'var(--ac)' : 'var(--mu)'}">${d.new_tickets_count}</div>
       <div class="home-sub">unread graded tickets</div>
       ${d.new_tickets_count > 0 ? `<button class="btn-p home-action-btn" id="home-go-new">View tickets</button>` : ''}`,
      { accent: d.new_tickets_count > 0 });

    cards += homeCard('My Score This Week',
      `<div class="home-big" style="color:${scoreColor}">${d.week_score != null ? d.week_score + '%' : '—'}</div>
       <div class="home-sub">${d.week_ticket_count} ticket${d.week_ticket_count !== 1 ? 's' : ''} graded ${scoreTrend(d.week_score, d.last_week_score)}</div>`);

    if (d.worst_category) {
      const catLabel = CAT_LABELS[d.worst_category.category_id] || d.worst_category.category_id;
      cards += homeCard('Needs Attention',
        `<div class="home-cat-label">${escapeHtml(catLabel)}</div>
         <div class="home-big" style="color:var(--rd)">${d.worst_category.avg_score != null ? d.worst_category.avg_score + '%' : '—'}</div>
         <div class="home-sub">lowest avg score this week</div>`);
    }

    cards += homeCard('Team Rank',
      `<div class="home-big">#${d.rank || '—'}</div>
       <div class="home-sub">out of ${d.rank_total} agents this week</div>`);
  }

  if (role === 'qa_grader') {
    cards += homeCard('To Grade',
      `<div class="home-big" style="color:${d.pending_grading > 0 ? 'var(--am)' : 'var(--gr)'}">${d.pending_grading}</div>
       <div class="home-sub">tickets assigned to you pending grading</div>
       ${d.pending_grading > 0 ? `<button class="btn-p home-action-btn" id="home-go-grading">Go to queue</button>` : ''}`);

    cards += homeCard('Team Score This Week',
      `<div class="home-big">${d.week_team_score != null ? d.week_team_score + '%' : '—'}</div>
       <div class="home-sub">${d.week_ticket_count} tickets ${scoreTrend(d.week_team_score, d.last_week_team_score)}</div>`);

    if (d.worst_category) {
      cards += homeCard('Worst Category',
        `<div class="home-cat-label">${escapeHtml(CAT_LABELS[d.worst_category.category_id] || d.worst_category.category_id)}</div>
         <div class="home-big" style="color:var(--rd)">${d.worst_category.avg_score != null ? d.worst_category.avg_score + '%' : '—'}</div>
         <div class="home-sub">vs last week ${scoreTrend(d.worst_category.avg_score, d.worst_category_last_week)}</div>`);
    }

    if (d.best_category) {
      cards += homeCard('Best Category',
        `<div class="home-cat-label">${escapeHtml(CAT_LABELS[d.best_category.category_id] || d.best_category.category_id)}</div>
         <div class="home-big" style="color:var(--gr)">${d.best_category.avg_score != null ? d.best_category.avg_score + '%' : '—'}</div>
         <div class="home-sub">vs last week ${scoreTrend(d.best_category.avg_score, d.best_category_last_week)}</div>`);
    }

    if (d.top_inbox) {
      cards += homeCard('Busiest Inbox',
        `<div class="home-cat-label">${escapeHtml(d.top_inbox.inbox || '—')}</div>
         <div class="home-big">${d.top_inbox.cnt}</div>
         <div class="home-sub">tickets this week · last week: ${d.top_inbox_last_week_count}</div>`);
    }
  }

  if (['cs_leader', 'admin'].includes(role)) {
    cards += homeCard('Team Score This Week',
      `<div class="home-big">${d.week_team_score != null ? d.week_team_score + '%' : '—'}</div>
       <div class="home-sub">${d.week_ticket_count} tickets ${scoreTrend(d.week_team_score, d.last_week_team_score)}</div>`);

    if (d.worst_category) {
      cards += homeCard('Worst Category',
        `<div class="home-cat-label">${escapeHtml(CAT_LABELS[d.worst_category.category_id] || d.worst_category.category_id)}</div>
         <div class="home-big" style="color:var(--rd)">${d.worst_category.avg_score != null ? d.worst_category.avg_score + '%' : '—'}</div>
         <div class="home-sub">vs last week ${scoreTrend(d.worst_category.avg_score, d.worst_category_last_week)}</div>`);
    }

    if (d.best_category) {
      cards += homeCard('Best Category',
        `<div class="home-cat-label">${escapeHtml(CAT_LABELS[d.best_category.category_id] || d.best_category.category_id)}</div>
         <div class="home-big" style="color:var(--gr)">${d.best_category.avg_score != null ? d.best_category.avg_score + '%' : '—'}</div>
         <div class="home-sub">vs last week ${scoreTrend(d.best_category.avg_score, d.best_category_last_week)}</div>`);
    }

    if (d.top_inbox) {
      cards += homeCard('Busiest Inbox',
        `<div class="home-cat-label">${escapeHtml(d.top_inbox.inbox || '—')}</div>
         <div class="home-big">${d.top_inbox.cnt}</div>
         <div class="home-sub">tickets this week · last week: ${d.top_inbox_last_week_count}</div>`);
    }

    cards += homeCard('Users',
      `<div class="home-big">${d.user_count}</div>
       <div class="home-sub">${d.active_sessions} active session${d.active_sessions !== 1 ? 's' : ''}</div>`);

    // Recent logs card
    const logRows = (d.recent_logs || []).map(l =>
      `<div class="home-log-row">
        <span class="home-log-user">${escapeHtml(l.username || '—')}</span>
        <span class="home-log-action">${escapeHtml(l.action)}</span>
        <span class="home-log-time">${new Date(l.created_at).toLocaleString()}</span>
      </div>`
    ).join('');
    cards += homeCard('Recent Activity', logRows || '<span style="color:var(--mu)">No activity yet</span>', { wide: true });

    // Unassigned low-score tickets
    if (role === 'cs_leader' && (d.unassigned_low_score || []).length > 0) {
      const graderOpts = (d.available_graders || []).map(g =>
        `<option value="${escapeHtml(g.username)}">${escapeHtml(g.username)}</option>`
      ).join('');

      const rows = d.unassigned_low_score.map(t =>
        `<tr>
          <td><input type="checkbox" class="home-assign-chk" data-tid="${t.id}"></td>
          <td>${escapeHtml(t.subject || '—')}</td>
          <td>${escapeHtml(t.agent || '—')}</td>
          <td>${escapeHtml(t.inbox || '—')}</td>
          <td>${fmtDate(t.ticket_date)}</td>
          <td style="color:var(--rd)">${t.total_percent != null ? t.total_percent + '%' : '—'}</td>
        </tr>`
      ).join('');

      cards += `<div class="home-card home-card-wide">
        <div class="home-card-title">Needs Review — Score &lt; 60% (Unassigned)</div>
        <div class="home-card-body">
          <div class="home-assign-bar">
            <label><input type="checkbox" id="home-assign-all"> Select all</label>
            <select id="home-assign-grader"><option value="">— assign to grader —</option>${graderOpts}</select>
            <button class="btn-p" id="home-assign-btn">Assign</button>
          </div>
          <div class="home-table-wrap">
            <table class="home-assign-table">
              <thead><tr><th></th><th>Subject</th><th>Agent</th><th>Inbox</th><th>Date</th><th>Score</th></tr></thead>
              <tbody>${rows}</tbody>
            </table>
          </div>
        </div>
      </div>`;
    }
  }

  wrap.innerHTML = `<div class="home-grid">${cards}</div>`;

  // Wire up buttons
  document.getElementById('home-go-new')?.addEventListener('click', () => switchTab('n'));
  document.getElementById('home-go-grading')?.addEventListener('click', () => switchTab('g'));

  // Select all checkbox
  document.getElementById('home-assign-all')?.addEventListener('change', function() {
    wrap.querySelectorAll('.home-assign-chk').forEach(c => { c.checked = this.checked; });
  });

  // Assign button
  document.getElementById('home-assign-btn')?.addEventListener('click', async () => {
    const grader = document.getElementById('home-assign-grader')?.value;
    if (!grader) { toast('Select a grader first', 'err'); return; }
    const ids = [...wrap.querySelectorAll('.home-assign-chk:checked')].map(c => Number(c.dataset.tid));
    if (!ids.length) { toast('Select at least one ticket', 'err'); return; }
    try {
      const r = await fetch(`${API_BASE}/api/tickets/assign`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ ticket_ids: ids, grader_username: grader })
      });
      if (!r.ok) throw new Error((await r.json()).error);
      toast(`Assigned ${ids.length} ticket${ids.length !== 1 ? 's' : ''} to ${grader} ✓`);
      await renderHome();
    } catch (e) {
      toast(e.message || 'Assign failed', 'err');
    }
  });
}

async function renderLogs() {
  const tbody = document.getElementById('logs-tbody');
  const countEl = document.getElementById('logs-count');
  const pagerHost = document.getElementById('logs-pager');
  if (!tbody) return;

  const username = document.getElementById('log-filter-username')?.value.trim() || '';
  const action = document.getElementById('log-filter-action')?.value || 'all';
  const dateFrom = document.getElementById('log-filter-from')?.value || '';
  const dateTo = document.getElementById('log-filter-to')?.value || '';

  const offset = (logsPage - 1) * LOGS_PAGE_SIZE;
  const params = new URLSearchParams({ limit: LOGS_PAGE_SIZE, offset });
  if (username) params.set('username', username);
  if (action && action !== 'all') params.set('action', action);
  if (dateFrom) params.set('dateFrom', dateFrom);
  if (dateTo) params.set('dateTo', dateTo);

  tbody.innerHTML = `<tr><td colspan="6" style="padding:24px;text-align:center;color:var(--mu)">Loading…</td></tr>`;

  const r = await fetch(`${API_BASE}/api/logs?${params}`, { credentials: 'include' });
  if (!r.ok) {
    tbody.innerHTML = `<tr><td colspan="6" style="padding:24px;text-align:center;color:var(--rd)">Failed to load logs</td></tr>`;
    return;
  }

  const { rows, total } = await r.json();

  if (countEl) countEl.textContent = `${total} event${total !== 1 ? 's' : ''}`;

  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="6" style="padding:40px;text-align:center;color:var(--mu)">No logs found</td></tr>`;
    if (pagerHost) pagerHost.innerHTML = '';
    return;
  }

  tbody.innerHTML = rows.map(row => {
    const dt = new Date(row.created_at);
    const time = dt.toLocaleDateString() + ' ' + dt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    const actionLabel = ACTION_LABELS[row.action] || row.action;
    return `<tr>
      <td style="white-space:nowrap;font-family:var(--mo);font-size:12px">${time}</td>
      <td><strong>${escapeHtml(row.username || '—')}</strong></td>
      <td><span style="font-size:11px;color:var(--mu)">${escapeHtml(row.role || '—')}</span></td>
      <td><span class="log-action log-action-${row.action}">${actionLabel}</span></td>
      <td style="font-size:12px;max-width:340px">${formatLogDetails(row.details)}</td>
      <td style="font-family:var(--mo);font-size:11px;color:var(--mu)">${escapeHtml(row.ip || '—')}</td>
    </tr>`;
  }).join('');

  // Pager
  if (pagerHost) {
    const totalPages = Math.ceil(total / LOGS_PAGE_SIZE);
    if (totalPages <= 1) { pagerHost.innerHTML = ''; return; }
    pagerHost.innerHTML = `<div class="pager">
      <button class="pager-btn" ${logsPage <= 1 ? 'disabled' : ''} id="logs-prev">← Prev</button>
      <span class="pager-info">Page ${logsPage} of ${totalPages}</span>
      <button class="pager-btn" ${logsPage >= totalPages ? 'disabled' : ''} id="logs-next">Next →</button>
    </div>`;
    document.getElementById('logs-prev')?.addEventListener('click', () => { logsPage--; renderLogs(); });
    document.getElementById('logs-next')?.addEventListener('click', () => { logsPage++; renderLogs(); });
  }
}

document.getElementById('log-filter-apply')?.addEventListener('click', () => { logsPage = 1; renderLogs(); });
document.getElementById('log-filter-reset')?.addEventListener('click', () => {
  document.getElementById('log-filter-username').value = '';
  document.getElementById('log-filter-action').value = 'all';
  document.getElementById('log-filter-from').value = '';
  document.getElementById('log-filter-to').value = '';
  logsPage = 1;
  renderLogs();
});

async function loadAdminUsers() {
  const r = await fetch(`${API_BASE}/api/admin/users`, {
    credentials: 'include'
  });

  if (!r.ok) return;

  const users = await r.json();
  const tbody = document.querySelector('#admin-users-table tbody');
  if (!tbody) return;

  tbody.innerHTML = users.map(u => `
    <tr>
      <td>${u.id}</td>
      <td>${u.email}</td>
      <td>${u.username}</td>
      <td>${u.role}</td>
      <td>${u.is_active ? 'Yes' : 'No'}</td>
      <td>${new Date(u.created_at).toLocaleString()}</td>
      <td style="display:flex;gap:4px;flex-wrap:wrap">
        <button class="bsm" onclick="toggleUserStatus(${u.id}, ${!u.is_active})">
          ${u.is_active ? 'Deactivate' : 'Activate'}
        </button>
        <button class="bsm" onclick="openEditUser(${u.id}, '${u.email.replace(/'/g,"\\'")}', '${u.username.replace(/'/g,"\\'")}', '${u.role}')">Edit</button>
        <button class="bsm" onclick="resetUserPassword(${u.id})">Reset pw</button>
        <button class="bsm" style="color:var(--rd,#e53)" onclick="deleteUser(${u.id})">Delete</button>
      </td>
    </tr>
  `).join('');
}

document.getElementById('lbtn').addEventListener('click', async () => {
  const username = document.getElementById('login-username').value.trim();
  const password = document.getElementById('login-password').value;
  showBootLoading('Signing in and loading tickets…');

  try {
    const r = await fetch(`${API_BASE}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ username, password })
    });

    const data = await r.json();

    if (!r.ok) {
      document.getElementById('lerr').textContent = data.error || 'Invalid username or password.';
      document.getElementById('lerr').style.display = 'block';
      hideBootLoading();
      return;
    }

    document.getElementById('lerr').style.display = 'none';

    if (data.token) localStorage.setItem(TOKEN_KEY, data.token);

    user = {
      id: data.user.id,
      name: data.user.username,
      email: data.user.email,
      role: data.user.role
    };

    applyRoleUI();

    document.getElementById('nav-name').textContent = user.name;
    document.getElementById('login').style.display = 'none';
    document.getElementById('app').classList.add('on');
    hideBootLoading();
    await loadTicketsFromServer();
  } catch (e) {
    console.error(e);
    document.getElementById('lerr').textContent = 'Login failed.';
    document.getElementById('lerr').style.display = 'block';
    hideBootLoading();
  }
});

document.getElementById('lobtn').addEventListener('click', async () => {
  try {
    await fetch(`${API_BASE}/api/auth/logout`, {
      method: 'POST',
      credentials: 'include'
    });
  } catch (e) {
    console.error(e);
  }

  localStorage.removeItem(TOKEN_KEY);
  user = null;
  applyRoleUI();

  sel = null;
  grades = {};
  filter = 'all';
  editing = false;
  TICKETS = [];

  document.getElementById('login').style.display = 'flex';
  document.getElementById('app').classList.remove('on');
  document.getElementById('nav-name').textContent = '';
  document.getElementById('panel').innerHTML = '<div class="empty"><div class="empty-ic">☑</div><p>Select a ticket to grade</p></div>';

  renderList();
});

function switchTab(t) {
  document.querySelectorAll('.tab').forEach(b => b.classList.remove('on'));
  document.querySelector(`.tab[data-tab="${t}"]`)?.classList.add('on');

  document.querySelectorAll('.view').forEach(v => v.classList.remove('on'));
  document.getElementById('v' + t)?.classList.add('on');

  if (t === 'h') { renderHome(); tabDirty.h = false; }
  if (t === 's') { if (tabDirty.s) { renderSubsFilters(); renderSubs(); tabDirty.s = false; } }
  if (t === 'n') { if (tabDirty.n) { renderNewTickets(); tabDirty.n = false; } }
  if (t === 'm') { if (tabDirty.m) { renderMyFilters(); renderMyTickets(); tabDirty.m = false; } }
  if (t === 'a') { if (tabDirty.a) { renderAnalytics(); tabDirty.a = false; } }
  if (t === 'l') { renderLogs(); tabDirty.l = false; }
  if (t === 'u') loadAdminUsers();
}

document.querySelectorAll('.tab').forEach(btn => btn.addEventListener('click', function(){
  switchTab(this.dataset.tab);
}));

document.querySelectorAll('.fb').forEach(b => b.addEventListener('click', function(){
  document.querySelectorAll('.fb').forEach(x => x.classList.remove('on'));
  this.classList.add('on');
  filter = this.dataset.f;
  resetPager('grading');
  renderList();
}));

document.getElementById('qfbar-tog')?.addEventListener('click', () => {
  qfOpen = !qfOpen;
  const body = document.getElementById('qfbar-body');
  if (body) body.style.display = qfOpen ? '' : 'none';
  renderQueueFilters();
  renderList();
});

document.getElementById('ticket-detail-close')?.addEventListener('click', closeTicketDetail);
document.getElementById('ticket-detail-close-btn')?.addEventListener('click', closeTicketDetail);
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') closeTicketDetail();
});

document.getElementById('sel-del-btn')?.addEventListener('click', async () => {
  if (!selectedIds.size) return;
  if (!confirm(`Delete ${selectedIds.size} selected ticket(s)?`)) return;

  const ids = [...selectedIds];
  let failed = 0;
  for (const id of ids) {
    try {
      await deleteTicket(id);
      delete grades[id];
      if (sel?.id === id) sel = null;
    } catch { failed++; }
  }
  selectedIds.clear();
  toast(failed ? `Deleted with ${failed} error(s)` : `Deleted ${ids.length} ticket(s)`);
  await loadTicketsFromServer();
  document.getElementById('panel').innerHTML = '<div class="empty"><div class="empty-ic">☑</div><p>Select a ticket to grade</p></div>';
});

document.addEventListener('click', async (e) => {
  if (e.target.id === 'admin-create-user') {
    const email = document.getElementById('admin-email').value.trim();
    const username = document.getElementById('admin-username').value.trim();
    const password = document.getElementById('admin-password').value;
    const role = document.getElementById('admin-role').value;

    const r = await fetch(`${API_BASE}/api/admin/users`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ email, username, password, role })
    });

    const data = await r.json();

    if (!r.ok) {
      toast(data.error || 'Failed to create user', 'err');
      return;
    }

    toast('User created');
    document.getElementById('admin-email').value = '';
    document.getElementById('admin-username').value = '';
    document.getElementById('admin-password').value = '';
    document.getElementById('admin-role').value = 'user';
    loadAdminUsers();
  }

  if (e.target.id === 'admin-gen-password') {
    const chars = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789!@#$%';
    const pwd = Array.from(crypto.getRandomValues(new Uint8Array(12)))
      .map(b => chars[b % chars.length]).join('');
    document.getElementById('admin-password').value = pwd;
    document.getElementById('admin-password').type = 'text';
  }

  if (e.target.id === 'admin-copy-creds') {
    const username = document.getElementById('admin-username').value.trim();
    const password = document.getElementById('admin-password').value;
    const role = document.getElementById('admin-role').value;
    const text = `Login page: https://testqa-5h8.pages.dev/\nUsername: ${username}\nPassword: ${password}\nRole: ${role}`;
    navigator.clipboard.writeText(text).then(() => toast('Credentials copied ✓')).catch(() => toast('Copy failed', 'err'));
  }
});

window.toggleUserStatus = async function (id, isActive) {
  const r = await fetch(`${API_BASE}/api/admin/users/${id}/status`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ is_active: isActive })
  });

  if (!r.ok) { toast('Failed to update user', 'err'); return; }
  toast('User updated');
  loadAdminUsers();
};

window.openEditUser = function(id, email, username, role) {
  const newEmail    = prompt('Email:', email);
  if (newEmail === null) return;
  const newUsername = prompt('Username:', username);
  if (newUsername === null) return;
  const roles = ['agent', 'qa_grader', 'cs_leader', 'admin'];
  const newRole = prompt(`Role (${roles.join(' / ')}):`, role);
  if (newRole === null || !roles.includes(newRole)) { toast('Invalid role', 'err'); return; }

  fetch(`${API_BASE}/api/admin/users/${id}/credentials`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ email: newEmail, username: newUsername, role: newRole })
  }).then(r => r.json()).then(data => {
    if (data.ok) { toast('User updated'); loadAdminUsers(); }
    else toast(data.error || 'Update failed', 'err');
  }).catch(() => toast('Update failed', 'err'));
};

window.resetUserPassword = async function(id) {
  const newPw = prompt('New password:');
  if (!newPw) return;

  const r = await fetch(`${API_BASE}/api/admin/users/${id}/password`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ password: newPw })
  });

  if (!r.ok) { toast('Failed to reset password', 'err'); return; }
  toast('Password updated');
};

window.deleteUser = async function(id) {
  if (!confirm('Permanently delete this user?')) return;

  const r = await fetch(`${API_BASE}/api/admin/users/${id}`, {
    method: 'DELETE',
    credentials: 'include'
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) { toast(data.error || 'Delete failed', 'err'); return; }
  toast('User deleted');
  loadAdminUsers();
};

window.deleteTicketFromTable = async function(ticketId) {
  if (!confirm('Delete this ticket from the system?')) return;

  try {
    await deleteTicket(ticketId);
    delete grades[ticketId];
    if (sel?.id === ticketId) sel = null;
    toast('Ticket deleted');
    await loadTicketsFromServer();
    document.getElementById('panel').innerHTML = '<div class="empty"><div class="empty-ic">☑</div><p>Select a ticket to grade</p></div>';
  } catch (e) {
    toast(e.message || 'Delete failed', 'err');
  }
};

window.deleteTicketFromQueue = async function(ticketId) {
  if (!confirm('Delete this ticket from the system?')) return;

  try {
    await deleteTicket(ticketId);
    delete grades[ticketId];
    if (sel?.id === ticketId) {
      sel = null;
      document.getElementById('panel').innerHTML = '<div class="empty"><div class="empty-ic">☑</div><p>Select a ticket to grade</p></div>';
    }
    toast('Ticket deleted');
    await loadTicketsFromServer();
  } catch (e) {
    toast(e.message || 'Delete failed', 'err');
  }
};

document.getElementById('purge-btn')?.addEventListener('click', async () => {
  if (!confirm('Purge ALL tickets from the database? This cannot be undone.')) return;

  try {
    const r = await fetch(`${API_BASE}/api/tickets`, {
      method: 'DELETE',
      credentials: 'include'
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.error || 'Purge failed');
    TICKETS = [];
    grades = {};
    sel = null;
    toast(`Purged ${data.count} ticket(s)`);
    await loadTicketsFromServer();
    document.getElementById('panel').innerHTML = '<div class="empty"><div class="empty-ic">☑</div><p>Select a ticket to grade</p></div>';
  } catch (e) {
    toast(e.message || 'Purge failed', 'err');
  }
});

// ── Helpers for filter unique values ──────────────────────────────────────
function uniq(arr) { return [...new Set(arr.filter(Boolean))].sort(); }
function ticketScore(t) {
  const g = grades[t.id];
  if (!g || !g.submitted) return null;
  return typeof g.totalPercent === 'number' ? g.totalPercent : null;
}

// ── Apply active filters to a ticket list ─────────────────────────────────
function applyFilters(tickets) {
  return tickets.filter(t => {
    const g = grades[t.id];
    if (F.category && !analyticsCategoryMatch(t.id, [F.category])) return false;
    if (F.inbox    && t.inbox   !== F.inbox)       return false;
    if (F.agent    && t.agent   !== F.agent)       return false;
    if (F.week     && t.week    !== F.week)        return false;
    if (F.convId && !convIdFromFrontUrl(t.frontUrl).toLowerCase().includes(String(F.convId).trim().toLowerCase())) return false;
    if (F.grader   && (g?.grader || '') !== F.grader) return false;
    if (F.dateFrom && t.date && t.date < F.dateFrom) return false;
    if (F.dateTo   && t.date && t.date > F.dateTo)   return false;
    if (F.autofail === 'yes' && !g?.af?.autofail)  return false;
    if (F.autofail === 'no'  &&  g?.af?.autofail)  return false;
    const sc = ticketScore(t);
    if (F.scoreFrom !== '' && sc !== null && sc < Number(F.scoreFrom)) return false;
    if (F.scoreTo   !== '' && sc !== null && sc > Number(F.scoreTo))   return false;
    return true;
  });
}

function applySubmissionFilters(tickets) {
  return tickets.filter(t => {
    const g = grades[t.id];
    if (!analyticsCategoryMatch(t.id, SF.categories)) return false;
    if (SF.inboxes.length && !SF.inboxes.includes(t.inbox || '')) return false;
    if (SF.agents.length && !SF.agents.includes(t.agent || '')) return false;
    if (SF.weeks.length && !SF.weeks.includes(t.week || '')) return false;
    if (SF.convId && !convIdFromFrontUrl(t.frontUrl).toLowerCase().includes(String(SF.convId).trim().toLowerCase())) return false;
    if (SF.grader && (g?.grader || '') !== SF.grader) return false;
    if (SF.dateFrom && t.date && t.date < SF.dateFrom) return false;
    if (SF.dateTo && t.date && t.date > SF.dateTo) return false;
    if (SF.autofail === 'yes' && !g?.af?.autofail) return false;
    if (SF.autofail === 'no' && g?.af?.autofail) return false;
    const sc = ticketScore(t);
    if (SF.scoreFrom !== '' && sc !== null && sc < Number(SF.scoreFrom)) return false;
    if (SF.scoreTo !== '' && sc !== null && sc > Number(SF.scoreTo)) return false;
    return true;
  });
}

function activeFilterCount() {
  return Object.values(F).filter(v => v !== '').length;
}

function resetPager(scope) {
  if (pagination[scope]) pagination[scope].page = 1;
}

function paginateItems(items, scope) {
  const state = pagination[scope] || (pagination[scope] = { page: 1, pageSize: 50 });
  const pageSize = Math.min(500, Math.max(1, Number(state.pageSize) || 50));
  const totalItems = items.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize) || 1);
  const page = Math.min(Math.max(1, Number(state.page) || 1), totalPages);
  const startIndex = totalItems ? (page - 1) * pageSize : 0;
  const endIndex = Math.min(startIndex + pageSize, totalItems);

  state.page = page;
  state.pageSize = pageSize;

  return {
    items: items.slice(startIndex, endIndex),
    page,
    pageSize,
    totalItems,
    totalPages,
    start: totalItems ? startIndex + 1 : 0,
    end: endIndex
  };
}

function renderPager(scope, containerId, meta) {
  const host = document.getElementById(containerId);
  if (!host) return;

  if (!meta.totalItems) {
    host.innerHTML = '';
    return;
  }

  const options = PAGE_SIZE_OPTIONS
    .map(size => `<option value="${size}" ${size === meta.pageSize ? 'selected' : ''}>${size}</option>`)
    .join('');

  host.className = 'pager';
  host.innerHTML = `
    <div class="pager-meta">Showing ${meta.start}-${meta.end} of ${meta.totalItems}</div>
    <div class="pager-ctrls">
      <label class="pager-meta">Rows
        <select data-page-size="${scope}">${options}</select>
      </label>
      <button class="pager-btn" data-page-nav="${scope}" data-dir="-1" ${meta.page <= 1 ? 'disabled' : ''}>Previous</button>
      <span class="pager-page">Page ${meta.page} / ${meta.totalPages}</span>
      <button class="pager-btn" data-page-nav="${scope}" data-dir="1" ${meta.page >= meta.totalPages ? 'disabled' : ''}>Next</button>
    </div>
  `;

  host.querySelector(`[data-page-size="${scope}"]`)?.addEventListener('change', e => {
    pagination[scope].pageSize = Number(e.target.value) || pagination[scope].pageSize;
    pagination[scope].page = 1;
    if (scope === 'grading') renderList();
    if (scope === 'submissions') renderSubs();
  });

  host.querySelectorAll(`[data-page-nav="${scope}"]`).forEach(btn => {
    btn.addEventListener('click', () => {
      pagination[scope].page += Number(btn.dataset.dir) || 0;
      if (scope === 'grading') renderList();
      if (scope === 'submissions') renderSubs();
    });
  });
}

function renderWeeklyRankingMatrix(tableId, rows, overallRows, emptyLabel){
  const table = document.getElementById(tableId);
  if(!table) return;

  if(!rows.length){
    table.innerHTML = `<thead><tr><th>Week</th><th>Team avg</th></tr></thead><tbody><tr><td colspan="2" style="color:var(--mu);padding:16px">${emptyLabel}</td></tr></tbody>`;
    return;
  }

  const orderedAgents = [];
  const seenAgents = new Set();

  [...overallRows, ...rows].forEach(r => {
    const agent = String(r.ag || '').trim();
    if(agent && !seenAgents.has(agent)){
      seenAgents.add(agent);
      orderedAgents.push(agent);
    }
  });

  const weekOrder = [];
  const byWeek = new Map();

  rows.forEach(r => {
    const week = r.week || '—';
    if(!byWeek.has(week)){
      byWeek.set(week, { rows: new Map(), totalWeighted: 0, totalTickets: 0 });
      weekOrder.push(week);
    }

    const bucket = byWeek.get(week);
    bucket.rows.set(r.ag, r);
    bucket.totalWeighted += (Number(r.aA) || 0) * (Number(r.n) || 0);
    bucket.totalTickets += Number(r.n) || 0;
  });

  table.innerHTML = `
    <thead>
      <tr>
        <th rowspan="2">Week</th>
        <th rowspan="2">Team avg</th>
        ${orderedAgents.map(agent => `<th>${escapeHtml(agent)}</th>`).join('')}
      </tr>
      <tr>
        ${orderedAgents.map(() => `<th>Score / Rank</th>`).join('')}
      </tr>
    </thead>
    <tbody>
      ${weekOrder.map(week => {
        const bucket = byWeek.get(week);
        const teamAvg = bucket.totalTickets ? Math.round(bucket.totalWeighted / bucket.totalTickets) : 0;
        const teamColor = scol(teamAvg);
        return `<tr>
          <td style="font-family:var(--mo);font-size:11px">${escapeHtml(week)}</td>
          <td><span class="schip" style="background:${teamAvg >= 80 ? 'var(--grs)' : 'var(--acs)'};color:${teamColor}">${teamAvg}%</span></td>
          ${orderedAgents.map(agent => {
            const row = bucket.rows.get(agent);
            if(!row) return `<td style="color:var(--mu2)">—</td>`;
            const col = scol(row.aA);
            return `<td>
              <div style="display:flex;flex-direction:column;gap:4px">
                <span style="font-family:var(--mo);font-size:11px;color:${col}">${row.aA}%</span>
                <span class="dpill dp-z" style="width:max-content">#${row.rank}</span>
              </div>
            </td>`;
          }).join('')}
        </tr>`;
      }).join('')}
    </tbody>`;
}

// ── Queue (sidebar) filter bar ────────────────────────────────────────────
function renderQueueFilters() {
  const body = document.getElementById('qfbar-body');
  if (!body) return;

  const role = user?.role;
  const canSeeAgent = role !== 'agent';
  const weeks    = uniq(TICKETS.map(t => t.week));
  const inboxes  = uniq(TICKETS.map(t => t.inbox));
  const agents   = canSeeAgent ? uniq(TICKETS.map(t => t.agent)) : [];
  const graders  = uniq(Object.values(grades).map(g => g?.grader).filter(Boolean));

  const sel = (val, arr) => arr.map(o => `<option value="${o}" ${F[val]===o?'selected':''}>${o}</option>`).join('');
  const catOpts = ANALYTICS_CATEGORY_OPTIONS.map(c => `<option value="${c.id}" ${F.category===c.id?'selected':''}>${c.label}</option>`).join('');

  body.innerHTML = `
    <div class="qfbar-row"><span class="qfbar-lbl">Category</span>
      <select data-f="category"><option value="">All</option>${catOpts}</select></div>
    <div class="qfbar-row"><span class="qfbar-lbl">Inbox</span>
      <select data-f="inbox"><option value="">All</option>${sel('inbox',inboxes)}</select></div>
    ${canSeeAgent ? `<div class="qfbar-row"><span class="qfbar-lbl">Agent</span>
      <select data-f="agent"><option value="">All</option>${sel('agent',agents)}</select></div>` : ''}
    ${weeks.length ? `<div class="qfbar-row"><span class="qfbar-lbl">Week</span>
      <select data-f="week"><option value="">All</option>${sel('week',weeks)}</select></div>` : ''}
    <div class="qfbar-row"><span class="qfbar-lbl">cnv_it</span>
      <input type="text" data-f="convId" value="${escapeHtml(F.convId)}" placeholder="Search cnv_it"></div>
    <div class="qfbar-row"><span class="qfbar-lbl">Date range</span>
      <div class="qfbar-dr">
        <input type="date" data-f="dateFrom" value="${F.dateFrom}" placeholder="From">
        <input type="date" data-f="dateTo"   value="${F.dateTo}"   placeholder="To">
      </div></div>
    ${graders.length ? `<div class="qfbar-row"><span class="qfbar-lbl">Grader</span>
      <select data-f="grader"><option value="">All</option>${sel('grader',graders)}</select></div>` : ''}
    <div class="qfbar-row"><span class="qfbar-lbl">Score %</span>
      <div class="qfbar-dr">
        <input type="number" data-f="scoreFrom" value="${F.scoreFrom}" placeholder="From" min="0" max="100">
        <input type="number" data-f="scoreTo"   value="${F.scoreTo}"   placeholder="To"   min="0" max="100">
      </div></div>
    <div class="qfbar-row"><span class="qfbar-lbl">Auto-fail</span>
      <select data-f="autofail"><option value="">All</option><option value="yes" ${F.autofail==='yes'?'selected':''}>Yes</option><option value="no" ${F.autofail==='no'?'selected':''}>No</option></select></div>
    <button class="qfbar-clear" id="qfbar-clear">Clear filters</button>
  `;

  body.querySelectorAll('[data-f]').forEach(el => {
    const syncFilter = () => {
      F[el.dataset.f] = el.value;
      resetPager('grading');
      resetPager('submissions');
      renderList();
    };
    el.addEventListener('change', syncFilter);
    if (el.tagName === 'INPUT' && el.type === 'text') el.addEventListener('input', syncFilter);
  });
  body.querySelector('#qfbar-clear')?.addEventListener('click', () => {
    F = { category:'', inbox:'', agent:'', week:'', convId:'', dateFrom:'', dateTo:'', grader:'', scoreFrom:'', scoreTo:'', autofail:'' };
    resetPager('grading');
    resetPager('submissions');
    renderQueueFilters();
    renderList();
  });
}

// ── Submissions horizontal filter bar ─────────────────────────────────────
function renderSubsFilters() {
  const cont = document.getElementById('hfbar-s');
  if (!cont) return;

  const role = user?.role;
  const canSeeAgent = role !== 'agent';
  const submitted = TICKETS.filter(t => grades[t.id]?.submitted);

  const weeks   = uniq(submitted.map(t => t.week));
  const inboxes = uniq(submitted.map(t => t.inbox));
  const agents  = canSeeAgent ? uniq(submitted.map(t => t.agent)) : [];
  const graders = uniq(submitted.map(t => grades[t.id]?.grader).filter(Boolean));
  const checkGroup = (label, key, options, selectedValues) => {
    if (!options.length) return '';
    return `<div class="hfbar-grp hfbar-grp-check">
      <span class="hfbar-lbl">${escapeHtml(label)}</span>
      <div class="hfcheck" data-sf-checkgroup="${escapeHtml(key)}">
        ${options.map(option => `<label class="hfcheck-item">
          <input type="checkbox" value="${escapeHtml(option.value)}" ${selectedValues.includes(option.value) ? 'checked' : ''}>
          <span>${escapeHtml(option.label)}</span>
        </label>`).join('')}
      </div>
    </div>`;
  };
  const textOptions = values => values.map(value => ({ value, label: value }));

  cont.innerHTML = `<div class="hfbar">
    ${checkGroup('Inbox', 'inboxes', textOptions(inboxes), SF.inboxes)}
    ${canSeeAgent ? checkGroup('Agent', 'agents', textOptions(agents), SF.agents) : ''}
    ${checkGroup('Week', 'weeks', textOptions(weeks), SF.weeks)}
    <div class="hfbar-grp"><span class="hfbar-lbl">cnv_it</span>
      <input type="text" data-sf="convId" value="${escapeHtml(SF.convId)}" placeholder="Search cnv_it"></div>
    <div class="hfbar-grp"><span class="hfbar-lbl">From</span>
      <input type="date" data-sf="dateFrom" value="${SF.dateFrom}"></div>
    <div class="hfbar-grp"><span class="hfbar-lbl">To</span>
      <input type="date" data-sf="dateTo"   value="${SF.dateTo}"></div>
    ${graders.length ? `<div class="hfbar-grp"><span class="hfbar-lbl">Grader</span>
      <select data-sf="grader"><option value="">All</option>${graders.map(o => `<option value="${o}" ${SF.grader===o?'selected':''}>${o}</option>`).join('')}</select></div>` : ''}
    <div class="hfbar-grp"><span class="hfbar-lbl">Score from</span>
      <input type="number" data-sf="scoreFrom" value="${SF.scoreFrom}" placeholder="0"   min="0" max="100" style="width:60px"></div>
    <div class="hfbar-grp"><span class="hfbar-lbl">Score to</span>
      <input type="number" data-sf="scoreTo"   value="${SF.scoreTo}"   placeholder="100" min="0" max="100" style="width:60px"></div>
    <div class="hfbar-grp"><span class="hfbar-lbl">Auto-fail</span>
      <select data-sf="autofail"><option value="">All</option><option value="yes" ${SF.autofail==='yes'?'selected':''}>Yes</option><option value="no" ${SF.autofail==='no'?'selected':''}>No</option></select></div>
    <button class="hfbar-clear" id="hfbar-clear">Clear</button>
  </div>`;

  cont.querySelectorAll('[data-sf]').forEach(el => {
    const syncFilter = () => {
      SF[el.dataset.sf] = el.value;
      resetPager('submissions');
      renderSubs();
    };
    el.addEventListener('change', syncFilter);
    if (el.tagName === 'INPUT' && el.type === 'text') el.addEventListener('input', syncFilter);
  });
  cont.querySelectorAll('[data-sf-checkgroup]').forEach(group => {
    const syncChecks = () => {
      SF[group.dataset.sfCheckgroup] = sanitizeStringArray(
        [...group.querySelectorAll('input:checked')].map(input => input.value)
      );
      resetPager('submissions');
      renderSubs();
    };
    group.querySelectorAll('input').forEach(input => input.addEventListener('change', syncChecks));
  });
  cont.querySelector('#hfbar-clear')?.addEventListener('click', () => {
    SF = defaultSubmissionFilters();
    resetPager('submissions');
    renderSubsFilters();
    renderSubs();
  });
}

function renderMyFilters() {
  const cont = document.getElementById('hfbar-m');
  if (!cont) return;

  const done = TICKETS.filter(t => grades[t.id]?.submitted);
  const weeks = uniq(done.map(t => t.week));
  const inboxes = uniq(done.map(t => t.inbox));
  const agents = uniq(done.map(t => t.agent));
  const cats = uniq(done.map(t => grades[t.id]?.category).filter(Boolean));

  const opt = (key, arr) => arr.map(o => `<option value="${o}" ${F[key]===o?'selected':''}>${o}</option>`).join('');

  cont.innerHTML = `<div class="hfbar">
    ${agents.length ? `<div class="hfbar-grp"><span class="hfbar-lbl">Agent</span>
      <select data-f="agent"><option value="">All</option>${opt('agent',agents)}</select></div>` : ''}
    ${weeks.length ? `<div class="hfbar-grp"><span class="hfbar-lbl">Week</span>
      <select data-f="week"><option value="">All</option>${opt('week',weeks)}</select></div>` : ''}
    ${cats.length ? `<div class="hfbar-grp"><span class="hfbar-lbl">Category</span>
      <select data-f="category"><option value="">All</option>${opt('category',cats)}</select></div>` : ''}
    <div class="hfbar-grp"><span class="hfbar-lbl">Inbox</span>
      <select data-f="inbox"><option value="">All</option>${opt('inbox',inboxes)}</select></div>
    <div class="hfbar-grp"><span class="hfbar-lbl">cnv_it</span>
      <input type="text" data-f="convId" value="${escapeHtml(F.convId)}" placeholder="Search cnv_it"></div>
    <div class="hfbar-grp"><span class="hfbar-lbl">Auto-fail</span>
      <select data-f="autofail"><option value="">All</option><option value="yes" ${F.autofail==='yes'?'selected':''}>Yes</option><option value="no" ${F.autofail==='no'?'selected':''}>No</option></select></div>
    <button class="hfbar-clear" id="hfbar-m-clear">Clear</button>
  </div>`;

  cont.querySelectorAll('[data-f]').forEach(el => {
    const syncFilter = () => {
      F[el.dataset.f] = el.value;
      renderMyTickets();
    };
    el.addEventListener('change', syncFilter);
    if (el.tagName === 'INPUT' && el.type === 'text') el.addEventListener('input', syncFilter);
  });
  cont.querySelector('#hfbar-m-clear')?.addEventListener('click', () => {
    F = { category:'', inbox:'', agent:'', week:'', convId:'', dateFrom:'', dateTo:'', grader:'', scoreFrom:'', scoreTo:'', autofail:'' };
    renderMyFilters();
    renderMyTickets();
  });
}

function applyAnalyticsFilters(tickets) {
  return tickets.filter(t => ticketMatchesAnalyticsFilters(t));
}

function renderAnalyticsCheckGroup(label, key, options, selected) {
  if(!options.length) return '';
  return `<div class="hfbar-grp hfbar-grp-check">
    <span class="hfbar-lbl">${escapeHtml(label)}</span>
    <div class="hfcheck" data-af-checkgroup="${escapeHtml(key)}">
      ${options.map(option => `<label class="hfcheck-item">
        <input type="checkbox" value="${escapeHtml(option.value)}" ${selected.includes(option.value) ? 'checked' : ''}>
        <span>${escapeHtml(option.label)}</span>
      </label>`).join('')}
    </div>
  </div>`;
}

function analyticsActiveChips() {
  const chips = [];
  if (AF.grader) chips.push({ label: 'Grader', value: AF.grader });
  AF.agents.forEach(value => chips.push({ label: 'Agent', value: analyticsAgentLabel(value) }));
  AF.excludedAgents.forEach(value => chips.push({ label: 'Exclude', value: analyticsAgentLabel(value) }));
  AF.categories.forEach(value => {
    const match = ANALYTICS_CATEGORY_OPTIONS.find(item => item.id === value);
    chips.push({ label: 'Category', value: match?.label || value });
  });
  AF.inboxes.forEach(value => chips.push({ label: 'Inbox', value }));
  if (AF.week) chips.push({ label: 'Week', value: AF.week });
  if (AF.month) chips.push({ label: 'Month', value: AF.month });
  if (AF.dateFrom) chips.push({ label: 'From', value: AF.dateFrom });
  if (AF.dateTo) chips.push({ label: 'To', value: AF.dateTo });

  if (!chips.length) return '';
  return `<div class="analytics-active">${chips.map(chip => `<span class="analytics-chip"><strong>${escapeHtml(chip.label)}:</strong> ${escapeHtml(chip.value)}</span>`).join('')}</div>`;
}

function renderAnalyticsFilters(submitted) {
  const graders = uniq(submitted.map(t => grades[t.id]?.grader).filter(Boolean));
  const inboxes = uniq(submitted.map(t => t.inbox));
  const weeks = uniq(submitted.map(t => t.week));
  const months = uniq(submitted.map(t => monthKey(t.date || t.createdTime)).filter(Boolean));
  const agentOptions = [];
  const seenAgents = new Set();
  submitted.forEach(t => {
    const key = normalizeAgentIdentity(t.agent);
    const label = analyticsAgentLabel(t.agent);
    if(key && label && !seenAgents.has(key)){
      seenAgents.add(key);
      agentOptions.push({ value: key, label });
    }
  });
  agentOptions.sort((a, b) => a.label.localeCompare(b.label));
  const singleOpt = (key, arr) => arr.map(o => `<option value="${escapeHtml(o)}" ${AF[key]===o?'selected':''}>${escapeHtml(o)}</option>`).join('');
  const categoryOptions = ANALYTICS_CATEGORY_OPTIONS.map(item => ({ value: item.id, label: item.label }));
  const inboxOptions = inboxes.map(item => ({ value: item, label: item }));

  return `<div class="hfbar">
    ${graders.length ? `<div class="hfbar-grp"><span class="hfbar-lbl">Grader</span>
      <select data-af="grader"><option value="">All</option>${singleOpt('grader',graders)}</select></div>` : ''}
    ${renderAnalyticsCheckGroup('Agents', 'agents', agentOptions, AF.agents)}
    ${user?.role !== 'agent' ? renderAnalyticsCheckGroup('Remove Agent', 'excludedAgents', agentOptions, AF.excludedAgents) : ''}
    ${renderAnalyticsCheckGroup('Category', 'categories', categoryOptions, AF.categories)}
    ${renderAnalyticsCheckGroup('Inbox', 'inboxes', inboxOptions, AF.inboxes)}
    ${weeks.length ? `<div class="hfbar-grp"><span class="hfbar-lbl">Week</span>
      <select data-af="week"><option value="">All</option>${singleOpt('week',weeks)}</select></div>` : ''}
    ${months.length ? `<div class="hfbar-grp"><span class="hfbar-lbl">Month</span>
      <select data-af="month"><option value="">All</option>${singleOpt('month',months)}</select></div>` : ''}
    <div class="hfbar-grp"><span class="hfbar-lbl">Date from</span>
      <input type="date" data-af="dateFrom" value="${AF.dateFrom}"></div>
    <div class="hfbar-grp"><span class="hfbar-lbl">Date to</span>
      <input type="date" data-af="dateTo" value="${AF.dateTo}"></div>
    <button class="hfbar-clear" id="analytics-clear">Clear</button>
  </div>`;
}

function analyticsQueryString() {
  const params = new URLSearchParams();
  if (AF.grader) params.set('grader', AF.grader);
  AF.agents.forEach(v => params.append('agent', v));
  AF.excludedAgents.forEach(v => params.append('excludeAgent', v));
  AF.categories.forEach(v => params.append('category', v));
  AF.inboxes.forEach(v => params.append('inbox', v));
  if (AF.week) params.set('week', AF.week);
  if (AF.month) params.set('month', AF.month);
  if (AF.dateFrom) params.set('dateFrom', AF.dateFrom);
  if (AF.dateTo) params.set('dateTo', AF.dateTo);
  const qs = params.toString();
  return qs ? `?${qs}` : '';
}

function updateSelBar() {
  const bar = document.getElementById('sel-bar');
  const cnt = document.getElementById('sel-count');
  if (!bar) return;
  if (selectedIds.size > 0) {
    bar.classList.add('on');
    if (cnt) cnt.textContent = `${selectedIds.size} selected`;
  } else {
    bar.classList.remove('on');
  }
}

function renderList(){
  const list = document.getElementById('tlist');
  const pagerHost = document.getElementById('grading-pager');

  // apply status filter then field filters
  const statusFiltered = TICKETS.filter(t =>
    filter === 'graded'  ?  grades[t.id]?.submitted :
    filter === 'pending' ? !grades[t.id]?.submitted : true
  );
  const vis = applyFilters(statusFiltered);
  const pageData = paginateItems(vis, 'grading');

  // update filter toggle label with active count
  const togEl = document.getElementById('qfbar-tog');
  if (togEl) {
    const ac = activeFilterCount();
    togEl.innerHTML = `Filters${ac ? ` <span style="color:var(--ac)">(${ac})</span>` : ''} <span id="qfbar-arrow">${qfOpen ? '▴' : '▾'}</span>`;
  }

  if (ticketsLoading) {
    list.innerHTML = `<div class="empty" style="height:auto;min-height:200px"><div class="empty-ic">⏳</div><p>Loading tickets…</p></div>`;
    if (pagerHost) pagerHost.innerHTML = '';
    return;
  }

  if(!vis.length){
    list.innerHTML = `<div class="empty" style="height:auto;min-height:200px"><div class="empty-ic">☑</div><p>No tickets</p></div>`;
    if (pagerHost) pagerHost.innerHTML = '';
    updateStats();
    updateSelBar();
    return;
  }

  const canDelete = ['admin', 'cs_leader'].includes(user?.role);

  list.innerHTML = pageData.items.map(t => {
    const done = grades[t.id]?.submitted;
    const checked = selectedIds.has(t.id);
    const convId = (t.frontUrl?.match(/cnv_[^\/\s?#]+/) || [''])[0];
    const displayId = convId || fmtDate(t.date || t.createdTime) || '';
    const cb = canDelete
      ? `<input type="checkbox" class="ti-cb" ${checked ? 'checked' : ''} onclick="event.stopPropagation();toggleSelect('${t.id}',this.checked)">`
      : '';
    const delBtn = canDelete
      ? `<button class="ti-del" title="Delete" onclick="event.stopPropagation();deleteTicketFromQueue('${t.id}')">×</button>`
      : '';
    return `<div class="ti ${sel?.id === t.id ? 'on' : ''}" data-id="${t.id}">
      <div class="ti-top">
        ${cb}<span class="ttid">${displayId}</span>
        <div style="display:flex;align-items:center;gap:4px;margin-left:auto">${delBtn}<div class="sdot ${done ? 'g' : 'p'}"></div></div>
      </div>
      <div class="tsubj">${t.subject || 'Untitled ticket'}</div>
      <div class="tmeta"><span class="tagt">${t.agent || '—'}</span></div>
    </div>`;
  }).join('');

  list.querySelectorAll('.ti').forEach(el => {
    el.addEventListener('click', function(){ pickTicket(this.dataset.id); });
  });

  renderPager('grading', 'grading-pager', pageData);
  updateStats();
  updateSelBar();
}

window.toggleSelect = function(id, checked) {
  if (checked) selectedIds.add(id);
  else selectedIds.delete(id);
  updateSelBar();
};

function updateStats(){
  const done = TICKETS.filter(t => grades[t.id]?.submitted);
  document.getElementById('sg').textContent = done.length;
  document.getElementById('sp').textContent = TICKETS.length - done.length;
  const avgs = done.map(t => pct(agentRaw(t.id), agentDenom(t.id)));
  document.getElementById('sa').textContent = avgs.length ? Math.round(avgs.reduce((a, b) => a + b, 0) / avgs.length) + '%' : '—';
}

function pickTicket(id){
  sel = TICKETS.find(t => t.id === id);
  editing = false;
  if(!grades[id]) grades[id] = blankG();
  renderList();
  if(sel && sel.frontUrl && !sel.convFailed && !(sel.conv && sel.conv.length)){
    fetchFrontConv(sel).then(() => renderDetail());
  }
  renderDetail();
}

async function fetchFrontConv(t){
  const m = t.frontUrl.match(/cnv_[^\/\s?#]+/);
  if(!m) return;
  const convId = m[0];

  try {
    const [msgResp, cmtResp] = await Promise.all([
      fetch(`${FRONT_BASE}/conversations/${convId}/messages`, {
        credentials: 'include'
      }),
      fetch(`${FRONT_BASE}/conversations/${convId}/comments`, {
        credentials: 'include'
      })
    ]);

    const messages = msgResp.ok ? (await msgResp.json())._results || [] : [];
    const comments = cmtResp.ok ? (await cmtResp.json())._results || [] : [];

    const items = [
      ...messages
        .filter(msg => msg.type !== 'auto_reply')
        .map(msg => {
          const authorName = msg.author
            ? `${msg.author.first_name || ''} ${msg.author.last_name || ''}`.trim()
            : '';
          return {
            _time: msg.created_at || 0,
            s: msg.is_inbound ? 'c' : 'a',
            author: authorName,
            b: msg.text || msg.blurb || '',
            t: new Date((msg.created_at || 0) * 1000).toLocaleString(),
            imgs: (msg.attachments || [])
              .filter(a => a.content_type && a.content_type.startsWith('image/'))
              .map(a => ({ url: a.url, name: a.filename || 'image' }))
          };
        }),
      ...comments.map(cmt => {
        const authorName = cmt.author
          ? `${cmt.author.first_name || ''} ${cmt.author.last_name || ''}`.trim()
          : '';
        return {
          _time: cmt.posted_at || 0,
          s: 'note',
          author: authorName,
          b: cmt.body || '',
          t: new Date((cmt.posted_at || 0) * 1000).toLocaleString(),
          imgs: (cmt.attachments || [])
            .filter(a => a.content_type && a.content_type.startsWith('image/'))
            .map(a => ({ url: a.url, name: a.filename || 'image' }))
        };
      })
    ];

    items.sort((a, b) => a._time - b._time);
    t.conv = items;
    if (!items.length) {
      // 403 or empty — mark as failed so UI doesn't show "Loading…" and doesn't retry
      const status = msgResp.status || cmtResp.status;
      if (status === 403 || status === 401) {
        t.convFailed = true;
      }
    }
  } catch(e){
    console.error('Front API error:', e);
    t.convFailed = true;
    toast('Could not load conversation from Front', 'err');
  }
}

async function loadConvImages(container){
  const imgs = container.querySelectorAll('img[data-att]');
  for(const img of imgs){
    const rawUrl = img.dataset.att;
    if(!rawUrl) continue;

    try {
      const encoded = encodeURIComponent(rawUrl);
      const r = await fetch(`${FRONT_BASE}/attachment?url=${encoded}`, {
        credentials: 'include'
      });

      if(r.ok){
        const blob = await r.blob();
        img.src = URL.createObjectURL(blob);
      }
    } catch(e){}
  }
}

function renderDetail(){
  if(!sel){
    document.getElementById('panel').innerHTML = '<div class="empty"><div class="empty-ic">☑</div><p>Select a ticket to grade</p></div>';
    return;
  }

  const t = sel;
  const g = grades[t.id] || blankG();
  grades[t.id] = g;

  const locked = g.submitted && !editing;
  const bot = t.bot || {};

  // Pre-populate grader scores/causes with bot values for pending tickets
  if (!g.submitted) {
    C.forEach(c => {
      if (isNA(g.scores[c.id]) && bot[c.id] !== undefined && !isNA(bot[c.id])) {
        g.scores[c.id] = bot[c.id];
      }
      if ((!g.causes[c.id] || g.causes[c.id] === '— select —') && bot[c.id + 'Cause'] && bot[c.id + 'Cause'] !== 'NA') {
        g.causes[c.id] = bot[c.id + 'Cause'];
      }
    });
  }
  const aRaw = agentRaw(t.id);
  const bRaw = botRaw(t);
  const aRawU = agentRawUnfiltered(t.id);
  const bDen = botDenom(t);
  const aDen = agentDenom(t.id);
  const aPct = pct(aRaw, aDen);
  const bPct = pct(bRaw, bDen);
  const aRawPct = pct(aRawU, aDen);
  const diff = aPct - bPct;
  const afActive = g.af.autofail && !g.af.autofail_ov;
  const below50 = !afActive && aRawU > 0 && aRawPct < 50;
  const secs = {};

  C.forEach(c => {
    if(!secs[c.sec]) secs[c.sec] = [];
    secs[c.sec].push(c);
  });

  let html = '';

  if(afActive){
    html += `<div class="af-banner">⛔ Auto-fail is active — agent score will be recorded as <strong>0%</strong></div>`;
  } else if(below50){
    html += `<div class="af-banner">⚠️ Raw score ${aRawPct}% is below 50% — will be recorded as <strong>0%</strong> (auto-fail threshold)</div>`;
  }

  html += `<div class="gtable"><div class="gh"><div class="gh-cell gh-crit">Criteria</div><div class="gh-cell gh-bot">🤖 Bot grade</div><div class="gh-cell gh-agt">👤 ${user?.name || 'Agent'} grade</div></div>`;

  Object.entries(secs).forEach(([sec, clist]) => {
    html += `<div class="gsec-row"><div class="gsec-label">${sec}</div></div>`;
    clist.forEach(c => {
      const bv = bot[c.id];
      const bc = bot[c.id + 'Cause'] || '';
      const av = g.scores[c.id];
      const ac = g.causes[c.id];
      const bCol = bv === 'NA' ? 'var(--mu2)' : scol(pct(nv(bv), c.max));

      html += `<div class="grow"><div class="grow-name">${c.label}<br><span class="gmax">/ ${c.max} pts</span></div>
        <div class="gcell bot">${bv === 'NA' || bv === undefined ? `<span class="natag">NA</span>` : `<span class="bval" style="color:${bCol}">${bv}</span><span class="smx" style="margin-left:4px">/ ${c.max}</span>`}${bc && bc !== 'NA' ? `<div class="bcause">${bc}</div>` : ''}</div>
        <div class="gcell agt">
          <div class="srow"><select class="sdd" id="sc-${c.id}" ${locked ? 'disabled' : ''}>${c.opts.map(o => `<option ${String(o) === String(av) ? 'selected' : ''}>${o}</option>`).join('')}</select><span class="smx">/ ${c.max}</span></div>
          <div class="clbl">Cause:</div>
          <select class="cdd" id="cd-${c.id}" ${locked ? 'disabled' : ''}>
            ${['— select —', ...c.causes].map(o => `<option ${o === ac ? 'selected' : ''}>${o}</option>`).join('')}
          </select>
          ${ac === 'Other' ? `
            <div class="af-cw" style="margin-top:6px">
              <input class="cdd" id="cd-other-${c.id}" ${locked ? 'disabled' : ''} value="${g.customCauses[c.id] || ''}" placeholder="Write cause...">
            </div>
          ` : ''}
        </div></div>`;
    });
  });

  html += `<div class="gsec-row"><div class="gsec-label">Auto-Fail & Escalation</div></div>`;

  AFS.forEach(af => {
    const botCause = t.bot?.afCauses?.[af.id] || '';
    const agentCause = g.afCauses[af.id] || '— select —';

    if(af.type === 'boolean'){
      const bOn = !!t.bot?.af?.[af.id];
      const aOn = !!g.af[af.id];

      html += `<div class="af-grid">
        <div class="af-nc">${af.label}<div class="af-nd">${af.desc}</div></div>
        <div class="af-bc">
          <div class="tog ${bOn ? 'on' : ''}" style="pointer-events:none;opacity:.6"><div class="tok"></div></div>
          <span class="tgl">${bOn ? 'Yes' : 'No'}</span>
          ${botCause ? `<div class="bcause">${botCause}</div>` : ''}
        </div>
        <div class="af-ac">
          <div class="tgw">
            <div class="tog ${aOn ? 'on' : ''}" id="aft-${af.id}" data-afid="${af.id}" style="${locked ? 'pointer-events:none;opacity:.4' : ''}">
              <div class="tok"></div>
            </div>
            <span class="tgl" id="afl-${af.id}">${aOn ? 'Yes' : 'No'}</span>
          </div>
          ${af.causes.length ? `
            <div class="af-cw" id="afc-${af.id}" style="${aOn ? '' : 'display:none'}">
              <div class="clbl" style="margin-top:6px">Cause:</div>
              <select class="cdd" id="afcd-${af.id}" ${locked ? 'disabled' : ''}>
                ${['— select —', ...af.causes].map(o => `<option ${o === agentCause ? 'selected' : ''}>${o}</option>`).join('')}
              </select>
              ${agentCause === 'Other' ? `
                <div class="af-cw" style="margin-top:6px">
                  <input class="cdd" id="afcd-other-${af.id}" ${locked ? 'disabled' : ''} value="${g.afCustomCauses[af.id] || ''}" placeholder="Write cause...">
                </div>
              ` : ''}
            </div>` : ''}
        </div>
      </div>`;
    } else {
      const bv = t.bot?.af?.[af.id] ?? 'NA';
      const av = g.af[af.id];
      const bCol = bv === 'NA' ? 'var(--mu2)' : scol(pct(nv(bv), af.max));

      html += `<div class="grow">
        <div class="grow-name">${af.label}<br><span class="gmax">/ ${af.max} pts</span></div>
        <div class="gcell bot">
          ${bv === 'NA'
            ? `<span class="natag">NA</span>`
            : `<span class="bval" style="color:${bCol}">${bv}</span><span class="smx" style="margin-left:4px">/ ${af.max}</span>`
          }
          ${botCause && botCause !== 'NA' ? `<div class="bcause">${botCause}</div>` : ''}
        </div>
        <div class="gcell agt">
          <div class="srow">
            <select class="sdd" id="afsc-${af.id}" ${locked ? 'disabled' : ''}>
              ${af.opts.map(o => `<option ${String(o) === String(av) ? 'selected' : ''}>${o}</option>`).join('')}
            </select>
            <span class="smx">/ ${af.max}</span>
          </div>
          <div class="clbl">Cause:</div>
          <select class="cdd" id="afcd-${af.id}" ${locked ? 'disabled' : ''}>
            ${['— select —', ...af.causes].map(o => `<option ${o === agentCause ? 'selected' : ''}>${o}</option>`).join('')}
          </select>
          ${agentCause === 'Other' ? `
            <div class="af-cw" style="margin-top:6px">
              <input class="cdd" id="afcd-other-${af.id}" ${locked ? 'disabled' : ''} value="${g.afCustomCauses[af.id] || ''}" placeholder="Write cause...">
            </div>
          ` : ''}
        </div>
      </div>`;
    }
  });

  const bTc = scol(bPct);
  const aTc = scol(aPct);
  const dl = diff > 0 ? `+${diff}%` : diff + '%';
  const dc = diff > 0 ? 'dp-pos' : diff < 0 ? 'dp-neg' : 'dp-z';

  html += `<div class="gfooter"><div class="gfl">Total score</div>
    <div class="gfb"><span class="tnum" style="color:${bTc}">${bPct}%</span><span class="tdenom">${bRaw}/${bDen}</span></div>
    <div class="gfa"><div style="display:flex;align-items:baseline;gap:6px"><span class="tnum" id="at-pct" style="color:${aTc}">${afActive ? '0%' : aPct + '%'}</span><span class="tdenom" id="at-raw">${afActive ? 'auto-fail' : aRaw + '/' + aDen}</span><span class="dpill ${dc}" id="dpill">${dl}</span></div>
      <div style="display:flex;gap:8px;align-items:center">
        <button class="bsm" id="delete-ticket-btn">Delete ticket</button>
        ${locked ? `<button class="btn-edit" id="edit-btn">Edit</button>` : `<button class="btn-sub" id="sub-btn">Submit grade →</button>`}
      </div>
    </div></div></div>`;

  html += `<div class="extra"><div class="slbl" style="margin-bottom:10px">Additional fields</div><div class="egrid">
    <div class="ef"><label>Agent's focus area</label><input id="ef-focus" value="${g.agentFocus || ''}" ${locked ? 'disabled' : ''} placeholder="e.g. Refunds"></div>
    <div class="ef"><label>Bot feedback similar to grader?</label><select id="ef-botsim" ${locked ? 'disabled' : ''}><option ${g.botSimilar === 'No' ? 'selected' : ''}>No</option><option ${g.botSimilar === 'Yes' ? 'selected' : ''}>Yes</option></select></div>
    <div class="ef"><label>Category</label><input id="ef-cat" value="${g.category || ''}" ${locked ? 'disabled' : ''} placeholder="Ticket category"></div>
    <div class="ef"><label>Fixed?</label><select id="ef-fixed" ${locked ? 'disabled' : ''}><option ${g.fixed === 'No' ? 'selected' : ''}>No</option><option ${g.fixed === 'Yes' ? 'selected' : ''}>Yes</option></select></div>
    <div class="ef"><label>Grader</label><select id="ef-grader" ${locked ? 'disabled' : ''}><option ${(g.grader || 'Bot') === 'Bot' ? 'selected' : ''}>Bot</option><option ${g.grader === (user?.name || 'Logged in user') ? 'selected' : ''}>${user?.name || 'Logged in user'}</option></select></div>
    <div class="ef full"><label>QA Feedback</label><textarea id="ef-qa" ${locked ? 'disabled' : ''} placeholder="Overall feedback…">${g.qaFeedback || ''}</textarea></div>
    <div class="ef full"><label>Suggestion on bot's prompt</label><textarea id="ef-botsugg" ${locked ? 'disabled' : ''} placeholder="Suggestions…">${g.botSuggestion || ''}</textarea></div>
    <div class="ef"><label>Brian's notes</label><input id="ef-brian" value="${g.brianNotes || ''}" ${locked ? 'disabled' : ''} placeholder="Notes"></div>
  </div></div>`;

  const badge = g.submitted ? `<span class="gbadge">✓ Graded</span>` : `<span class="pbadge">Pending</span>`;

  const convId = (t.frontUrl?.match(/cnv_[^\/\s?#]+/) || [''])[0];
  const wk = t.week || weekOf(t.date || t.createdTime);
  document.getElementById('panel').innerHTML = `<div class="detail">
    <div class="dh"><div class="did">${convId ? convId + ' · ' : ''}Week ${wk || '—'}</div><div class="dsubj">${t.subject || 'Untitled ticket'}</div>
      <div class="dmeta">
        <span class="mtag">🧑 ${t.agent || '—'}</span>
        ${t.date ? `<span class="mtag">📅 ${fmtDate(t.date)}</span>` : ''}
        ${t.createdTime ? `<span class="mtag">🕐 ${t.createdTime}</span>` : ''}
        ${t.inbox ? `<span class="mtag">📥 ${t.inbox}</span>` : ''}
        ${t.frontUrl ? `<span class="mtag">🔗 <a href="${t.frontUrl}" target="_blank" rel="noopener noreferrer" style="color:inherit">Front URL</a></span>` : ''}
        ${badge}
      </div></div>
    <div class="sec"><div class="slbl">Conversation${t.frontUrl ? ` <button class="bsm" style="margin-left:8px;font-size:10px" id="reload-conv">↻ Reload</button>` : ''}</div><div class="conv">${(t.conv && t.conv.length) ? t.conv.map(m => {
      const isNote = m.s === 'note';
      const isCust = m.s === 'c';
      const icon = isNote ? '💬' : (isCust ? '👤' : '🎧');
      const label = `${icon} ${m.author || (isNote ? 'Note' : (isCust ? 'Customer' : 'Agent'))}`;
      const cls = isNote ? 'n' : (isCust ? 'c' : 'a');
      const imgHtml = (m.imgs && m.imgs.length) ? m.imgs.map(a => `<img class="conv-img" data-att="${a.url}" alt="${a.name}" src="">`).join('') : '';
      return `<div class="msg${isNote ? ' msg-note' : ''}"><div class="mh"><span class="ms ${cls}">${label}</span><span class="mt">${m.t}</span></div><div class="msg-copy">${renderMessageBody(m.b)}</div>${imgHtml}</div>`;
    }).join('') : `<div class="msg"><div>${t.frontUrl ? (t.convFailed ? 'Conversation unavailable (no access)' : 'Loading conversation…') : 'No conversation imported'}</div></div>`}</div></div>
    <div class="sec"><div class="slbl">Grade — Bot vs ${user?.name || 'Agent'}</div>${html}</div>
  </div>`;

  const convEl = document.querySelector('.conv');
  if(convEl) loadConvImages(convEl);

  const reloadBtn = document.getElementById('reload-conv');
  if(reloadBtn) reloadBtn.addEventListener('click', () => {
    sel.conv = [];
    fetchFrontConv(sel).then(() => renderDetail());
    renderDetail();
  });

  C.forEach(c => {
    const sc = document.getElementById('sc-' + c.id);
    if(sc) sc.addEventListener('change', function(){
      grades[t.id].scores[c.id] = this.value;
      refreshT(t.id);
    });

    const cd = document.getElementById('cd-' + c.id);
    if(cd) cd.addEventListener('change', function(){
      grades[t.id].causes[c.id] = this.value;
      if(this.value !== 'Other') grades[t.id].customCauses[c.id] = '';
      renderDetail();
    });

    const cdOther = document.getElementById('cd-other-' + c.id);
    if(cdOther) cdOther.addEventListener('input', function(){
      grades[t.id].customCauses[c.id] = this.value;
    });
  });

  AFS.forEach(af => {
    if(af.type === 'boolean'){
      const trk = document.getElementById('aft-' + af.id);
      if(trk) trk.addEventListener('click', function(){
        if(locked) return;
        grades[t.id].af[af.id] = !grades[t.id].af[af.id];
        const on = grades[t.id].af[af.id];
        this.classList.toggle('on', on);
        const lbl = document.getElementById('afl-' + af.id);
        if(lbl) lbl.textContent = on ? 'Yes' : 'No';
        const wrap = document.getElementById('afc-' + af.id);
        if(wrap) wrap.style.display = on ? '' : 'none';
        refreshT(t.id);
        renderDetail();
      });
    } else {
      const sc = document.getElementById('afsc-' + af.id);
      if(sc) sc.addEventListener('change', function(){
        grades[t.id].af[af.id] = this.value;
      });
    }

    const afcd = document.getElementById('afcd-' + af.id);
    if(afcd) afcd.addEventListener('change', function(){
      grades[t.id].afCauses[af.id] = this.value;
      if(this.value !== 'Other') grades[t.id].afCustomCauses[af.id] = '';
      renderDetail();
    });

    const afcdOther = document.getElementById('afcd-other-' + af.id);
    if(afcdOther) afcdOther.addEventListener('input', function(){
      grades[t.id].afCustomCauses[af.id] = this.value;
    });
  });

  [
    {id:'ef-focus',k:'agentFocus'},
    {id:'ef-qa',k:'qaFeedback'},
    {id:'ef-botsugg',k:'botSuggestion'},
    {id:'ef-brian',k:'brianNotes'},
    {id:'ef-cat',k:'category'}
  ].forEach(({id, k}) => {
    const el = document.getElementById(id);
    if(el) el.addEventListener('input', function(){
      grades[t.id][k] = this.value;
    });
  });

  [
    {id:'ef-botsim',k:'botSimilar'},
    {id:'ef-fixed',k:'fixed'},
    {id:'ef-grader',k:'grader'}
  ].forEach(({id, k}) => {
    const el = document.getElementById(id);
    if(el) el.addEventListener('change', function(){
      grades[t.id][k] = this.value;
    });
  });

  const sub = document.getElementById('sub-btn');
  if(sub) sub.addEventListener('click', async () => {
    try {
      const currentId = t.id;
      // Find next pending ticket before submitting
      const pendingList = applyFilters(TICKETS.filter(x => !grades[x.id]?.submitted));
      const currentIdx = pendingList.findIndex(x => x.id === currentId);
      const nextTicket = pendingList[currentIdx + 1] || pendingList[currentIdx - 1] || null;

      await saveTicketGrade(currentId);
      grades[currentId].submitted = true;
      editing = false;
      toast('Grade submitted and saved ✓');
      await loadTicketsFromServer();

      // Auto-advance to next pending ticket
      if (nextTicket) {
        const refreshed = TICKETS.find(x => x.id === nextTicket.id);
        sel = refreshed || null;
      } else {
        sel = TICKETS.find(x => x.id === currentId) || null;
      }
      renderList();
      renderDetail();
    } catch (e) {
      toast(e.message || 'Save failed', 'err');
    }
  });

  const edb = document.getElementById('edit-btn');
  if(edb) edb.addEventListener('click', () => {
    editing = true;
    renderDetail();
  });

  const delBtn = document.getElementById('delete-ticket-btn');
  if(delBtn) delBtn.addEventListener('click', async () => {
    if (!confirm('Delete this ticket from the system?')) return;

    try {
      await deleteTicket(t.id);
      delete grades[t.id];
      sel = null;
      toast('Ticket deleted');
      await loadTicketsFromServer();
      document.getElementById('panel').innerHTML = '<div class="empty"><div class="empty-ic">☑</div><p>Select a ticket to grade</p></div>';
    } catch (e) {
      toast(e.message || 'Delete failed', 'err');
    }
  });
}

function refreshT(id){
  const t = TICKETS.find(x => x.id === id);
  const aRaw = agentRaw(id);
  const bRaw = botRaw(t);
  const aRawU = agentRawUnfiltered(id);
  const aDen = agentDenom(id);
  const bDen = botDenom(t);
  const aPct = pct(aRaw, aDen);
  const bPct = pct(bRaw, bDen);
  const afActive = grades[id].af.autofail && !grades[id].af.autofail_ov;
  const below50 = !afActive && aRawU > 0 && pct(aRawU, aDen) < 50;
  const el = document.getElementById('at-pct');
  const er = document.getElementById('at-raw');
  const dp = document.getElementById('dpill');
  if(!el) return;

  el.textContent = afActive ? '0%' : aPct + '%';
  el.style.color = scol(afActive ? 0 : aPct);

  if(er) er.textContent = afActive ? 'auto-fail' : aRaw + '/' + aDen;

  if(dp){
    const diff = aPct - bPct;
    dp.textContent = diff > 0 ? `+${diff}%` : diff + '%';
    dp.className = 'dpill ' + (diff > 0 ? 'dp-pos' : diff < 0 ? 'dp-neg' : 'dp-z');
  }

  const existing = document.querySelector('.af-banner');
  if(afActive && (!existing || existing.textContent.includes('below 50'))){ renderDetail(); return; }
  if(below50 && (!existing || existing.textContent.includes('Auto-fail is active'))){ renderDetail(); return; }
  if(!afActive && !below50 && existing){ renderDetail(); return; }
}

function isNewAgentTicket(ticketId) {
  const g = grades[ticketId];
  const t = TICKETS.find(x => String(x.id) === String(ticketId));
  const ticketDate = t?.date || '';
  if (isBeforeCutoff(ticketDate)) return false;
  return user?.role === 'agent' && !!g?.submitted && !g.agentAcknowledgedAt;
}

function renderNewTickets() {
  const countEl = document.getElementById('new-count');
  const thead = document.querySelector('#new-table thead');
  const tbody = document.querySelector('#new-table tbody');
  const pagerHost = document.getElementById('new-pager');
  if (!countEl || !thead || !tbody) return;

  const tickets = TICKETS.filter(t => isNewAgentTicket(t.id));
  const pageData = paginateItems(tickets, 'newTickets');
  countEl.textContent = tickets.length ? `${tickets.length} new graded ticket${tickets.length !== 1 ? 's' : ''}` : 'No new graded tickets';

  if (!tickets.length) {
    thead.innerHTML = '';
    tbody.innerHTML = `<tr><td colspan="200" style="padding:40px;text-align:center;color:var(--mu)">No new graded tickets</td></tr>`;
    if (pagerHost) pagerHost.innerHTML = '';
    return;
  }

  thead.innerHTML = `<tr>
    <th>Open</th>
    <th>Week</th>
    <th>Ticket date</th>
    <th>Agent</th>
    <th>Created Time</th>
    <th>Inbox</th>
    <th>cnv_it</th>
    <th>Front URL</th>
    <th>Bot's score</th>
    <th>Andi's score</th>
    <th>Diff</th>
    <th>Grader</th>
    <th>QA Feedback</th>
    <th>Reflection</th>
  </tr>`;

  tbody.innerHTML = pageData.items.map(t => {
    const g = grades[t.id];
    const aP = pct(agentRaw(t.id), agentDenom(t.id));
    const bP = pct(botRaw(t), botDenom(t));
    const diff = aP - bP;
    const convId = convIdFromFrontUrl(t.frontUrl);
    const reflection = (g.reflection || '').trim();
    return `<tr>
      <td><button class="tdm-open" onclick="openTicketDetail('${t.id}')">Open</button></td>
      <td>${t.week || weekOf(t.date || t.createdTime)}</td>
      <td>${fmtDate(t.date || t.createdTime)}</td>
      <td>${t.agent || ''}</td>
      <td style="font-size:10px">${t.createdTime || ''}</td>
      <td>${t.inbox || ''}</td>
      <td class="cn">${convId || ''}</td>
      <td style="font-size:10px">${t.frontUrl ? `<a href="${t.frontUrl}" target="_blank" rel="noopener noreferrer">link</a>` : ''}</td>
      <td><span class="schip" style="background:${bP >= 80 ? 'var(--grs)' : 'var(--acs)'};color:${scol(bP)}">${bP}%</span></td>
      <td><span class="schip" style="background:${aP >= 80 ? 'var(--grs)' : 'var(--acs)'};color:${scol(aP)}">${aP}%</span></td>
      <td class="cn" style="color:${diff > 0 ? 'var(--gr)' : diff < 0 ? 'var(--rd)' : 'var(--mu)'}">${diff > 0 ? '+' : ''}${diff}%</td>
      <td>${g.grader || 'Bot'}</td>
      <td class="cc">${g.qaFeedback || ''}</td>
      <td class="cc">${reflection || (aP < 100 ? 'Pending' : 'Not required')}</td>
    </tr>`;
  }).join('');

  renderPager('newTickets', 'new-pager', pageData);
}

function renderMyTickets() {
  const done = applyFilters(TICKETS.filter(t => grades[t.id]?.submitted));
  const countEl = document.getElementById('my-count');
  if (countEl) countEl.textContent = done.length ? `${done.length} graded ticket${done.length !== 1 ? 's' : ''}` : 'No graded tickets yet';

  const thead = document.querySelector('#my-table thead');
  const tbody = document.querySelector('#my-table tbody');
  if (!thead || !tbody) return;

  if (!done.length) {
    thead.innerHTML = '';
    tbody.innerHTML = `<tr><td colspan="200" style="padding:40px;text-align:center;color:var(--mu)">No graded tickets yet</td></tr>`;
    return;
  }

  thead.innerHTML = `<tr>
    <th>Open</th>
    <th>Week</th>
    <th>Ticket date</th>
    <th>Agent</th>
    <th>Created Time</th>
    <th>Inbox</th>
    <th>cnv_it</th>
    <th>Front URL</th>
    <th>Bot Denom</th>
    <th>Bot Num</th>
    <th>Bot's score</th>
    <th>Andi's Denom</th>
    <th>Andi's Num</th>
    <th>Andi's score</th>
    <th>Diff</th>
    <th>Grader</th>
    ${C.map(c => `<th>${c.label}</th><th>Cause</th>`).join('')}
    <th>Auto-Fail</th>
    <th>Auto-Fail Cause</th>
    <th>Bug Esc</th>
    <th>Bug Esc Cause</th>
    <th>Post Bug Esc</th>
    <th>Post Bug Esc Cause</th>
    <th>QA Feedback</th>
    <th>Open</th>
  </tr>`;

  tbody.innerHTML = done.map(t => {
    const g = grades[t.id];
    const aR = agentRaw(t.id);
    const bR = botRaw(t);
    const aD = agentDenom(t.id);
    const bD = botDenom(t);
    const aP = pct(aR, aD);
    const bP = pct(bR, bD);
    const af = isAF(t.id);
    const diff = aP - bP;
    const tWk = t.week || weekOf(t.date || t.createdTime);

    return `<tr>
      <td><button class="tdm-open" onclick="openTicketDetail('${t.id}')">Open</button></td>
      <td>${tWk}</td>
      <td>${fmtDate(t.date || t.createdTime)}</td>
      <td>${t.agent || ''}</td>
      <td style="font-size:10px">${t.createdTime || ''}</td>
      <td>${t.inbox || ''}</td>
      <td class="cn">${convIdFromFrontUrl(t.frontUrl) || ''}</td>
      <td style="font-size:10px">${t.frontUrl ? `<a href="${t.frontUrl}" target="_blank" rel="noopener noreferrer">link</a>` : ''}</td>
      <td class="cn">${bD}</td>
      <td class="cn">${bR}</td>
      <td><span class="schip" style="background:${bP >= 80 ? 'var(--grs)' : 'var(--acs)'};color:${scol(bP)}">${bP}%</span></td>
      <td class="cn">${aD}</td>
      <td class="cn">${aR}</td>
      <td><span class="schip" style="background:${af ? 'var(--rds)' : aP >= 80 ? 'var(--grs)' : 'var(--acs)'};color:${af ? 'var(--rd)' : scol(aP)}">${af ? '0%' : aP + '%'}</span></td>
      <td class="cn" style="color:${diff > 0 ? 'var(--gr)' : diff < 0 ? 'var(--rd)' : 'var(--mu)'}">${diff > 0 ? '+' : ''}${diff}%</td>
      <td>${g.grader || user?.name || 'Bot'}</td>
      ${C.map(c => {
        const v = g.scores[c.id];
        const p = isNA(v) ? null : pct(nv(v), c.max);
        const col = p === null ? 'var(--mu2)' : scol(p);
        return `<td><span class="cn" style="color:${col}">${isNA(v) ? 'NA' : nv(v)}</span></td><td class="cc">${finalCause(g, c.id)}</td>`;
      }).join('')}
      <td style="color:${g.af.autofail ? 'var(--rd)' : 'var(--mu)'}">${g.af.autofail ? 'TRUE' : 'FALSE'}</td>
      <td class="cc">${finalAFCause(g, 'autofail')}</td>
      <td>${isNA(g.af.bug_esc) ? 'NA' : g.af.bug_esc}</td>
      <td class="cc">${finalAFCause(g, 'bug_esc')}</td>
      <td>${isNA(g.af.post_bug) ? 'NA' : g.af.post_bug}</td>
      <td class="cc">${finalAFCause(g, 'post_bug')}</td>
      <td class="cc">${g.qaFeedback || ''}</td>
      <td><button class="tdm-open" onclick="openTicketDetail('${t.id}')">Open</button></td>
    </tr>`;
  }).join('');
}

async function acknowledgeAgentTicket(ticketId) {
  const r = await fetch(`${API_BASE}/api/tickets/${ticketId}/agent-acknowledge`, {
    method: 'POST',
    credentials: 'include'
  });
  if (!r.ok) {
    const data = await r.json().catch(() => ({}));
    throw new Error(data.error || 'Could not acknowledge ticket');
  }
  return r.json().catch(() => ({}));
}

async function submitTicketReflection(ticketId, reflection, reviewDurationSeconds) {
  const r = await fetch(`${API_BASE}/api/tickets/${ticketId}/reflection`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ reflection, review_duration_seconds: reviewDurationSeconds ?? null })
  });
  if (!r.ok) {
    const data = await r.json().catch(() => ({}));
    throw new Error(data.error || 'Could not submit reflection');
  }
  return r.json().catch(() => ({}));
}

async function markTicketReflectionRead(ticketId) {
  const r = await fetch(`${API_BASE}/api/tickets/${ticketId}/reflection-read`, {
    method: 'POST',
    credentials: 'include'
  });
  if (!r.ok) {
    const data = await r.json().catch(() => ({}));
    throw new Error(data.error || 'Could not mark reflection as read');
  }
  return r.json().catch(() => ({}));
}

function wireTicketDetailReflection(ticketId, body) {
  const addBtn = body.querySelector('#ticket-detail-add-reflection');
  const form = body.querySelector('#ticket-detail-reflection-form');
  const text = body.querySelector('#ticket-detail-reflection-text');
  const submitBtn = body.querySelector('#ticket-detail-reflection-submit');

  if (addBtn && form) {
    addBtn.addEventListener('click', () => {
      addBtn.style.display = 'none';
      form.style.display = '';
      if (text) {
        text.style.height = 'auto';
        text.style.height = `${Math.max(text.scrollHeight, 120)}px`;
        text.focus();
      }
    });
  }

  if (text) {
    const resize = () => {
      text.style.height = 'auto';
      text.style.height = `${Math.max(text.scrollHeight, 120)}px`;
    };
    text.addEventListener('input', resize);
    resize();
  }

  if (submitBtn && text) {
    submitBtn.addEventListener('click', async () => {
      submitBtn.disabled = true;
      try {
        const elapsed = reviewTimerStart ? Math.round((Date.now() - reviewTimerStart) / 1000) : 0;
        const reviewDuration = (reviewAccumulated[String(ticketId)] || 0) + elapsed || null;
        const data = await submitTicketReflection(ticketId, text.value, reviewDuration);
        if (grades[String(ticketId)]) {
          grades[String(ticketId)].reflection = data.reflection_text || text.value.trim();
          grades[String(ticketId)].reflectionSubmittedAt = data.reflection_submitted_at || new Date().toISOString();
          grades[String(ticketId)].agentAcknowledgedAt = data.reflection_submitted_at || new Date().toISOString();
        }
        if (reviewTimerInterval) { clearInterval(reviewTimerInterval); reviewTimerInterval = null; }
        reviewTimerStart = null;
        reviewingTicketId = null;
        delete reviewAccumulated[String(ticketId)];
        closeTicketDetail();
        await loadTicketsFromServer();
        switchTab('n');
        toast('Reflection submitted ✓');
      } catch (e) {
        toast(e.message || 'Reflection submit failed', 'err');
      } finally {
        submitBtn.disabled = false;
      }
    });
  }
}

function ticketDetailBody(t, g) {
  const aR = agentRaw(t.id);
  const bR = botRaw(t);
  const aD = agentDenom(t.id);
  const bD = botDenom(t);
  const aP = pct(aR, aD);
  const bP = pct(bR, bD);
  const diff = aP - bP;
  const af = isAF(t.id);
  const wk = t.week || weekOf(t.date || t.createdTime);
  const reflection = String(g.reflection || '').trim();
  const needsReflection = user?.role === 'agent' && isNewAgentTicket(t.id) && aP < 100 && !reflection;

  return `
    <div class="tdm-grid">
      <div class="tdm-stat"><div class="tdm-stat-lbl">Bot Score</div><div class="tdm-stat-val">${bP}%</div><div class="tsub">${bR}/${bD}</div></div>
      <div class="tdm-stat"><div class="tdm-stat-lbl">Grader Score</div><div class="tdm-stat-val">${af ? '0%' : `${aP}%`}</div><div class="tsub">${aR}/${aD}</div></div>
      <div class="tdm-stat"><div class="tdm-stat-lbl">Difference</div><div class="tdm-stat-val">${diff > 0 ? '+' : ''}${diff}%</div><div class="tsub">${g.grader || 'Bot'}</div></div>
      <div class="tdm-stat"><div class="tdm-stat-lbl">Auto-fail</div><div class="tdm-stat-val">${g.af.autofail ? 'TRUE' : 'FALSE'}</div><div class="tsub">${finalAFCause(g, 'autofail')}</div></div>
    </div>
    <div class="tdm-meta">
      <span class="tdm-tags">Week ${wk || '—'}</span>
      <span class="tdm-tags">Agent: ${t.agent || '—'}</span>
      <span class="tdm-tags">Inbox: ${t.inbox || '—'}</span>
      <span class="tdm-tags">Grader: ${g.grader || 'Bot'}</span>
      ${g.category ? `<span class="tdm-tags">Category: ${g.category}</span>` : ''}
      ${t.frontUrl ? `<span class="tdm-tags"><a href="${t.frontUrl}" target="_blank" rel="noopener noreferrer" style="color:inherit">Open in Front</a></span>` : ''}
    </div>
    <div class="tdm-sec">
      <h4>Conversation ${t.frontUrl ? `<button class="bsm" style="margin-left:8px;font-size:10px" id="ticket-detail-reload-conv">Reload</button>` : ''}</h4>
      <div class="tdm-conv">${(t.conv && t.conv.length) ? t.conv.map(m => {
        const isNote = m.s === 'note';
        const isCust = m.s === 'c';
        const icon = isNote ? '💬' : (isCust ? '👤' : '🎧');
        const label = `${icon} ${m.author || (isNote ? 'Note' : (isCust ? 'Customer' : 'Agent'))}`;
        const cls = isNote ? 'n' : (isCust ? 'c' : 'a');
        const imgHtml = (m.imgs && m.imgs.length) ? m.imgs.map(a => `<img class="conv-img" data-att="${a.url}" alt="${a.name}" src="">`).join('') : '';
        return `<div class="msg${isNote ? ' msg-note' : ''}"><div class="mh"><span class="ms ${cls}">${label}</span><span class="mt">${m.t}</span></div><div class="msg-copy">${renderMessageBody(m.b)}</div>${imgHtml}</div>`;
      }).join('') : `<div class="msg"><div>${t.frontUrl ? (t.convFailed ? 'Conversation unavailable (no access)' : 'Loading conversation…') : 'No conversation imported'}</div></div>`}</div>
    </div>
    <div class="tdm-sec">
      <h4>Category Results</h4>
      <div class="tdm-cats">${C.map(c => `
        <div class="tdm-cat">
          <div class="tdm-cat-top">
            <div class="tdm-cat-name">${c.label}</div>
            <div class="tdm-cat-score">${isNA(g.scores[c.id]) ? 'NA' : `${nv(g.scores[c.id])}/${c.max}`}</div>
          </div>
          <div class="tdm-cat-cause">${finalCause(g, c.id)}</div>
        </div>`).join('')}
      </div>
    </div>
    <div class="tdm-sec">
      <h4>QA Feedback</h4>
      <div class="tdm-copy">${g.qaFeedback || '—'}</div>
    </div>
    <div class="tdm-sec">
      <h4>Reflection</h4>
      ${reflection ? `<div class="tdm-copy">${escapeHtml(reflection)}</div>` : `<div class="tdm-note">${aP < 100 ? 'Reflection is required before this ticket leaves your New Tickets list.' : 'No reflection submitted.'}</div>`}
      ${needsReflection ? `
        <div style="margin-top:10px">
          <button class="tdm-reflect-btn" id="ticket-detail-add-reflection">Add Reflection</button>
          <div class="tdm-reflect-form" id="ticket-detail-reflection-form" style="display:none;margin-top:10px">
            <textarea id="ticket-detail-reflection-text" placeholder="Write your reflection here..."></textarea>
            <div class="tdm-reflect-actions">
              <button class="tdm-reflect-btn" id="ticket-detail-reflection-submit">Submit</button>
            </div>
          </div>
        </div>` : ''}
    </div>
    <div class="tdm-sec">
      <h4>Additional Notes</h4>
      <div class="tdm-cats">
        <div class="tdm-cat"><div class="tdm-cat-top"><div class="tdm-cat-name">Agent's Focus</div></div><div class="tdm-cat-cause">${g.agentFocus || '—'}</div></div>
        <div class="tdm-cat"><div class="tdm-cat-top"><div class="tdm-cat-name">Brian's Notes</div></div><div class="tdm-cat-cause">${g.brianNotes || '—'}</div></div>
        <div class="tdm-cat"><div class="tdm-cat-top"><div class="tdm-cat-name">Bot Prompt Suggestion</div></div><div class="tdm-cat-cause">${g.botSuggestion || '—'}</div></div>
        <div class="tdm-cat"><div class="tdm-cat-top"><div class="tdm-cat-name">Flags</div></div><div class="tdm-cat-cause">Bug Esc: ${isNA(g.af.bug_esc) ? 'NA' : g.af.bug_esc}\nCause: ${finalAFCause(g, 'bug_esc')}\n\nPost Bug Esc: ${isNA(g.af.post_bug) ? 'NA' : g.af.post_bug}\nCause: ${finalAFCause(g, 'post_bug')}</div></div>
      </div>
    </div>`;
}

function closeTicketDetail() {
  // Pause timer — save elapsed into accumulated so it resumes on reopen
  if (reviewTimerStart !== null && reviewingTicketId) {
    const elapsed = Math.round((Date.now() - reviewTimerStart) / 1000);
    reviewAccumulated[reviewingTicketId] = (reviewAccumulated[reviewingTicketId] || 0) + elapsed;
  }
  if (reviewTimerInterval) { clearInterval(reviewTimerInterval); reviewTimerInterval = null; }
  reviewTimerStart = null;
  reviewingTicketId = null;
  const modal = document.getElementById('ticket-detail-modal');
  if (modal) modal.style.display = 'none';
  currentDetailTicketId = null;
  currentDetailOptions = {};
}

window.openTicketDetail = async function(ticketId) {
  const options = arguments[1] || {};
  const t = TICKETS.find(x => String(x.id) === String(ticketId));
  const g = grades[String(ticketId)];
  if (!t || !g) return;

  const modal = document.getElementById('ticket-detail-modal');
  const title = document.getElementById('ticket-detail-title');
  const subtitle = document.getElementById('ticket-detail-subtitle');
  const body = document.getElementById('ticket-detail-body');
  if (!modal || !title || !subtitle || !body) return;

  // If switching away from a different ticket mid-review, pause that timer first
  if (reviewTimerStart !== null && reviewingTicketId && String(reviewingTicketId) !== String(ticketId)) {
    const elapsed = Math.round((Date.now() - reviewTimerStart) / 1000);
    reviewAccumulated[reviewingTicketId] = (reviewAccumulated[reviewingTicketId] || 0) + elapsed;
    reviewTimerStart = null;
    reviewingTicketId = null;
  }
  if (reviewTimerInterval) { clearInterval(reviewTimerInterval); reviewTimerInterval = null; }

  currentDetailTicketId = String(ticketId);
  currentDetailOptions = options;
  document.getElementById('review-timer')?.remove();
  modal.style.display = 'block';
  title.textContent = t.subject || 'Untitled ticket';
  subtitle.textContent = `${t.agent || '—'}${t.createdTime ? ` · ${t.createdTime}` : ''}${t.inbox ? ` · ${t.inbox}` : ''}`;

  const aP = pct(agentRaw(String(ticketId)), agentDenom(String(ticketId)));
  const needsReviewGate = user?.role === 'agent' && isNewAgentTicket(ticketId) && aP < 100 && !grades[String(ticketId)]?.reflection;
  const alreadyStarted = (reviewAccumulated[String(ticketId)] || 0) > 0;

  const startReviewTimer = () => {
    reviewTimerStart = Date.now();
    reviewingTicketId = String(ticketId);
    const head = document.querySelector('.tdm-head');
    if (head && !head.querySelector('#review-timer')) {
      head.insertAdjacentHTML('beforeend', `<span id="review-timer" style="font-family:var(--mo);font-size:12px;color:var(--am);background:var(--ams);padding:4px 10px;border-radius:6px">⏱ 00:00</span>`);
    }
    const updateTimer = () => {
      const el = document.getElementById('review-timer');
      if (!el || !reviewTimerStart) return;
      const elapsed = Math.floor((Date.now() - reviewTimerStart) / 1000);
      const total = (reviewAccumulated[String(ticketId)] || 0) + elapsed;
      const m = String(Math.floor(total / 60)).padStart(2, '0');
      const s = String(total % 60).padStart(2, '0');
      el.textContent = `⏱ ${m}:${s}`;
    };
    updateTimer();
    reviewTimerInterval = setInterval(updateTimer, 1000);
  };

  const renderModalBody = () => {
    body.classList.remove('review-gate-active');
    body.scrollTop = 0;
    body.innerHTML = ticketDetailBody(t, grades[String(ticketId)]);
    loadConvImages(body);
    wireTicketDetailReflection(ticketId, body);
    document.getElementById('ticket-detail-reload-conv')?.addEventListener('click', async () => {
      t.conv = [];
      t.convFailed = false;
      renderModalBody();
      await fetchFrontConv(t);
      renderModalBody();
    });
    if (needsReviewGate) {
      if (alreadyStarted) {
        // Resuming after a close — skip gate, restart timer immediately
        if (!reviewTimerStart) startReviewTimer();
      } else {
        // First open — show the gate
        body.classList.add('review-gate-active');
        body.insertAdjacentHTML('afterbegin', `<div class="review-gate" id="review-gate">
          <div class="review-gate-card">
            <div class="review-gate-ic">📋</div>
            <div class="review-gate-title">Review Required</div>
            <div class="review-gate-sub">Read through the conversation and grading feedback carefully before writing your reflection.</div>
            <button class="btn-p review-gate-btn" id="review-gate-start">Start reviewing the ticket</button>
          </div>
        </div>`);
        document.getElementById('review-gate-start')?.addEventListener('click', () => {
          document.getElementById('review-gate')?.remove();
          body.classList.remove('review-gate-active');
          startReviewTimer();
        });
      }
    }
  };
  renderModalBody();

  if (t.frontUrl && !(t.conv && t.conv.length)) {
    await fetchFrontConv(t);
    renderModalBody();
  }

  try {
    if (user?.role === 'agent' && isNewAgentTicket(ticketId) && generalPercent(ticketId) >= 100) {
      const data = await acknowledgeAgentTicket(ticketId);
      grades[String(ticketId)].agentAcknowledgedAt = data.agent_acknowledged_at || new Date().toISOString();
      renderNewTickets();
      await loadNotifications();
    }
    if (user?.role !== 'agent' && grades[String(ticketId)]?.reflectionSubmittedAt && !grades[String(ticketId)]?.reflectionReadAt) {
      const data = await markTicketReflectionRead(ticketId);
      grades[String(ticketId)].reflectionReadAt = data.reflection_read_at || new Date().toISOString();
      await loadNotifications();
    }
  } catch (e) {
    console.error(e);
  }
};

function renderSubs(){
  const allDone = TICKETS.filter(t => grades[t.id]?.submitted);
  const done = applySubmissionFilters(allDone);
  const pageData = paginateItems(done, 'submissions');
  document.getElementById('sub-count').textContent = done.length ? `${done.length} submitted grade${done.length !== 1 ? 's' : ''}` : 'No graded tickets yet';

  const thead = document.querySelector('#sub-table thead');
  const tbody = document.querySelector('#sub-table tbody');
  const pagerHost = document.getElementById('subs-pager');

  if(!done.length){
    thead.innerHTML = '';
    tbody.innerHTML = `<tr><td colspan="200" style="padding:40px;text-align:center;color:var(--mu)">No submissions yet</td></tr>`;
    if (pagerHost) pagerHost.innerHTML = '';
    return;
  }

  thead.innerHTML = `<tr>
    <th>Open</th>
    <th>Week</th>
    <th>Ticket date</th>
    <th>Agent</th>
    <th>Created Time</th>
    <th>Inbox</th>
    <th>cnv_it</th>
    <th>Front URL</th>
    <th>Bot Denom</th>
    <th>Bot Num</th>
    <th>Bot's score</th>
    <th>Andi's Denom</th>
    <th>Andi's Num</th>
    <th>Andi's score</th>
    <th>Diff</th>
    <th>Grader</th>
    ${C.map(c => `<th>${c.label}</th><th>Cause</th>`).join('')}
    <th>Auto-Fail</th>
    <th>Auto-Fail Cause</th>
    <th>Bug Esc</th>
    <th>Bug Esc Cause</th>
    <th>Post Bug Esc</th>
    <th>Post Bug Esc Cause</th>
    <th>QA Feedback</th>
    <th>Reflection</th>
    <th>Actions</th>
  </tr>`;

  tbody.innerHTML = pageData.items.map(t => {
    const g = grades[t.id];
    const aR = agentRaw(t.id);
    const bR = botRaw(t);
    const aD = agentDenom(t.id);
    const bD = botDenom(t);
    const aP = pct(aR, aD);
    const bP = pct(bR, bD);
    const af = isAF(t.id);
    const diff = aP - bP;

    const tWk = t.week || weekOf(t.date || t.createdTime);
    const convId = convIdFromFrontUrl(t.frontUrl);
    return `<tr>
      <td><button class="tdm-open" onclick="openTicketDetail('${t.id}')">Open</button></td>
      <td>${tWk}</td>
      <td>${fmtDate(t.date || t.createdTime)}</td>
      <td>${t.agent || ''}</td>
      <td style="font-size:10px">${t.createdTime || ''}</td>
      <td>${t.inbox || ''}</td>
      <td class="cn">${convId || ''}</td>
      <td style="font-size:10px">${t.frontUrl ? `<a href="${t.frontUrl}" target="_blank" rel="noopener noreferrer">link</a>` : ''}</td>
      <td class="cn">${bD}</td>
      <td class="cn">${bR}</td>
      <td><span class="schip" style="background:${bP >= 80 ? 'var(--grs)' : 'var(--acs)'};color:${scol(bP)}">${bP}%</span></td>
      <td class="cn">${aD}</td>
      <td class="cn">${aR}</td>
      <td><span class="schip" style="background:${af ? 'var(--rds)' : aP >= 80 ? 'var(--grs)' : 'var(--acs)'};color:${af ? 'var(--rd)' : scol(aP)}">${af ? '0%' : aP + '%'}</span></td>
      <td class="cn" style="color:${diff > 0 ? 'var(--gr)' : diff < 0 ? 'var(--rd)' : 'var(--mu)'}">${diff > 0 ? '+' : ''}${diff}%</td>
      <td>${g.grader || user?.name || 'Bot'}</td>
      ${C.map(c => {
        const v = g.scores[c.id];
        const p = isNA(v) ? null : pct(nv(v), c.max);
        const col = p === null ? 'var(--mu2)' : scol(p);
        return `<td><span class="cn" style="color:${col}">${isNA(v) ? 'NA' : nv(v)}</span></td><td class="cc">${finalCause(g, c.id)}</td>`;
      }).join('')}
      <td style="color:${g.af.autofail ? 'var(--rd)' : 'var(--mu)'}">${g.af.autofail ? 'TRUE' : 'FALSE'}</td>
      <td class="cc">${finalAFCause(g, 'autofail')}</td>
      <td>${isNA(g.af.bug_esc) ? 'NA' : g.af.bug_esc}</td>
      <td class="cc">${finalAFCause(g, 'bug_esc')}</td>
      <td>${isNA(g.af.post_bug) ? 'NA' : g.af.post_bug}</td>
      <td class="cc">${finalAFCause(g, 'post_bug')}</td>
      <td class="cc">${g.qaFeedback || ''}</td>
      <td class="cc">${g.reflection || ''}</td>
      <td>${['admin','cs_leader'].includes(user?.role) ? `<button class="bsm" onclick="deleteTicketFromTable('${t.id}')">Delete</button>` : ''}</td>
    </tr>`;
  }).join('');

  renderPager('submissions', 'subs-pager', pageData);
}

let analyticsSubTab = 'general';

async function renderAnalytics(){
  const cont = document.getElementById('an-content');
  const allDone = TICKETS.filter(t => grades[t.id]?.submitted);
  const done = applyAnalyticsFilters(allDone);
  const generalDone = allDone.filter(t => ticketMatchesAnalyticsFilters(t, { ignoreGrader:true }));

  const canSplitAnalytics = user?.role === 'cs_leader' || user?.role === 'admin';
  const subTabHtml = canSplitAnalytics ? `<div class="an-subtabs">
    <button class="an-subtab${analyticsSubTab === 'general' ? ' on' : ''}" data-subtab="general">General Analytics</button>
    <button class="an-subtab${analyticsSubTab === 'submissions' ? ' on' : ''}" data-subtab="submissions">Submissions Analytics</button>
  </div>` : '';

  if(!allDone.length){
    cont.innerHTML = `${subTabHtml}<div class="an-empty"><div class="empty-ic">📊</div><p>No graded tickets yet.</p></div>`;
    if (canSplitAnalytics) wireAnalyticsSubTabs(cont);
    return;
  }

  if (canSplitAnalytics && analyticsSubTab === 'submissions') {
    renderSubmissionsAnalytics(cont, subTabHtml, allDone);
    return;
  }

  Object.values(charts).forEach(c => {
    try { c.destroy(); } catch(e) {}
  });
  charts = {};

  const mapRankRows = rows => Array.isArray(rows) ? rows.map(r => ({
    week: r.week || '',
    ag: r.agent || 'Unknown',
    n: Number(r.ticket_count) || 0,
    aA: Number(r.avg_score) || 0,
    rank: Number(r.rank) || 0
  })) : [];
  const renderAllTimeRankingTable = (tableId, rows, emptyLabel) => {
    const table = document.getElementById(tableId);
    if (!table) return;

    table.innerHTML = `<thead><tr><th>Agent</th><th>Avg score %</th><th>Tickets</th><th>Rank</th></tr></thead><tbody>${rows.map(r => {
      const col = scol(r.aA);
      return `<tr><td style="font-family:var(--mo);font-size:11px">${r.ag}</td><td><div class="barwrap"><div class="barbg"><div class="barfill" style="width:${r.aA}%;background:${col}"></div></div><span style="font-family:var(--mo);font-size:11px;color:${col};min-width:36px">${r.aA}%</span></div></td><td style="color:var(--mu)">${r.n}</td><td><span class="dpill dp-z">#${r.rank}</span></td></tr>`;
    }).join('') || `<tr><td colspan="4" style="color:var(--mu);padding:16px">${emptyLabel}</td></tr>`}</tbody>`;
  };

  let filteredSummary = {};
  let filteredGeneralRows = [];
  let filteredGraderRows = [];
  let filteredBotRows = [];
  let weeklyGeneralRows = [];
  let weeklyGraderRows = [];
  let weeklyBotRows = [];
  let allTimeSummary = {};
  let allTimeGraderRows = [];
  let allTimeBotRows = [];

  try {
    const resp = await fetch(`${API_BASE}/api/analytics/rankings${analyticsQueryString()}`, {
      credentials: 'include'
    });
    if (resp.ok) {
      const data = await resp.json();
      filteredSummary = data.filtered_summary || {};
      filteredGeneralRows = mapRankRows(data.filtered_general_agents);
      filteredGraderRows = mapRankRows(data.filtered_grader_agents);
      filteredBotRows = mapRankRows(data.filtered_bot_agents);
      weeklyGeneralRows = mapRankRows(data.weekly_general_ranks);
      weeklyGraderRows = mapRankRows(data.weekly_grader_ranks);
      weeklyBotRows = mapRankRows(data.weekly_bot_ranks);
      allTimeSummary = data.all_time_summary || {};
      allTimeGraderRows = mapRankRows(data.all_time_grader_agents);
      allTimeBotRows = mapRankRows(data.all_time_bot_agents);
    }
  } catch (e) {
    console.error('Analytics ranking load failed:', e);
  }

  const filteredGeneralSummary = summarizeGeneralAnalytics(generalDone);
  const allTimeGeneralSummary = summarizeGeneralAnalytics(allDone);
  filteredGeneralRows = buildAgentRankingRows(generalDone, t => generalPercent(t.id));
  weeklyGeneralRows = buildWeeklyRankingRows(generalDone, t => generalPercent(t.id));

  const filteredTicketCount = Number(filteredSummary.total_tickets) || 0;
  const filteredGraderCount = Number(filteredSummary.grader_ticket_count) || 0;
  const filteredGeneralCount = filteredGeneralSummary.count;
  const avgGeneralScore = filteredGeneralSummary.avgScore;
  const avgGraderScore = Number(filteredSummary.avg_grader_score) || 0;
  const avgBotScore = Number(filteredSummary.avg_bot_score) || 0;
  const avgDiff = Math.abs(avgBotScore - avgGraderScore);
  const allTimeTicketCount = Number(allTimeSummary.total_tickets) || 0;
  const allTimeGraderCount = Number(allTimeSummary.grader_ticket_count) || 0;
  const allTimeGeneralCount = allTimeGeneralSummary.count || allTimeTicketCount;
  const allTimeAvgGeneralScore = allTimeGeneralSummary.avgScore;
  const allTimeAvgGraderScore = Number(allTimeSummary.avg_grader_score) || 0;
  const allTimeAvgBotScore = Number(allTimeSummary.avg_bot_score) || 0;
  const allTimeAvgDiff = Math.abs(allTimeAvgBotScore - allTimeAvgGraderScore);

  cont.innerHTML = `${subTabHtml}${renderAnalyticsFilters(allDone)}
  ${analyticsActiveChips()}
  ${!(done.length || generalDone.length) ? `<div class="an-empty"><div class="empty-ic">📊</div><p>No analytics match the current filters.</p></div>` : `<div class="kpi-section-label">Filtered</div>
  <div class="kpis">
    <div class="kpi"><div class="kv" style="color:#0ea5a4">${avgGeneralScore}%</div><div class="kl">Avg general score</div><div class="ks">${filteredGeneralCount} filtered tickets</div></div>
    <div class="kpi"><div class="kv" style="color:#1ec97a">${filteredTicketCount}</div><div class="kl">Filtered tickets</div><div class="ks">${filteredGraderCount} graded by grader</div></div>
    <div class="kpi"><div class="kv" style="color:#4f7cff">${avgGraderScore}%</div><div class="kl">Avg grader score</div><div class="ks">human-graded only</div></div>
    <div class="kpi"><div class="kv" style="color:#9d7df0">${avgBotScore}%</div><div class="kl">Avg bot score</div><div class="ks">all filtered tickets</div></div>
    <div class="kpi"><div class="kv" style="color:#f0a020">${avgDiff}%</div><div class="kl">Avg score gap</div><div class="ks">avg bot vs avg grader</div></div>
  </div>
  <div class="kpi-section-label">All-time</div>
  <div class="kpis">
    <div class="kpi"><div class="kv" style="color:#0ea5a4">${allTimeAvgGeneralScore}%</div><div class="kl">General avg</div><div class="ks">${allTimeGeneralCount} tickets</div></div>
    <div class="kpi"><div class="kv" style="color:#4f7cff">${allTimeAvgGraderScore}%</div><div class="kl">Grader avg</div><div class="ks">${allTimeGraderCount} human-graded tickets</div></div>
    <div class="kpi"><div class="kv" style="color:#9d7df0">${allTimeAvgBotScore}%</div><div class="kl">Bot avg</div><div class="ks">all submitted tickets</div></div>
    <div class="kpi"><div class="kv" style="color:#f0a020">${allTimeAvgDiff}%</div><div class="kl">Score gap</div><div class="ks">avg bot vs avg grader</div></div>
  </div>
  <div class="cgrid">
    <div class="ccard wide"><div class="ctitle">Weekly Ranking By General Score</div><div class="rank-scroll"><table class="atbl" id="atbl-general"></table></div></div>
    <div class="ccard"><div class="ctitle">Criteria avg — Grader vs Bot</div><div class="cwrap tall"><canvas id="ch-crit"></canvas></div></div>
    <div class="ccard"><div class="ctitle">Grader score distribution</div><div class="cwrap tall"><canvas id="ch-dist"></canvas></div></div>
    <div class="ccard wide"><div class="ctitle">Weekly Ranking By Grader</div><div class="rank-scroll"><table class="atbl" id="atbl-grader"></table></div></div>
    <div class="ccard wide"><div class="ctitle">Weekly Ranking By Bot</div><div class="rank-scroll"><table class="atbl" id="atbl-bot"></table></div></div>
  </div>`}`;

  cont.querySelectorAll('[data-af]').forEach(el => {
    el.addEventListener('change', () => {
      AF[el.dataset.af] = el.value;
      saveAnalyticsFilters();
      renderAnalytics();
    });
  });
  cont.querySelectorAll('[data-af-checkgroup]').forEach(group => {
    const syncChecks = () => {
      AF[group.dataset.afCheckgroup] = sanitizeStringArray(
        [...group.querySelectorAll('input:checked')].map(input => input.value)
      );
      saveAnalyticsFilters();
      renderAnalytics();
    };
    group.querySelectorAll('input').forEach(input => input.addEventListener('change', syncChecks));
  });
  cont.querySelector('#analytics-clear')?.addEventListener('click', () => {
    AF = defaultAnalyticsFilters();
    saveAnalyticsFilters();
    renderAnalytics();
  });
  if (canSplitAnalytics) wireAnalyticsSubTabs(cont);

  if(!done.length && !generalDone.length) return;

  Chart.defaults.color = '#6b7189';
  Chart.defaults.borderColor = 'rgba(255,255,255,0.06)';
  Chart.defaults.font.family = 'DM Sans';

  const graderDone = done.filter(t => isHumanGradedTicket(t.id));
  const cL = C.map(c => c.label.length > 16 ? c.label.slice(0, 16) + '…' : c.label);
  const aA = C.map(c => {
    const vs = graderDone.map(t => nv(grades[t.id].scores[c.id]));
    return vs.length ? Math.round(vs.reduce((a, b) => a + b, 0) / vs.length) : 0;
  });
  const bA = C.map(c => {
    const vs = done.map(t => nv(t.bot?.[c.id]));
    return vs.length ? Math.round(vs.reduce((a, b) => a + b, 0) / vs.length) : 0;
  });

  charts.crit = new Chart(document.getElementById('ch-crit'), {
    type:'bar',
    data:{
      labels:cL,
      datasets:[
        {label:'Grader',data:aA,backgroundColor:'rgba(79,124,255,0.75)',borderRadius:3,borderSkipped:false},
        {label:'Bot',data:bA,backgroundColor:'rgba(157,125,240,0.55)',borderRadius:3,borderSkipped:false}
      ]
    },
    options:{
      responsive:true,
      maintainAspectRatio:false,
      plugins:{legend:{position:'top',labels:{boxWidth:10,padding:12,font:{size:11}}}},
      scales:{
        x:{ticks:{font:{size:9},maxRotation:35},grid:{display:false}},
        y:{beginAtZero:true,grid:{color:'rgba(255,255,255,0.05)'}}
      }
    }
  });

  const bands = ['0% (auto-fail)','1–49%','50–69%','70–84%','85–100%'];
  const dist = [0,0,0,0,0];

  graderDone.forEach(t => {
    const p = pct(agentRaw(t.id), agentDenom(t.id));
    dist[p === 0 ? 0 : p < 50 ? 1 : p < 70 ? 2 : p < 85 ? 3 : 4]++;
  });

  charts.dist = new Chart(document.getElementById('ch-dist'), {
    type:'doughnut',
    data:{
      labels:bands,
      datasets:[{
        data:dist,
        backgroundColor:['rgba(240,78,78,0.9)','rgba(240,78,78,0.5)','rgba(240,160,32,0.8)','rgba(79,124,255,0.8)','rgba(30,201,122,0.8)'],
        borderWidth:0,
        hoverOffset:5
      }]
    },
    options:{
      responsive:true,
      maintainAspectRatio:false,
      plugins:{legend:{position:'right',labels:{boxWidth:10,padding:12,font:{size:11}}}}
    }
  });

  renderWeeklyRankingMatrix('atbl-general', weeklyGeneralRows, filteredGeneralRows, 'No general-score ranking data for the current filters.');
  renderWeeklyRankingMatrix('atbl-grader', weeklyGraderRows, filteredGraderRows, 'No grader ranking data for the current filters.');
  renderWeeklyRankingMatrix('atbl-bot', weeklyBotRows, filteredBotRows, 'No bot ranking data for the current filters.');
}

function wireAnalyticsSubTabs(cont) {
  cont.querySelectorAll('.an-subtab').forEach(btn => {
    btn.addEventListener('click', () => {
      analyticsSubTab = btn.dataset.subtab;
      tabDirty.a = true;
      renderAnalytics();
    });
  });
}

function fmtDuration(secs) {
  if (secs === null || secs === undefined) return '—';
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

function renderSubmissionsAnalytics(cont, subTabHtml, allDone) {
  Object.values(charts).forEach(c => { try { c.destroy(); } catch(e) {} });
  charts = {};

  // Exclude pre-cutoff tickets from submissions analytics
  const eligibleDone = allDone.filter(t => !isBeforeCutoff(t.date || ''));

  // Collect tickets that have review duration data
  const reviewed = eligibleDone.filter(t => grades[t.id]?.reviewDurationSeconds != null);

  // KPI values
  const allDurations = reviewed.map(t => grades[t.id].reviewDurationSeconds);
  const avgDuration = allDurations.length ? Math.round(allDurations.reduce((a, b) => a + b, 0) / allDurations.length) : null;
  const minDuration = allDurations.length ? Math.min(...allDurations) : null;
  const maxDuration = allDurations.length ? Math.max(...allDurations) : null;

  // Per-agent breakdown
  const byAgent = {};
  reviewed.forEach(t => {
    const key = normalizeAgentIdentity(t.agent) || t.agent || 'Unknown';
    const label = t.agent || 'Unknown';
    if (!byAgent[key]) byAgent[key] = { label, durations: [] };
    byAgent[key].durations.push(grades[t.id].reviewDurationSeconds);
  });
  const agentRows = Object.values(byAgent)
    .map(a => ({ label: a.label, avg: Math.round(a.durations.reduce((x, y) => x + y, 0) / a.durations.length), min: Math.min(...a.durations), max: Math.max(...a.durations), count: a.durations.length }))
    .sort((a, b) => b.avg - a.avg);

  // Per-week breakdown
  const byWeek = {};
  reviewed.forEach(t => {
    const wk = t.week || weekOf(t.date || t.createdTime) || '—';
    if (!byWeek[wk]) byWeek[wk] = [];
    byWeek[wk].push(grades[t.id].reviewDurationSeconds);
  });
  const weekLabels = Object.keys(byWeek).sort();
  const weekAvgs = weekLabels.map(w => Math.round(byWeek[w].reduce((a, b) => a + b, 0) / byWeek[w].length));

  // Submissions table
  const tableRows = eligibleDone.slice().sort((a, b) => (b.date || b.createdTime || '').localeCompare(a.date || a.createdTime || '')).map(t => {
    const g = grades[t.id];
    const aP = pct(agentRaw(t.id), agentDenom(t.id));
    const bP = botPercent(t);
    const diff = aP - bP;
    const reflection = (g.reflection || '').trim();
    const wk = t.week || weekOf(t.date || t.createdTime);
    const reflStatus = reflection
      ? `<span style="color:var(--gr)">✓ Submitted</span>`
      : (aP < 100 ? `<span style="color:var(--am)">Pending</span>` : `<span style="color:var(--mu)">N/A</span>`);
    const dur = g.reviewDurationSeconds != null ? fmtDuration(g.reviewDurationSeconds) : `<span style="color:var(--mu)">—</span>`;
    return `<tr>
      <td><button class="tdm-open" onclick="openTicketDetail('${t.id}')">Open</button></td>
      <td>${wk || '—'}</td>
      <td>${fmtDate(t.date || t.createdTime)}</td>
      <td>${escapeHtml(t.agent || '—')}</td>
      <td><span class="schip" style="background:${bP >= 80 ? 'var(--grs)' : 'var(--acs)'};color:${scol(bP)}">${bP}%</span></td>
      <td><span class="schip" style="background:${aP >= 80 ? 'var(--grs)' : 'var(--acs)'};color:${scol(aP)}">${aP}%</span></td>
      <td style="color:${diff > 0 ? 'var(--gr)' : diff < 0 ? 'var(--rd)' : 'var(--mu)'}">${diff > 0 ? '+' : ''}${diff}%</td>
      <td>${escapeHtml(g.grader || 'Bot')}</td>
      <td>${reflStatus}</td>
      <td style="font-family:var(--mo);font-size:11px">${dur}</td>
      <td class="cc" style="max-width:180px">${escapeHtml(reflection || '—')}</td>
    </tr>`;
  }).join('');

  const noReviewData = !reviewed.length;

  cont.innerHTML = `${subTabHtml}${renderAnalyticsFilters(allDone)}${analyticsActiveChips()}
  <div class="kpi-section-label">Review Time</div>
  <div class="kpis" style="margin-bottom:14px">
    <div class="kpi"><div class="kv" style="color:var(--am);font-family:var(--mo)">${fmtDuration(avgDuration)}</div><div class="kl">Avg review time</div><div class="ks">${reviewed.length} ticket${reviewed.length !== 1 ? 's' : ''} with timer data</div></div>
    <div class="kpi"><div class="kv" style="color:var(--gr);font-family:var(--mo)">${fmtDuration(minDuration)}</div><div class="kl">Fastest review</div><div class="ks">shortest session</div></div>
    <div class="kpi"><div class="kv" style="color:var(--rd);font-family:var(--mo)">${fmtDuration(maxDuration)}</div><div class="kl">Slowest review</div><div class="ks">longest session</div></div>
    <div class="kpi"><div class="kv" style="color:var(--ac)">${eligibleDone.length - reviewed.length}</div><div class="kl">No timer data</div><div class="ks">submitted before timer was added</div></div>
  </div>
  ${noReviewData ? '' : `<div class="cgrid" style="margin-bottom:14px">
    <div class="ccard"><div class="ctitle">Avg Review Time by Agent (seconds)</div><div class="cwrap tall"><canvas id="ch-agent-time"></canvas></div></div>
    <div class="ccard"><div class="ctitle">Avg Review Time by Week (seconds)</div><div class="cwrap tall"><canvas id="ch-week-time"></canvas></div></div>
  </div>
  <div class="ccard wide" style="margin-bottom:14px">
    <div class="ctitle">Review Time by Agent</div>
    <div class="dtw" style="max-height:260px">
      <table class="dt">
        <thead><tr><th>Agent</th><th>Tickets</th><th>Avg time</th><th>Fastest</th><th>Slowest</th></tr></thead>
        <tbody>${agentRows.map(r => `<tr>
          <td>${escapeHtml(r.label)}</td>
          <td style="color:var(--mu)">${r.count}</td>
          <td style="font-family:var(--mo)">${fmtDuration(r.avg)}</td>
          <td style="font-family:var(--mo);color:var(--gr)">${fmtDuration(r.min)}</td>
          <td style="font-family:var(--mo);color:var(--rd)">${fmtDuration(r.max)}</td>
        </tr>`).join('')}</tbody>
      </table>
    </div>
  </div>`}
  <div class="ccard wide">
    <div class="ctitle">All Submissions</div>
    <div class="dtw" style="max-height:480px">
      <table class="dt">
        <thead><tr>
          <th>Open</th><th>Week</th><th>Date</th><th>Agent</th>
          <th>Bot Score</th><th>Grader Score</th><th>Diff</th><th>Grader</th>
          <th>Reflection</th><th>Review time</th><th>Reflection text</th>
        </tr></thead>
        <tbody>${tableRows || `<tr><td colspan="11" style="padding:24px;text-align:center;color:var(--mu)">No submissions match current filters.</td></tr>`}</tbody>
      </table>
    </div>
  </div>`;

  // Wire filters
  cont.querySelectorAll('[data-af]').forEach(el => {
    el.addEventListener('change', () => { AF[el.dataset.af] = el.value; saveAnalyticsFilters(); renderAnalytics(); });
  });
  cont.querySelectorAll('[data-af-checkgroup]').forEach(group => {
    const sync = () => {
      AF[group.dataset.afCheckgroup] = sanitizeStringArray([...group.querySelectorAll('input:checked')].map(i => i.value));
      saveAnalyticsFilters(); renderAnalytics();
    };
    group.querySelectorAll('input').forEach(input => input.addEventListener('change', sync));
  });
  cont.querySelector('#analytics-clear')?.addEventListener('click', () => { AF = defaultAnalyticsFilters(); saveAnalyticsFilters(); renderAnalytics(); });
  wireAnalyticsSubTabs(cont);

  if (noReviewData) return;

  Chart.defaults.color = '#6b7189';
  Chart.defaults.borderColor = 'rgba(255,255,255,0.06)';
  Chart.defaults.font.family = 'DM Sans';

  const secTick = v => v >= 60 ? `${Math.floor(v/60)}m${v%60 > 0 ? ` ${v%60}s` : ''}` : `${v}s`;

  charts.agentTime = new Chart(document.getElementById('ch-agent-time'), {
    type: 'bar',
    data: {
      labels: agentRows.map(r => r.label.length > 14 ? r.label.slice(0, 14) + '…' : r.label),
      datasets: [{ label: 'Avg (s)', data: agentRows.map(r => r.avg), backgroundColor: 'rgba(240,160,32,0.7)', borderRadius: 4, borderSkipped: false }]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { ticks: { font: { size: 9 }, maxRotation: 30 }, grid: { display: false } },
        y: { beginAtZero: true, grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { callback: secTick } }
      }
    }
  });

  charts.weekTime = new Chart(document.getElementById('ch-week-time'), {
    type: 'bar',
    data: {
      labels: weekLabels,
      datasets: [{ label: 'Avg (s)', data: weekAvgs, backgroundColor: 'rgba(79,124,255,0.7)', borderRadius: 4, borderSkipped: false }]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { ticks: { font: { size: 9 }, maxRotation: 35 }, grid: { display: false } },
        y: { beginAtZero: true, grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { callback: secTick } }
      }
    }
  });
}

function ticketDateFromCreatedTime(createdTime) {
  if (!createdTime) return null;
  // Created Time format: "YYYY-MM-DD HH:MM:SS" — take the date portion
  const datePart = createdTime.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(datePart)) return null;
  return datePart; // store as YYYY-MM-DD
}

function weekMondayFromDate(dateStr) {
  if (!dateStr) return null;
  const d = new Date(dateStr + 'T00:00:00');
  if (isNaN(d)) return null;
  // WEEKDAY(date, 3): Mon=0, Tue=1, ..., Sun=6
  const mode3 = (d.getDay() + 6) % 7;
  const monday = new Date(d);
  monday.setDate(d.getDate() - mode3);
  const mm = String(monday.getMonth() + 1).padStart(2, '0');
  const dd = String(monday.getDate()).padStart(2, '0');
  const yyyy = monday.getFullYear();
  return `${mm}/${dd}/${yyyy}`;
}

document.getElementById('csv-in').addEventListener('change', async function(e){
  const file = e.target.files[0];
  if(!file) return;

  try {
    await importCsvFile(file, {
      submitted: false,
      chunkSize: 100,
      successLabel: 'Imported and saved'
    });
  } catch(err){
    console.error(err);
    toast(err.message || 'Import error', 'err');
  }

  this.value = '';
});

document.getElementById('csv-in-grader').addEventListener('change', async function(e){
  const file = e.target.files[0];
  if(!file) return;

  try {
    await importCsvFile(file, {
      submitted: true,
      chunkSize: 100,
      successLabel: 'Imported and submitted'
    });
  } catch(err){
    console.error(err);
    toast(err.message || 'Import error', 'err');
  }

  this.value = '';
});

function downloadBlob(blob, filename){
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function fileStamp() {
  return new Date().toISOString().slice(0,10);
}

function analyticsReportStyles() {
  return `
    <style>
      body{font-family:Arial,sans-serif;background:#fff;color:#172033;margin:24px}
      h1{font-size:24px;margin:0 0 8px}
      h2{font-size:16px;margin:24px 0 10px}
      .meta{font-size:12px;color:#667085;margin-bottom:16px}
      .chips{display:flex;flex-wrap:wrap;gap:8px;margin:0 0 18px}
      .chip{display:inline-flex;gap:6px;padding:6px 10px;border:1px solid #d8dfeb;border-radius:999px;font-size:12px}
      .chip strong{color:#667085}
      .kpis{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;margin-bottom:18px}
      .kpi{border:1px solid #d8dfeb;border-radius:12px;padding:14px}
      .kv{font-size:22px;font-weight:700;margin-bottom:4px}
      .kl{font-size:12px;color:#667085}
      .ks{font-size:11px;color:#98a2b3;margin-top:4px}
      .chart-grid{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:18px}
      .chart-card{border:1px solid #d8dfeb;border-radius:12px;padding:14px}
      .chart-card img{width:100%;height:auto;border-radius:8px}
      .table-card{margin:18px 0;padding:14px;border:1px solid #d8dfeb;border-radius:12px;overflow:auto}
      table{border-collapse:collapse;width:max-content;min-width:100%;font-size:12px}
      th,td{border:1px solid #d8dfeb;padding:7px 10px;text-align:left;vertical-align:top}
      th{background:#f3f6fb;font-size:11px;text-transform:uppercase;color:#667085}
      @media print{
        body{margin:12mm}
        .table-card{page-break-inside:avoid}
      }
    </style>
  `;
}

function exportTableStyles() {
  return `
    <style>
      body{font-family:Arial,sans-serif;background:#fff;color:#172033;margin:24px}
      h1{font-size:24px;margin:0 0 8px}
      .meta{font-size:12px;color:#667085;margin-bottom:16px}
      .chips{display:flex;flex-wrap:wrap;gap:8px;margin:0 0 18px}
      .chip{display:inline-flex;gap:6px;padding:6px 10px;border:1px solid #d8dfeb;border-radius:999px;font-size:12px}
      .chip strong{color:#667085}
      .table-card{padding:14px;border:1px solid #d8dfeb;border-radius:12px;overflow:auto}
      table{border-collapse:collapse;width:max-content;min-width:100%;font-size:12px}
      th,td{border:1px solid #d8dfeb;padding:7px 10px;text-align:left;vertical-align:top}
      th{background:#f3f6fb;font-size:11px;text-transform:uppercase;color:#667085}
    </style>
  `;
}

function submissionsExportColumns() {
  return [
    'Week',
    'Ticket date',
    'Agent',
    'Created Time',
    'Inbox',
    'Front URL',
    'Bot Denominator',
    'Bot Numerator',
    "Bot's score",
    "Andi's Denominator",
    "Andi's Numerator",
    "Andi's score",
    'Difference (Bot - Andi)',
    'Grader',
    'Grammar & Language (5)',
    'Grammar & Language Cause',
    'Tone & Personalization (5)',
    'Tone & Personalization Cause',
    'Timeliness & Responsiveness (10)',
    'Timeliness & Responsiveness Cause',
    'Ticket Efficiency (15)',
    'Ticket Efficiency Cause',
    'Ticket Efficiency (Manual Override) (15)',
    'Ticket Efficiency (Manual Override) Cause',
    'Probing & Clarification (10)',
    'Probing & Clarification Cause',
    'Probing & Clarification (Manual Override) (10)',
    'Probing & Clarification (Manual Override) Cause',
    'Problem Statement Comprehension (20)',
    'Problem Statement Comprehension Cause',
    'Problem Statement Comprehension (Manual Override) (20)',
    'Problem Statement Comprehension Cause (Manual Override)',
    'Customer Education (15)',
    'Customer Education Cause',
    'Customer Education (Manual Override) (15)',
    'Customer Education Cause (Manual Override)',
    'Resolution Quality (20)',
    'Resolution Quality Cause',
    'Resolution Quality (Manual Override) (20)',
    'Resolution Quality Cause (Manual Override)',
    'Documentation & Notes (10)',
    'Documentation & Notes Cause',
    'Documentation & Notes (Manual Override) (10)',
    'Documentation & Notes (Manual Override) Cause',
    'Chatbot Education (Manual Override) (16)',
    'Chatbot Education Cause (Manual Override)',
    'Auto-Fail',
    'Escalation',
    'Auto-Fail Cause',
    'Bug Escalation',
    'Bug Escalation Cause',
    'Post Bug Escalation',
    'Post Bug Escalation Cause',
    'QA Feedback',
    'Reflection'
  ];
}

function submissionExportRow(t) {
  const g = grades[t.id];
  const ag = g && g.submitted;
  const bNum = botRaw(t);
  const bDen = botDenom(t);
  const bScore = pct(bNum, bDen);
  const aNum = ag ? agentRaw(t.id) : '';
  const aDen = ag ? agentDenom(t.id) : '';
  const aScore = ag ? pct(aNum, aDen) : '';
  const diff = ag ? bScore - aScore : '';

  return [
    t.week || weekOf(t.date || t.createdTime),
    fmtDate(t.date || t.createdTime),
    t.agent || '',
    t.createdTime || '',
    t.inbox || '',
    t.frontUrl || '',
    bDen,
    bNum,
    bScore,
    aDen,
    aNum,
    aScore,
    diff,
    ag ? (g.grader || user?.name || 'Bot') : '',
    ag ? (isNA(g.scores.grammar) ? 'NA' : nv(g.scores.grammar)) : 'NA',
    ag ? finalCause(g, 'grammar') : 'NA',
    ag ? (isNA(g.scores.tone) ? 'NA' : nv(g.scores.tone)) : 'NA',
    ag ? finalCause(g, 'tone') : 'NA',
    ag ? (isNA(g.scores.timeliness) ? 'NA' : nv(g.scores.timeliness)) : 'NA',
    ag ? finalCause(g, 'timeliness') : 'NA',
    'NA',
    'NA',
    ag ? (isNA(g.scores.efficiency) ? 'NA' : nv(g.scores.efficiency)) : 'NA',
    ag ? finalCause(g, 'efficiency') : 'NA',
    'NA',
    'NA',
    ag ? (isNA(g.scores.probing) ? 'NA' : nv(g.scores.probing)) : 'NA',
    ag ? finalCause(g, 'probing') : 'NA',
    'NA',
    'NA',
    ag ? (isNA(g.scores.problem) ? 'NA' : nv(g.scores.problem)) : 'NA',
    ag ? finalCause(g, 'problem') : 'NA',
    'NA',
    'NA',
    ag ? (isNA(g.scores.education) ? 'NA' : nv(g.scores.education)) : 'NA',
    ag ? finalCause(g, 'education') : 'NA',
    'NA',
    'NA',
    ag ? (isNA(g.scores.resolution) ? 'NA' : nv(g.scores.resolution)) : 'NA',
    ag ? finalCause(g, 'resolution') : 'NA',
    'NA',
    'NA',
    ag ? (isNA(g.scores.docs) ? 'NA' : nv(g.scores.docs)) : 'NA',
    ag ? finalCause(g, 'docs') : 'NA',
    ag ? (isNA(g.scores.chatbot) ? 'NA' : nv(g.scores.chatbot)) : 'NA',
    ag ? finalCause(g, 'chatbot') : 'NA',
    ag ? (g.af.autofail ? 'TRUE' : 'FALSE') : '',
    '',
    ag ? finalAFCause(g, 'autofail') : 'NA',
    ag ? g.af.bug_esc : '',
    ag ? finalAFCause(g, 'bug_esc') : '',
    ag ? g.af.post_bug : '',
    ag ? finalAFCause(g, 'post_bug') : '',
    ag ? g.qaFeedback : '',
    ag ? (g.reflection || '') : ''
  ];
}

function filteredSubmissionTickets() {
  return applySubmissionFilters(TICKETS.filter(t => grades[t.id]?.submitted));
}

function submissionsActiveChips() {
  const chips = [];
  SF.categories.forEach(value => chips.push({ label: 'Category', value }));
  SF.inboxes.forEach(value => chips.push({ label: 'Inbox', value }));
  SF.agents.forEach(value => chips.push({ label: 'Agent', value }));
  SF.weeks.forEach(value => chips.push({ label: 'Week', value }));
  if (SF.convId) chips.push({ label: 'cnv_it', value: SF.convId });
  if (SF.dateFrom) chips.push({ label: 'From', value: SF.dateFrom });
  if (SF.dateTo) chips.push({ label: 'To', value: SF.dateTo });
  if (SF.grader) chips.push({ label: 'Grader', value: SF.grader });
  if (SF.scoreFrom) chips.push({ label: 'Score from', value: SF.scoreFrom });
  if (SF.scoreTo) chips.push({ label: 'Score to', value: SF.scoreTo });
  if (SF.autofail) chips.push({ label: 'Auto-fail', value: SF.autofail });
  return chips;
}

async function buildAnalyticsReportHtml() {
  await renderAnalytics();

  const kpis = document.querySelector('#an-content .kpis')?.innerHTML || '';
  const activeChips = analyticsActiveChips();
  const critChart = document.getElementById('ch-crit')?.toDataURL('image/png') || '';
  const distChart = document.getElementById('ch-dist')?.toDataURL('image/png') || '';
  const sections = [
    { title: 'Weekly Ranking By General Score', id: 'atbl-general' },
    { title: 'Weekly Ranking By Grader', id: 'atbl-grader' },
    { title: 'Weekly Ranking By Bot', id: 'atbl-bot' }
  ];

  return `<!DOCTYPE html>
  <html>
  <head>
    <meta charset="UTF-8">
    <title>QA Grader Analytics Report</title>
    ${analyticsReportStyles()}
  </head>
  <body>
    <h1>QA Grader Analytics Report</h1>
    <div class="meta">Generated on ${new Date().toLocaleString()}</div>
    ${activeChips ? `<div class="chips">${activeChips.replace(/class="analytics-chip"/g, 'class="chip"').replace(/analytics-active/g, '')}</div>` : ''}
    ${kpis ? `<div class="kpis">${kpis}</div>` : ''}
    <div class="chart-grid">
      ${critChart ? `<div class="chart-card"><h2>Criteria Avg — Grader vs Bot</h2><img src="${critChart}" alt="Criteria chart"></div>` : ''}
      ${distChart ? `<div class="chart-card"><h2>Grader Score Distribution</h2><img src="${distChart}" alt="Distribution chart"></div>` : ''}
    </div>
    ${sections.map(section => {
      const table = document.getElementById(section.id);
      return table ? `<div class="table-card"><h2>${section.title}</h2>${table.outerHTML}</div>` : '';
    }).join('')}
  </body>
  </html>`;
}

function exportCsv() {
  const cols = submissionsExportColumns();
  const rows = [cols];

  TICKETS.forEach(t => {
    rows.push(submissionExportRow(t));
  });

  const csv = rows.map(r => r.map(c => `"${String(c ?? '').replace(/"/g, '""')}"`).join(';')).join('\n');
  const blob = new Blob([csv], {type:'text/csv;charset=utf-8;'});
  downloadBlob(blob, `qa_grades_${fileStamp()}.csv`);
  toast('Exported ✓');
}

function buildSubmissionsExcelHtml() {
  const tickets = filteredSubmissionTickets();
  const cols = submissionsExportColumns();
  const rows = tickets.map(submissionExportRow);
  const chips = submissionsActiveChips();

  return `<!DOCTYPE html>
  <html>
  <head>
    <meta charset="UTF-8">
    <title>QA Grader Submissions Export</title>
    ${exportTableStyles()}
  </head>
  <body>
    <h1>QA Grader Submissions Export</h1>
    <div class="meta">Generated on ${new Date().toLocaleString()} · ${tickets.length} filtered ticket${tickets.length !== 1 ? 's' : ''}</div>
    ${chips.length ? `<div class="chips">${chips.map(chip => `<span class="chip"><strong>${escapeHtml(chip.label)}:</strong> ${escapeHtml(chip.value)}</span>`).join('')}</div>` : ''}
    <div class="table-card">
      <table>
        <thead>
          <tr>${cols.map(col => `<th>${escapeHtml(col)}</th>`).join('')}</tr>
        </thead>
        <tbody>
          ${rows.length ? rows.map(row => `<tr>${row.map(cell => `<td>${escapeHtml(cell ?? '')}</td>`).join('')}</tr>`).join('') : `<tr><td colspan="${cols.length}">No filtered submissions.</td></tr>`}
        </tbody>
      </table>
    </div>
  </body>
  </html>`;
}

function exportSubmissionsExcel() {
  const tickets = filteredSubmissionTickets();
  if (!tickets.length) {
    toast('No filtered submissions to export', 'err');
    return;
  }

  const html = buildSubmissionsExcelHtml();
  const blob = new Blob([html], { type: 'application/vnd.ms-excel;charset=utf-8;' });
  downloadBlob(blob, `qa_submissions_filtered_${fileStamp()}.xls`);
  toast('Submissions Excel exported ✓');
}

async function exportAnalyticsExcel() {
  const html = await buildAnalyticsReportHtml();
  const blob = new Blob([html], { type: 'application/vnd.ms-excel;charset=utf-8;' });
  downloadBlob(blob, `qa_analytics_${fileStamp()}.xls`);
  toast('Analytics Excel exported ✓');
}

async function exportAnalyticsPdf() {
  const html = await buildAnalyticsReportHtml();
  const win = window.open('', '_blank', 'width=1280,height=900');
  if (!win) {
    toast('Popup blocked. Please allow popups to export PDF.', 'err');
    return;
  }

  win.document.open();
  win.document.write(`${html}<script>window.onload = () => setTimeout(() => window.print(), 300);<\/script>`);
  win.document.close();
  toast('PDF print dialog opened ✓');
}

function toast(msg, type, options = {}){
  const t = document.getElementById('toast');
  const sticky = !!options.sticky;
  if(toastTimer){
    clearTimeout(toastTimer);
    toastTimer = null;
  }
  t.textContent = msg;
  t.style.background = type ? 'var(--rd)' : 'var(--gr)';
  t.classList.add('show');
  if(!sticky){
    toastTimer = setTimeout(() => {
      t.classList.remove('show');
      toastTimer = null;
    }, 2500);
  }
}

const themeSwitch = document.getElementById('theme-switch');
if (themeSwitch) {
  let storedTheme = 'system';
  try { storedTheme = localStorage.getItem(THEME_KEY) || 'system'; } catch (e) {}
  applyThemePreference(storedTheme, false);
  themeSwitch.addEventListener('change', e => {
    applyThemePreference(e.target.value);
  });
}

const exportMenu = document.getElementById('export-menu');
const exportMenuToggle = document.getElementById('export-menu-toggle');
const exportCsvBtn = document.getElementById('export-csv-btn');
const exportSubmissionsExcelBtn = document.getElementById('export-submissions-excel-btn');
const exportAnalyticsExcelBtn = document.getElementById('export-analytics-excel-btn');
const exportAnalyticsPdfBtn = document.getElementById('export-analytics-pdf-btn');
const notifMenu = document.getElementById('notif-menu');
const notifToggle = document.getElementById('notif-toggle');

function setExportMenuOpen(open) {
  if (!exportMenu) return;
  exportMenu.classList.toggle('open', !!open);
  if (exportMenuToggle) exportMenuToggle.setAttribute('aria-expanded', open ? 'true' : 'false');
}

function setNotifMenuOpen(open) {
  if (!notifMenu) return;
  notifMenu.classList.toggle('open', !!open);
  if (notifToggle) notifToggle.setAttribute('aria-expanded', open ? 'true' : 'false');
}

if (exportMenu && exportMenuToggle) {
  exportMenuToggle.addEventListener('click', e => {
    e.stopPropagation();
    setNotifMenuOpen(false);
    setExportMenuOpen(!exportMenu.classList.contains('open'));
  });

  exportMenu.addEventListener('click', e => {
    e.stopPropagation();
  });

  document.addEventListener('click', () => {
    setExportMenuOpen(false);
    setNotifMenuOpen(false);
  });

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      setExportMenuOpen(false);
      setNotifMenuOpen(false);
    }
  });
}

if (notifMenu && notifToggle) {
  notifToggle.addEventListener('click', e => {
    e.stopPropagation();
    setExportMenuOpen(false);
    setNotifMenuOpen(!notifMenu.classList.contains('open'));
  });

  notifMenu.addEventListener('click', e => {
    e.stopPropagation();
  });
}

exportCsvBtn?.addEventListener('click', () => {
  setExportMenuOpen(false);
  exportCsv();
});

exportSubmissionsExcelBtn?.addEventListener('click', () => {
  setExportMenuOpen(false);
  try {
    exportSubmissionsExcel();
  } catch (e) {
    console.error(e);
    toast('Submissions Excel export failed', 'err');
  }
});

exportAnalyticsExcelBtn?.addEventListener('click', async () => {
  setExportMenuOpen(false);
  try {
    await exportAnalyticsExcel();
  } catch (e) {
    console.error(e);
    toast('Analytics Excel export failed', 'err');
  }
});

exportAnalyticsPdfBtn?.addEventListener('click', async () => {
  setExportMenuOpen(false);
  try {
    await exportAnalyticsPdf();
  } catch (e) {
    console.error(e);
    toast('Analytics PDF export failed', 'err');
  }
});

(async function checkSession() {
  showBootLoading('Checking session…');
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);
  try {
    const r = await fetch(`${API_BASE}/api/auth/me`, {
      credentials: 'include',
      signal: controller.signal
    });
    clearTimeout(timeout);

    const data = await r.json();

    if (data.user) {
      user = {
        id: data.user.id,
        name: data.user.username,
        email: data.user.email,
        role: data.user.role
      };

      applyRoleUI();
      document.getElementById('nav-name').textContent = user.name;
      document.getElementById('login').style.display = 'none';
      document.getElementById('app').classList.add('on');
      hideBootLoading();
      await loadTicketsFromServer();
    } else {
      applyRoleUI();
      hideBootLoading();
    }
  } catch (e) {
    clearTimeout(timeout);
    console.error('Session check failed', e);
    applyRoleUI();
    hideBootLoading();
  }
})();

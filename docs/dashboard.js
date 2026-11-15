// Reddit 账号监控 · 在线查看版。由采集脚本 v3.3 自动生成：界面和计算完全相同，数据来自 data.json，不发任何采集请求。
(function () {
  'use strict';

  if (window.top !== window.self) return;
  if (document.getElementById('rmd-host')) return;

  // ---------- 配置 ----------
  const VERSION = '3.3';
  const DEFAULT_USERS = [
    'Parca-designer7891', 'Bolu_Cod1106', '8Leafs', 'Exciting_Smell5249', 'Thunderage9281',
    'ConstantJoke1949', 'Moritablue', 'Vortek13', 'Pretty_Audience_1471', 'Sea-Individual2912',
  ];
  const WINDOW_DAYS = 30;        // 采集多少天内的发帖和评论
  const TRACK_HOURS = 168;       // 帖子发布后多少小时内记录分数快照
  const MAX_PAGES = 3;           // 每个列表最多翻几页（每页 100 条）
  const MX_OFFSET_MS = 6 * 3600 * 1000; // 墨西哥城 UTC-6，按当地时间统计
  const ARCHIVE = 'https://arctic-shift.photon-reddit.com'; // 公开的 Reddit 存档，按作者查帖子和评论
  const ARCHIVE_PAGES = 10;      // 存档每类最多翻几页（每页 100 条）
  const SEARCH_PAGES = 10;       // 站内搜索每类（帖子 / 评论）最多翻几页（每页约 25 条）
  const SEARCH_MAX_IDS = 300;    // 站内搜索每类最多收多少条
  const RATE_MIN_COVERAGE = 0.8; // 查得到删除状态的内容不到这个比例时，不显示被删比例，只报条数
  const ITEM_BUDGET = 20;        // 批量查询被拒时，一轮采集最多逐个查多少个帖子
  const HIDDEN_RECHECK_DAYS = 7; // 确认过主页是隐藏的账号，隔多少天再去读一次主页（期间省掉这次请求）
  const FULL_SWEEP_DAYS = 7;     // 每个账号隔多少天把整个统计窗口重新完整翻一遍；期间每次只翻新的部分
  const FRESH_DAYS = 7;          // 发布多少天以内的内容每次都重新读（分数还在变）；更早的沿用之前的记录
  const STORE = {
    latest: 'rmc_latest', users: 'rmc_users', ui: 'rmc_ui',
    karma: 'rmc_karma_history', posts: 'rmc_post_obs', status: 'rmc_status_since', route: 'rmc_route',
  };
  const REMOVED = {
    moderator: '版主删除', automod_filtered: '自动过滤', deleted: '作者删除', author: '作者删除',
    reddit: '平台删除', anti_evil_ops: '平台删除', content_takedown: '平台删除',
    copyright_takedown: '平台删除', community_ops: '平台删除',
  };

  // ---------- 工具函数 ----------
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const isoSec = (ms) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');
  const mxDay = (ms) => new Date(ms - MX_OFFSET_MS).toISOString().slice(0, 10);
  const dayMs = (day) => Date.parse(day + 'T12:00:00Z');
  const pad = (n) => String(n).padStart(2, '0');
  const fmtDay = (day) => (day ? day.slice(5).replace('-', '/') : '');
  const fmtMx = (iso) => {
    if (!iso) return '';
    if (iso.length === 10) return fmtDay(iso);
    const d = new Date(Date.parse(iso) - MX_OFFSET_MS);
    return `${pad(d.getUTCMonth() + 1)}/${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
  };
  const ago = (iso) => {
    const m = (Date.now() - Date.parse(iso)) / 60000;
    if (m < 1) return '刚刚';
    if (m < 60) return Math.round(m) + ' 分钟前';
    if (m < 1440) return Math.round(m / 60) + ' 小时前';
    return Math.round(m / 1440) + ' 天前';
  };
  const fmtInt = (n) => (n === null || n === undefined || Number.isNaN(n) ? '—' : Math.round(n).toLocaleString('en-US'));
  const fmtSigned = (n) => (n === null || n === undefined ? '—' : (n > 0 ? '+' : n < 0 ? '−' : '') + Math.abs(Math.round(n)).toLocaleString('en-US'));
  const fmtPct = (x, digits = 1) => (x === null || x === undefined ? '—' : (x * 100).toFixed(digits) + '%');
  const fmt1 = (x) => (x === null || x === undefined ? '—' : x.toFixed(1));
  const sum = (xs, f) => xs.reduce((s, x) => s + (f(x) || 0), 0);
  const clip = (s, n) => {
    const t = String(s || '').replace(/\s+/g, ' ').trim();
    return t.length > n ? t.slice(0, n - 1) + '…' : t;
  };
  const VIEW = window.__RMC_VIEW || { store: {}, status: null };
  const load = (key, fallback) => {
    try { return JSON.parse(VIEW.store[key]) || fallback; } catch (e) { return fallback; }
  };
  const save = (key, value) => {
    try { VIEW.store[key] = JSON.stringify(value); return true; } catch (e) { return false; }
  };
  const lc = (s) => String(s || '').toLowerCase();
  const USERNAME_RE = /^[A-Za-z0-9_-]{3,20}$/;

  // 解析粘贴进来的名单：每行一个账号，可以是主页链接、「名称 + 链接」、Excel 两列或单独的用户名。
  // 用户名以链接为准，其余文字记成备注；认不出的行原样留下，方便修改后再加。
  function parseEntries(raw) {
    const entries = [];
    const problems = [];
    const bad = [];
    let dupes = 0;
    String(raw || '').split(/\r?\n/).forEach((line) => {
      const text = line.trim();
      if (!text) return;
      const link = text.match(/(?:https?:\/\/)?(?:[a-z]+\.)?reddit\.com\/(?:u|user)\/([A-Za-z0-9_-]+)\S*/i);
      let username = '';
      let label = '';
      if (link) {
        username = link[1];
        label = text.replace(link[0], ' ');
      } else {
        const parts = text.split(/[\t,，;；|]+|\s+/).map((p) => p.trim()).filter(Boolean);
        const cands = parts.filter((p) => USERNAME_RE.test(p.replace(/^\/?u\//i, '')));
        if (cands.length !== 1) {
          problems.push(`「${clip(text, 40)}」：${cands.length ? '看不出哪个是用户名' : '没找到用户名'}，请附上主页链接`);
          bad.push(text);
          return;
        }
        username = cands[0].replace(/^\/?u\//i, '');
        label = parts.filter((p) => p !== cands[0]).join(' ');
      }
      if (!USERNAME_RE.test(username)) {
        problems.push(`「${clip(text, 40)}」：用户名「${clip(username, 30)}」格式不对，应为 3–20 位字母、数字、_ 或 -`);
        bad.push(text);
        return;
      }
      label = label.replace(/[\t,，;；|]+/g, ' ').replace(/\s+/g, ' ').trim();
      if (lc(label.replace(/^\/?u\//i, '')) === lc(username)) label = '';
      else if (link && label && USERNAME_RE.test(label)) {
        problems.push(`名称「${label}」和链接里的用户名「${username}」不一致：已按链接里的用户名添加，名称记为备注`);
      }
      const dup = entries.find((e) => lc(e.username) === lc(username));
      if (dup) {
        dupes += 1;
        if (label && !dup.label) dup.label = label;
        return;
      }
      entries.push({ username, label });
    });
    return { entries, problems, bad, dupes };
  }
  // 名单存成 [{username, label}]；兼容早先只存用户名字符串的版本
  function userEntries() {
    const list = load(STORE.users, null) || DEFAULT_USERS;
    return list.map((x) => (typeof x === 'string' ? { username: x, label: '' } : { username: x.username, label: x.label || '' })).filter((e) => e.username);
  }
  const userList = () => userEntries().map((e) => e.username);

  // ---------- 采集 ----------
  // 诊断记录：每类请求各返回了什么状态码、搜索结果卡片的网页源码长什么样。
  // 随采集结果一起保存和导出；Reddit 再改接口或页面时，凭这份记录就能定位。
  const probe = { http: {}, samples: {}, notes: [] };
  const tally = (key, status) => { const k = probe.http[key] || (probe.http[key] = {}); k[status] = (k[status] || 0) + 1; };
  const endpointKey = (path) => (/\/about\.json/.test(path) ? '账号资料' : /\/overview\.json/.test(path) ? '个人主页' : /\/api\/me\.json/.test(path) ? '登录身份'
    : /\/api\/info/.test(path) ? '批量查询(www)' : /^\/comments\//.test(path) ? '单帖查询' : '其他');
  const BLOCK_RE = /blocked by network security/i; // Reddit 拦截页上的固定文字

  // ---------- 流量控制 ----------
  // 所有发往 Reddit 的请求都从这里排队出去，目的是不被限速、不被拦：
  //   1. 同时最多 FLOW.maxActive 个请求；同类请求之间留间隔，再加一点随机量，不做成机械的固定节拍；
  //   2. 读 Reddit 响应头里的剩余额度，额度变少时提前把请求摊开，不撞到 0；
  //   3. 收到 429（限速）：这一轮整体降速，所有请求一起等到 Reddit 说的时间（没说就等到额度重置，或 1–5 分钟），等完自动继续；
  //   4. 熔断：限速累计要等的时间太长，或者原本能用的接口中途被拦（403 拦截页），这一轮不再发任何请求，
  //      已经拿到的数据照常保存，没采到的账号沿用上次的数据。
  const FLOW = {
    maxActive: 2,                             // 同时最多几个请求在路上
    workers: 2,                               // 同时处理几个账号
    gap: { json: 700, html: 1500, gm: 700 },  // 同类请求两次发出之间的基础间隔（毫秒）；搜索页最重，留得最宽
    floor: 300,                               // 任意两次请求之间的最小间隔（毫秒）
    jitter: 0.4,                              // 每次间隔再随机加 0–40%
    lowQuota: 30,                             // Reddit 给的剩余额度低于这个数，就把请求摊开到额度重置
    maxSlow: 4,                               // 被限速后间隔最多放大到几倍
    limitWaits: [60, 120, 300],               // 被限速而 Reddit 没说要等多久时，依次等这么多秒再重试
    maxWaitS: 900,                            // 一轮里因为限速累计要等的时间超过这么多秒就停止，不无限等下去
    penaltyMin: 30,                           // 出过限速或拦截之后的这段时间内（分钟），下一轮从 1.5 倍间隔起步
    cooldownMin: 10,                          // 两次完整采集之间建议的最短间隔（分钟）
  };
  const newStats = () => ({ requests: 0, byKind: { json: 0, html: 0, gm: 0 }, limited: 0, waitS: 0, pausedMs: 0, startedAt: Date.now(), peak: 0 });
  const flow = { active: 0, waiters: [], gate: Promise.resolve(), last: {}, lastAny: 0, slow: 1, pauseUntil: 0, remaining: null, resetAt: 0, ok: new Set(), halted: '', stats: newStats() };
  const haltError = () => Object.assign(new Error(flow.halted || '采集已停止'), { halted: true });
  function halt(reason) {
    if (flow.halted) return;
    flow.halted = reason;
    probe.notes.push('采集提前停止 → ' + reason);
    flow.waiters.splice(0).forEach((wake) => wake());
  }
  // 新一轮采集开始：降速倍数、统计、熔断状态重新算；上一个请求的时间保留，保证和这一轮的第一个请求之间也留着间隔
  function resetFlow(slow) {
    Object.assign(flow, { slow, pauseUntil: 0, remaining: null, resetAt: 0, ok: new Set(), halted: '', stats: newStats() });
  }

  // 排队，等到可以发下一个请求时返回；拿到之后必须调用一次 release()。
  // onWait(秒)：需要长时间等待（被限速、额度用完）时用来更新界面上的倒计时。
  function take(kind, onWait) {
    const turn = flow.gate.then(async () => {
      while (flow.active >= FLOW.maxActive && !flow.halted) await new Promise((wake) => flow.waiters.push(wake));
      for (;;) {
        if (flow.halted) throw haltError();
        const now = Date.now();
        let until = flow.pauseUntil; // 被限速后的统一等待
        if (kind !== 'html' && flow.remaining !== null && flow.remaining <= 3 && flow.resetAt > now) until = Math.max(until, flow.resetAt + 1000); // 额度见底：等到重置
        if (until <= now) break;
        if (onWait) onWait(Math.ceil((until - now) / 1000));
        const step = Math.min(1000, until - now);
        flow.stats.pausedMs += step;
        await sleep(step);
      }
      let gap = FLOW.gap[kind] * flow.slow * (1 + Math.random() * FLOW.jitter);
      if (kind !== 'html' && flow.remaining !== null && flow.remaining < FLOW.lowQuota && flow.resetAt > Date.now()) {
        // 额度偏少：把剩下的额度平均摊到重置之前
        gap = Math.max(gap, Math.min((flow.resetAt - Date.now()) / Math.max(1, flow.remaining - 3), 15000));
      }
      const wait = Math.max((flow.last[kind] || 0) + gap, flow.lastAny + FLOW.floor * flow.slow) - Date.now();
      if (wait > 0) await sleep(wait);
      if (flow.halted) throw haltError();
      flow.last[kind] = flow.lastAny = Date.now();
      flow.active += 1;
      flow.stats.requests += 1;
      flow.stats.byKind[kind] = (flow.stats.byKind[kind] || 0) + 1;
      flow.stats.peak = Math.max(flow.stats.peak, flow.active);
    });
    flow.gate = turn.catch(() => {});
    return turn;
  }
  function release() {
    flow.active -= 1;
    const wake = flow.waiters.shift();
    if (wake) wake();
  }
  function readQuota(get) {
    const remaining = parseFloat(get('x-ratelimit-remaining'));
    const reset = parseFloat(get('x-ratelimit-reset'));
    if (!Number.isNaN(remaining)) flow.remaining = remaining;
    if (!Number.isNaN(reset)) flow.resetAt = Date.now() + reset * 1000;
  }
  // 收到 429（限速）。等多久：Reddit 在响应里说了就按它说的；没说而额度已经见底，就等到额度重置；都不是就依次等 1 / 2 / 5 分钟。
  // 所有请求一起等，界面上显示倒计时，等完自动继续。返回 true 表示等完可以重试这个请求。
  function limited(retryAfter, attempt) {
    const now = Date.now();
    flow.stats.limited += 1;
    flow.slow = Math.min(flow.slow * 1.5, FLOW.maxSlow);
    // 只有额度确实见底时才等到额度重置；额度还剩很多却被限速，说明限的不是这份额度，按预设的时间等
    const toReset = flow.remaining !== null && flow.remaining <= 3 && flow.resetAt > now ? (flow.resetAt - now) / 1000 + 2 : 0;
    const secs = retryAfter > 0 ? Math.min(retryAfter + 1, 900) : toReset > 0 && toReset <= 900 ? toReset : FLOW.limitWaits[Math.min(attempt, FLOW.limitWaits.length - 1)];
    const before = Math.max(flow.pauseUntil, now);
    flow.pauseUntil = Math.max(flow.pauseUntil, now + secs * 1000);
    flow.stats.waitS += Math.round((flow.pauseUntil - before) / 1000); // 两个请求同时被限速时不重复计
    if (flow.stats.waitS > FLOW.maxWaitS) { halt(`Reddit 持续限速，累计要等的时间已经超过 ${Math.round(FLOW.maxWaitS / 60)} 分钟`); throw haltError(); }
    return attempt < FLOW.limitWaits.length;
  }
  // 收到 Reddit 的拦截页。这一轮里这个接口之前是通的，说明是刚被拦：熔断。一开始就不通的接口（比如 www 上的批量查询）不算。
  function blockedNow(key) {
    if (flow.ok.has(key)) halt(`Reddit 开始拦截「${key}」`);
  }

  // 同源请求，自动带上登录 cookie。opts.noRetry：被限速时不等、不重试，直接报错（登录检查用，要尽快有答案）。
  async function getJson(path, onWait, opts = {}) {
    const key = endpointKey(path);
    const url = path.startsWith('/') ? location.origin + path : path;
    for (let attempt = 0; ; attempt++) {
      await take('json', onWait);
      let r = null;
      let data = null;
      let text = '';
      let fail = null;
      try {
        r = await fetch(url, { credentials: 'include', headers: { Accept: 'application/json' } });
        readQuota((h) => r.headers.get(h));
        tally(key, r.status);
        if (r.ok) data = await r.json(); else text = await r.text().catch(() => '');
      } catch (e) {
        fail = e;
      } finally {
        release();
      }
      if (fail) throw Object.assign(new Error(r ? '返回的不是数据' : '网络请求失败'), { status: r ? r.status : 0 });
      if (r.status === 429) {
        const retryAfter = parseFloat(r.headers.get('retry-after'));
        if (!opts.noRetry && limited(retryAfter, attempt)) continue;
        throw Object.assign(new Error('请求太频繁，Reddit 暂时拒绝'), { status: 429, retryAfter: retryAfter > 0 ? retryAfter : null });
      }
      if (!r.ok) {
        const blocked = BLOCK_RE.test(text);
        if (blocked) blockedNow(key);
        throw Object.assign(new Error('HTTP ' + r.status + (blocked ? '（Reddit 拦截了这个接口）' : '')), { status: r.status, blocked });
      }
      flow.ok.add(key);
      return data;
    }
  }

  // 按时间倒序翻页，拿到 since 之后的全部内容。overview 一次同时返回帖子和评论，
  // 比分开拉 submitted 和 comments 少一半请求；个人主页置顶的旧帖会被跳过。
  async function listing(user, since, onWait) {
    const out = [];
    out.raw = 0; // 主页一共返回了多少条（不论新旧）；0 条说明主页被隐藏或从没发过内容
    let after = null;
    for (let page = 0; page < MAX_PAGES; page++) {
      const q = new URLSearchParams({ limit: '100', sort: 'new', raw_json: '1' });
      if (after) q.set('after', after);
      const j = await getJson(`/user/${encodeURIComponent(user)}/overview.json?${q}`, onWait);
      const children = (j && j.data && j.data.children) || [];
      out.raw += children.length;
      children.forEach((c) => { if (c.data && c.data.created_utc * 1000 >= since) out.push(c); });
      after = j && j.data && j.data.after;
      const lastItem = children[children.length - 1];
      if (!after || !lastItem || lastItem.data.created_utc * 1000 < since) break;
    }
    return out;
  }

  // ---------- 站内搜索（新版搜索页） ----------
  // 主页隐藏只影响个人主页；内容在 Reddit 自己的搜索里仍然查得到，但要满足两点：
  //   1. 用新版搜索页 /search/?q=author:"用户名"，用户名必须带引号；旧的 search.json 接口从 2026 年 10 月起对所有登录用户返回 403；
  //   2. 帖子和评论是两个结果页（type=posts / type=comments），旧接口从来不返回评论。
  // 搜索页返回的是网页而不是 JSON：先直接请求并解析网页；请求被拒或解析不到结果时，改用隐藏的内嵌页面让 Reddit 自己渲染再读取。
  const sitePace = { fetchWorks: false, frameWorks: false, fetchDown: '', frameLock: Promise.resolve() };
  // Reddit 给搜索结果卡片用过的几种标记（不同版式并存）
  const UNIT_SEL = ['search-sdui-post', 'search-post-unit', 'search-post-with-content-preview', 'sdui-post-unit', 'search-sdui-comment-unit', 'search-comment-unit']
    .map((t) => `[data-testid="${t}"]`).join(', ');

  async function getHtml(path, key, onWait) {
    const url = path.startsWith('/') ? location.origin + path : path;
    for (let attempt = 0; ; attempt++) {
      await take('html', onWait);
      let r = null;
      let text = '';
      let fail = null;
      try {
        r = await fetch(url, { credentials: 'include', headers: { Accept: 'text/html' } });
        tally(key, r.status);
        text = await r.text();
      } catch (e) {
        fail = e;
      } finally {
        release();
      }
      if (fail) throw Object.assign(new Error('网络请求失败'), { status: 0 });
      if (r.status === 429) {
        if (limited(parseFloat(r.headers.get('retry-after')), attempt)) continue;
        throw Object.assign(new Error('请求太频繁，Reddit 暂时拒绝'), { status: 429 });
      }
      if (!r.ok) {
        const blocked = BLOCK_RE.test(text);
        if (blocked) blockedNow(key);
        throw Object.assign(new Error('HTTP ' + r.status + (blocked ? '（Reddit 拦截了搜索页）' : '')), { status: r.status, blocked });
      }
      let landed = '';
      try { landed = new URL(r.url || url, location.origin).pathname; } catch (e) { /* ignore */ }
      if (/\/login\/?$|\/account\/login/.test(landed)) throw Object.assign(new Error('被转到了登录页，请先登录 Reddit'), { status: 401 });
      flow.ok.add(key);
      return text;
    }
  }

  const fullId = (id, prefix) => { const t = String(id || ''); return /^t\d_/.test(t) ? t : t ? prefix + t : ''; };
  // 时间可能是秒、毫秒，或 Reddit 写法的日期（2026-11-10T12:34:56.789000+0000），统一成秒
  function toSec(v) {
    if (v === null || v === undefined || v === '') return null;
    let n;
    if (typeof v === 'number') n = v;
    else if (/^\d+(\.\d+)?$/.test(String(v))) n = Number(v);
    else {
      const m = String(v).trim().match(/^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2}(?::\d{2})?)(\.\d+)?\s*(Z|[+-]\d{2}:?\d{2})?$/i);
      if (m) {
        const tz = !m[4] || /^z$/i.test(m[4]) ? 'Z' : m[4].length === 5 ? m[4].slice(0, 3) + ':' + m[4].slice(3) : m[4];
        n = Date.parse(`${m[1]}T${m[2].length === 5 ? m[2] + ':00' : m[2]}${m[3] ? m[3].slice(0, 4) : ''}${tz}`);
      } else n = Date.parse(v);
    }
    if (!Number.isFinite(n) || n <= 0) return null;
    return n > 1e11 ? n / 1000 : n;
  }
  // 从帖子 / 评论链接里取 ID：/r/x/comments/<帖子>/<标题>/ ，/r/x/comments/<帖子>/comment/<评论>/ ，旧式 /r/x/comments/<帖子>/<标题>/<评论>/
  function idsFromHref(href) {
    const m = String(href || '').split(/[?#]/)[0].match(/\/comments\/([a-z0-9]+)((?:\/[^/]+)*)/i);
    if (!m) return null;
    const rest = m[2].split('/').filter(Boolean);
    let comment = '';
    if (rest[0] === 'comment' && rest[1]) comment = rest[1];
    else if (rest.length >= 2 && /^[a-z0-9]{5,10}$/i.test(rest[1])) comment = rest[1];
    return { post: m[1], comment };
  }
  // 在一块内容里找元素：除了普通子元素，也看 <template>（网页源码里还没展开的影子节点）和已经展开的影子节点
  function deepAll(root, sel, out = []) {
    if (!root || !root.querySelectorAll) return out;
    out.push(...root.querySelectorAll(sel));
    root.querySelectorAll('template').forEach((t) => deepAll(t.content, sel, out));
    root.querySelectorAll('*').forEach((el) => { if (el.shadowRoot) deepAll(el.shadowRoot, sel, out); });
    return out;
  }

  // 把一张搜索结果卡片读成一条记录（格式和 Reddit 接口返回的一致，多一个 _card 标记）。
  // 接口查得到时只用它的 ID；接口全部被拒时，看板就显示这里读到的标题、社区、时间和页面上的票数。读不出时间的返回 null。
  function cardRecord(card, ctx, id, isComment, name) {
    const o = ctx[isComment ? 'comment' : 'post'] || {};
    const p = ctx.post || {};
    const sr = ctx.subreddit || {};
    const id36 = id.slice(3);
    const hrefOf = (a) => String(a.getAttribute('href') || '').replace(/^https?:\/\/[^/]+/i, '').split(/[?#]/)[0];
    const textOf = (el) => String((el && el.textContent) || '').replace(/\s+/g, ' ').trim();
    const links = deepAll(card, 'a[href*="/comments/"]').map((a) => ({ a, x: idsFromHref(a.getAttribute('href')) })).filter((l) => l.x);
    const post36 = isComment ? (String(p.id || '').replace(/^t3_/i, '') || (links[0] ? links[0].x.post : '')) : id36;
    const postLinks = links.filter((l) => l.x.post === post36 && !l.x.comment);
    const ownLinks = isComment ? links.filter((l) => l.x.comment === id36) : postLinks;
    const anyPath = links[0] ? hrefOf(links[0].a) : '';
    const subreddit = String(sr.name || p.subreddit_name || (anyPath.match(/^\/r\/([^/]+)\//) || [])[1] || '').replace(/^r\//i, '');
    let permalink = ownLinks[0] ? hrefOf(ownLinks[0].a) : '';
    if (!permalink && subreddit && post36) permalink = isComment ? `/r/${subreddit}/comments/${post36}/comment/${id36}/` : `/r/${subreddit}/comments/${id36}/`;

    const marked = deepAll(card, '[data-testid*="title"], [id*="post-title"], [slot="title"]').map(textOf).find((t) => t.length > 1);
    const linked = postLinks.map((l) => textOf(l.a) || String(l.a.getAttribute('aria-label') || '').trim()).find((t) => t.length > 1);
    let slug = ((postLinks[0] ? hrefOf(postLinks[0].a) : '').match(/\/comments\/[a-z0-9]+\/([^/]+)\//i) || [])[1] || '';
    if (slug === 'comment') slug = '';
    const title = String(p.title || marked || linked || slug.replace(/_/g, ' ') || '');

    let body = '';
    let bodyEl = null;
    if (isComment) {
      const zone = card.matches('[data-testid*="comment-unit"]') ? card : card.querySelector('[data-testid*="comment-unit"]') || card;
      bodyEl = deepAll(zone, '[id*="rtjson"], [data-testid*="comment-content"], [data-testid*="comment-body"], .md, p')
        .map((el) => ({ el, t: textOf(el) })).sort((x, y) => y.t.length - x.t.length)[0] || null;
      body = bodyEl ? bodyEl.t : '';
      if (!body) body = title ? textOf(zone).split(title).join(' ').replace(/\s+/g, ' ').trim() : textOf(zone);
    }

    // 时间：评论卡片上可能同时有帖子和评论两个时间，评论一定更晚，取最晚的；帖子卡片取第一个
    const stamps = deepAll(card, 'faceplate-timeago[ts], time[datetime]').map((t) => toSec(t.getAttribute('ts') || t.getAttribute('datetime'))).filter(Boolean);
    const sec = toSec(o.created_timestamp || o.created_at || o.created) || (stamps.length ? (isComment ? Math.max(...stamps) : stamps[0]) : null);
    if (!sec) return null;

    // 票数和评论数：页面上按「票数、评论数」的顺序各放一个 <faceplate-number number="…">。
    // 评论卡片上还可能带着所在帖子的「票数、评论数」，所以只在分得清时才取：正文后面有 1 个（评论票数）或 3 个（评论票数 + 帖子的两个）数字时取第一个，否则留空。
    const numEls = deepAll(card, 'faceplate-number[number]').filter((n) => Number.isFinite(Number(n.getAttribute('number'))));
    const nums = numEls.map((n) => Number(n.getAttribute('number')));
    let score = typeof o.score === 'number' ? o.score : null;
    if (score === null && !isComment && nums.length) score = nums[0];
    if (score === null && isComment && bodyEl && bodyEl.el) {
      const after = numEls.filter((n) => bodyEl.el.compareDocumentPosition(n) & 4 /* 在正文之后 */ && !bodyEl.el.contains(n));
      if (after.length === 1 || after.length === 3) score = Number(after[0].getAttribute('number'));
    }
    const replies = isComment ? null : typeof p.number_comments === 'number' ? p.number_comments : typeof p.comment_count === 'number' ? p.comment_count : nums.length > 1 ? nums[1] : null;

    let media = '';
    if (!isComment) {
      const kind = String(p.type || p.post_type || '').toLowerCase();
      const has = (sel) => deepAll(card, sel).length > 0;
      media = /gallery/.test(kind) || has('gallery-carousel, [data-testid*="gallery"]') ? '图集'
        : /video|gif/.test(kind) || has('shreddit-player, shreddit-player-2, video') ? '视频'
          : /image/.test(kind) || has('img[src*="//preview.redd.it"], img[src*="//i.redd.it"], faceplate-img[src*="//preview.redd.it"], faceplate-img[src*="//i.redd.it"]') ? '图片' : '';
    }
    return { _card: true, _media: media, name: id, author: name, created_utc: sec, subreddit, title, body, score, num_comments: replies, permalink };
  }

  // 从一页搜索结果里收集内容。out: Map(ID → 卡片记录或 null)。返回新增条数、这一页各条结果的 ID 和发布时间（按页面顺序）、是否明确写着没有结果。
  // 已经翻过了统计窗口的判断：一页里大部分结果都早于 since（不用「有一条早于」，免得个别乱序的结果让翻页提前停下）
  const pastWindow = (times, since) => times.length > 0 && times.filter((t) => t * 1000 < since).length >= times.length * 0.6;
  function harvest(doc, type, name, out) {
    const isComment = type === 'comments';
    const prefix = isComment ? 't1_' : 't3_';
    const noun = isComment ? 'comment' : 'post';
    const idRe = new RegExp('^' + prefix + '[a-z0-9]+$', 'i');
    let added = 0;
    const put = (id, rec) => {
      if (!out.has(id)) { out.set(id, rec || null); added += 1; } else if (rec && !out.get(id)) out.set(id, rec);
    };

    // 1) 每条结果都包在带埋点信息的 <search-telemetry-tracker> 里，埋点里写着帖子 / 评论的 ID 和所在社区
    const groups = new Map(); // ID → { nodes, ctx }
    const idOf = new Map();
    doc.querySelectorAll('[data-faceplate-tracking-context]').forEach((n) => {
      const raw = n.getAttribute('data-faceplate-tracking-context') || '';
      if (raw.indexOf('"' + noun + '"') < 0) return;
      let ctx = null;
      try { ctx = JSON.parse(raw); } catch (e) { return; }
      const o = ctx && ctx[noun];
      if (!o || typeof o.id !== 'string') return;
      const id = fullId(o.id, prefix);
      if (!idRe.test(id)) return;
      // 只认搜索结果：推广内容、页面右侧的推荐栏不算
      if (ctx.promoted === true || o.promoted === true || (ctx.action_info && ctx.action_info.type === 'right_rail')) return;
      if (n.localName !== 'search-telemetry-tracker' && !n.closest('search-telemetry-tracker, ' + UNIT_SEL)) return;
      const g = groups.get(id) || { nodes: [], ctx: {} };
      g.nodes.push(n);
      // 同一条结果上里外几层埋点的信息合在一起（外层带社区，里层带类型），先出现的优先
      Object.keys(ctx).forEach((k) => { if (ctx[k] && typeof ctx[k] === 'object' && !Array.isArray(ctx[k])) g.ctx[k] = Object.assign({}, ctx[k], g.ctx[k]); });
      groups.set(id, g);
      idOf.set(n, id);
    });
    const times = []; // 这一页每条结果自己的发布时间（按页面顺序）
    const entries = []; // 这一页每条结果的 ID 和发布时间
    const idsIn = (el) => {
      const set = new Set();
      if (idOf.has(el)) set.add(idOf.get(el));
      el.querySelectorAll('[data-faceplate-tracking-context]').forEach((n) => { if (idOf.has(n)) set.add(idOf.get(n)); });
      return set;
    };
    const isContainer = (el) => !el || el === doc.body || el === doc.documentElement || /^(main|body|html|faceplate-partial|faceplate-batch|shreddit-feed|reddit-feed)$/.test(el.localName);
    const hasTime = (el) => deepAll(el, 'faceplate-timeago[ts], time[datetime]').length > 0;
    groups.forEach((g, id) => {
      // 卡片范围：最外层那个埋点元素（或带标记的卡片）；如果里面还没有时间，往上找几层，但不能把别的结果包进来
      let card = g.nodes[0];
      const unit = card.closest(UNIT_SEL);
      if (unit && unit.contains(card) && idsIn(unit).size === 1) card = unit;
      for (let up = 0; up < 4 && !hasTime(card); up++) {
        const parent = card.parentElement;
        if (isContainer(parent) || idsIn(parent).size !== 1) break;
        card = parent;
      }
      const rec = cardRecord(card, g.ctx, id, isComment, name);
      if (rec) times.push(rec.created_utc);
      entries.push({ id, t: rec ? rec.created_utc : null });
      put(id, rec);
      if (!probe.samples[type]) probe.samples[type] = String(card.outerHTML || '').replace(/\s+/g, ' ').slice(0, 4000);
    });

    // 2) 兜底：页面上完全没有埋点信息时（Reddit 改了格式），从结果卡片里的链接取 ID
    if (!groups.size) {
      doc.querySelectorAll(UNIT_SEL + ', search-telemetry-tracker').forEach((u) => {
        u.querySelectorAll('a[href*="/comments/"]').forEach((a) => {
          const x = idsFromHref(a.getAttribute('href'));
          if (!x) return;
          if (isComment) { if (x.comment) put(prefix + x.comment, null); } else if (!x.comment) put(prefix + x.post, null);
        });
      });
    }
    const main = doc.querySelector('main') || doc.body;
    const text = String((main && main.textContent) || '');
    const empty = !out.size && /couldn.t find any results|no (?:results|posts|comments) found|no results|sin resultados|nenhum resultado|没有找到|未找到/i.test(text);
    if (!out.size && !empty && !probe.samples[type + '_空页']) {
      probe.samples[type + '_空页'] = `标题：${clip(doc.title, 60)}；埋点元素 ${doc.querySelectorAll('[data-faceplate-tracking-context]').length} 个，结果卡片 ${doc.querySelectorAll(UNIT_SEL).length} 个，search-telemetry-tracker ${doc.querySelectorAll('search-telemetry-tracker').length} 个；正文开头：${clip(text, 300)}`;
    }
    return { added, times, entries, empty, blocked: !out.size && BLOCK_RE.test(text) };
  }

  const siteSearchPath = (name, type) => `/search/?${new URLSearchParams({ q: `author:"${name}"`, type, sort: 'new' })}`;
  // 翻页翻到「已经有数据的内容」就可以停：一页最后几条要么是已知的（个人主页已经给了，或上次采到过、这次会批量刷新），
  // 要么已经早于统计窗口。看最后 6 条、允许其中 1 条例外，免得个别乱序或不相干的结果影响判断。
  const tailKnown = (entries, known, since) => {
    if (!known || !known.size || !entries.length) return false;
    const tail = entries.slice(-Math.min(6, entries.length));
    return tail.filter((e) => !(known.has(e.id) || (e.t !== null && e.t * 1000 < since))).length <= (tail.length >= 4 ? 1 : 0);
  };

  // 方式一：直接请求搜索页并解析，顺着页面里的「下一页」地址往后翻
  async function siteSearchFetch(name, type, since, onWait, out, known) {
    let path = siteSearchPath(name, type);
    let empty = false;
    let capped = false;
    let stopped = false;
    const visited = new Set();
    for (let page = 0; page < SEARCH_PAGES && path && !visited.has(path); page++) {
      visited.add(path);
      let html;
      try { html = await getHtml(path, page ? '搜索翻页' : '搜索页', onWait); } catch (e) { if (page === 0 || e.halted) throw e; break; }
      const doc = new DOMParser().parseFromString(html, 'text/html');
      const res = harvest(doc, type, name, out);
      if (page === 0) {
        empty = res.empty;
        if (res.blocked) throw Object.assign(new Error('Reddit 拦截了搜索页'), { status: 403, blocked: true });
      }
      if (!res.added || pastWindow(res.times, since)) break;
      if (tailKnown(res.entries, known, since)) { stopped = true; break; }
      if (out.size >= SEARCH_MAX_IDS) { capped = true; break; }
      // 下一页的地址写在 <faceplate-partial src="/svc/shreddit/search/?…cursor=…"> 里，只认本站地址
      const next = [...doc.querySelectorAll('faceplate-partial[src]')]
        .map((el) => { try { return new URL(el.getAttribute('src'), location.origin); } catch (e) { return null; } })
        .find((u) => u && u.origin === location.origin && /^\/svc\/shreddit\/search(\/|$)/.test(u.pathname) && u.searchParams.get('cursor'));
      path = next ? next.pathname + next.search : null;
      if (path && page === SEARCH_PAGES - 1) capped = true; // 还有下一页，但已经翻到上限
    }
    return { empty, capped, stopped };
  }

  // 方式二：把搜索页放进一个看不见的内嵌页面，让 Reddit 自己渲染，往下滚动加载更多。
  // 内嵌页面必须在窗口范围内（只是透明、不可点），否则 Reddit 不会加载后面的结果。一次只开一个。
  function siteSearchFrame(name, type, since, onWait, out, known) {
    const run = async () => {
      await take('html', onWait); // 和其他请求一样排队、留间隔
      release();
      const f = document.createElement('iframe');
      f.setAttribute('aria-hidden', 'true');
      f.tabIndex = -1;
      f.style.cssText = 'position:fixed;left:0;top:0;width:100vw;height:100vh;border:0;opacity:0;pointer-events:none;z-index:-1;';
      const loaded = new Promise((resolve) => f.addEventListener('load', resolve, { once: true }));
      f.src = siteSearchPath(name, type);
      document.documentElement.appendChild(f);
      tally('搜索页(内嵌)', 'opened');
      try {
        await Promise.race([loaded, sleep(15000)]);
        const deadline = Date.now() + 45000;
        let idle = 0;
        let stopped = false;
        while (Date.now() < deadline && idle < 3 && out.size < SEARCH_MAX_IDS && !flow.halted) {
          let doc = null;
          try { doc = f.contentDocument; } catch (e) { break; }
          if (!doc || !doc.documentElement) { idle += 1; await sleep(800); continue; }
          const res = harvest(doc, type, name, out);
          if (res.blocked) throw Object.assign(new Error('Reddit 拦截了搜索页'), { status: 403, blocked: true });
          if (pastWindow(res.times.slice(-20), since) || (res.empty && !out.size)) break;
          if (tailKnown(res.entries, known, since)) { stopped = true; break; }
          idle = res.added ? 0 : idle + 1;
          try { f.contentWindow.scrollTo(0, doc.documentElement.scrollHeight); } catch (e) { /* ignore */ }
          await sleep(res.added ? 1200 : 2000);
        }
        return { stopped, capped: out.size >= SEARCH_MAX_IDS || (Date.now() >= deadline && idle === 0) };
      } finally {
        f.remove();
      }
    };
    const p = sitePace.frameLock.then(run, run);
    sitePace.frameLock = p.catch(() => {});
    return p;
  }

  // 返回 { ids: Map, via: 'fetch' | 'frame', capped, stopped }。
  // capped：内容多到没翻完，只拿到最新的一部分；stopped：翻到已知内容就停了（更早的沿用已有记录）。
  // 哪种方式走得通会记住，这一轮后面的账号不再重复试错。
  async function siteSearch(name, type, since, onWait, known) {
    const ids = new Map();
    let fetchErr = null;
    let fetchTried = false;
    if (!sitePace.fetchDown) {
      try {
        fetchTried = true;
        const res = await siteSearchFetch(name, type, since, onWait, ids, known);
        if (ids.size) { sitePace.fetchWorks = true; return { ids, via: 'fetch', capped: res.capped, stopped: res.stopped }; }
        if (sitePace.fetchWorks || res.empty) return { ids, via: 'fetch', capped: false, stopped: false }; // 直接请求走得通，这个账号就是没有结果
      } catch (e) {
        if (e.halted) throw e;
        fetchErr = e;
        // 被拒绝（403 / 401 / 拦截页）：这一轮后面都不再直接请求，改用内嵌页面
        if (e.status === 403 || e.status === 401 || e.blocked) sitePace.fetchDown = e.message;
      }
    }
    let frame;
    try {
      frame = await siteSearchFrame(name, type, since, onWait, ids, known);
    } catch (e) {
      if (e.halted) throw e;
      // 直接请求和内嵌页面都被拦：搜索页整个不可用了，继续查其他账号只会加重拦截
      if (e.blocked) { halt('Reddit 拦截了搜索页（直接请求和内嵌页面都被拒）'); throw haltError(); }
      throw fetchErr || e;
    }
    if (ids.size) {
      sitePace.frameWorks = true;
      // 同一个搜索，直接请求拿到的网页里没有结果、内嵌页面里有：说明结果是页面脚本后填的，这一轮不用再直接请求
      if (fetchTried && !fetchErr && !sitePace.fetchWorks) sitePace.fetchDown = '直接请求拿到的网页里没有结果';
    } else if (fetchErr) throw fetchErr; // 两种方式都没读到内容，把直接请求的错误报出来
    return { ids, via: 'frame', capped: frame.capped, stopped: frame.stopped };
  }

  // ---------- 向 Reddit 查最新数据 ----------
  // 批量查询接口（/api/info）在 www.reddit.com 上从 2026 年 10 月起返回 403，但同一个接口在 api.reddit.com 和 old.reddit.com 上可能还能用。
  // 三条路按顺序试，哪条走得通就记住（下次采集先走它）；被拒绝的这一轮不再试。全部被拒时返回空，由调用方改用搜索页上的数据，
  // 并记下时间：24 小时内不再试探，免得反复去撞已经拒绝的接口。
  const INFO_ROUTES = ['api', 'old', 'www'];
  const INFO_HOST = { api: 'api.reddit.com', old: 'old.reddit.com', www: 'www.reddit.com' };
  const infoPace = { order: INFO_ROUTES.slice(), dead: {}, ok: null, budget: 0, itemDead: '', premarked: false };

  async function gmRedditJson(url, key, onWait) {
    for (let attempt = 0; ; attempt++) {
      await take('gm', onWait);
      let r = null;
      let fail = null;
      try { r = await gmGet(url); } catch (e) { fail = e; } finally { release(); }
      if (fail) throw fail; // 连不上（transport）或超时
      tally(key, r.status);
      const header = (h) => { const m = String(r.headers || '').match(new RegExp('^' + h + ':\\s*(.+)$', 'im')); return m ? m[1].trim() : null; };
      readQuota(header);
      if (r.status === 429) {
        if (limited(parseFloat(header('retry-after')), attempt)) continue;
        throw Object.assign(new Error('请求太频繁，Reddit 暂时拒绝'), { status: 429 });
      }
      let j = null;
      try { j = JSON.parse(r.text); } catch (e) { /* 下面统一处理 */ }
      if (r.status === 200 && j && j.data && Array.isArray(j.data.children)) { flow.ok.add(key); return j; }
      const blocked = BLOCK_RE.test(r.text || '');
      if (blocked) blockedNow(key);
      // 状态 200 但不是数据（登录页、拦截页）一样算被拒
      throw Object.assign(new Error(r.status === 200 ? '返回的不是数据' : 'HTTP ' + r.status), { status: r.status === 200 ? 403 : r.status, blocked });
    }
  }

  function infoFetch(via, ids, onWait) {
    const q = `raw_json=1&id=${ids.join(',')}`;
    if (via === 'www') return getJson(`/api/info.json?${q}`, onWait);
    return gmRedditJson(via === 'api' ? `https://api.reddit.com/api/info?${q}` : `https://old.reddit.com/api/info.json?${q}`, `批量查询(${via})`, onWait);
  }

  // 批量查询全部被拒时的兜底：逐个读帖子自己的数据（每帖一次请求，所以只查最近的少量帖子）
  async function itemLookup(id, onWait) {
    const j = await getJson(`/comments/${id.slice(3)}.json?raw_json=1&limit=1`, onWait);
    const c = Array.isArray(j) && j[0] && j[0].data && j[0].data.children && j[0].data.children[0];
    return c && c.kind === 't3' ? c : null;
  }

  // ---------- 公开存档 ----------
  // 存档在 Reddit 之外，不占 Reddit 的请求额度。优先用 Tampermonkey 的跨域请求；
  // 它不可用或被拒绝时，改用普通请求（存档允许任何网站直接读取）。
  const archivePace = { last: 0, via: null, gmDown: '', fetchDown: '' };
  const transportError = (msg) => Object.assign(new Error(msg), { transport: true });

  function gmGet(url) {
    return new Promise((resolve, reject) => {
      if (typeof GM_xmlhttpRequest !== 'function') { reject(transportError('脚本没有跨域请求权限')); return; }
      let done = false;
      const finish = (fn, v) => { if (!done) { done = true; clearTimeout(guard); fn(v); } };
      // Tampermonkey 等待用户授权时可能一直不回调，到时间就放弃这条路
      const guard = setTimeout(() => { try { req && req.abort && req.abort(); } catch (e) { /* ignore */ } finish(reject, transportError('跨域请求没有响应')); }, 50000);
      let req = null;
      try {
        req = GM_xmlhttpRequest({
          method: 'GET', url, timeout: 45000, headers: { Accept: 'application/json' },
          onload: (r) => finish(resolve, { status: r.status, text: r.responseText, headers: r.responseHeaders || '' }),
          onerror: () => finish(reject, transportError('跨域请求被拒绝或连不上')),
          onabort: () => finish(reject, transportError('跨域请求被中止')),
          ontimeout: () => finish(reject, Object.assign(new Error('存档响应超时'), { retry: true })),
        });
      } catch (e) {
        finish(reject, transportError('跨域请求出错：' + e.message));
      }
    });
  }

  async function pageGet(url) {
    const ctl = typeof AbortController === 'function' ? new AbortController() : null;
    const t = ctl ? setTimeout(() => ctl.abort(), 45000) : null;
    try {
      const r = await fetch(url, { headers: { Accept: 'application/json' }, credentials: 'omit', signal: ctl ? ctl.signal : undefined });
      return { status: r.status, text: await r.text() };
    } catch (e) {
      if (ctl && ctl.signal.aborted) throw Object.assign(new Error('存档响应超时'), { retry: true });
      throw transportError('连不上存档');
    } finally {
      if (t) clearTimeout(t);
    }
  }

  // 记住哪条路走不通（gmDown / fetchDown），这一轮采集里不再反复尝试
  async function archiveSend(url) {
    for (const [via, send, down] of [['gm', gmGet, 'gmDown'], ['fetch', pageGet, 'fetchDown']]) {
      if (archivePace[down]) continue;
      try {
        const r = await send(url);
        archivePace.via = via;
        return r;
      } catch (e) {
        if (!e.transport) throw e;
        if (archivePace.via === via) throw Object.assign(e, { retry: true }); // 之前走得通，多半是临时网络问题
        archivePace[down] = e.message;
      }
    }
    throw new Error(`连不上存档（Tampermonkey 跨域请求：${archivePace.gmDown}；直接请求：${archivePace.fetchDown}）`);
  }

  // 存档忙的时候会回 422「Timeout. Maybe slow down a bit」，等几秒重试通常就好
  async function archiveJson(url) {
    const waits = [2, 5, 10, 20];
    for (let attempt = 0; ; attempt++) {
      const wait = archivePace.last + 400 - Date.now();
      if (wait > 0) await sleep(wait);
      archivePace.last = Date.now();
      let r;
      try {
        r = await archiveSend(url);
      } catch (e) {
        if (e.retry && attempt < waits.length) { await sleep(waits[attempt] * 1000); continue; }
        throw e;
      }
      let j = null;
      try { j = JSON.parse(r.text); } catch (e) { /* 下面统一处理 */ }
      if (r.status === 200 && j && Array.isArray(j.data)) return j;
      const busy = r.status === 422 || r.status === 429 || r.status >= 500 || (r.status === 200 && j && j.error);
      if (busy && attempt < waits.length) { await sleep(waits[attempt] * 1000); continue; }
      if (r.status === 200 && !j) throw new Error('存档返回的不是 JSON');
      throw new Error('HTTP ' + r.status + (j && j.error ? '：' + clip(String(j.error), 60) : ''));
    }
  }

  // 按时间倒序翻页，拿到 afterSec 之后这个作者的全部帖子或评论
  async function archiveList(kind, name, afterSec) {
    const records = [];
    let before = null;
    for (let page = 0; page < ARCHIVE_PAGES; page++) {
      const q = new URLSearchParams({ author: name, after: String(afterSec), limit: '100', sort: 'desc' });
      if (before) q.set('before', String(before));
      let j;
      try {
        j = await archiveJson(`${ARCHIVE}/api/${kind}/search?${q}`);
      } catch (e) {
        return { records, error: e };
      }
      records.push(...j.data);
      if (j.data.length < 100) break;
      const oldest = Math.min(...j.data.map((d) => d.created_utc || Infinity));
      if (!Number.isFinite(oldest) || (before && oldest >= before)) break;
      before = Math.floor(oldest);
    }
    return { records, error: null };
  }

  // 上次采到的一条记录，转成和搜索卡片记录同样的格式。只在「这次没重新查到、又刷新不了」时沿用。
  const storedRec = (i) => ({
    _card: true, _media: i.media || '', _removed: i.removed === undefined ? null : i.removed, _ratio: i.upvote_ratio ?? null,
    name: i.id, author: i.username, created_utc: Date.parse(i.created) / 1000, subreddit: String(i.subreddit || '').replace(/^r\//i, ''),
    title: i.text, body: i.text, score: i.score, num_comments: i.replies, permalink: i.permalink,
  });

  // 从站内搜索、公开存档和以前采到的记录里找出这个账号近期内容的 ID。
  // 返回 Map(ID → { via, rec, stored })，rec 是搜索页、存档或上次采到的数据，向 Reddit 查不到最新值时用它兜底。
  // ctx.known：已经有数据的 ID（翻页翻到这些就停）；ctx.prev：上次采到的这个账号的记录。
  async function discover(name, since, onWait, diag, ctx) {
    const found = new Map();
    const add = (id, via, rec, stored) => {
      if (!id) return;
      const f = found.get(id);
      if (!f) found.set(id, { via, rec: rec || null, stored: !!(rec && stored) });
      else if (rec && !f.rec) { f.rec = rec; f.stored = !!stored; }
    };
    // 新版站内搜索：帖子和评论各查一遍（隐藏主页的账号主要靠这一路）
    for (const [type, key, label] of [['posts', 'site_posts', '帖子'], ['comments', 'site_comments', '评论']]) {
      ctx.step(type === 'posts' ? '搜索帖子' : '搜索评论', type === 'posts' ? 0.15 : 0.5);
      try {
        const res = await siteSearch(name, type, since, onWait, ctx.known);
        res.ids.forEach((rec, id) => add(id, 'search', rec));
        diag[key] = res.ids.size;
        if (res.via) diag.site_via = res.via;
        // 这次翻到了多早：scan = full（整个统计窗口翻完了）/ partial（翻到已知内容或上限就停了），reach = 翻到的最早一条的时间
        const times = [...res.ids.values()].filter(Boolean).map((r) => r.created_utc);
        diag.scan[type] = res.stopped || res.capped ? 'partial' : 'full';
        diag.reach[type] = times.length ? Math.min(...times) : null;
        if (res.capped) diag.errors.push(`${label}太多，站内搜索只翻到最新的 ${res.ids.size} 条，更早的沿用之前的记录`);
        const had = ctx.prev.filter((i) => (i.kind === '帖子') === (type === 'posts')).length;
        if (!res.ids.size && had) {
          // 上次还有内容、这次一条都没搜到：更像是搜索临时没返回，而不是内容全没了。沿用上次的记录，并报出来。
          diag.scan[type] = 'failed';
          diag.errors.push(`站内搜索这次没有返回${label}（上次有 ${had} 条），沿用上次的记录`);
        }
      } catch (e) {
        if (e.halted) throw e;
        diag.scan[type] = 'failed';
        diag.errors.push(`站内搜索${label}：${e.message}`);
      }
    }
    ctx.step('查最新分数', 0.85);
    // 公开存档（补充来源）：上次连不上的话 24 小时内直接跳过
    if (archivePace.premarked) {
      diag.archive_skipped = true;
    } else {
      const afterSec = Math.floor(since / 1000);
      for (const [kind, prefix, key] of [['posts', 't3_', 'archive_posts'], ['comments', 't1_', 'archive_comments']]) {
        const { records, error } = await archiveList(kind, name, afterSec);
        records.forEach((d) => {
          if (d && lc(d.author) === lc(name)) add(d.name || (d.id ? prefix + d.id : ''), 'archive', d);
        });
        diag[key] = records.length;
        if (error) diag.errors.push(`存档${kind === 'posts' ? '帖子' : '评论'}：${error.message}${records.length ? `（已拿到 ${records.length} 条）` : ''}`);
      }
      diag.archive_via = archivePace.via;
    }
    ctx.prev.forEach((i) => add(i.id, i.via === 'profile' ? 'history' : i.via || 'history', storedRec(i), true));
    return found;
  }

  // 按 ID 批量向 Reddit 查最新数据，一次最多 100 个；某一批失败不影响其他批。
  // 返回 { rows, covered }：covered 是成功查过的那些批里的 ID（查过但 Reddit 没返回的，说明内容已经不在了）。
  async function lookup(ids, onWait, diag) {
    const rows = [];
    const covered = new Set();
    for (let i = 0; i < ids.length; i += 100) {
      const batch = ids.slice(i, i + 100);
      let got = null;
      let soft = null;
      for (const via of infoPace.order.slice()) {
        if (infoPace.dead[via]) continue;
        try {
          const j = await infoFetch(via, batch, onWait);
          got = (j && j.data && j.data.children) || [];
          infoPace.ok = via;
          infoPace.order = [via, ...infoPace.order.filter((v) => v !== via)];
          break;
        } catch (e) {
          if (e.halted) throw e;
          // 被拒绝（403 / 401）或根本连不上：这条路这一轮不再试；超时之类的临时问题只影响这一批
          if (e.status === 403 || e.status === 401 || e.transport) infoPace.dead[via] = e.message;
          else soft = `${INFO_HOST[via]}：${e.message}`;
        }
      }
      if (got) { rows.push(...got); batch.forEach((id) => covered.add(id)); continue; }
      if (infoPace.order.every((v) => infoPace.dead[v])) { diag.info_blocked = true; break; }
      if (soft) diag.errors.push('向 Reddit 查最新数据：' + soft);
    }
    diag.info_via = infoPace.ok;
    return { rows, covered };
  }

  const postRemoved = (d) => (d.removed_by_category ? REMOVED[d.removed_by_category] || '已删除' : d.selftext === '[removed]' ? '已删除' : '');
  const commentRemoved = (d) => (d.body === '[removed]' ? '已删除' : d.body === '[deleted]' ? '作者删除' : '');
  // 头像地址只认 Reddit 自己的图片域名
  const safeImg = (u) => {
    try {
      const x = new URL(String(u || ''));
      return x.protocol === 'https:' && /(^|\.)(redditmedia\.com|redd\.it|redditstatic\.com)$/.test(x.hostname) ? x.href : '';
    } catch (e) { return ''; }
  };

  // run：这一轮采集共用的东西 { prevItems, prevAccounts, route, batchOk, accountsLeft(), step(账号, 步骤, 完成比例) }
  async function collectUser(name, now, onWait, run) {
    const since = now - WINDOW_DAYS * 864e5;
    const key = lc(name);
    const step = (label, frac) => run.step(name, label, frac);
    step('读取资料', 0.02);
    const account = {
      username: name, created: null, status: '正常', status_since: null,
      link_karma: null, comment_karma: null, total_karma: null, verified_email: null, note: '', profile: null,
    };
    // 每一路来源各拿到多少条、哪里出了错，显示在账号详情里，方便排查
    const diag = {
      profile: null, profile_skipped: false, site_posts: null, site_comments: null, site_via: null, quick: false,
      scan: { posts: null, comments: null }, reach: { posts: null, comments: null },
      archive_posts: null, archive_comments: null, archive_via: null, archive_skipped: false,
      info_via: null, info_blocked: false, item_lookups: 0, refreshed: 0, cached: 0, carried: 0, vanished: 0, no_time: 0, errors: [],
    };
    account.diag = diag;
    let about = null;
    try {
      about = await getJson(`/user/${encodeURIComponent(name)}/about.json?raw_json=1`, onWait);
    } catch (e) {
      if (e.halted) throw e;
      if (e.status === 404) {
        account.status = '疑似 shadowban';
        account.note = '主页返回 404：可能是 shadowban，也可能是账号已注销';
        return { account, items: [] };
      }
      account.status = '查询失败';
      diag.errors.push('账号资料：' + e.message);
    }
    const d = (about && about.data) || {};
    if (d.is_suspended) {
      account.status = '已封禁';
      account.note = '主页显示账号已被封禁';
      return { account, items: [] };
    }
    if (about) {
      const sub = d.subreddit || {};
      account.created = d.created_utc ? isoSec(d.created_utc * 1000).slice(0, 10) : null;
      account.link_karma = d.link_karma ?? null;
      account.comment_karma = d.comment_karma ?? null;
      account.total_karma = d.total_karma ?? ((d.link_karma || 0) + (d.comment_karma || 0));
      account.verified_email = d.has_verified_email ?? null;
      // 个人资料：主页上公开展示的那些信息
      account.profile = {
        display: clip(sub.title || '', 60),
        bio: clip(sub.public_description || '', 300),
        avatar: safeImg(d.icon_img) || safeImg(sub.icon_img) || safeImg(d.snoovatar_img),
        followers: typeof sub.subscribers === 'number' ? sub.subscribers : null,
        is_mod: !!d.is_mod, premium: !!d.is_gold, employee: !!d.is_employee, nsfw: !!sub.over_18,
        awardee_karma: d.awardee_karma ?? null, awarder_karma: d.awarder_karma ?? null,
      };
    }

    const items = [];
    const seen = new Set();
    const toItem = ({ kind, data: d }, via) => {
      if (!d || !d.created_utc || d.created_utc * 1000 < since) return false;
      const id = d.name || (d.id ? kind + '_' + d.id : '');
      if (!id || seen.has(id)) return false;
      // 别人的内容不收（搜索偶尔会带出不相干的结果）；作者显示为 [deleted] 的是自己删掉的，保留
      if (via !== 'profile' && d.author && d.author !== '[deleted]' && lc(d.author) !== lc(name)) return false;
      // d._card：这条不是接口返回的，而是搜索页卡片或上次的记录——删除状态、好评率只有记录里带着才有
      const cardRemoved = d._removed === undefined ? null : d._removed;
      if (kind === 't3') {
        const media = d.is_gallery ? '图集'
          : d.is_video || /video/.test(d.post_hint || '') || /(^|\.)v\.redd\.it$/.test(d.domain || '') ? '视频'
            : d.post_hint === 'image' || /(^|\.)i\.redd\.it$/.test(d.domain || '') || /\.(jpe?g|png|gif|webp)$/i.test(String(d.url || '').split('?')[0]) ? '图片' : '';
        items.push({
          id, username: name, kind: '帖子', subreddit: d.subreddit_name_prefixed || (d.subreddit ? 'r/' + d.subreddit : ''),
          created: isoSec(d.created_utc * 1000), text: clip(d.title, 200) || '（标题没读到）', score: typeof d.score === 'number' ? d.score : null,
          replies: d.num_comments ?? null, upvote_ratio: d.upvote_ratio ?? d._ratio ?? null,
          removed: d._card ? cardRemoved : postRemoved(d), permalink: d.permalink, via, media: d._card ? d._media || '' : media,
        });
      } else if (kind === 't1') {
        items.push({
          id, username: name, kind: '评论', subreddit: d.subreddit_name_prefixed || (d.subreddit ? 'r/' + d.subreddit : ''),
          created: isoSec(d.created_utc * 1000), text: clip(d.body, 160) || '（评论内容没读到）', score: typeof d.score === 'number' ? d.score : null,
          replies: null, upvote_ratio: null, removed: d._card ? cardRemoved : commentRemoved(d), permalink: d.permalink, via, media: '',
        });
      } else {
        return false;
      }
      seen.add(id);
      return true;
    };

    // 1. 个人主页（主页公开时最全、最快）。上次确认过主页是隐藏的，HIDDEN_RECHECK_DAYS 天内不再重复读，省一次请求。
    step('读取主页', 0.08);
    const hiddenAt = run.route.hidden[key] || 0;
    if (hiddenAt && now - hiddenAt < HIDDEN_RECHECK_DAYS * 864e5) {
      account.profile_hidden = true;
      diag.profile_skipped = true;
    } else {
      let profileRaw = 0;
      let listed = false;
      try {
        const profile = await listing(name, since, onWait);
        profileRaw = profile.raw;
        listed = true;
        profile.forEach((c) => toItem(c, 'profile'));
        diag.profile = profile.length;
      } catch (e) {
        if (e.halted) throw e;
        // 403 / 404 就是主页不让看，内容照样从下面几路找，不算出错
        if (e.status !== 403 && e.status !== 404) diag.errors.push('个人主页：' + e.message);
      }
      account.profile_hidden = profileRaw === 0;
      if (listed && profileRaw === 0) run.route.hidden[key] = now; else delete run.route.hidden[key];
    }

    // 2. 站内搜索（和公开存档）。这是最花时间的一步，所以只翻需要翻的部分——翻到「已经有数据的内容」就停：
    //    · 个人主页已经给了的；
    //    · 这个账号近 FULL_SWEEP_DAYS 天内完整翻过一遍的话：批量查询走得通时，上次采到过的全部内容（第 3 步会一次性刷新它们）；
    //      批量查询走不通时，上次采到过、发布已超过 FRESH_DAYS 天的内容（分数基本不再变，沿用之前的记录）。
    //    第一次采集、或距离上次完整翻页超过 FULL_SWEEP_DAYS 天，就把整个统计窗口重新翻一遍。
    const prevMine = run.prevItems.filter((i) => lc(i.username) === key && Date.parse(i.created) >= since);
    const prevAcct = run.prevAccounts.get(key);
    const fullAt = prevAcct && prevAcct.full_at ? Date.parse(prevAcct.full_at) : 0;
    diag.quick = fullAt > 0 && now - fullAt < FULL_SWEEP_DAYS * 864e5;
    const freshFrom = now - FRESH_DAYS * 864e5;
    const known = new Set(seen);
    if (diag.quick) prevMine.forEach((i) => { if (run.batchOk || Date.parse(i.created) < freshFrom) known.add(i.id); });
    const found = await discover(name, since, onWait, diag, { known, prev: prevMine, step });
    // 两类都把整个窗口翻完了：记下这次完整翻页的时间
    account.full_at = diag.scan.posts === 'full' && diag.scan.comments === 'full' ? isoSec(now) : (prevAcct && prevAcct.full_at) || null;
    const need = [...found.keys()].filter((id) => !seen.has(id));

    // 3. 主页没有的，向 Reddit 批量查最新分数、评论数和删除状态
    const answered = new Set(); // Reddit 回了数据的 ID：即使被判定为不该收（比如其实是别人的内容），也不再用兜底数据补
    const { rows, covered } = await lookup(need, onWait, diag);
    rows.forEach((c) => {
      const f = found.get(c.data && c.data.name);
      if (c.data && c.data.name) answered.add(c.data.name);
      if (toItem(c, f ? f.via : 'archive')) diag.refreshed += 1;
    });

    // 3b. 批量查询三条路都被拒时：最近 7 天的帖子逐个查（有限额），拿到准确的分数、好评率和删除状态
    if (diag.info_blocked && !infoPace.itemDead && infoPace.budget > 0) {
      const quota = Math.min(infoPace.budget, Math.max(2, Math.ceil(infoPace.budget / Math.max(1, run.accountsLeft()))));
      const recent = need.filter((id) => id.startsWith('t3_') && !seen.has(id) && !answered.has(id) && found.get(id).via === 'search')
        .map((id) => ({ id, rec: found.get(id).rec }))
        .filter((x) => !x.rec || x.rec.created_utc * 1000 >= now - TRACK_HOURS * 36e5) // 读不出时间的也查：搜索按时间倒序，排前面的就是最新的
        .slice(0, quota);
      for (const x of recent) {
        infoPace.budget -= 1;
        try {
          const c = await itemLookup(x.id, onWait);
          if (!c) continue;
          answered.add(x.id);
          diag.item_lookups += 1;
          if (toItem(c, 'search')) diag.refreshed += 1;
        } catch (e) {
          if (e.halted) throw e;
          if (e.status === 403 || e.status === 401) { infoPace.itemDead = e.message; break; }
        }
      }
    }

    // 4. Reddit 没返回最新数据的，用手头的数据兜底：
    //    · 搜索页卡片 / 存档里的数据（分数可能不是最新）；
    //    · 上次采到、这次没重新看到的记录：
    //        批量查过而 Reddit 没返回 → 内容已经不在了，不保留；
    //        这一类搜索失败了 → 全部沿用；
    //        比这次翻到的最早一条还早（翻页提前停了，没翻到那里）→ 沿用；
    //        在这次翻到的范围之内却没出现 → 不保留，记一笔「从搜索里消失」（可能被删了）。
    step('整理', 0.95);
    need.forEach((id) => {
      const f = found.get(id);
      if (seen.has(id) || answered.has(id) || !f || !f.rec) return;
      const data = { kind: id.slice(0, 2), data: f.rec };
      if (f.stored) {
        if (covered.has(id)) return;
        const type = id.startsWith('t1_') ? 'comments' : 'posts';
        const scan = diag.scan[type];
        const reach = diag.reach[type];
        const beyond = scan === 'partial' && reach !== null && f.rec.created_utc <= reach + 60; // 和最早一条同一时刻的也算没翻到（同一秒的两条可能正好被翻页隔开）
        if (scan === 'failed' || beyond) { if (toItem(data, 'history-cache')) diag.carried += 1; } else if (scan) diag.vanished += 1;
        return;
      }
      if (toItem(data, f.via === 'search' ? 'search-cache' : 'archive-cache')) diag.cached += 1;
    });

    // 搜索页找到了、但既查不到接口数据又读不出时间的，没法放进看板：记下来并报出来，不能悄悄少算
    diag.no_time = diag.info_blocked ? need.filter((id) => !seen.has(id) && !answered.has(id) && found.get(id).via === 'search' && !found.get(id).rec).length : 0;
    if (diag.no_time) diag.errors.push(`站内搜索找到的内容里有 ${diag.no_time} 条读不出发布时间，没有计入`);
    account.recovered = items.filter((i) => i.via !== 'profile').length;
    diag.errors = [...new Set(diag.errors)];
    const lead = account.profile_hidden ? '主页已隐藏，' : '';
    // 公开存档只是补充来源：站内搜索两路都走通时，存档连不上不算问题，不打扰看板
    const siteOk = diag.site_posts !== null && diag.site_comments !== null;
    diag.minor = siteOk ? diag.errors.filter((e) => e.startsWith('存档')) : [];
    const real = diag.errors.filter((e) => !diag.minor.includes(e));
    if (real.length) account.note = lead + '部分来源没查到（' + real.join('；') + '）';
    return { account, items };
  }

  // 本机历史：karma 每日快照、帖子分数快照、异常状态首次发现日期
  function recordHistory(now, accounts, items) {
    const day = mxDay(now);
    const karma = load(STORE.karma, {});
    const status = load(STORE.status, {});
    accounts.forEach((a) => {
      if (typeof a.total_karma === 'number') {
        karma[a.username] = karma[a.username] || {};
        karma[a.username][day] = a.total_karma;
      }
      if (a.status === '正常') delete status[a.username];
      else if (!status[a.username] || status[a.username].status !== a.status) status[a.username] = { status: a.status, since: day };
      a.status_since = status[a.username] ? status[a.username].since : null;
    });
    const obs = load(STORE.posts, {});
    items.filter((i) => i.kind === '帖子').forEach((p) => {
      const ageH = (now - Date.parse(p.created)) / 36e5;
      if (ageH > TRACK_HOURS || typeof p.score !== 'number' || p.via === 'history-cache') return;
      const o = obs[p.id] || (obs[p.id] = { username: p.username, subreddit: p.subreddit, created: p.created, points: {} });
      o.title = p.text;
      o.removed = p.removed;
      o.points[(Math.round(ageH * 10) / 10).toFixed(1)] = p.score;
    });
    Object.keys(obs).forEach((id) => { if (now - Date.parse(obs[id].created) > 14 * 864e5) delete obs[id]; });
    save(STORE.karma, karma);
    save(STORE.status, status);
    save(STORE.posts, obs);
  }

  const loadRoute = () => Object.assign({ info: null, infoBlockedAt: 0, archiveDownAt: 0, hidden: {}, lastRunAt: 0, troubleAt: 0 }, load(STORE.route, {}));
  const fmtDur = (ms) => { const sec = Math.max(0, Math.round(ms / 1000)); return sec < 60 ? `${sec} 秒` : `${Math.floor(sec / 60)} 分 ${pad(sec % 60)} 秒`; };

  // 采集 names 里的账号。opts.subset = true：只更新这几个账号，其余账号沿用已有数据。
  // onProgress(完成比例 0–1, 文字)
  async function collectAll(names, onProgress, opts = {}) {
    const now = Date.now();
    const DAY = 864e5;
    const prev = load(STORE.latest, null);
    const route = loadRoute();
    route.hidden = route.hidden || {};
    // 刚出过限速或拦截（FLOW.penaltyMin 分钟内）：这一轮从 1.5 倍间隔起步。Reddit 的限速窗口是分钟级的，过了这段时间就按正常速度。
    resetFlow(now - route.troubleAt < FLOW.penaltyMin * 60000 ? 1.5 : 1);
    Object.assign(probe, { http: {}, samples: {}, notes: [] });
    Object.assign(sitePace, { fetchWorks: false, frameWorks: false, fetchDown: '', frameLock: Promise.resolve() });
    Object.assign(archivePace, { via: null, gmDown: '', fetchDown: '', premarked: now - route.archiveDownAt < DAY });
    const infoSkip = !!route.infoBlockedAt && now - route.infoBlockedAt < DAY; // 上次三条路都被拒：24 小时内不再试探
    Object.assign(infoPace, { order: INFO_ROUTES.slice(), dead: {}, ok: null, budget: ITEM_BUDGET, itemDead: '', premarked: infoSkip });
    if (infoSkip) INFO_ROUTES.forEach((v) => { infoPace.dead[v] = '上次被拒，24 小时内不再尝试'; });
    else if (INFO_ROUTES.includes(route.info)) infoPace.order = [route.info, ...INFO_ROUTES.filter((v) => v !== route.info)];
    // 上次批量查询走得通：这次上次采到过的内容都可以靠批量查询刷新，翻页只要翻到它们就能停
    const batchOk = !infoSkip && INFO_ROUTES.includes(route.info);
    const prevItems = (prev && prev.items) || [];
    const prevAccounts = new Map(((prev && prev.accounts) || []).map((a) => [lc(a.username), a]));

    const jobs = names.map((name, i) => ({ name, i }));
    const results = new Array(names.length).fill(null);
    const running = new Set();
    const steps = new Map(); // 账号 → { label, frac }：每个正在采的账号做到哪一步了
    let finished = 0;
    let waiting = 0;
    const tell = () => {
      const st = flow.stats;
      // 进度条按「做完的账号 + 正在做的账号各自做到的比例」走，不用等一个账号完全做完才动
      const partial = [...running].reduce((sum2, n) => sum2 + ((steps.get(n) || {}).frac || 0), 0);
      const doing = [...running].map((n) => `u/${n}（${(steps.get(n) || {}).label || '排队'}）`).join('、');
      const head = waiting > 0
        ? `Reddit 限制了请求频率，${waiting >= 90 ? Math.ceil(waiting / 60) + ' 分钟' : waiting + ' 秒'}后自动继续，已完成 ${finished} / ${names.length}。不用操作，也不用刷新页面。`
        : `采集中：已完成 ${finished} / ${names.length}${doing ? ' · 正在查 ' + doing : ''}`;
      onProgress(Math.min(1, (finished + partial) / names.length), `${head} · 已用 ${fmtDur(Date.now() - st.startedAt)} · ${st.requests} 次请求${flow.slow > 1 ? ' · 已自动降速' : ''}${sitePace.frameWorks ? ' · 请让这个标签页保持在前台' : ''}`);
    };
    const onWait = (secs) => { waiting = secs; tell(); if (secs <= 1) setTimeout(() => { waiting = 0; }, 1100); };
    const ticker = setInterval(tell, 1000);
    const worker = async () => {
      for (;;) {
        if (flow.halted) return;
        const job = jobs.shift();
        if (!job) return;
        running.add(job.name);
        tell();
        try {
          results[job.i] = await collectUser(job.name, now, onWait, {
            prevItems, prevAccounts, route, batchOk, accountsLeft: () => jobs.length + running.size,
            step: (n, label, frac) => { steps.set(n, { label, frac }); tell(); },
          });
          finished += 1;
        } catch (e) {
          if (!e.halted) results[job.i] = { failed: e.message || String(e) };
        }
        running.delete(job.name);
        tell();
      }
    };
    let haltedWhy = '';
    try {
      await Promise.all(Array.from({ length: Math.min(FLOW.workers, names.length) }, worker));
    } finally {
      clearInterval(ticker);
      haltedWhy = flow.halted;
      flow.halted = ''; // 熔断只管这一轮；之后的检查登录、检查新账号等请求照常
    }

    const fresh = results.filter((r) => r && r.account);
    const failed = results.map((r, i) => (r && r.failed ? `u/${names[i]}：${r.failed}` : null)).filter(Boolean);
    if (failed.length) probe.notes.push('采集出错的账号 → ' + failed.join('；'));
    if (!fresh.length) throw new Error(haltedWhy || failed[0] || '没有采到任何账号');
    onProgress(1, '整理数据…');
    const at = isoSec(now);
    fresh.forEach((r) => { r.account.collected_at = at; });
    const freshAccounts = fresh.map((r) => r.account);
    const freshItems = fresh.flatMap((r) => r.items);
    recordHistory(now, freshAccounts, freshItems);

    // 这一轮没采到的账号（只更新了部分账号，或中途停止）：沿用上次的数据，并标明是哪一次采的
    const got = new Set(freshAccounts.map((a) => lc(a.username)));
    const carried = [];
    let accounts = freshAccounts;
    let items = freshItems;
    if (prev && Array.isArray(prev.accounts)) {
      const listed = new Set(userList().map(lc)); // 已经从名单里移除的账号不再保留
      const old = prev.accounts.filter((a) => !got.has(lc(a.username)) && listed.has(lc(a.username)));
      old.forEach((a) => carried.push(a.username));
      accounts = accounts.concat(old.map((a) => ({ ...a, collected_at: a.collected_at || prev.meta.collected_at })));
      items = items.concat(prevItems.filter((i) => !got.has(lc(i.username)) && listed.has(lc(i.username))));
    }

    // 记住这一轮的结论，下次少走弯路
    if (infoPace.ok) { route.info = infoPace.ok; route.infoBlockedAt = 0; }
    else if (!infoPace.premarked && INFO_ROUTES.every((v) => infoPace.dead[v])) { route.info = null; route.infoBlockedAt = now; }
    if (archivePace.via) route.archiveDownAt = 0;
    else if (!archivePace.premarked && archivePace.gmDown && archivePace.fetchDown) route.archiveDownAt = now;
    if (flow.stats.limited || haltedWhy) route.troubleAt = now;
    if (!opts.subset) route.lastRunAt = now;
    save(STORE.route, route);

    const dead = Object.keys(infoPace.dead).map((v) => `${INFO_HOST[v]}：${infoPace.dead[v]}`);
    if (dead.length) probe.notes.push('批量查询被拒的路线 → ' + dead.join('；'));
    if (infoPace.itemDead) probe.notes.push('单帖查询被拒 → ' + infoPace.itemDead);
    if (sitePace.fetchDown) probe.notes.push('直接请求搜索页不可用，改用了内嵌页面 → ' + sitePace.fetchDown);
    const st = flow.stats;
    const latest = {
      meta: {
        collected_at: at, window_days: WINDOW_DAYS, viewer: state.viewer, version: VERSION,
        info_via: infoPace.ok, info_blocked: freshAccounts.some((a) => a.diag && a.diag.info_blocked), probe,
        halted: haltedWhy, subset: !!opts.subset, updated: freshAccounts.map((a) => a.username), carried,
        flow: {
          requests: st.requests, byKind: st.byKind, limited: st.limited, paused_s: Math.round(st.pausedMs / 1000), took_s: Math.round((Date.now() - st.startedAt) / 1000),
          peak: st.peak, slow: flow.slow, batch_ok: batchOk, quick: freshAccounts.filter((a) => a.diag && a.diag.quick).length,
        },
      },
      accounts, items,
    };
    if (!save(STORE.latest, latest)) {
      latest.items.forEach((i) => { i.text = clip(i.text, 80); });
      latest.meta.probe.samples = {};
      save(STORE.latest, latest);
    }
    return latest;
  }

  // ---------- 计算 ----------
  function derive(latest) {
    const snapMs = Date.parse(latest.meta.collected_at);
    // 只显示当前名单里的账号；刚加入、还没采集过的账号单独列出
    const current = userEntries();
    const labelMap = new Map(current.map((e) => [lc(e.username), e.label || '']));
    const label = (u) => labelMap.get(lc(u)) || '';
    const avatarMap = new Map(latest.accounts.map((a) => [lc(a.username), (a.profile && a.profile.avatar) || '']));
    const avatarOf = (u) => avatarMap.get(lc(u)) || '';
    const accounts = latest.accounts.filter((a) => labelMap.has(lc(a.username)));
    const kept = new Set(accounts.map((a) => a.username));
    const items = latest.items.filter((i) => kept.has(i.username));
    const pending = current.filter((e) => !latest.accounts.some((a) => lc(a.username) === lc(e.username))).map((e) => e.username);
    const names = accounts.map((a) => a.username);
    const karmaHist = load(STORE.karma, {});
    const days = [...new Set(names.flatMap((u) => Object.keys(karmaHist[u] || {})))].sort();
    const lastDay = days[days.length - 1] || null;
    const weekAgo = lastDay ? new Date(dayMs(lastDay) - 7 * 864e5).toISOString().slice(0, 10) : null;
    const older = days.filter((d) => d <= weekAgo);
    const baseDay = older.length ? older[older.length - 1] : days[0] || null;
    const deltaLabel = !baseDay || baseDay === older[older.length - 1] ? '近 7 天' : `自 ${fmtDay(baseDay)} 起`;

    const perAccount = accounts.map((a) => {
      const mine = items.filter((i) => i.username === a.username);
      const posts = mine.filter((i) => i.kind === '帖子').length;
      const removed = mine.filter((i) => i.removed).length;
      const judged = mine.filter((i) => i.removed !== null && i.removed !== undefined).length; // 查得到删除状态的条数
      const scored = mine.filter((i) => typeof i.score === 'number');
      const bySub = {};
      mine.forEach((i) => { bySub[i.subreddit] = (bySub[i.subreddit] || 0) + 1; });
      const top = Object.entries(bySub).sort((x, y) => y[1] - x[1])[0];
      const times = mine.map((i) => i.created).sort();
      const h = karmaHist[a.username] || {};
      return {
        ...a,
        karma_delta: h[lastDay] !== undefined && h[baseDay] !== undefined ? h[lastDay] - h[baseDay] : null,
        posts_30d: posts,
        comments_30d: mine.length - posts,
        avg_score: scored.length ? sum(scored, (i) => i.score) / scored.length : null,
        removed,
        removed_rate: judged && judged >= mine.length * RATE_MIN_COVERAGE ? removed / judged : null,
        last_active: times.length ? times[times.length - 1] : null,
        top_subreddit: top ? top[0] : null,
        age_days: a.created ? Math.floor((snapMs - Date.parse(a.created)) / 864e5) : null,
        followers: a.profile && typeof a.profile.followers === 'number' ? a.profile.followers : null,
        stale: !!(a.collected_at && snapMs - Date.parse(a.collected_at) > 36e5), // 最近这次采集没有更新到这个账号
      };
    });

    const alerts = [];
    perAccount.forEach((a) => {
      const u = a.username;
      if (a.status === '已封禁') alerts.push({ level: '严重', username: u, kind: '账号封禁', detail: a.note, at: a.status_since });
      if (a.status === '疑似 shadowban') alerts.push({ level: '严重', username: u, kind: '疑似 shadowban', detail: a.note, at: a.status_since });
      if (a.status === '查询失败') alerts.push({ level: '注意', username: u, kind: '查询失败', detail: a.note, at: a.status_since });
      if (a.status === '正常' && a.note) alerts.push({ level: '注意', username: u, kind: '数据不完整', detail: a.note, at: null });
      const removed = items.filter((i) => i.username === u && i.removed && snapMs - Date.parse(i.created) <= 7 * 864e5);
      if (removed.length) {
        const by = {};
        removed.forEach((i) => { by[i.removed] = (by[i.removed] || 0) + 1; });
        alerts.push({ level: '注意', username: u, kind: '内容被删', detail: `近 7 天 ${removed.length} 条被删（${Object.entries(by).map(([k, n]) => k + ' ' + n).join('、')}）`, at: removed.map((i) => i.created).sort().pop() });
      }
      if (a.diag && a.diag.vanished) alerts.push({ level: '提示', username: u, kind: '内容从搜索里消失', detail: `上次采到的 ${a.diag.vanished} 条内容这次在站内搜索里找不到了，可能已被删除`, at: null });
      const series = Object.entries(karmaHist[u] || {}).sort((x, y) => (x[0] < y[0] ? -1 : 1));
      series.slice(1).forEach(([day, v], j) => {
        const change = v - series[j][1];
        if (change <= -20 && snapMs - dayMs(day) <= 7 * 864e5) alerts.push({ level: '注意', username: u, kind: 'Karma 下降', detail: `比上一次快照（${fmtDay(series[j][0])}）少了 ${Math.abs(change)}`, at: day });
      });
      const idle = a.last_active ? Math.floor((snapMs - Date.parse(a.last_active)) / 864e5) : null;
      if (a.status === '正常' && (idle === null || idle >= 7)) {
        const none = a.profile_hidden ? `主页已隐藏，站内搜索里近 ${WINDOW_DAYS} 天也没找到内容` : `近 ${WINDOW_DAYS} 天没有发帖或评论`;
        alerts.push({ level: '提示', username: u, kind: '长时间没活动', detail: idle === null ? none : `已经 ${idle} 天没有发帖或评论`, at: a.last_active });
      }
    });
    const rank = { 严重: 0, 注意: 1, 提示: 2 };
    alerts.sort((x, y) => rank[x.level] - rank[y.level] || String(y.at || '').localeCompare(String(x.at || '')));

    const obs = load(STORE.posts, {});
    const nameSet = new Set(names);
    const postTracks = Object.entries(obs).filter(([, p]) => nameSet.has(p.username)).map(([id, p]) => ({
      id, user: p.username, sub: p.subreddit, title: p.title, removed: p.removed || '',
      pts: Object.entries(p.points).map(([h, s]) => ({ h: Number(h), s })).sort((a, b) => a.h - b.h),
    }));

    const lastLocal = mxDay(snapMs);
    const activityDays = Array.from({ length: WINDOW_DAYS }, (_, i) => new Date(dayMs(lastLocal) - (WINDOW_DAYS - 1 - i) * 864e5).toISOString().slice(0, 10));

    const staleAccounts = perAccount.filter((a) => a.stale);
    return { snapMs, accounts, items, names, label, avatarOf, pending, karmaHist, days, deltaLabel, perAccount, staleAccounts, alerts, postTracks, activityDays };
  }

  // ---------- SVG 小工具 ----------
  const NS = 'http://www.w3.org/2000/svg';
  function s(tag, attrs, parent) {
    const e = document.createElementNS(NS, tag);
    Object.entries(attrs || {}).forEach(([k, v]) => { if (v !== null && v !== undefined) e.setAttribute(k, v); });
    if (parent) parent.appendChild(e);
    return e;
  }
  function stext(parent, x, y, str, attrs) {
    const t = s('text', { x, y, ...(attrs || {}) }, parent);
    t.textContent = str;
    return t;
  }
  function measure(svg, str, cls) {
    const t = stext(svg, 0, 0, str, { class: cls || 'tick' });
    const w = t.getComputedTextLength();
    t.remove();
    return w;
  }
  const linear = (d0, d1, r0, r1) => (v) => (d1 === d0 ? (r0 + r1) / 2 : r0 + ((v - d0) / (d1 - d0)) * (r1 - r0));
  function niceTicks(lo, hi, count, integer) {
    if (lo === hi) { const padBy = Math.max(10, Math.abs(lo) * 0.05); lo -= padBy; hi += padBy; }
    const raw = (hi - lo) / count;
    const mag = Math.pow(10, Math.floor(Math.log10(raw)));
    const err = raw / mag;
    let step = (err >= 7.5 ? 10 : err >= 3.5 ? 5 : err >= 1.5 ? 2 : 1) * mag;
    if (integer) step = Math.max(1, Math.round(step));
    const nlo = Math.floor(lo / step) * step;
    const nhi = Math.ceil(hi / step) * step;
    const ticks = [];
    for (let v = nlo; v <= nhi + step / 2; v += step) ticks.push(Number(v.toFixed(10)));
    return { lo: nlo, hi: nhi, ticks };
  }
  function makeChart(box, H) {
    box.replaceChildren();
    const W = Math.max(240, Math.floor(box.clientWidth));
    const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, width: '100%' }, box);
    const tipEl = document.createElement('div');
    tipEl.className = 'tip';
    tipEl.hidden = true;
    box.appendChild(tipEl);
    const tip = {
      show(lines, x, y) {
        tipEl.replaceChildren(...lines.map(([text, color, cls]) => {
          const d = document.createElement('div');
          d.className = cls || 'tip-v';
          if (color) { const sw = document.createElement('span'); sw.className = 'sw'; sw.style.background = color; d.appendChild(sw); }
          d.appendChild(document.createTextNode(text));
          return d;
        }));
        tipEl.hidden = false;
        const scale = box.clientWidth / W;
        const px = x * scale, py = y * scale;
        tipEl.style.left = Math.max(0, Math.min(box.clientWidth - tipEl.offsetWidth, px + 12)) + 'px';
        let top = py - tipEl.offsetHeight - 10;
        if (top < 0) top = py + 14;
        tipEl.style.top = top + 'px';
      },
      hide() { tipEl.hidden = true; },
    };
    return { svg, W, tip };
  }
  function yGrid(svg, ticks, y, x0, x1, fmt) {
    ticks.forEach((t) => {
      s('line', { x1: x0, x2: x1, y1: y(t), y2: y(t), class: 'grid' }, svg);
      stext(svg, x0 - 8, y(t), fmt(t), { class: 'tick', 'text-anchor': 'end', dy: '0.32em' });
    });
  }
  // 只把一端做成圆角的柱子：堆叠柱只有最上面一段圆顶，横向柱只有最右端圆角
  function roundedBar(parent, x, y, w, h, color, end) {
    if (w <= 0 || h <= 0) return;
    const r = Math.min(4, (end === 'right' ? h : w) / 2);
    if (!end || (end === 'top' ? h : w) <= r) { s('rect', { x, y, width: w, height: h, style: `fill:${color}` }, parent); return; }
    s('rect', { x, y, width: w, height: h, rx: r, style: `fill:${color}` }, parent);
    if (end === 'top') s('rect', { x, y: y + r, width: w, height: h - r, style: `fill:${color}` }, parent);
    else s('rect', { x, y, width: w - r, height: h, style: `fill:${color}` }, parent);
  }
  function emptyNote(text) {
    const p = document.createElement('p');
    p.className = 'chart-empty';
    p.textContent = text;
    return p;
  }
  const C = { c1: 'var(--c1)', c2: 'var(--c2)', muted: 'var(--cmuted)', bad: 'var(--bad)' };

  // ---------- 图表 ----------
  function drawKarma(box, series) {
    if (!series.length) { box.replaceChildren(emptyNote('还没有 karma 快照。')); return; }
    const H = 220, top = 12, bottom = H - 26;
    const { svg, W, tip } = makeChart(box, H);
    svg.setAttribute('height', H);
    const vals = series.map((d) => d.v);
    const yt = niceTicks(Math.min(...vals), Math.max(...vals), 4, true);
    const y = linear(yt.lo, yt.hi, bottom, top);
    const left = Math.max(...yt.ticks.map((t) => measure(svg, fmtInt(t)))) + 10;
    const last = series[series.length - 1];
    const right = measure(svg, fmtInt(last.v), 'end') + 14;
    const x = linear(dayMs(series[0].day), dayMs(last.day), left, W - right);
    yGrid(svg, yt.ticks, y, left, W - right, fmtInt);
    const maxLabels = Math.max(1, Math.floor((W - left - right) / 70));
    const step = Math.max(1, Math.ceil(series.length / maxLabels));
    series.forEach((d, i) => {
      if ((series.length - 1 - i) % step === 0) stext(svg, x(dayMs(d.day)), H - 6, fmtDay(d.day), { class: 'tick', 'text-anchor': 'middle' });
    });
    const pts = series.map((d) => [x(dayMs(d.day)), y(d.v)]);
    if (series.length > 1) {
      const defs = s('defs', {}, svg);
      const grad = s('linearGradient', { id: 'rmd-grad', x1: 0, x2: 0, y1: 0, y2: 1 }, defs);
      [[0, 0.32], [0.25, 0.2], [0.5, 0.1], [0.75, 0.03], [1, 0]].forEach(([o, a]) => s('stop', { offset: o, style: `stop-color:var(--kline);stop-opacity:${a}` }, grad));
      const line = pts.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ',' + p[1].toFixed(1)).join('');
      s('path', { d: `${line}L${pts[pts.length - 1][0].toFixed(1)},${bottom}L${pts[0][0].toFixed(1)},${bottom}Z`, fill: 'url(#rmd-grad)' }, svg);
      s('path', { d: line, class: 'line', style: 'stroke:var(--kline)' }, svg);
    }
    if (series.length <= 10) pts.forEach((p) => s('circle', { cx: p[0], cy: p[1], r: 2.5, style: 'fill:var(--kline)' }, svg));
    s('circle', { cx: pts[pts.length - 1][0], cy: pts[pts.length - 1][1], r: 3.5, style: 'fill:var(--kline)' }, svg);
    stext(svg, pts[pts.length - 1][0] + 8, pts[pts.length - 1][1], fmtInt(last.v), { class: 'end', dy: '0.32em' });
    const rule = s('line', { y1: top, y2: bottom, class: 'axis', visibility: 'hidden' }, svg);
    const dot = s('circle', { r: 4, style: 'fill:var(--kline)', visibility: 'hidden' }, svg);
    const hit = s('rect', { x: left - 6, y: top, width: Math.max(0, W - right - left + 12), height: bottom - top, fill: 'transparent' }, svg);
    hit.addEventListener('pointermove', (ev) => {
      const r = svg.getBoundingClientRect();
      const mx = ((ev.clientX - r.left) / r.width) * W;
      let best = 0;
      pts.forEach((p, i) => { if (Math.abs(p[0] - mx) < Math.abs(pts[best][0] - mx)) best = i; });
      const [px, py] = pts[best];
      rule.setAttribute('x1', px); rule.setAttribute('x2', px); rule.setAttribute('visibility', 'visible');
      dot.setAttribute('cx', px); dot.setAttribute('cy', py); dot.setAttribute('visibility', 'visible');
      tip.show([[fmtDay(series[best].day), null, 'tip-k'], [fmtInt(series[best].v) + ' karma']], px, py);
    });
    hit.addEventListener('pointerleave', () => { rule.setAttribute('visibility', 'hidden'); dot.setAttribute('visibility', 'hidden'); tip.hide(); });
  }

  function drawActivity(box, rows) {
    const H = 220, top = 12, bottom = H - 26;
    const { svg, W, tip } = makeChart(box, H);
    svg.setAttribute('height', H);
    const yt = niceTicks(0, Math.max(1, ...rows.map((d) => d.posts + d.comments)), 4, true);
    const y = linear(0, yt.hi, bottom, top);
    const left = Math.max(...yt.ticks.map((t) => measure(svg, fmtInt(t)))) + 10;
    yGrid(svg, yt.ticks, y, left, W, fmtInt);
    const step = (W - left) / rows.length;
    const bw = Math.min(32, step * 0.72);
    const every = Math.max(1, Math.ceil((measure(svg, '10/23') + 14) / step));
    const cols = rows.map((d, i) => {
      const x0 = left + i * step + (step - bw) / 2;
      const g = s('g', {}, svg);
      if (d.posts) roundedBar(g, x0, y(d.posts), bw, bottom - y(d.posts), 'var(--c1)', d.comments ? null : 'top');
      if (d.comments) roundedBar(g, x0, y(d.posts + d.comments), bw, y(d.posts) - y(d.posts + d.comments), 'var(--c2)', 'top');
      if ((rows.length - 1 - i) % every === 0) stext(svg, left + i * step + step / 2, H - 6, fmtDay(d.day), { class: 'tick', 'text-anchor': 'middle' });
      return g;
    });
    rows.forEach((d, i) => {
      const hit = s('rect', { x: left + i * step, width: step, y: top, height: bottom - top, fill: 'transparent' }, svg);
      hit.addEventListener('pointerenter', () => {
        cols.forEach((g, j) => g.setAttribute('opacity', j === i ? 1 : 0.45));
        tip.show([[fmtDay(d.day), null, 'tip-k'], ['帖子 ' + d.posts, C.c1], ['评论 ' + d.comments, C.c2]], left + i * step + step / 2, y(d.posts + d.comments));
      });
      hit.addEventListener('pointerleave', () => { cols.forEach((g) => g.setAttribute('opacity', 1)); tip.hide(); });
    });
  }

  function drawSubs(box, rows) {
    if (!rows.length) { box.replaceChildren(emptyNote(`近 ${WINDOW_DAYS} 天没有内容。`)); return; }
    const rowH = 28, H = rows.length * rowH + 8;
    const { svg, W, tip } = makeChart(box, H);
    svg.setAttribute('height', H);
    const labelW = Math.max(...rows.map((d) => measure(svg, d.sub, 'label'))) + 10;
    const valW = Math.max(...rows.map((d) => measure(svg, fmtInt(d.posts + d.comments), 'end'))) + 10;
    const max = Math.max(...rows.map((d) => d.posts + d.comments));
    const x = linear(0, max, labelW, Math.max(labelW + 20, W - valW));
    rows.forEach((d, i) => {
      const y0 = 4 + i * rowH + 5, bh = rowH - 10, cy = y0 + bh / 2;
      stext(svg, labelW - 10, cy, d.sub, { class: 'label', 'text-anchor': 'end', dy: '0.32em' });
      if (d.posts) roundedBar(svg, labelW, y0, x(d.posts) - labelW, bh, 'var(--c1)', d.comments ? null : 'right');
      if (d.comments) roundedBar(svg, x(d.posts), y0, x(d.posts + d.comments) - x(d.posts), bh, 'var(--c2)', 'right');
      stext(svg, x(d.posts + d.comments) + 6, cy, fmtInt(d.posts + d.comments), { class: 'end', dy: '0.32em' });
      const hit = s('rect', { x: 0, width: W, y: 4 + i * rowH, height: rowH, fill: 'transparent' }, svg);
      hit.addEventListener('pointerenter', () => {
        const lines = [[d.sub, null, 'tip-k'], ['帖子 ' + d.posts, C.c1], ['评论 ' + d.comments, C.c2], ['得分合计 ' + fmtInt(d.score)]];
        if (d.removed) lines.push(['被删 ' + d.removed]);
        tip.show(lines, x(d.posts + d.comments), cy);
      });
      hit.addEventListener('pointerleave', () => tip.hide());
    });
  }

  function drawHeat(box, items) {
    const days = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];
    const counts = {};
    items.forEach((i) => {
      const local = new Date(Date.parse(i.created) - MX_OFFSET_MS);
      const k = ((local.getUTCDay() + 6) % 7) + '|' + local.getUTCHours();
      counts[k] = (counts[k] || 0) + 1;
    });
    const max = Math.max(1, ...Object.values(counts));
    const { svg, W, tip } = makeChart(box, 200);
    const labelW = Math.max(...days.map((d) => measure(svg, d))) + 8;
    const cw = (W - labelW) / 24;
    const ch = Math.max(16, Math.min(26, cw));
    const H = 7 * ch + 24;
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    svg.setAttribute('height', H);
    days.forEach((name, wd) => {
      stext(svg, labelW - 8, wd * ch + ch / 2, name, { class: 'tick', 'text-anchor': 'end', dy: '0.32em' });
      for (let h = 0; h < 24; h += 1) {
        const v = counts[wd + '|' + h] || 0;
        const r = s('rect', {
          x: labelW + h * cw + 1, y: wd * ch + 1, width: Math.max(1, cw - 2), height: ch - 2,
          rx: 3, style: v ? `fill:var(--c1);fill-opacity:${(0.16 + 0.84 * (v / max)).toFixed(3)}` : 'fill:var(--grid)',
        }, svg);
        r.addEventListener('pointerenter', () => {
          r.classList.add('hot');
          tip.show([[`${name} ${h}:00–${h}:59`, null, 'tip-k'], [v + ' 条']], labelW + h * cw + cw / 2, wd * ch);
        });
        r.addEventListener('pointerleave', () => { r.classList.remove('hot'); tip.hide(); });
      }
    });
    const every = cw < 18 ? 6 : 3;
    for (let h = 0; h < 24; h += every) stext(svg, labelW + h * cw + cw / 2, 7 * ch + 16, h + '时', { class: 'tick', 'text-anchor': 'middle' });
  }

  function drawPosts(box, legend, tracks, sel) {
    legend.replaceChildren();
    if (!tracks.length) { box.replaceChildren(emptyNote('近 7 天没有新帖子的分数记录。')); return; }
    const top3 = new Set(tracks.filter((p) => !p.removed).sort((a, b) => b.pts[b.pts.length - 1].s - a.pts[a.pts.length - 1].s).slice(0, 3).map((p) => p.id));
    const emph = (p) => (sel ? p.user === sel : top3.has(p.id) || !!p.removed);
    const color = (p) => (p.removed ? C.bad : (sel ? p.user === sel : top3.has(p.id)) ? C.c1 : C.muted);
    [[C.c1, sel ? 'u/' + sel : '分数最高的 3 帖'], [C.bad, '已被删除'], [C.muted, '其他帖子']].forEach(([c, t]) => {
      const sp = document.createElement('span');
      const sw = document.createElement('i');
      sw.className = 'sw';
      sw.style.background = c;
      sp.append(sw, document.createTextNode(t));
      legend.appendChild(sp);
    });
    const H = 260, top = 12, bottom = H - 26;
    const { svg, W, tip } = makeChart(box, H);
    svg.setAttribute('height', H);
    const yt = niceTicks(0, Math.max(1, ...tracks.flatMap((p) => p.pts.map((q) => q.s))), 4, true);
    const y = linear(yt.lo, yt.hi, bottom, top);
    const left = Math.max(...yt.ticks.map((t) => measure(svg, fmtInt(t)))) + 10;
    const right = W - 14;
    const x = (h) => left + Math.sqrt(Math.max(0, h) / TRACK_HOURS) * (right - left);
    yGrid(svg, yt.ticks, y, left, right, fmtInt);
    let lastX = -Infinity;
    [0, 1, 3, 6, 12, 24, 48, 96, 168].forEach((h) => {
      if (x(h) - lastX < 30) return;
      lastX = x(h);
      stext(svg, x(h), H - 6, h < 48 ? h + 'h' : h / 24 + '天', { class: 'tick', 'text-anchor': 'middle' });
    });
    const ordered = tracks.slice().sort((a, b) => Number(emph(a)) - Number(emph(b)));
    const shapes = new Map();
    ordered.forEach((p) => {
      const g = s('g', { opacity: emph(p) ? 1 : sel ? 0.35 : 0.75 }, svg);
      if (p.pts.length > 1) {
        s('path', { d: p.pts.map((q, i) => (i ? 'L' : 'M') + x(q.h).toFixed(1) + ',' + y(q.s).toFixed(1)).join(''), class: 'line', style: `stroke:${color(p)};stroke-width:${emph(p) ? 2 : 1.5}` }, g);
      }
      p.pts.forEach((q) => s('circle', { cx: x(q.h), cy: y(q.s), r: emph(p) ? 3 : 2.5, style: `fill:${color(p)}` }, g));
      shapes.set(p, g);
    });
    const all = tracks.flatMap((p) => p.pts.map((q) => ({ p, h: q.h, s: q.s, px: x(q.h), py: y(q.s) })));
    const ring = s('circle', { r: 5, class: 'ring', visibility: 'hidden' }, svg);
    const hit = s('rect', { x: left - 6, y: top - 6, width: right - left + 12, height: bottom - top + 12, fill: 'transparent' }, svg);
    hit.addEventListener('pointermove', (ev) => {
      const r = svg.getBoundingClientRect();
      const mx = ((ev.clientX - r.left) / r.width) * W;
      const my = ((ev.clientY - r.top) / r.width) * W;
      let best = null, bd = Infinity;
      all.forEach((d) => { const dd = (d.px - mx) ** 2 + (d.py - my) ** 2; if (dd < bd) { bd = dd; best = d; } });
      if (!best) return;
      shapes.forEach((g, p) => g.setAttribute('opacity', p === best.p ? 1 : 0.25));
      ring.setAttribute('cx', best.px); ring.setAttribute('cy', best.py); ring.setAttribute('visibility', 'visible');
      const lines = [[best.p.title, null, 'tip-k'], ['u/' + best.p.user + ' · ' + best.p.sub], [`发布后 ${best.h} 小时：${fmtInt(best.s)} 分`]];
      if (best.p.removed) lines.push(['已被删除（' + best.p.removed + '）']);
      tip.show(lines, best.px, best.py);
    });
    hit.addEventListener('pointerleave', () => {
      shapes.forEach((g, p) => g.setAttribute('opacity', emph(p) ? 1 : sel ? 0.35 : 0.75));
      ring.setAttribute('visibility', 'hidden');
      tip.hide();
    });
  }

  function drawGrowth(box, D, sel, onPick) {
    box.replaceChildren();
    if (D.days.length < 2) {
      const note = emptyNote('目前只有一次快照。以后每天点一次「获取最新数据」，这里会出现每个账号的增长曲线。');
      note.style.gridColumn = '1 / -1';
      box.appendChild(note);
      return;
    }
    const series = D.perAccount.filter((a) => D.karmaHist[a.username]).map((a) => {
      const h = D.karmaHist[a.username];
      const pts = D.days.filter((d) => h[d] !== undefined).map((d) => ({ day: d, v: h[d] }));
      const base = pts.length ? pts[0].v : 0;
      return { a, pts: pts.map((p) => ({ day: p.day, g: p.v - base })), last: pts.length ? pts[pts.length - 1].v - base : 0 };
    }).sort((x, y) => y.last - x.last);
    const gains = series.flatMap((sr) => sr.pts.map((p) => p.g));
    const y = linear(Math.min(0, ...gains), Math.max(1, ...gains), 33, 3);
    const x = linear(dayMs(D.days[0]), dayMs(D.days[D.days.length - 1]), 0, 100);
    series.forEach((sr) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'mini' + (sr.a.username === sel ? ' sel' : '');
      b.addEventListener('click', () => onPick(sr.a.username));
      const head = document.createElement('div');
      head.className = 'mini-top';
      const nm = document.createElement('span');
      nm.className = 'mini-name';
      nm.textContent = sr.a.username;
      const val = document.createElement('span');
      val.className = 'mini-val ' + (sr.last > 0 ? 'up' : sr.last < 0 ? 'down' : 'muted');
      val.textContent = fmtSigned(sr.last);
      head.append(nm, val);
      b.appendChild(head);
      if (D.label(sr.a.username)) b.appendChild(el('span', 'sublabel', D.label(sr.a.username)));
      const svg = s('svg', { viewBox: '0 0 100 36', preserveAspectRatio: 'none' });
      s('line', { x1: 0, x2: 100, y1: y(0), y2: y(0), class: 'ref' }, svg);
      if (sr.pts.length > 1) {
        s('path', {
          d: sr.pts.map((p, i) => (i ? 'L' : 'M') + x(dayMs(p.day)).toFixed(2) + ',' + y(p.g).toFixed(2)).join(''),
          class: 'line', style: `stroke:${sr.a.status === '正常' ? 'var(--kline)' : C.bad}`, 'vector-effect': 'non-scaling-stroke',
        }, svg);
      }
      b.appendChild(svg);
      if (sr.a.status !== '正常') b.appendChild(chip(sr.a.status, 'bad'));
      box.appendChild(b);
    });
  }

  // ---------- 界面 ----------
  // 汇报用的版式：白底、一页从上到下读完。华为红只用在品牌和「有问题」的地方，图表用深蓝灰；不用渐变、阴影层叠和动效。
  const CSS = `
    :host { all: initial; }
    .app {
      --bg: #f3f4f6; --panel: #ffffff; --panel-2: #f7f8fa; --fg: #1b1f27; --muted: #667085; --faint: #98a2b3; --line: #e2e5ea; --grid: #edeff3;
      --brand: #c7000b; --c1: #1f3b64; --c2: #a3b6d1; --kline: #1f3b64; --cmuted: #cfd5df;
      --ok: #17855a; --warn: #b26b00; --bad: #c7000b; --ban: #7b2d8e;
      --hover: rgba(27, 31, 39, 0.035); --sel: rgba(31, 59, 100, 0.07);
      --shadow: 0 1px 2px rgba(16, 24, 40, 0.05);
      --maxw: 1320px; --pad: max(16px, 2vw);
      position: fixed; inset: 0; overflow: auto; color: var(--fg); background: var(--bg);
      font: 14px/1.55 "Microsoft YaHei", "PingFang SC", -apple-system, BlinkMacSystemFont, "Segoe UI", "Hiragino Sans GB", sans-serif;
      -webkit-font-smoothing: antialiased;
    }
    * { box-sizing: border-box; }
    [hidden] { display: none !important; }
    button, input, select, textarea { font: inherit; color: inherit; }
    button:focus-visible, select:focus-visible, input:focus-visible, textarea:focus-visible, tr:focus-visible, a:focus-visible, summary:focus-visible {
      outline: 2px solid var(--kline); outline-offset: 2px;
    }
    a { color: inherit; }
    h1, h2, h3 { margin: 0; }
    h3 { font-size: 15px; font-weight: 650; }
    .ic { width: 16px; height: 16px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; flex: none; }
    .num { font-variant-numeric: tabular-nums; }
    .nowrap { white-space: nowrap; }
    .up { color: var(--ok); } .down { color: var(--bad); } .muted { color: var(--muted); }
    .ok { color: var(--ok); } .warn { color: var(--warn); } .bad { color: var(--bad); } .ban { color: var(--ban); }
    .note { margin: 0; font-size: 12px; color: var(--muted); line-height: 1.6; }

    /* 顶栏：标题、数据时间、操作按钮，下面一行是目录 */
    .top { position: sticky; top: 0; z-index: 8; background: #fff; border-bottom: 1px solid var(--line); }
    .top::before { content: ""; display: block; height: 3px; background: var(--brand); }
    .top-in { max-width: var(--maxw); margin: 0 auto; padding: 10px var(--pad); display: flex; flex-wrap: wrap; align-items: center; gap: 8px 16px; }
    .brand { display: flex; align-items: center; gap: 12px; min-width: 0; }
    .logo { width: 30px; height: 30px; border-radius: 6px; display: grid; place-items: center; color: #fff; flex: none; background: var(--brand); }
    .logo .ic { width: 18px; height: 18px; }
    .brand-text { display: grid; min-width: 0; }
    .brand h1 { font-size: 17px; font-weight: 700; }
    .updated { font-size: 12px; color: var(--muted); }
    .actions { margin-left: auto; display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
    .btn { border: 1px solid var(--line); background: var(--panel); border-radius: 8px; padding: 6px 13px; font-size: 13px; font-weight: 550; cursor: pointer;
      white-space: nowrap; text-decoration: none; display: inline-flex; align-items: center; justify-content: center; gap: 7px; }
    .btn:hover { border-color: var(--muted); background: var(--panel-2); }
    .btn:disabled { opacity: 0.55; cursor: not-allowed; }
    .btn.icon { width: 32px; height: 32px; padding: 0; }
    .btn.primary { border-color: var(--brand); color: #fff; background: var(--brand); }
    .btn.primary:hover { background: #a80009; border-color: #a80009; }
    .spin { animation: spin 0.9s linear infinite; }
    @keyframes spin { to { transform: rotate(360deg); } }
    .strip { max-width: var(--maxw); margin: 0 auto; padding: 0 var(--pad) 10px; display: grid; gap: 6px; }
    .bar { height: 3px; background: var(--grid); border-radius: 2px; overflow: hidden; }
    .bar span { display: block; height: 100%; width: 0; background: var(--brand); transition: width 0.3s; }
    .ptext { font-size: 12px; color: var(--muted); }
    .banner { font-size: 13px; color: var(--warn); }
    .toc { max-width: var(--maxw); margin: 0 auto; padding: 0 var(--pad); display: flex; gap: 2px; overflow-x: auto; scrollbar-width: none; }
    .toc button { background: none; border: 0; border-bottom: 2px solid transparent; padding: 8px 12px 9px; font-size: 13.5px; font-weight: 550; color: var(--muted); cursor: pointer; white-space: nowrap; }
    .toc button:hover { color: var(--fg); }
    .toc button[aria-current="true"] { color: var(--fg); border-bottom-color: var(--brand); }
    .toc .count { margin-left: 6px; padding: 0 6px; border-radius: 9px; font-size: 11.5px; font-weight: 650; background: var(--grid); color: var(--muted); }
    .toc .count.hot { background: color-mix(in srgb, var(--bad) 12%, transparent); color: var(--bad); }

    /* 页面：一列，每一块是「小标题 + 结论句 + 证据」 */
    .page { max-width: var(--maxw); margin: 0 auto; padding: 20px var(--pad) 64px; display: grid; gap: 26px; grid-template-columns: minmax(0, 1fr); }
    .page.solo { padding-top: 40px; }
    .sec { display: grid; gap: 14px; grid-template-columns: minmax(0, 1fr); scroll-margin-top: calc(var(--top-h, 110px) + 14px); min-width: 0; }
    .sec-head { display: flex; flex-wrap: wrap; align-items: flex-end; justify-content: space-between; gap: 10px 20px; }
    .sec-titles { display: grid; gap: 3px; min-width: 0; padding-left: 12px; border-left: 4px solid var(--brand); }
    .sec-kicker { font-size: 12.5px; font-weight: 650; color: var(--muted); letter-spacing: 0.04em; }
    .sec-title { font-size: 19px; line-height: 1.35; font-weight: 700; text-wrap: pretty; }
    .sec-title b { color: var(--brand); font-weight: 700; }
    .sec-title b.calm { color: var(--ok); }
    .card { background: var(--panel); border: 1px solid var(--line); border-radius: 10px; padding: 18px; display: grid; gap: 14px; grid-template-columns: minmax(0, 1fr);
      align-content: start; min-width: 0; box-shadow: var(--shadow); }
    .card.flush { padding: 0; overflow: hidden; gap: 0; }
    .card-head { display: flex; flex-wrap: wrap; justify-content: space-between; align-items: center; gap: 8px 14px; }
    .card-head h3 { display: inline-flex; align-items: center; gap: 8px; }
    .card-head h3 .ic { color: var(--muted); }
    .grid2 { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 420px), 1fr)); gap: 16px; }
    .grid2.lean { grid-template-columns: minmax(0, 1.55fr) minmax(0, 1fr); }
    .legend { display: flex; flex-wrap: wrap; gap: 12px; font-size: 12px; color: var(--muted); }
    .legend span { display: inline-flex; align-items: center; gap: 6px; }
    .sw { display: inline-block; width: 10px; height: 10px; border-radius: 2px; flex: none; }

    /* 提示条：旧数据、提前停止、新账号 */
    .pending { display: grid; gap: 8px; }
    .notice { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 14px; padding: 10px 14px; border-radius: 8px; font-size: 13px;
      background: color-mix(in srgb, var(--warn) 7%, var(--panel)); border: 1px solid color-mix(in srgb, var(--warn) 30%, var(--line)); }

    /* 结论 */
    .hero { background: var(--panel); border: 1px solid var(--line); border-radius: 10px; padding: 22px 22px 18px; gap: 16px; box-shadow: var(--shadow); }
    .headline { font-size: clamp(24px, 2.6vw, 30px); line-height: 1.3; font-weight: 700; text-wrap: balance; }
    .headline b { color: var(--brand); font-weight: 700; }
    .headline b.calm { color: var(--ok); }
    .kpis { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; }
    .kpi { text-align: left; display: grid; gap: 2px; align-content: start; padding: 14px 16px 12px; border-radius: 8px; min-width: 0; cursor: pointer;
      background: var(--panel-2); border: 1px solid var(--line); border-top: 3px solid var(--c1); }
    .kpi:hover { border-color: var(--muted); border-top-color: var(--c1); }
    .kpi.alarm { border-top-color: var(--bad); }
    .kpi.calm { border-top-color: var(--ok); }
    .kpi-label { font-size: 13px; color: var(--muted); }
    .kpi-value { font-size: 30px; line-height: 1.2; font-weight: 700; font-variant-numeric: tabular-nums; overflow-wrap: anywhere; }
    .kpi-unit { margin-left: 6px; font-size: 14px; font-weight: 550; color: var(--muted); }
    .kpi-sub { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 8px; font-size: 12.5px; color: var(--muted); min-height: 20px; }
    .delta { display: inline-flex; align-items: center; padding: 0 7px; border-radius: 4px; font-size: 12px; font-weight: 650; font-variant-numeric: tabular-nums; }
    .delta.up { background: color-mix(in srgb, var(--ok) 12%, transparent); color: var(--ok); }
    .delta.down { background: color-mix(in srgb, var(--bad) 10%, transparent); color: var(--bad); }
    .delta.flat { background: var(--grid); color: var(--muted); }
    .spark { display: block; width: 100%; height: 30px; margin-top: 6px; overflow: visible; }
    .points { margin: 0; padding: 0; list-style: none; display: grid; gap: 7px; }
    .points li { position: relative; padding-left: 16px; font-size: 14.5px; line-height: 1.6; }
    .points li::before { content: ""; position: absolute; left: 0; top: 0.62em; width: 6px; height: 6px; background: var(--brand); }
    .points b { font-weight: 700; }
    .points .k { color: var(--muted); margin-right: 8px; }
    .cover { display: flex; flex-wrap: wrap; gap: 4px 20px; font-size: 12.5px; color: var(--muted); padding-top: 12px; border-top: 1px solid var(--line); }
    .cover b { color: var(--fg); font-weight: 600; }

    /* 小标签 */
    .chip { display: inline-flex; align-items: center; gap: 6px; padding: 1px 9px 1px 7px; border-radius: 5px; white-space: nowrap; font-size: 12px; font-weight: 600;
      background: color-mix(in srgb, currentColor 11%, transparent); }
    .chip::before { content: ""; width: 6px; height: 6px; border-radius: 50%; background: currentColor; flex: none; }
    .tag { display: inline-block; font-size: 11.5px; color: var(--muted); background: var(--panel-2); border: 1px solid var(--line); border-radius: 4px; padding: 0 6px; white-space: nowrap; }
    .tag.warn { color: var(--warn); border-color: color-mix(in srgb, var(--warn) 35%, var(--line)); }
    .tags { display: flex; flex-wrap: wrap; gap: 4px; }
    .sublabel { display: block; font-size: 11.5px; font-weight: 400; color: var(--muted); white-space: normal; }
    .bio-line { display: block; max-width: 240px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 11.5px; font-weight: 400; color: var(--faint); }

    /* 头像：有就用 Reddit 的头像，没有就用用户名前两个字母 */
    .av { --h: 220; width: 30px; height: 30px; border-radius: 50%; display: inline-grid; place-items: center; flex: none; overflow: hidden;
      font-size: 11px; font-weight: 700; background: hsl(var(--h) 60% 93%); color: hsl(var(--h) 50% 34%); }
    .av img { width: 100%; height: 100%; object-fit: cover; display: block; }
    .av-sm { width: 22px; height: 22px; font-size: 9px; }
    .av-lg { width: 52px; height: 52px; font-size: 17px; }
    .avs { display: inline-flex; align-items: center; }
    .avs .av { box-shadow: 0 0 0 2px var(--panel); }
    .avs .av + .av { margin-left: -5px; }
    .who { display: inline-flex; align-items: center; gap: 10px; min-width: 0; }
    .who-name { font-weight: 600; }

    /* 需要关注 */
    .agroups { list-style: none; margin: 0; padding: 0; }
    .agroups > li + li { border-top: 1px solid var(--line); }
    .agroup > summary { list-style: none; display: grid; grid-template-columns: 58px minmax(110px, 150px) 78px minmax(0, 1fr) 18px; align-items: center; gap: 12px;
      padding: 10px 6px; cursor: pointer; font-size: 13.5px; border-radius: 6px; }
    .agroup > summary::-webkit-details-marker { display: none; }
    .agroup > summary::after { content: "›"; font-size: 20px; line-height: 1; color: var(--muted); justify-self: end; }
    .agroup[open] > summary::after { transform: rotate(90deg); }
    .agroup > summary:hover { background: var(--hover); }
    .akind { font-weight: 650; }
    .acount { color: var(--muted); white-space: nowrap; }
    .apeek { display: inline-flex; align-items: center; gap: 10px; min-width: 0; color: var(--muted); }
    .anames { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
    .agroup[open] .apeek { visibility: hidden; }
    .aitems { list-style: none; margin: 0 0 8px; padding: 0 0 0 70px; display: grid; gap: 2px; }
    .aitem { width: 100%; text-align: left; background: none; border: 0; border-radius: 6px; padding: 7px 10px; cursor: pointer;
      display: grid; grid-template-columns: minmax(150px, 230px) minmax(0, 1fr) auto; align-items: center; gap: 14px; font-size: 13px; }
    .aitem:hover { background: var(--hover); }
    .aat { color: var(--muted); font-variant-numeric: tabular-nums; white-space: nowrap; }
    .allgood { display: flex; align-items: center; gap: 10px; font-size: 14px; }

    /* 筛选条 */
    .toolbar { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
    .seg { display: inline-flex; flex-wrap: wrap; padding: 2px; border-radius: 8px; background: var(--panel); border: 1px solid var(--line); }
    .seg button { background: none; border: 0; border-radius: 6px; padding: 4px 11px; font-size: 13px; font-weight: 550; color: var(--muted); cursor: pointer; white-space: nowrap; }
    .seg button:hover { color: var(--fg); }
    .seg button[aria-pressed="true"] { background: var(--fg); color: #fff; }
    .seg .count { margin-left: 5px; font-weight: 500; opacity: 0.75; font-variant-numeric: tabular-nums; }
    .search { position: relative; display: inline-flex; align-items: center; }
    .search .ic { position: absolute; left: 10px; color: var(--muted); pointer-events: none; }
    .input { background: var(--panel); border: 1px solid var(--line); border-radius: 8px; padding: 6px 12px 6px 32px; font-size: 13px; max-width: 100%; min-width: 200px; }
    .select { background: var(--panel); border: 1px solid var(--line); border-radius: 8px; padding: 5px 8px; font-size: 13px; }
    .morebtn { justify-self: center; background: var(--panel-2); border: 1px solid var(--line); border-radius: 8px; padding: 6px 16px; font-size: 13px; color: var(--muted); cursor: pointer; }
    .morebtn:hover { color: var(--fg); border-color: var(--muted); }

    /* 表格 */
    .tablebox { overflow: auto; max-height: 640px; }
    .tablebox.grow { max-height: none; }
    table { width: 100%; border-collapse: collapse; font-size: 13px; font-variant-numeric: tabular-nums; }
    th { position: sticky; top: 0; z-index: 1; background: var(--panel-2); text-align: left; font-weight: 600; color: var(--muted); font-size: 12px;
      border-bottom: 1px solid var(--line); padding: 9px 10px; white-space: nowrap; }
    td { padding: 9px 10px; border-bottom: 1px solid var(--line); vertical-align: middle; }
    tbody tr:last-child td { border-bottom: 0; }
    .card.flush th:first-child, .card.flush td:first-child { padding-left: 18px; }
    .card.flush th:last-child, .card.flush td:last-child { padding-right: 18px; }
    .r { text-align: right; }
    td.text { min-width: 220px; max-width: 460px; }
    td.text a { text-decoration: none; }
    td.text a:hover { text-decoration: underline; }
    tbody tr.click { cursor: pointer; }
    tbody tr.click:hover { background: var(--hover); }
    tbody tr.sel { background: var(--sel); }
    .sortbtn { background: none; border: 0; padding: 0; cursor: pointer; color: inherit; font: inherit; }
    .sortbtn:hover { color: var(--fg); }
    th[aria-sort="ascending"] .sortbtn::after { content: " ↑"; }
    th[aria-sort="descending"] .sortbtn::after { content: " ↓"; }
    .cell-sub { display: block; font-size: 11.5px; color: var(--muted); font-weight: 400; white-space: nowrap; }
    .strong { font-weight: 650; }
    .karma { display: flex; align-items: center; justify-content: flex-end; gap: 8px; font-weight: 650; }
    .kbar { height: 5px; border-radius: 3px; flex: none; background: var(--c2); }
    .ext { display: inline-flex; margin-left: 6px; color: var(--muted); text-decoration: none; opacity: 0; }
    .ext .ic { width: 13px; height: 13px; }
    tr:hover .ext, .ext:focus-visible { opacity: 1; }
    .linkname { background: none; border: 0; padding: 0; cursor: pointer; text-align: left; color: inherit; font: inherit; }
    .linkname:hover .who-name { color: var(--brand); text-decoration: underline; }
    /* 可以点的数字：点了看对应的明细 */
    .numlink { background: none; border: 0; padding: 1px 6px; margin: -1px -6px; border-radius: 5px; cursor: pointer; font: inherit; font-weight: 650; color: var(--c1);
      font-variant-numeric: tabular-nums; text-decoration: underline; text-decoration-color: color-mix(in srgb, var(--c1) 35%, transparent); text-underline-offset: 3px; }
    .numlink:hover { background: var(--sel); text-decoration-color: var(--c1); }
    .numlink.zero { color: var(--faint); text-decoration: none; cursor: default; }
    th.grp { text-align: center; color: var(--fg); font-size: 12.5px; border-left: 1px solid var(--line); }
    .grp-first { border-left: 1px solid var(--line); }
    .card-head.pad { padding: 13px 18px; border-bottom: 1px solid var(--line); }
    .rank { display: inline-grid; place-items: center; width: 20px; height: 20px; border-radius: 4px; font-size: 12px; font-weight: 700; background: var(--grid); color: var(--muted); }
    tr:first-child .rank { background: var(--brand); color: #fff; }

    /* 图表 */
    .chart { position: relative; min-height: 200px; }
    .chart svg { display: block; overflow: visible; }
    .tick { fill: var(--muted); font-size: 11px; font-variant-numeric: tabular-nums; }
    .label { fill: var(--fg); font-size: 12px; }
    .end { fill: var(--fg); font-size: 12px; font-weight: 600; font-variant-numeric: tabular-nums; }
    .grid { stroke: var(--grid); stroke-width: 1; }
    .axis { stroke: var(--muted); stroke-width: 1; stroke-dasharray: 3 3; }
    .ref { stroke: var(--muted); stroke-dasharray: 3 3; vector-effect: non-scaling-stroke; opacity: 0.6; }
    .line { fill: none; stroke-width: 2.25; stroke-linecap: round; stroke-linejoin: round; }
    .ring { fill: var(--panel); stroke: var(--fg); stroke-width: 2; }
    rect.hot { stroke: var(--fg); stroke-width: 1.5; }
    .tip { position: absolute; z-index: 3; pointer-events: none; background: var(--panel); border: 1px solid var(--line); border-radius: 8px;
      box-shadow: 0 8px 24px -10px rgba(16, 24, 40, 0.35); padding: 8px 12px; font-size: 12px; max-width: 300px; display: grid; gap: 3px; }
    .tip-k { color: var(--muted); }
    .tip-v { display: flex; align-items: center; gap: 6px; font-variant-numeric: tabular-nums; font-weight: 550; }
    .chart-empty { margin: 0; padding: 40px 8px; text-align: center; font-size: 13px; color: var(--muted); }
    .multi { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 180px), 1fr)); gap: 10px; }
    .mini { text-align: left; background: var(--panel-2); border: 1px solid var(--line); border-radius: 8px; padding: 10px 12px; display: grid; gap: 4px; cursor: pointer; min-width: 0; }
    .mini:hover { border-color: var(--muted); }
    .mini-top { display: flex; justify-content: space-between; gap: 6px; font-size: 12px; }
    .mini-name { overflow-wrap: anywhere; min-width: 0; font-weight: 600; }
    .mini-val { white-space: nowrap; font-variant-numeric: tabular-nums; font-weight: 650; }
    .mini svg { display: block; width: 100%; height: 38px; overflow: visible; }

    /* 可展开的补充内容 */
    .disclose > summary { list-style: none; cursor: pointer; display: flex; flex-wrap: wrap; justify-content: space-between; align-items: center; gap: 6px 14px; }
    .disclose > summary::-webkit-details-marker { display: none; }
    .dtitle { display: inline-flex; align-items: center; font-size: 14.5px; font-weight: 650; }
    .dtitle::before { content: "›"; display: inline-block; width: 18px; font-size: 20px; line-height: 1; color: var(--muted); }
    .disclose[open] .dtitle::before { transform: rotate(90deg); }
    .about { padding: 0 4px; }
    .about > summary { display: inline-flex; align-items: center; gap: 6px; cursor: pointer; font-size: 13px; color: var(--muted); }
    .about[open] > summary { margin-bottom: 10px; }
    .notes { margin: 0 0 10px; padding-left: 18px; display: grid; gap: 4px; font-size: 12px; color: var(--muted); line-height: 1.65; max-width: 96ch; }
    .tools { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
    .linkbtn { background: none; border: 0; padding: 0; color: var(--muted); text-decoration: underline; cursor: pointer; font-size: 12px; }
    .empty { background: var(--panel); border: 1px solid var(--line); border-radius: 10px; padding: 48px 24px; text-align: center; display: grid; gap: 14px; justify-items: center; }
    .empty .logo { width: 48px; height: 48px; }
    .empty .logo .ic { width: 26px; height: 26px; }
    .empty h2 { font-size: 20px; }
    .empty p { margin: 0; color: var(--muted); max-width: 54ch; }

    /* 侧滑面板：账号详情、名单管理 */
    .modal { position: fixed; inset: 0; z-index: 20; display: flex; justify-content: flex-end; background: rgba(15, 18, 26, 0.45); }
    .sheet { width: min(820px, 100%); height: 100%; background: var(--bg); display: flex; flex-direction: column; box-shadow: -16px 0 40px -20px rgba(0, 0, 0, 0.45); }
    .sheet.wide { width: min(1000px, 100%); }
    .sheet-head, .sheet-foot { display: flex; align-items: center; gap: 12px; padding: 14px 20px; background: var(--panel); }
    .sheet-head { border-bottom: 1px solid var(--line); flex-wrap: wrap; }
    .sheet-head > h2 { flex: 1; font-size: 17px; }
    .sheet-foot { border-top: 1px solid var(--line); justify-content: flex-end; flex-wrap: wrap; }
    .sheet-foot .note { margin-right: auto; }
    .sheet-body { flex: 1; overflow: auto; scrollbar-gutter: stable; padding: 16px 20px 36px; display: grid; gap: 14px; align-content: start; grid-template-columns: minmax(0, 1fr);
      grid-auto-rows: max-content; /* 每一块按内容的高度排，不压缩；内容超出面板时面板自己滚动 */ }
    .acct-head { flex: 1 1 240px; min-width: 0; display: flex; align-items: center; gap: 14px; }
    .acct-id { display: grid; gap: 4px; min-width: 0; }
    .acct-id h2 { font-size: 19px; font-weight: 700; overflow-wrap: anywhere; }
    .acct-sub { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; font-size: 13px; }
    .bio { margin: 0; font-size: 13.5px; color: var(--fg); background: var(--panel); border: 1px solid var(--line); border-left: 3px solid var(--cmuted); border-radius: 6px; padding: 8px 12px; overflow-wrap: anywhere; }
    .facts { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 10px; margin: 0; }
    .fact { text-align: left; background: var(--panel); border: 1px solid var(--line); border-radius: 8px; padding: 10px 12px; display: grid; gap: 1px; min-width: 0; align-content: start; }
    .fact .k { font-size: 12px; color: var(--muted); }
    .fact .v { font-size: 20px; font-weight: 700; font-variant-numeric: tabular-nums; overflow-wrap: anywhere; }
    .fact .s { font-size: 11.5px; color: var(--muted); }
    button.fact { cursor: pointer; border-top: 3px solid var(--c1); }
    button.fact:hover { border-color: var(--muted); border-top-color: var(--c1); background: var(--panel-2); }
    button.fact .v { color: var(--c1); }
    button.fact .s { color: var(--c1); }
    button.fact:disabled { cursor: default; border-top-color: var(--line); }
    button.fact:disabled .v, button.fact:disabled .s { color: var(--faint); }
    .ilist { list-style: none; margin: 0; padding: 0; display: grid; }
    .ilist li { display: grid; grid-template-columns: auto minmax(0, 1fr) auto; gap: 3px 12px; align-items: baseline; padding: 8px 0; border-bottom: 1px solid var(--line); font-size: 13px; }
    .ilist li:last-child { border-bottom: 0; }
    .ilist .meta { grid-column: 2 / 4; color: var(--muted); font-size: 12px; display: flex; flex-wrap: wrap; gap: 4px 10px; align-items: center; }
    .ilist a { text-decoration: none; overflow-wrap: anywhere; }
    .ilist a:hover { text-decoration: underline; }
    .score { font-weight: 650; font-variant-numeric: tabular-nums; white-space: nowrap; }
    .flash { animation: flash 1.4s ease-out 1; }
    @keyframes flash { 0%, 35% { box-shadow: 0 0 0 3px color-mix(in srgb, var(--c1) 45%, transparent); } 100% { box-shadow: var(--shadow); } }
    .mgr-add, .mgr-list { display: grid; gap: 8px; min-width: 0; }
    .mgr-label { font-size: 14px; font-weight: 650; }
    .mgr-problems { margin: 0; padding-left: 18px; font-size: 12px; color: var(--warn); display: grid; gap: 2px; }
    .mgr-problems:empty { display: none; }
    .mgr-removed { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
    .removed-chip { display: inline-flex; align-items: center; gap: 8px; border: 1px dashed var(--muted); border-radius: 6px; padding: 2px 10px; font-size: 12px; text-decoration: line-through; }
    .removed-chip .linkbtn { text-decoration: underline; }
    textarea { width: 100%; min-height: 140px; background: var(--panel); border: 1px solid var(--line); border-radius: 8px; padding: 10px 12px; font: 12px/1.6 ui-monospace, Menlo, monospace; resize: vertical; }
    .label-input { width: 100%; min-width: 140px; background: var(--panel); border: 1px solid var(--line); border-radius: 6px; padding: 5px 9px; font-size: 13px; }
    .xbtn { background: none; border: 0; color: var(--muted); cursor: pointer; font-size: 18px; line-height: 1; padding: 0 4px; }
    .xbtn:hover { color: var(--bad); }

    @media (prefers-reduced-motion: reduce) {
      *, *::before, *::after { animation: none !important; transition: none !important; }
    }
    @media (max-width: 980px) {
      .kpis { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      .grid2.lean { grid-template-columns: minmax(0, 1fr); }
    }
    @media (max-width: 720px) {
      .hide-narrow { display: none; }
      .actions { margin-left: 0; }
      .input { min-width: 0; width: 100%; }
      .search { flex: 1 1 100%; }
      .kpi-value { font-size: 24px; }
      .agroup > summary { grid-template-columns: auto minmax(0, 1fr) auto 18px; }
      .apeek { display: none; }
      .aitems { padding-left: 4px; }
      .aitem { grid-template-columns: minmax(0, 1fr) auto; }
      .aitem .adetail { grid-column: 1 / -1; }
    }
  `;

  const ICON_PATHS = {
    radar: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><path d="M12 12l6-6"/><circle cx="12" cy="12" r="1.2"/>',
    karma: '<polyline points="22 7 13.5 15.5 8.5 10.5 2 17"/><polyline points="16 7 22 7 22 13"/>',
    posts: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/>',
    comments: '<path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/>',
    removed: '<circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/>',
    alert: '<path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>',
    check: '<path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/>',
    refresh: '<polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>',
    users: '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
    trend: '<polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>',
    feed: '<line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/>',
    hash: '<line x1="4" y1="9" x2="20" y2="9"/><line x1="4" y1="15" x2="20" y2="15"/><line x1="10" y1="3" x2="8" y2="21"/><line x1="16" y1="3" x2="14" y2="21"/>',
    clock: '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>',
    search: '<circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>',
    ext: '<path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/>',
    info: '<circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/>',
    x: '<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>',
    left: '<polyline points="15 18 9 12 15 6"/>',
    right: '<polyline points="9 18 15 12 9 6"/>',
  };
  const icon = (name, cls) => `<svg class="ic${cls ? ' ' + cls : ''}" viewBox="0 0 24 24" aria-hidden="true">${ICON_PATHS[name]}</svg>`;
  function iconEl(name, cls) {
    const t = document.createElement('template');
    t.innerHTML = icon(name, cls);
    return t.content.firstChild;
  }

  const HTML = `
    <div class="app" id="app">
      <header class="top">
        <div class="top-in">
          <div class="brand">
            <span class="logo">${icon('radar')}</span>
            <div class="brand-text"><h1>Reddit 账号监控</h1><span class="updated" id="updated"></span></div>
          </div>
          <div class="actions">
            <button class="btn" id="manage"></button>
            <button class="btn primary" id="refresh"></button>
            <button class="btn icon" id="close" title="返回 Reddit" aria-label="返回 Reddit">${icon('x')}</button>
          </div>
        </div>
        <div class="strip" id="progress" hidden><div class="bar"><span id="barfill"></span></div><span class="ptext" id="ptext"></span></div>
        <div class="strip" id="banner-wrap" hidden><span class="banner" id="banner"></span></div>
        <div class="strip" id="notice-wrap" hidden><span class="ptext" id="notice"></span></div>
        <nav class="toc" id="toc" aria-label="页面目录" hidden></nav>
      </header>
      <main id="main"></main>

      <div class="modal" id="acct" hidden>
        <div class="sheet wide" role="dialog" aria-modal="true" aria-labelledby="acct-title">
          <div class="sheet-head">
            <div class="acct-head"><span id="acct-av"></span><div class="acct-id"><h2 id="acct-title"></h2><div class="acct-sub" id="acct-sub"></div></div></div>
            <div class="tools">
              <button class="btn icon" id="acct-prev" aria-label="上一个账号" title="上一个（←）">${icon('left')}</button>
              <span class="note nowrap" id="acct-pos"></span>
              <button class="btn icon" id="acct-next" aria-label="下一个账号" title="下一个（→）">${icon('right')}</button>
              <button class="btn" id="acct-refresh" title="只重新采集这一个账号，其他账号的数据不动">${icon('refresh')}只更新这个账号</button>
              <a class="btn" id="acct-link" target="_blank" rel="noopener">${icon('ext')}主页</a>
              <button class="btn icon" id="acct-close" aria-label="关闭">${icon('x')}</button>
            </div>
          </div>
          <div class="sheet-body" id="acct-body"></div>
        </div>
      </div>

      <div class="modal" id="mgr" hidden>
        <div class="sheet" role="dialog" aria-modal="true" aria-labelledby="mgr-title">
          <div class="sheet-head"><h2 id="mgr-title">管理监控账号</h2><button class="btn icon" id="mgr-close" aria-label="关闭">${icon('x')}</button></div>
          <div class="sheet-body">
            <div class="mgr-add">
              <label class="mgr-label" for="mgr-input">粘贴要添加的账号</label>
              <p class="note">每行一个。可以只贴主页链接，也可以「名称 + 链接」，或者直接从 Excel 复制两列。用户名以链接为准，名称会记成备注。按 ⌘/Ctrl + Enter 直接加入。</p>
              <textarea id="mgr-input" spellcheck="false" placeholder="https://www.reddit.com/user/8Leafs/&#10;墨西哥一号  https://www.reddit.com/user/Latent_Frame/&#10;u/Moritablue"></textarea>
              <div class="tools">
                <button class="btn primary" id="mgr-add" disabled>加入名单</button>
                <button class="btn" id="mgr-replace" disabled>用这些替换整个名单</button>
                <span class="note" id="mgr-parse"></span>
              </div>
              <ul class="mgr-problems" id="mgr-problems"></ul>
            </div>
            <div class="mgr-list">
              <div class="card-head"><h3 id="mgr-count"></h3><span class="note" id="mgr-diff"></span></div>
              <div class="mgr-removed" id="mgr-removed" hidden></div>
              <div class="card flush"><div class="tablebox"><table id="mgr-table"><thead><tr><th>用户名</th><th>备注</th><th>变化</th><th>检查</th><th></th></tr></thead><tbody></tbody></table></div></div>
            </div>
          </div>
          <div class="sheet-foot">
            <span class="note" id="mgr-msg"></span>
            <button class="btn" id="mgr-cancel">取消</button>
            <button class="btn primary" id="mgr-save" disabled>保存名单</button>
          </div>
        </div>
      </div>
    </div>
  `;

  const host = document.createElement('div');
  host.id = 'rmd-host';
  host.style.cssText = 'position:fixed;inset:0;z-index:2147483647;display:none;';
  const root = host.attachShadow({ mode: 'open' });
  root.innerHTML = `<style>${CSS}#manage,#refresh,#close,#acct-refresh,#reset{display:none !important}</style>${HTML}`;
  document.documentElement.appendChild(host);

  const tab = document.createElement('div');
  tab.textContent = '账号监控';
  tab.title = '打开 Reddit 账号监控看板';
  tab.style.cssText = 'position:fixed;right:0;top:50%;transform:translateY(-50%);z-index:2147483646;color:#fff;'
    + 'background:#c7000b;writing-mode:vertical-rl;padding:14px 8px;border-radius:8px 0 0 8px;'
    + 'font:700 12px/1 "Microsoft YaHei","PingFang SC",-apple-system,sans-serif;letter-spacing:.14em;cursor:pointer;user-select:none;'
    + 'box-shadow:-2px 2px 8px rgba(0,0,0,.18);';
  /* 在线查看版不需要入口按钮 */

  const $ = (id) => root.getElementById(id);
  const state = {
    latest: load(STORE.latest, null), D: null, running: false, viewer: null, open: false, confirmUntil: 0, forceUntil: 0,
    statusFilter: 'all', search: '', sort: { f: null, dir: -1 }, order: [],
    feedKind: '', feedLimit: 20,
    acct: null, acctKind: '', acctSort: 'time', acctLimit: 15, acctMore: false, acctSource: false, jumpAt: 0,
  };
  const reduceMotion = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined && text !== null) e.textContent = text;
    return e;
  }
  function chip(text, cls) { return el('span', 'chip ' + cls, text); }
  const statusClass = (st) => (st === '正常' ? 'ok' : st === '查询失败' ? 'warn' : st === '已封禁' ? 'ban' : 'bad');
  const levelClass = (l) => (l === '严重' ? 'bad' : l === '注意' ? 'warn' : 'muted');
  const STATUS_ORDER = ['已封禁', '疑似 shadowban', '查询失败', '正常'];

  function hue(u) {
    let h = 7;
    for (const ch of lc(u)) h = (h * 31 + ch.charCodeAt(0)) % 360;
    return h;
  }
  // 头像：采到了 Reddit 头像就显示图片，图片加载不出来或没有头像时显示用户名前两个字母
  function avatar(u, size) {
    const a = el('span', 'av' + (size ? ' av-' + size : ''));
    a.style.setProperty('--h', String(hue(u)));
    a.setAttribute('aria-hidden', 'true');
    const letters = (u.replace(/[^A-Za-z0-9]/g, '') || u).slice(0, 2).toUpperCase();
    const src = state.D ? state.D.avatarOf(u) : '';
    if (!src) { a.textContent = letters; return a; }
    const img = document.createElement('img');
    img.alt = '';
    img.loading = 'lazy';
    img.referrerPolicy = 'no-referrer';
    img.addEventListener('error', () => { a.textContent = letters; }, { once: true });
    img.src = src;
    a.appendChild(img);
    return a;
  }
  function who(u, size) {
    const w = el('span', 'who');
    const t = el('span', '');
    t.appendChild(el('span', 'who-name', u));
    const lb = state.D ? state.D.label(u) : '';
    if (lb) t.appendChild(el('span', 'sublabel', lb));
    w.append(avatar(u, size), t);
    return w;
  }

  let sparkSeq = 0;
  function spark(values, color, type) {
    const svg = s('svg', { viewBox: '0 0 100 32', preserveAspectRatio: 'none', class: 'spark', 'aria-hidden': 'true' });
    if (!values.length) return svg;
    const max = Math.max(...values);
    const min = type === 'bars' ? 0 : Math.min(...values);
    const y = (v) => (max === min ? 16 : 30 - ((v - min) / (max - min)) * 27);
    if (type === 'bars') {
      const w = 100 / values.length;
      values.forEach((v, i) => {
        if (v > 0) s('rect', { x: i * w + w * 0.18, width: w * 0.64, y: y(v), height: 30 - y(v) + 0.01, rx: 0.6, style: `fill:${color};opacity:.9` }, svg);
        else s('rect', { x: i * w + w * 0.18, width: w * 0.64, y: 29.2, height: 0.8, style: 'fill:#e2e5ea' }, svg);
      });
      return svg;
    }
    const x = (i) => (values.length === 1 ? 50 : (i / (values.length - 1)) * 100);
    const pts = values.map((v, i) => [x(i), y(v)]);
    if (pts.length < 2) {
      s('line', { x1: 0, x2: 100, y1: 16, y2: 16, style: `stroke:${color}`, 'stroke-dasharray': '2 3', 'vector-effect': 'non-scaling-stroke', opacity: 0.6 }, svg);
      return svg;
    }
    const id = 'rmd-sp' + (++sparkSeq);
    const grad = s('linearGradient', { id, x1: 0, x2: 0, y1: 0, y2: 1 }, s('defs', {}, svg));
    s('stop', { offset: 0, style: `stop-color:${color};stop-opacity:.18` }, grad);
    s('stop', { offset: 1, style: `stop-color:${color};stop-opacity:0` }, grad);
    const line = pts.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(2) + ',' + p[1].toFixed(2)).join('');
    s('path', { d: `${line}L100,32L0,32Z`, fill: `url(#${id})` }, svg);
    s('path', { d: line, fill: 'none', style: `stroke:${color}`, 'stroke-width': 2, 'vector-effect': 'non-scaling-stroke', 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }, svg);
    return svg;
  }

  function setRefresh(running) {
    const b = $('refresh');
    b.disabled = running;
    b.replaceChildren(iconEl('refresh', running ? 'spin' : ''), document.createTextNode(running ? '采集中…' : '获取最新数据'));
    $('acct-refresh').disabled = running;
  }
  setRefresh(false);

  function openDash() {
    if (state.open) return;
    state.open = true;
    host.style.display = 'block';
    tab.style.display = 'none';
    document.documentElement.style.overflow = 'hidden';
    render();
    const vs = VIEW.status;
    if (vs && vs.ok === false && !vs.skipped && !vs.partial) { // 部分成功的情况，下面「上次采集提前停止」那条提示已经说清楚了
      const when = vs.at ? new Date(vs.at).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : '';
      $('banner').textContent = `最近一次云端自动采集${when ? `（${when}）` : ''}没有成功：${vs.reason || '原因不明'}。${state.latest ? '下面显示的是上一次成功采集的数据。' : ''}`;
      $('banner-wrap').hidden = false;
    }
  }
  function closeDash() {
    state.open = false;
    host.style.display = 'none';
    tab.style.display = '';
    document.documentElement.style.overflow = '';
    if (location.hash === '#rm-dashboard') history.replaceState(null, '', location.pathname + location.search);
  }
  tab.addEventListener('click', openDash);
  $('close').addEventListener('click', closeDash);
  const onKey = (e) => {
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test((e.target && e.target.tagName) || '');
    if (!$('acct').hidden && !typing && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
      e.preventDefault();
      stepAccount(e.key === 'ArrowLeft' ? -1 : 1);
      return;
    }
    if (e.key !== 'Escape') return;
    if (!$('acct').hidden) closeAccount();
    else if (!$('mgr').hidden) closeManager();
    /* 在线查看版没有可以返回的页面 */
  };
  root.addEventListener('keydown', onKey);
  document.addEventListener('keydown', (e) => { if (e.target !== host) onKey(e); });
  const wantsOpen = () => true;
  window.addEventListener('hashchange', () => { if (wantsOpen()) openDash(); });

  // 确认这个浏览器登录了 Reddit。返回：'ok' 已登录 / 'anon' 没登录 / 'limited' Reddit 正在限速，问不出来 / 'unknown' 没问出来，也看不出没登录。
  // 没登录时 Reddit 的频率限制严得多、很多接口直接拒绝，硬采只会又慢又不全，所以采集前必须先过这一关。
  async function checkViewer() {
    let status = 'unknown';
    let detail = '';
    // Reddit 页面本身怎么说：有用户菜单、没有「登录」按钮 = 已登录（'in'）；反过来 = 没登录（'out'）；看不出来 = ''
    const pageSays = () => {
      const loginBtn = document.querySelector('#login-button, a[href*="reddit.com/login"], faceplate-tracker[noun="login"]');
      const userMenu = document.querySelector('#expand-user-drawer-button, faceplate-tracker[noun="user_drawer"], [id^="USER_DROPDOWN"]');
      return userMenu && !loginBtn ? 'in' : loginBtn && !userMenu ? 'out' : '';
    };
    try {
      const j = await getJson('/api/me.json', null, { noRetry: true });
      state.viewer = (j && j.data && j.data.name) || null;
      // 接口没给用户名，但页面上明明有用户菜单：两边说法不一致，不下「没登录」的结论
      status = state.viewer ? 'ok' : pageSays() === 'in' ? 'unknown' : 'anon';
      if (!state.viewer) detail = '登录接口没有返回用户名';
    } catch (e) {
      state.viewer = null;
      detail = e.message;
      status = e.status === 429 ? 'limited' : pageSays() === 'out' ? 'anon' : 'unknown';
    }
    const banner = $('banner');
    let msg = '';
    if (status === 'anon') msg = '这个浏览器看起来没有登录 Reddit。没登录时 Reddit 的频率限制严得多，很多数据也不给，采集会又慢又不全。请先登录（用一个不在监控名单里的账号），再点「获取最新数据」。';
    else if (status === 'limited') msg = 'Reddit 正在限制这个浏览器的请求频率，暂时确认不了登录状态。请过 10 分钟左右再试。';
    else if (status === 'unknown') msg = `没能确认登录状态（${detail}）。如果 Reddit 页面右上角显示的是「登录」按钮，请先登录再采集。`;
    else if (userList().some((n) => n.toLowerCase() === state.viewer.toLowerCase())) msg = `当前登录的 u/${state.viewer} 在监控名单里。自己看自己时查不出 shadowban，建议换一个不在名单里的账号登录。`;
    banner.textContent = msg;
    $('banner-wrap').hidden = !msg;
    return status;
  }

  // 顶栏的高度会变（进度条、提示条时有时无）：记到样式变量里，目录跳转时让标题正好停在顶栏下面
  const syncTop = () => $('app').style.setProperty('--top-h', Math.round(root.querySelector('.top').getBoundingClientRect().height) + 'px');
  new ResizeObserver(syncTop).observe(root.querySelector('.top'));

  let noticeTimer = null;
  function showNotice(text, ms) {
    $('notice').textContent = text;
    $('notice-wrap').hidden = false;
    clearTimeout(noticeTimer);
    noticeTimer = setTimeout(() => { $('notice-wrap').hidden = true; }, ms || 8000);
  }

  // 采集入口。names：要采集的账号；opts.subset：只更新这几个账号（其余账号的数据不动）。
  async function runCollect(names, opts = {}) {
    if (VIEW) return; // 在线查看版不采集
    if (state.running || !names.length) return;
    if (!opts.subset) {
      // 刚完整采集过：先提醒一次，10 秒内再点才继续。连续采集是最容易招来限速的做法。
      const mins = (Date.now() - (loadRoute().lastRunAt || 0)) / 60000;
      if (mins < FLOW.cooldownMin && Date.now() > state.confirmUntil) {
        state.confirmUntil = Date.now() + 10000;
        showNotice(`距离上次完整采集只有 ${Math.max(1, Math.round(mins))} 分钟。连续采集容易被 Reddit 限速，建议至少间隔 ${FLOW.cooldownMin} 分钟；只想补几个账号，可以在账号详情里点「只更新这个账号」。仍要现在采集，请在 10 秒内再点一次。`, 10000);
        return;
      }
    }
    state.confirmUntil = 0;
    state.running = true;
    setRefresh(true);
    $('notice-wrap').hidden = true;
    $('progress').hidden = false;
    $('barfill').style.width = '0%';
    $('ptext').textContent = '正在确认登录状态…';
    let keep = false;
    try {
      // 先确认登录：没登录或正被限速时不开始，免得白白发一堆会被拒的请求
      // 这个判断没法在真实的 Reddit 上验证过，所以留一条退路：10 秒内再点一次就照常采集。
      const who = await checkViewer();
      if ((who === 'anon' || who === 'limited') && Date.now() > state.forceUntil) {
        state.forceUntil = Date.now() + 10000;
        const why = who === 'anon' ? '这个浏览器看起来没有登录 Reddit。请先登录，再点「获取最新数据」' : 'Reddit 正在限制这个浏览器的请求频率。建议过 10 分钟左右再试';
        throw Object.assign(new Error(`${why}；如果确认没有问题，10 秒内再点一次会照常采集`), { preflight: true });
      }
      state.forceUntil = 0;
      state.latest = await collectAll(names, (frac, text) => {
        $('barfill').style.width = Math.round(frac * 100) + '%';
        $('ptext').textContent = text;
      }, opts);
      const m = state.latest.meta;
      const f = m.flow;
      const cost = `用时 ${fmtDur(f.took_s * 1000)}，发出 ${f.requests} 次请求，${f.limited ? `中途被限速 ${f.limited} 次，已自动降速` : '没有触发限速'}。`;
      if (m.halted) {
        keep = true;
        $('ptext').textContent = `采集提前停止：${m.halted}。已更新 ${m.updated.length} 个账号，其余账号沿用上次的数据。${cost}建议至少 30 分钟后再试。`;
      } else {
        $('ptext').textContent = `完成：更新了 ${m.updated.length} 个账号${opts.subset ? '（其余账号的数据没有动）' : ''}，共 ${state.latest.items.filter((i) => m.updated.includes(i.username)).length} 条发帖和评论。${cost}`;
      }
      $('barfill').style.width = '100%';
      render();
    } catch (e) {
      keep = true;
      $('ptext').textContent = e.preflight ? `没有开始采集：${e.message}。已有的数据没有改动。` : `采集没有完成：${e.message}。已有的数据没有改动，建议至少 30 分钟后再试。`;
    } finally {
      state.running = false;
      setRefresh(false);
      if (!keep) setTimeout(() => { if (!state.running) $('progress').hidden = true; }, 15000);
    }
  }
  $('refresh').addEventListener('click', () => runCollect(userList()));
  $('acct-refresh').addEventListener('click', () => { if (state.acct) runCollect([state.acct], { subset: true }); });

  // ---------- 页面骨架 ----------
  // 一页从上到下读完，不分标签页：结论 → 需要关注 → 账号档案 → 活跃与影响力 → 内容表现 → 社区与时段 → 全部动态。
  // 每一块的标题直接写结论（由数据生成），图表和表格是标题的证据；顶部目录点一下跳到对应的块。
  const SECTIONS = [['summary', '结论'], ['alerts', '需要关注'], ['roster', '账号档案'], ['trend', '活跃与影响力'], ['content', '内容表现'], ['where', '社区与时段'], ['feed', '全部动态']];
  const LEGEND_PC = '<div class="legend"><span><i class="sw" style="background:var(--c1)"></i>帖子</span><span><i class="sw" style="background:var(--c2)"></i>评论</span></div>';
  const secHead = (id, kicker, tools) => `<div class="sec-head"><div class="sec-titles"><span class="sec-kicker">${kicker}</span><h2 class="sec-title" id="t-${id}"></h2></div>${tools || ''}</div>`;
  const KIND_FILTERS = [['', '全部'], ['帖子', '帖子'], ['评论', '评论'], ['media', '带图 / 视频'], ['removed', '被删除']];
  const matchKind = (i, k) => !k || (k === 'removed' ? !!i.removed : k === 'media' ? !!i.media : i.kind === k);
  const MAIN = `
    <div class="page">
      <div class="pending" id="pending" hidden></div>

      <section class="sec hero" id="sec-summary">
        <span class="sec-kicker" id="k-summary"></span>
        <h2 class="headline" id="headline"></h2>
        <div class="kpis" id="kpis"></div>
        <ul class="points" id="points"></ul>
        <div class="cover" id="cover"></div>
      </section>

      <section class="sec" id="sec-alerts">
        ${secHead('alerts', '需要关注')}
        <div class="card"><ul class="agroups" id="agroups"></ul></div>
      </section>

      <section class="sec" id="sec-roster">
        ${secHead('roster', '账号档案', `<div class="toolbar">
          <div class="seg" id="status-filter" role="group" aria-label="按状态筛选"><button data-f="all"></button><button data-f="risk"></button><button data-f="ok"></button></div>
          <label class="search">${icon('search')}<input class="input" id="search" type="search" placeholder="搜索账号、备注或社区" aria-label="搜索账号、备注或社区"></label>
        </div>`)}
        <div class="card flush"><div class="tablebox grow"><table id="tbl-accounts"><thead>
          <tr><th rowspan="2" data-f="username"><button class="sortbtn">账号</button></th><th rowspan="2" data-f="status"><button class="sortbtn">状态</button></th>
            <th colspan="5" class="grp">个人资料</th><th colspan="5" class="grp">近 ${WINDOW_DAYS} 天表现</th></tr>
          <tr>
            <th class="grp-first">标记</th>
            <th data-f="created"><button class="sortbtn">注册时间</button></th>
            <th data-f="followers" class="r"><button class="sortbtn">粉丝</button></th>
            <th data-f="total_karma" class="r"><button class="sortbtn">Karma</button></th>
            <th data-f="karma_delta" class="r"><button class="sortbtn" id="delta-head">近 7 天</button></th>
            <th data-f="posts_30d" class="r grp-first"><button class="sortbtn">发帖</button></th>
            <th data-f="comments_30d" class="r"><button class="sortbtn">评论</button></th>
            <th data-f="removed" class="r"><button class="sortbtn">被删</button></th>
            <th data-f="last_active"><button class="sortbtn">最近活跃</button></th>
            <th data-f="top_subreddit"><button class="sortbtn">主阵地</button></th>
          </tr></thead><tbody></tbody></table></div></div>
        <p class="note">点任意一行看这个账号的详情；点「发帖」「评论」的数字，直接看这个账号对应的明细。表头可以排序。</p>
      </section>

      <section class="sec" id="sec-trend">
        ${secHead('trend', '活跃与影响力')}
        <div class="grid2">
          <div class="card"><div class="card-head"><h3>每天发帖和评论</h3>${LEGEND_PC}</div><div class="chart" id="chart-activity"></div></div>
          <div class="card"><div class="card-head"><h3>Karma 总量</h3><span class="note" id="karma-note"></span></div><div class="chart" id="chart-karma"></div></div>
        </div>
        <details class="card disclose" id="growth-box">
          <summary><span class="dtitle">按账号看 karma 增量</span><span class="note">每个账号一张小图，同一刻度；点小图看账号详情</span></summary>
          <div class="multi" id="growth"></div>
        </details>
      </section>

      <section class="sec" id="sec-content">
        ${secHead('content', '内容表现')}
        <div class="grid2 lean">
          <div class="card flush">
            <div class="card-head pad"><h3>得分最高的帖子</h3><span class="note">近 ${WINDOW_DAYS} 天 · 不含已被删除的</span></div>
            <div class="tablebox grow"><table id="tbl-top"><thead><tr><th></th><th>帖子</th><th>账号</th><th class="r">分数</th><th class="r">评论数</th><th class="r hide-narrow">好评率</th></tr></thead><tbody></tbody></table></div>
          </div>
          <div class="card"><div class="card-head"><h3>被删除的内容</h3><span class="note" id="removed-note"></span></div><ul class="ilist" id="removed-list"></ul></div>
        </div>
        <details class="card disclose" id="tracks-box">
          <summary><span class="dtitle">近 7 天新帖的分数走势</span><span class="note">每次采集给每个帖子记一个点；曲线很早就变平，多半是被删了或没被看到</span></summary>
          <div class="legend" id="posts-legend"></div>
          <div class="chart" id="chart-posts"></div>
        </details>
      </section>

      <section class="sec" id="sec-where">
        ${secHead('where', '社区与时段')}
        <div class="grid2">
          <div class="card"><div class="card-head"><h3>内容最多的 10 个社区</h3>${LEGEND_PC}</div><div class="chart" id="chart-subs"></div></div>
          <div class="card"><div class="card-head"><h3>活跃时段</h3><span class="note">墨西哥城时间 · 颜色越深越多</span></div><div class="chart" id="chart-heat"></div></div>
        </div>
      </section>

      <section class="sec" id="sec-feed">
        ${secHead('feed', '全部动态', `<div class="seg" id="kinds" role="group" aria-label="按类型筛选">${KIND_FILTERS.map(([k, t]) => `<button data-kind="${k}">${t}</button>`).join('')}</div>`)}
        <div class="card flush">
          <div class="tablebox grow"><table id="tbl-feed"><thead><tr>
            <th>时间（墨西哥城）</th><th>账号</th><th>类型</th><th class="hide-narrow">社区</th><th>内容</th>
            <th class="r">分数</th><th class="r hide-narrow">评论数</th><th class="r hide-narrow">好评率</th><th>状态</th>
          </tr></thead><tbody></tbody></table></div>
        </div>
        <button class="morebtn" id="feed-more" hidden></button>
      </section>

      <details class="about" id="about">
        <summary>${icon('info')}关于这些数据</summary>
        <ul class="notes">
          <li>数据由云端定时任务自动采集：它在云端打开一个登录了 Reddit 的浏览器，运行和油猴脚本相同的采集程序。每次采集都会存一次 karma 和帖子分数快照，趋势曲线会逐日连起来。这个页面只负责显示，不向 Reddit 发任何请求。</li>
          <li>只统计近 ${WINDOW_DAYS} 天的内容。个人资料（头像、简介、注册时间、粉丝、karma）来自账号的公开资料页。</li>
          <li>隐藏了主页的账号：主页是空的，但内容在 Reddit 站内搜索里仍然查得到。看板按「author:"用户名"」分别查帖子和评论两个结果页，再向 Reddit 批量查最新分数和删除状态（依次试 api.reddit.com、old.reddit.com、www.reddit.com，记住走得通的那条）。三条路都被拒时，最近 7 天的帖子逐个查，其余显示搜索页上的票数，这部分没有删除状态，被删比例只按查得到状态的内容计算。</li>
          <li>流量控制：采集前先确认登录状态，没登录不开始。所有请求统一排队，同时最多 ${FLOW.maxActive} 个，间隔带随机量；Reddit 给的额度变少时提前放慢；被限速就等到 Reddit 允许的时间再自动继续，原本能用的接口中途被拦就自动停止，已拿到的数据照常保存。</li>
          <li>为了少发请求：每个账号第一次采集会把近 ${WINDOW_DAYS} 天完整翻一遍，之后 ${FULL_SWEEP_DAYS} 天内每次只翻新的部分（发布超过 ${FRESH_DAYS} 天的内容沿用之前的记录）；已确认隐藏的主页 ${HIDDEN_RECHECK_DAYS} 天内不再重复读；上次被拒的接口 24 小时内不再试探。</li>
          <li>拿不到的数据：帖子浏览量（只有作者本人能看到）、点赞和点踩各自的数量、评论的好评率和回复数。Reddit 还会对分数做轻微模糊处理。</li>
          <li>疑似 shadowban：访问账号资料返回 404，也可能是账号已注销。已封禁：资料页明确显示封禁。</li>
          <li>监控名单和采集时间在云端项目里修改（accounts.json 和定时设置），这个页面只用来查看。</li>
        </ul>
        <div class="tools"><button class="linkbtn" id="export">导出数据（JSON）</button><button class="linkbtn" id="reset">清除本机保存的全部数据</button></div>
      </details>
    </div>
  `;

  const goSection = (id) => { const n = $('sec-' + id); if (n) n.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' }); };
  const b = (text, cls) => el('b', cls || '', String(text));
  const ageText = (days) => (days === null || days === undefined ? '' : days < 60 ? `${days} 天` : days < 730 ? `${Math.floor(days / 30.44)} 个月` : `${(days / 365.25).toFixed(1)} 年`);
  const signedPct = (x) => (x > 0 ? '+' : x < 0 ? '−' : '') + Math.abs(Math.round(x * 100)) + '%';

  function render() {
    const main = $('main');
    $('manage').replaceChildren(iconEl('users'), document.createTextNode(`管理账号 · ${userList().length}`));
    if (!state.latest) {
      state.D = null;
      $('toc').hidden = true;
      $('updated').textContent = `还没有数据 · 云端自动采集 · v${VERSION}`;
      const wrap = el('div', 'page solo');
      const box = el('div', 'empty');
      const logo = el('span', 'logo');
      logo.appendChild(iconEl('radar'));
      box.append(logo, el('h2', '', '还没有数据'), el('p', '', `云端还没有成功采集过数据。名单里有 ${userList().length} 个账号，第一次自动采集完成后，刷新这个页面就能看到。`));
      wrap.appendChild(box);
      main.replaceChildren(wrap);
      return;
    }
    state.D = derive(state.latest);
    if (!main.querySelector('#sec-summary')) { main.innerHTML = MAIN; bindMain(); }
    const D = state.D;
    const at = state.latest.meta.collected_at;
    $('updated').textContent = `数据更新于 ${new Date(at).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}（${ago(at)}）· 监控 ${D.perAccount.length} 个账号 · 云端自动采集 · v${VERSION}`;
    renderNotices();
    renderSummary();
    renderAlerts();
    renderRoster();
    renderTrend();
    renderContent();
    renderWhere();
    renderFeed();
    renderToc();
    drawCharts();
    if (state.acct) renderAccount(true);
  }

  function bindMain() {
    root.querySelectorAll('#status-filter button').forEach((btn) => btn.addEventListener('click', () => { state.statusFilter = btn.dataset.f; renderRoster(); }));
    $('search').addEventListener('input', (e) => { state.search = e.target.value; renderRoster(); });
    root.querySelectorAll('#tbl-accounts th[data-f]').forEach((th) => {
      th.querySelector('.sortbtn').addEventListener('click', () => {
        const f = th.dataset.f;
        if (state.sort.f === f) state.sort.dir = -state.sort.dir;
        else state.sort = { f, dir: ['username', 'status', 'top_subreddit', 'created'].includes(f) ? 1 : -1 };
        renderRoster();
      });
    });
    root.querySelectorAll('#kinds button').forEach((btn) => {
      btn.addEventListener('click', () => { state.feedKind = btn.dataset.kind; state.feedLimit = 20; renderFeed(); });
    });
    $('feed-more').addEventListener('click', () => { state.feedLimit += 20; renderFeed(); });
    $('growth-box').addEventListener('toggle', drawCharts);
    $('tracks-box').addEventListener('toggle', drawCharts);
    $('export').addEventListener('click', () => {
      const blob = new Blob([JSON.stringify({ script_version: VERSION, users: userEntries(), route: load(STORE.route, {}), latest: state.latest, karma_history: load(STORE.karma, {}), post_obs: load(STORE.posts, {}) })], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `reddit_monitor_${mxDay(Date.now())}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    });
    $('reset').addEventListener('click', () => {
      if (!window.confirm('会清除最近一次采集结果和所有历史快照，监控名单保留。确定清除吗？')) return;
      [STORE.latest, STORE.karma, STORE.posts, STORE.status, STORE.route].forEach((k) => { try { localStorage.removeItem(k); } catch (e) { /* ignore */ } });
      state.latest = null;
      closeAccount();
      render();
    });
  }

  // 顶部目录：点一下跳到对应的块；滚动时标出当前所在的块
  function renderToc() {
    const D = state.D;
    const toc = $('toc');
    toc.hidden = false;
    const serious = D.alerts.filter((a) => a.level === '严重').length;
    toc.replaceChildren(...SECTIONS.map(([id, name]) => {
      const btn = el('button', '', name);
      btn.dataset.sec = id;
      if (id === 'alerts' && D.alerts.length) btn.appendChild(el('span', 'count' + (serious ? ' hot' : ''), String(D.alerts.length)));
      if (id === 'roster') btn.appendChild(el('span', 'count', String(D.perAccount.length)));
      btn.addEventListener('click', () => goSection(id));
      return btn;
    }));
    markToc();
  }
  function markToc() {
    const app = $('app');
    const toc = $('toc');
    if (!toc || toc.hidden) return;
    const line = root.querySelector('.top').getBoundingClientRect().bottom + 60;
    let current = SECTIONS[0][0];
    SECTIONS.forEach(([id]) => { const n = $('sec-' + id); if (n && n.getBoundingClientRect().top <= line) current = id; });
    toc.querySelectorAll('button').forEach((btn) => btn.setAttribute('aria-current', String(btn.dataset.sec === current)));
  }
  let tocTick = 0;
  $('app').addEventListener('scroll', () => { if (!tocTick) tocTick = requestAnimationFrame(() => { tocTick = 0; markToc(); }); }, { passive: true });

  // 提示条：数据是旧版脚本采的、上次采集提前停止、有新账号还没采
  function renderNotices() {
    const D = state.D;
    const meta = state.latest.meta;
    const rows = [];
    const dataVer = meta.version || '';
    if (dataVer !== VERSION && !VIEW) {
      rows.push([`现在显示的还是${dataVer ? ' v' + dataVer + ' ' : '旧版脚本'}采集的数据。请重新采集一次，页面上的资料和明细才是完整的。`, '获取最新数据', () => runCollect(userList())]);
    }
    if (meta.halted) rows.push([`上次采集提前停止（${meta.halted}），只更新了 ${(meta.updated || []).length} 个账号${D.staleAccounts.length ? `，另外 ${D.staleAccounts.length} 个沿用的是更早的数据` : ''}。下一次定时采集会自动再试。`]);
    else if (D.staleAccounts.length) rows.push([`${D.staleAccounts.length} 个账号的数据不是最近这次采集更新的：${D.staleAccounts.slice(0, 6).map((a) => a.username).join('、')}${D.staleAccounts.length > 6 ? ' 等' : ''}。`]);
    if (D.pending.length) rows.push([`${D.pending.length} 个新加入的账号还没有数据：${D.pending.join('、')}。`, `只采集这 ${D.pending.length} 个`, () => runCollect(D.pending, { subset: true })]);
    const box = $('pending');
    box.hidden = !rows.length;
    box.replaceChildren(...rows.map(([text, label, fn]) => {
      const row = el('div', 'notice');
      row.appendChild(el('span', '', text));
      if (label && !VIEW) { const btn = el('button', 'btn primary', label); btn.addEventListener('click', fn); row.appendChild(btn); }
      return row;
    }));
  }

  // ---------- 结论 ----------
  const karmaSeries = (D, names) => D.days.map((day) => {
    const vals = names.map((n) => (D.karmaHist[n] || {})[day]).filter((v) => v !== undefined);
    return vals.length ? { day, v: vals.reduce((x, y) => x + y, 0) } : null;
  }).filter(Boolean);
  const activityRows = (D, items) => D.activityDays.map((day) => {
    const today = items.filter((i) => mxDay(Date.parse(i.created)) === day);
    return { day, posts: today.filter((i) => i.kind === '帖子').length, comments: today.filter((i) => i.kind === '评论').length, removed: today.filter((i) => i.removed).length };
  });
  function subsRows(items) {
    const bySub = {};
    items.forEach((i) => {
      const r = bySub[i.subreddit] || (bySub[i.subreddit] = { sub: i.subreddit, posts: 0, comments: 0, score: 0, removed: 0 });
      if (i.kind === '帖子') r.posts += 1; else r.comments += 1;
      r.score += i.score || 0;
      if (i.removed) r.removed += 1;
    });
    return Object.values(bySub).sort((x, y) => y.posts + y.comments - (x.posts + x.comments)).slice(0, 10);
  }

  // 全页共用的几组数：各块的结论句和首屏指标都从这里取，保证口径一致
  function facts(D) {
    const rows = D.perAccount;
    const items = D.items;
    const counts = {};
    rows.forEach((r) => { counts[r.status] = (counts[r.status] || 0) + 1; });
    const risk = rows.length - (counts['正常'] || 0);
    const posts = items.filter((i) => i.kind === '帖子');
    const comments = items.filter((i) => i.kind === '评论');
    const removed = items.filter((i) => i.removed);
    const judged = items.filter((i) => i.removed !== null && i.removed !== undefined); // 查得到删除状态的内容
    const rateOk = judged.length > 0 && judged.length >= items.length * RATE_MIN_COVERAGE; // 状态查得够全，比例才有意义
    const ageDays = (i) => (D.snapMs - Date.parse(i.created)) / 864e5;
    const last7 = items.filter((i) => ageDays(i) <= 7).length;
    const prev7 = items.filter((i) => ageDays(i) > 7 && ageDays(i) <= 14).length;
    const delta = rows.some((r) => r.karma_delta !== null) ? sum(rows, (r) => r.karma_delta) : null;
    const scored = (xs) => xs.filter((i) => typeof i.score === 'number');
    const mean = (xs) => { const ys = scored(xs); return ys.length ? sum(ys, (i) => i.score) / ys.length : null; };
    return {
      rows, items, counts, risk, posts, comments, removed, judged, rateOk, last7, prev7, delta, mean,
      unjudged: items.length - judged.length,
      removed7: removed.filter((i) => ageDays(i) <= 7).length,
      totalKarma: sum(rows, (r) => r.total_karma),
      followers: rows.some((r) => typeof r.followers === 'number') ? sum(rows, (r) => r.followers) : null,
      hidden: rows.filter((r) => r.profile_hidden && r.status === '正常'),
      topSubs: subsRows(items).slice(0, 3),
      topPosts: scored(posts).filter((i) => !i.removed).sort((x, y) => y.score - x.score).slice(0, 5),
      byOutput: rows.filter((r) => r.posts_30d + r.comments_30d > 0).sort((x, y) => y.posts_30d + y.comments_30d - (x.posts_30d + x.comments_30d)),
      idle: rows.filter((r) => r.status === '正常' && r.posts_30d + r.comments_30d === 0),
      byGrowth: rows.filter((r) => typeof r.karma_delta === 'number').sort((x, y) => y.karma_delta - x.karma_delta),
    };
  }

  function renderSummary() {
    const D = state.D;
    const F = facts(D);
    const { rows, items } = F;
    $('k-summary').textContent = `本期结论 · 统计近 ${WINDOW_DAYS} 天`;
    $('headline').replaceChildren(...(F.risk
      ? [`${rows.length} 个账号中 ${rows.length - F.risk} 个状态正常，`, b(F.risk), ' 个状态异常']
      : [b(rows.length, 'calm'), ' 个账号状态全部正常']),
    items.length ? `；近 ${WINDOW_DAYS} 天共产出 ${fmtInt(items.length)} 条内容` : `；近 ${WINDOW_DAYS} 天没有采到内容`);

    // 四个指标：账号安不安全、做了多少、影响力涨没涨、内容留没留住。点一下跳到对应的块。
    const abnormal = STATUS_ORDER.filter((st) => st !== '正常' && F.counts[st]).map((st) => `${st} ${F.counts[st]}`).join(' · ');
    const wow = F.prev7 > 0 ? (F.last7 - F.prev7) / F.prev7 : null;
    const act = activityRows(D, items);
    const chipOf = (v, text) => el('span', 'delta ' + (v > 0 ? 'up' : v < 0 ? 'down' : 'flat'), text);
    const tiles = [
      { go: 'roster', cls: F.risk ? 'alarm' : 'calm', label: '账号健康', value: `${rows.length - F.risk}/${rows.length}`, unit: '正常',
        sub: [F.risk ? abnormal : '没有封禁或疑似 shadowban'] },
      { go: 'trend', label: `近 ${WINDOW_DAYS} 天产出`, value: fmtInt(items.length), unit: '条',
        sub: [`帖子 ${fmtInt(F.posts.length)} · 评论 ${fmtInt(F.comments.length)}`, ...(wow === null ? [] : [chipOf(wow, signedPct(wow)), '近 7 天较前 7 天'])],
        spark: spark(act.map((d) => d.posts + d.comments), '#1f3b64', 'bars') },
      { go: 'trend', label: 'Karma 总量', value: fmtInt(F.totalKarma), unit: '',
        sub: F.delta === null ? ['还没有可比的快照'] : [chipOf(F.delta, fmtSigned(F.delta)), D.deltaLabel],
        spark: spark(karmaSeries(D, D.names).map((p) => p.v), '#1f3b64', 'line') },
      { go: 'content', cls: F.rateOk && F.removed.length / F.judged.length >= 0.1 ? 'alarm' : '', label: '被删比例', value: F.rateOk ? fmtPct(F.removed.length / F.judged.length) : '—', unit: '',
        sub: [!items.length ? '没有内容' : !F.judged.length ? '这次查不到删除状态' : !F.rateOk ? `只查到 ${F.judged.length} 条的状态，其中 ${F.removed.length} 条被删` : `共 ${F.removed.length} 条 · 近 7 天 ${F.removed7} 条${F.unjudged ? ` · ${F.unjudged} 条状态未知` : ''}`],
        spark: spark(act.map((d) => d.removed), '#c7000b', 'bars') },
    ];
    $('kpis').replaceChildren(...tiles.map((t) => {
      const card = el('button', 'kpi' + (t.cls ? ' ' + t.cls : ''));
      card.type = 'button';
      card.title = '点一下看这一块的详情';
      const value = el('div', 'kpi-value', t.value);
      if (t.unit) value.appendChild(el('span', 'kpi-unit', t.unit));
      const sub = el('div', 'kpi-sub');
      sub.append(...t.sub);
      card.append(el('div', 'kpi-label', t.label), value, sub);
      if (t.spark) card.appendChild(t.spark);
      card.addEventListener('click', () => goSection(t.go));
      return card;
    }));

    // 要点：每条一句话，补充指标里看不出来的「是谁、在哪」
    const point = (k, ...nodes) => { const li = el('li'); li.append(el('span', 'k', k), ...nodes); return li; };
    const pts = [];
    if (F.byOutput.length) {
      const top = F.byOutput.slice(0, 3);
      pts.push(point('产出', '最多的是 ', ...top.flatMap((r, i) => [i ? '、' : '', b('u/' + r.username), `（${r.posts_30d + r.comments_30d} 条）`]),
        F.idle.length ? `；${F.idle.length} 个账号近 ${WINDOW_DAYS} 天没有动态。` : '。'));
    }
    const best = F.byGrowth[0];
    const worst = F.byGrowth[F.byGrowth.length - 1];
    if (best && best.karma_delta > 0) {
      pts.push(point('增长', 'karma 涨得最快的是 ', b('u/' + best.username), `（${D.deltaLabel} ${fmtSigned(best.karma_delta)}）`,
        worst && worst.karma_delta < 0 ? `；u/${worst.username} 下降 ${fmtInt(Math.abs(worst.karma_delta))}。` : '。'));
    }
    if (F.topSubs.length) pts.push(point('阵地', '内容最集中在 ', b(F.topSubs.map((r) => r.sub).join('、')), `，合计占 ${fmtPct(sum(F.topSubs, (r) => r.posts + r.comments) / items.length, 0)}。`));
    const worstRemoved = rows.filter((r) => r.removed > 0).sort((x, y) => y.removed - x.removed)[0];
    if (items.length && !F.judged.length) pts.push(point('留存', 'Reddit 这次没有返回删除状态，本期不判断留存。'));
    else if (items.length && !F.rateOk) pts.push(point('留存', `只有 ${F.judged.length} 条（最近的帖子）查得到删除状态，其中 `, b(F.removed.length), ` 条被删；其余 ${F.unjudged} 条这次查不到，本期不算被删比例。`));
    else if (F.removed.length) pts.push(point('留存', '有 ', b(F.removed.length), ` 条内容被删，其中近 7 天 ${F.removed7} 条`, worstRemoved ? `；最多的是 u/${worstRemoved.username}（${worstRemoved.removed} 条）。` : '。'));
    $('points').replaceChildren(...pts);
    $('points').hidden = !pts.length;

    const cover = [];
    if (F.hidden.length) cover.push(['主页隐藏的账号', `${F.hidden.length} 个，其中 ${F.hidden.filter((r) => r.posts_30d + r.comments_30d > 0).length} 个已通过站内搜索找回内容`]);
    const fromCard = items.filter((i) => i.via === 'search-cache').length;
    if (fromCard) cover.push(['票数来源', `${fromCard} 条取自搜索页上显示的数字，这部分没有删除状态`]);
    const carriedItems = items.filter((i) => i.via === 'history-cache').length;
    if (carriedItems) cover.push(['较早的内容', `${carriedItems} 条沿用之前采到的数字（发布超过 ${FRESH_DAYS} 天，分数基本不再变）`]);
    cover.push(['时间口径', '墨西哥城时间']);
    cover.push(['分数', 'Reddit 会做轻微模糊处理，看趋势即可']);
    $('cover').replaceChildren(...cover.map(([k, v]) => { const sp = el('span'); sp.append(`${k}：`, b(v)); return sp; }));
  }

  // ---------- 需要关注 ----------
  // 同一级别、同一类型的事项归成一组：严重的默认展开，其余先折叠，只露出类型、账号数和前几个头像
  function renderAlerts() {
    const D = state.D;
    const box = $('agroups');
    const users = new Set(D.alerts.map((a) => a.username));
    const serious = D.alerts.filter((a) => a.level === '严重').length;
    $('t-alerts').replaceChildren(...(D.alerts.length
      ? [b(users.size, serious ? '' : 'calm'), ` 个账号有 ${D.alerts.length} 件事需要关注`, serious ? `，其中 ${serious} 件严重` : '，没有严重问题']
      : [b('没有', 'calm'), '需要关注的事项，所有账号都在正常运转']));
    box.closest('.card').hidden = !D.alerts.length;
    if (!D.alerts.length) { box.replaceChildren(); return; }
    const groups = [];
    D.alerts.forEach((a) => {
      let g = groups.find((x) => x.level === a.level && x.kind === a.kind);
      if (!g) groups.push((g = { level: a.level, kind: a.kind, rows: [] }));
      g.rows.push(a);
    });
    const firstRender = !box.dataset.ready;
    const wasOpen = new Set([...box.querySelectorAll('details[open]')].map((d) => d.dataset.key));
    box.dataset.ready = '1';
    box.replaceChildren(...groups.map((g) => {
      const key = g.level + '|' + g.kind;
      const names = [...new Set(g.rows.map((r) => r.username))];
      const d = el('details', 'agroup');
      d.dataset.key = key;
      d.open = firstRender ? g.level === '严重' : wasOpen.has(key);
      const sm = el('summary');
      const peek = el('span', 'apeek');
      const avs = el('span', 'avs');
      names.slice(0, 4).forEach((n) => avs.appendChild(avatar(n, 'sm')));
      peek.append(avs, el('span', 'anames', names.slice(0, 3).join('、') + (names.length > 3 ? ' 等' : '')));
      sm.append(chip(g.level, levelClass(g.level)), el('span', 'akind', g.kind), el('span', 'acount', `${names.length} 个账号`), peek);
      const ul = el('ul', 'aitems');
      g.rows.forEach((r) => {
        const btn = el('button', 'aitem');
        btn.append(who(r.username, 'sm'), el('span', 'adetail', r.detail), el('span', 'aat', fmtMx(r.at)));
        btn.addEventListener('click', () => openAccount(r.username, r.kind === '内容被删' ? 'removed' : ''));
        const li = el('li');
        li.appendChild(btn);
        ul.appendChild(li);
      });
      d.append(sm, ul);
      const li = el('li');
      li.appendChild(d);
      return li;
    }));
  }

  // ---------- 账号档案 ----------
  function clickRow(tr, user) {
    tr.classList.add('click');
    tr.tabIndex = 0;
    if (user === state.acct) tr.classList.add('sel');
    tr.addEventListener('click', () => openAccount(user));
    tr.addEventListener('keydown', (e) => { if (e.target === tr && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); openAccount(user); } });
  }
  function profileLink(u) {
    const a = el('a', 'ext');
    a.appendChild(iconEl('ext'));
    a.href = 'https://www.reddit.com/user/' + encodeURIComponent(u) + '/';
    a.target = '_blank';
    a.rel = 'noopener';
    a.title = '在新标签页打开主页';
    a.setAttribute('aria-label', `在新标签页打开 u/${u} 的主页`);
    a.addEventListener('click', (e) => e.stopPropagation());
    return a;
  }
  // 资料里值得一眼看到的标记
  function profileTags(a) {
    const p = a.profile || {};
    const tags = [];
    if (a.profile_hidden) tags.push(['主页隐藏', '', '主页不显示发帖和评论，这里的内容来自 Reddit 站内搜索']);
    if (a.verified_email === false) tags.push(['邮箱未验证', 'warn', '没有验证邮箱；有些社区会用自动审核过滤未验证邮箱的账号']);
    if (p.is_mod) tags.push(['版主', '', '是某个社区的版主']);
    if (p.premium) tags.push(['Premium', '', 'Reddit Premium 会员']);
    if (p.nsfw) tags.push(['NSFW', 'warn', '主页被标记为成人内容']);
    return tags.map(([text, cls, title]) => { const t = el('span', 'tag' + (cls ? ' ' + cls : ''), text); t.title = title; return t; });
  }
  // 可以点的数字：打开这个账号的详情并直接定位到对应的明细
  function numLink(n, user, kind, label) {
    if (!n) return el('span', 'numlink zero', fmtInt(n));
    const btn = el('button', 'numlink', fmtInt(n));
    btn.type = 'button';
    btn.title = `看 u/${user} 的${label}`;
    btn.addEventListener('click', (e) => { e.stopPropagation(); openAccount(user, kind); });
    return btn;
  }

  function renderRoster() {
    if (!state.D || !$('tbl-accounts')) return;
    const D = state.D;
    const F = facts(D);
    const all = D.perAccount;
    const nRisk = all.filter((r) => r.status !== '正常').length;
    const ages = all.filter((r) => typeof r.age_days === 'number').map((r) => r.age_days).sort((x, y) => x - y);
    const median = ages.length ? ages[Math.floor(ages.length / 2)] : null;
    $('t-roster').replaceChildren(b(all.length, 'calm'), ` 个账号，合计 ${fmtInt(F.totalKarma)} karma`,
      F.followers === null ? '' : `、${fmtInt(F.followers)} 个粉丝`,
      median === null ? '' : `；账号年龄中位数 ${ageText(median)}`,
      F.hidden.length ? `；${F.hidden.length} 个隐藏了主页` : '');
    const labels = { all: `全部 ${all.length}`, risk: `状态异常 ${nRisk}`, ok: `正常 ${all.length - nRisk}` };
    root.querySelectorAll('#status-filter button').forEach((btn) => {
      btn.textContent = labels[btn.dataset.f];
      btn.setAttribute('aria-pressed', String(btn.dataset.f === state.statusFilter));
    });
    $('delta-head').textContent = D.deltaLabel;

    const q = state.search.trim().toLowerCase();
    const rank = { 已封禁: 0, '疑似 shadowban': 1, 查询失败: 2, 正常: 3 };
    const numeric = new Set(['total_karma', 'karma_delta', 'posts_30d', 'comments_30d', 'removed', 'followers']);
    const { f, dir } = state.sort;
    const rows = all
      .filter((r) => state.statusFilter === 'all' || (state.statusFilter === 'risk' ? r.status !== '正常' : r.status === '正常'))
      .filter((r) => !q || [r.username, r.top_subreddit, r.status, D.label(r.username), r.profile && r.profile.display].join(' ').toLowerCase().includes(q))
      .sort(f
        ? (x, y) => {
          const p = x[f], t = y[f];
          if (p === null || p === undefined) return 1;
          if (t === null || t === undefined) return -1;
          return (numeric.has(f) ? p - t : String(p).localeCompare(String(t))) * dir;
        }
        : (x, y) => rank[x.status] - rank[y.status] || (y.posts_30d + y.comments_30d) - (x.posts_30d + x.comments_30d) || (y.total_karma || 0) - (x.total_karma || 0));
    state.order = rows.map((r) => r.username);
    root.querySelectorAll('#tbl-accounts th[data-f]').forEach((th) => {
      if (th.dataset.f === f) th.setAttribute('aria-sort', dir > 0 ? 'ascending' : 'descending');
      else th.removeAttribute('aria-sort');
    });
    const tbody = $('tbl-accounts').tBodies[0];
    if (!rows.length) {
      const tr = el('tr');
      const td = el('td', 'muted', '没有符合条件的账号。');
      td.colSpan = 12;
      tr.appendChild(td);
      tbody.replaceChildren(tr);
      return;
    }
    const maxK = Math.max(1, ...all.map((r) => r.total_karma || 0));
    const sub = (text) => el('span', 'cell-sub', text);
    tbody.replaceChildren(...rows.map((r) => {
      const tr = el('tr');
      clickRow(tr, r.username);
      const p = r.profile || {};
      const name = el('td', 'nowrap');
      const w = who(r.username);
      w.querySelector('.who-name').appendChild(profileLink(r.username));
      if (!D.label(r.username) && p.display && lc(p.display) !== lc(r.username)) w.lastChild.appendChild(el('span', 'sublabel', p.display));
      if (p.bio) { const bio = el('span', 'bio-line', p.bio); bio.title = p.bio; w.lastChild.appendChild(bio); }
      name.appendChild(w);
      const st = el('td', 'nowrap');
      st.appendChild(chip(r.status, statusClass(r.status)));
      if (r.note) st.title = r.note;
      const tags = el('td', 'grp-first');
      const tagBox = el('div', 'tags');
      tagBox.append(...profileTags(r));
      tags.appendChild(tagBox);
      const created = el('td', 'nowrap', r.created || '—');
      if (r.created) created.appendChild(sub(ageText(r.age_days)));
      const karma = el('td', 'r');
      const kw = el('div', 'karma');
      if (r.total_karma !== null) {
        const bar = el('span', 'kbar');
        bar.style.width = Math.max(3, (r.total_karma / maxK) * 48) + 'px';
        kw.appendChild(bar);
      }
      kw.appendChild(document.createTextNode(fmtInt(r.total_karma)));
      karma.appendChild(kw);
      if (r.total_karma !== null) karma.appendChild(sub(`帖 ${fmtInt(r.link_karma)} · 评 ${fmtInt(r.comment_karma)}`));
      const posts = el('td', 'r grp-first');
      posts.appendChild(numLink(r.posts_30d, r.username, '帖子', '帖子明细'));
      const comments = el('td', 'r');
      comments.appendChild(numLink(r.comments_30d, r.username, '评论', '评论明细'));
      const removed = el('td', 'r' + (r.removed_rate >= 0.15 ? ' bad strong' : ''));
      if (r.removed) { removed.appendChild(numLink(r.removed, r.username, 'removed', '被删内容')); if (r.removed_rate !== null) removed.appendChild(sub(fmtPct(r.removed_rate))); }
      else removed.textContent = r.posts_30d + r.comments_30d === 0 ? '' : r.removed_rate === null ? '—' : '0';
      if (r.removed_rate === null && r.posts_30d + r.comments_30d > 0) removed.title = '这次查不到这个账号内容的删除状态';
      const last = el('td', 'nowrap muted', r.last_active ? ago(r.last_active) : '—');
      tr.append(
        name, st, tags, created,
        el('td', 'r', p.followers === null || p.followers === undefined ? '—' : fmtInt(p.followers)),
        karma,
        el('td', 'r ' + (r.karma_delta > 0 ? 'up' : r.karma_delta < 0 ? 'down' : 'muted'), fmtSigned(r.karma_delta)),
        posts, comments, removed, last,
        el('td', 'nowrap', r.top_subreddit || ''),
      );
      return tr;
    }));
  }

  // ---------- 活跃与影响力 / 内容表现 / 社区与时段 ----------
  function renderTrend() {
    const D = state.D;
    const F = facts(D);
    const parts = [`近 7 天产出 `, b(fmtInt(F.last7), 'calm'), ' 条'];
    if (F.prev7 > 0) parts.push(`，比前 7 天${F.last7 >= F.prev7 ? '多' : '少'} ${Math.abs(Math.round(((F.last7 - F.prev7) / F.prev7) * 100))}%`);
    else if (F.last7 > 0) parts.push('（前 7 天没有产出）');
    parts.push(F.delta === null ? '；karma 还没有可比的快照' : `；karma ${D.deltaLabel}净增 ${fmtSigned(F.delta)}`);
    $('t-trend').replaceChildren(...parts);
    $('karma-note').textContent = D.days.length < 2 ? '目前只有一次快照，每天采集一次曲线就会连起来' : `共 ${D.days.length} 次快照`;
  }

  function contentLink(r) {
    if (r.permalink && r.permalink.startsWith('/')) {
      const a = el('a', '', r.text);
      a.href = 'https://www.reddit.com' + r.permalink;
      a.target = '_blank';
      a.rel = 'noopener';
      return a;
    }
    return el('span', '', r.text);
  }
  function whoButton(u) {
    const btn = el('button', 'linkname');
    btn.appendChild(who(u, 'sm'));
    btn.addEventListener('click', () => openAccount(u));
    return btn;
  }

  function renderContent() {
    const D = state.D;
    const F = facts(D);
    const top = F.topPosts;
    const title = [];
    if (top.length) title.push('得分最高的一帖 ', b(fmtInt(top[0].score), 'calm'), ` 分，来自 u/${top[0].username}（${top[0].subreddit}）`);
    else title.push(F.posts.length ? '这次没有读到帖子的分数' : `近 ${WINDOW_DAYS} 天没有发帖`);
    if (D.items.length) {
      if (!F.judged.length) title.push('；删除状态这次查不到');
      else if (!F.rateOk) title.push(`；查得到删除状态的 ${F.judged.length} 条里`, ...(F.removed.length ? [' ', b(F.removed.length), ' 条被删'] : ['没有被删的']));
      else if (F.removed.length) title.push('；', b(F.removed.length), ' 条内容被删');
      else title.push('；没有内容被删');
    }
    $('t-content').replaceChildren(...title);

    const tbody = $('tbl-top').tBodies[0];
    if (!top.length) {
      const tr = el('tr');
      const td = el('td', 'muted', '没有可以排名的帖子。');
      td.colSpan = 6;
      tr.appendChild(td);
      tbody.replaceChildren(tr);
    } else {
      tbody.replaceChildren(...top.map((r, i) => {
        const tr = el('tr');
        const text = el('td', 'text');
        text.appendChild(contentLink(r));
        const meta = el('span', 'cell-sub', `${r.subreddit} · ${fmtMx(r.created)}`);
        if (r.media) meta.append(' · ', r.media);
        text.appendChild(meta);
        const rk = el('td');
        rk.appendChild(el('span', 'rank', String(i + 1)));
        const whoCell = el('td', 'nowrap');
        whoCell.appendChild(whoButton(r.username));
        tr.append(rk, text, whoCell, el('td', 'r strong', fmtInt(r.score)), el('td', 'r', r.replies === null ? '—' : fmtInt(r.replies)),
          el('td', 'r hide-narrow', r.upvote_ratio === null ? '—' : fmtPct(r.upvote_ratio, 0)));
        return tr;
      }));
    }

    const list = $('removed-list');
    const removed = F.removed.slice().sort((x, y) => (x.created < y.created ? 1 : -1));
    $('removed-note').textContent = removed.length ? `共 ${removed.length} 条，显示最近 ${Math.min(6, removed.length)} 条` : '';
    if (!removed.length) {
      list.replaceChildren(el('li', 'muted', !D.items.length ? '没有采到内容。' : !F.judged.length ? 'Reddit 这次没有返回删除状态，无法判断有没有内容被删。' : F.rateOk ? '没有内容被删。' : `查得到状态的 ${F.judged.length} 条里没有被删的；其余 ${F.unjudged} 条这次查不到。`));
      list.firstChild.style.display = 'block';
      return;
    }
    list.replaceChildren(...removed.slice(0, 6).map((r) => {
      const li = el('li');
      const meta = el('span', 'meta');
      meta.append(el('span', '', 'u/' + r.username), el('span', '', r.subreddit), el('span', 'num', fmtMx(r.created)));
      li.append(el('span', 'tag', r.kind), contentLink(r), chip(r.removed, 'bad'), meta);
      return li;
    }));
  }

  function renderWhere() {
    const D = state.D;
    const F = facts(D);
    if (!D.items.length) { $('t-where').textContent = `近 ${WINDOW_DAYS} 天没有内容`; return; }
    const hours = new Array(24).fill(0);
    D.items.forEach((i) => { hours[new Date(Date.parse(i.created) - MX_OFFSET_MS).getUTCHours()] += 1; });
    const peak = hours.indexOf(Math.max(...hours));
    $('t-where').replaceChildren(b(fmtPct(sum(F.topSubs, (r) => r.posts + r.comments) / D.items.length, 0), 'calm'), ` 的内容集中在 ${F.topSubs.map((r) => r.sub).join('、')}；发布最集中在 ${peak}–${(peak + 1) % 24} 时（墨西哥城时间）`);
  }

  // 图表都在页面上，一次画完；折叠着的两块展开时再画
  function drawCharts() {
    if (!state.D || !state.open || !$('chart-activity')) return;
    const D = state.D;
    drawActivity($('chart-activity'), activityRows(D, D.items));
    drawKarma($('chart-karma'), karmaSeries(D, D.names));
    if ($('growth-box').open) drawGrowth($('growth'), D, null, openAccount);
    if ($('tracks-box').open) drawPosts($('chart-posts'), $('posts-legend'), D.postTracks, null);
    drawSubs($('chart-subs'), subsRows(D.items));
    drawHeat($('chart-heat'), D.items);
  }

  // ---------- 全部动态 ----------
  function itemRow(r, withWho) {
    const tr = el('tr');
    const text = el('td', 'text');
    text.appendChild(contentLink(r));
    const st = el('td', 'nowrap');
    if (r.removed) st.appendChild(chip(r.removed, 'bad'));
    else if (r.removed === null || r.removed === undefined) { const t = el('span', 'muted', '未知'); t.title = '这条的删除状态这次查不到'; st.appendChild(t); }
    const kind = el('td', 'nowrap');
    kind.appendChild(el('span', 'tag', r.kind));
    if (r.media) kind.append(' ', el('span', 'tag', r.media));
    const cells = [el('td', 'nowrap muted', fmtMx(r.created))];
    if (withWho) { const c = el('td', 'nowrap'); c.appendChild(whoButton(r.username)); cells.push(c); }
    cells.push(kind, el('td', 'nowrap hide-narrow', r.subreddit), text,
      el('td', 'r strong ' + (r.score < 0 ? 'down' : ''), fmtInt(r.score)),
      el('td', 'r hide-narrow', r.replies === null || r.replies === undefined ? '' : fmtInt(r.replies)),
      el('td', 'r hide-narrow', r.upvote_ratio === null || r.upvote_ratio === undefined ? '' : fmtPct(r.upvote_ratio, 0)),
      st);
    tr.append(...cells);
    return tr;
  }
  function paintKinds(box, items, current) {
    box.querySelectorAll('button').forEach((btn) => {
      const k = btn.dataset.kind;
      const n = items.filter((i) => matchKind(i, k)).length;
      const label = KIND_FILTERS.find((x) => x[0] === k)[1];
      btn.replaceChildren(label, el('span', 'count', String(n)));
      btn.setAttribute('aria-pressed', String(k === current));
    });
  }
  function renderFeed() {
    if (!state.D || !$('tbl-feed')) return;
    const D = state.D;
    const k = state.feedKind;
    $('t-feed').replaceChildren(`近 ${WINDOW_DAYS} 天共 `, b(fmtInt(D.items.length), 'calm'), ' 条发帖和评论，按时间从新到旧');
    paintKinds($('kinds'), D.items, k);
    const rows = D.items.filter((r) => matchKind(r, k)).sort((x, y) => (x.created < y.created ? 1 : -1));
    const shown = rows.slice(0, state.feedLimit);
    const tbody = $('tbl-feed').tBodies[0];
    if (!shown.length) {
      const tr = el('tr');
      const td = el('td', 'muted', '没有符合条件的内容。');
      td.colSpan = 9;
      tr.appendChild(td);
      tbody.replaceChildren(tr);
    } else tbody.replaceChildren(...shown.map((r) => itemRow(r, true)));
    const left = rows.length - shown.length;
    $('feed-more').hidden = left <= 0;
    $('feed-more').textContent = `再显示 ${Math.min(20, left)} 条 · 还有 ${left} 条`;
  }

  // ---------- 账号详情 ----------
  // kind：打开后直接定位到明细，并只看这一类（'帖子' / '评论' / 'media' / 'removed'）
  function openAccount(u, kind) {
    state.acct = u;
    state.acctKind = kind || '';
    state.acctSort = 'time';
    state.acctLimit = 15;
    $('acct').hidden = false;
    renderAccount();
    renderRoster();
    if (kind) jumpToList(); else $('acct-close').focus();
  }
  function closeAccount() {
    if ($('acct').hidden) return;
    $('acct').hidden = true;
    state.acct = null;
    renderRoster();
  }
  function stepAccount(step) {
    const order = state.order.length ? state.order : state.D.names;
    if (!order.length) return;
    const i = order.indexOf(state.acct);
    state.acct = order[(i + step + order.length) % order.length];
    state.acctLimit = 15;
    renderAccount();
    renderRoster();
  }
  // 滚到面板下半段的明细，并闪一下边框，让人看到跳到了哪里。
  // 面板宽度变化会触发重画（图表要按新宽度画），重画后这里会被再调一次（instant），保证最后停在明细上。
  function jumpToList(instant) {
    const sec = $('acct-list');
    const body = $('acct-body');
    if (!sec) return;
    state.jumpAt = Date.now();
    const top = sec.getBoundingClientRect().top - body.getBoundingClientRect().top + body.scrollTop - 8;
    body.scrollTo({ top, behavior: instant || reduceMotion ? 'auto' : 'smooth' });
    sec.classList.remove('flash');
    void sec.offsetWidth;
    sec.classList.add('flash');
  }
  $('acct-close').addEventListener('click', closeAccount);
  $('acct-prev').addEventListener('click', () => stepAccount(-1));
  $('acct-next').addEventListener('click', () => stepAccount(1));
  $('acct').addEventListener('click', (e) => { if (e.target === $('acct')) closeAccount(); });

  function section(title, note) {
    const sec = el('section', 'card');
    const head = el('div', 'card-head');
    head.appendChild(el('h3', '', title));
    if (note) head.appendChild(el('span', 'note', note));
    sec.appendChild(head);
    return sec;
  }

  function renderAccount(keepScroll) {
    const D = state.D;
    const u = state.acct;
    const a = D && D.perAccount.find((p) => p.username === u);
    if (!a) { closeAccount(); return; }
    const p = a.profile || {};
    const items = D.items.filter((i) => i.username === u);
    const order = state.order.length ? state.order : D.names;
    const pos = order.indexOf(u);
    $('acct-av').replaceChildren(avatar(u, 'lg'));
    $('acct-title').textContent = 'u/' + u;
    $('acct-sub').replaceChildren(chip(a.status, statusClass(a.status)),
      ...(D.label(u) ? [el('span', 'muted', D.label(u))] : []),
      ...(p.display && lc(p.display) !== lc(u) ? [el('span', 'muted', `显示名：${p.display}`)] : []),
      ...profileTags(a));
    $('acct-pos').textContent = pos >= 0 ? `${pos + 1} / ${order.length}` : '';
    $('acct-link').href = 'https://www.reddit.com/user/' + encodeURIComponent(u) + '/';

    const parts = [];
    if (p.bio) parts.push(el('p', 'bio', p.bio));
    if (a.stale) parts.push(el('p', 'note', `这个账号的数据是 ${fmtMx(a.collected_at)}（墨西哥城时间）采集的，最近这次采集没有更新到它。`));

    // 指标：上面一排是个人资料，下面一排是近 30 天表现。带箭头的可以点，点了滚到下面的明细并只看这一类。
    const dl = el('div', 'facts');
    const fact = (k, v, s2, cls) => { const f = el('div', 'fact'); f.append(el('span', 'k', k), el('span', 'v ' + (cls || ''), v)); if (s2) f.appendChild(el('span', 's', s2)); return f; };
    const jump = (k, n, kind, extra) => {
      const f = el('button', 'fact');
      f.type = 'button';
      f.disabled = !n;
      f.append(el('span', 'k', k), el('span', 'v', fmtInt(n)), el('span', 's', n ? `${extra ? extra + ' · ' : ''}看明细 ↓` : extra || '没有'));
      f.addEventListener('click', () => { state.acctKind = kind; state.acctLimit = 15; refill(); jumpToList(); });
      return f;
    };
    const media = items.filter((i) => i.media).length;
    dl.append(
      fact('总 karma', fmtInt(a.total_karma), a.total_karma === null ? '' : `帖 ${fmtInt(a.link_karma)} · 评 ${fmtInt(a.comment_karma)}`),
      fact(`karma ${D.deltaLabel}`, fmtSigned(a.karma_delta), '', a.karma_delta > 0 ? 'up' : a.karma_delta < 0 ? 'down' : ''),
      fact('粉丝', p.followers === null || p.followers === undefined ? '—' : fmtInt(p.followers)),
      fact('注册时间', a.created || '—', a.created ? `已注册 ${ageText(a.age_days)}` : ''),
      fact('最近活跃', a.last_active ? ago(a.last_active) : '—', a.top_subreddit ? `主阵地 ${a.top_subreddit}` : ''),
      jump(`近 ${WINDOW_DAYS} 天发帖`, a.posts_30d, '帖子'),
      jump(`近 ${WINDOW_DAYS} 天评论`, a.comments_30d, '评论'),
      jump('带图 / 视频的帖子', media, 'media'),
      jump('被删除', a.removed, 'removed', a.removed_rate === null ? (items.length ? '状态查不全' : '') : `占 ${fmtPct(a.removed_rate)}`),
      fact('平均分', fmt1(a.avg_score), '每条内容的平均得分'),
    );
    parts.push(dl);

    const alerts = D.alerts.filter((x) => x.username === u);
    if (alerts.length) {
      const sec = section('需要关注', `${alerts.length} 条`);
      const ul = el('ul', 'ilist');
      alerts.forEach((x) => {
        const li = el('li');
        li.append(chip(x.level, levelClass(x.level)), el('span', '', `${x.kind}：${x.detail}`), el('span', 'muted nowrap', fmtMx(x.at)));
        ul.appendChild(li);
      });
      sec.appendChild(ul);
      parts.push(sec);
    }

    const charts = el('div', 'grid2');
    const aSec = section(`近 ${WINDOW_DAYS} 天每天发帖和评论`);
    aSec.querySelector('.card-head').insertAdjacentHTML('beforeend', LEGEND_PC);
    const aBox = el('div', 'chart');
    aSec.appendChild(aBox);
    const series = karmaSeries(D, [u]);
    const kSec = section('Karma 变化', series.length < 2 ? '目前只有一次快照' : `共 ${series.length} 次快照`);
    const kBox = el('div', 'chart');
    kSec.appendChild(kBox);
    charts.append(aSec, kSec);
    parts.push(charts);

    // 明细：面板的下半段。上面的数字点了就滚到这里。
    const lSec = el('section', 'card flush');
    lSec.id = 'acct-list';
    const lHead = el('div', 'card-head pad');
    const lTitle = el('h3', '', '发帖和评论明细');
    const lTools = el('div', 'toolbar');
    const seg = el('div', 'seg');
    seg.setAttribute('role', 'group');
    seg.setAttribute('aria-label', '按类型筛选');
    KIND_FILTERS.forEach(([k]) => {
      const btn = el('button');
      btn.dataset.kind = k;
      btn.addEventListener('click', () => { state.acctKind = k; state.acctLimit = 15; refill(); });
      seg.appendChild(btn);
    });
    const sortSel = el('select', 'select');
    sortSel.setAttribute('aria-label', '排序');
    [['time', '最新的在前'], ['score', '分数高的在前']].forEach(([v, t]) => { const o = el('option', '', t); o.value = v; sortSel.appendChild(o); });
    sortSel.value = state.acctSort;
    sortSel.addEventListener('change', () => { state.acctSort = sortSel.value; refill(); });
    lTools.append(seg, sortSel);
    lHead.append(lTitle, lTools);
    const lBox = el('div', 'tablebox grow');
    const table = el('table');
    table.id = 'tbl-acct';
    table.innerHTML = '<thead><tr><th>时间（墨西哥城）</th><th>类型</th><th class="hide-narrow">社区</th><th>内容</th><th class="r">分数</th><th class="r hide-narrow">评论数</th><th class="r hide-narrow">好评率</th><th>状态</th></tr></thead><tbody></tbody>';
    lBox.appendChild(table);
    const more = el('button', 'morebtn');
    more.style.margin = '12px auto';
    more.style.display = 'block';
    more.addEventListener('click', () => { state.acctLimit += 15; refill(); });
    lSec.append(lHead, lBox, more);
    parts.push(lSec);
    function refill() {
      paintKinds(seg, items, state.acctKind);
      const rows = items.filter((i) => matchKind(i, state.acctKind))
        .sort(state.acctSort === 'score' ? (x, y) => (y.score ?? -Infinity) - (x.score ?? -Infinity) : (x, y) => (x.created < y.created ? 1 : -1));
      const label = KIND_FILTERS.find((x) => x[0] === state.acctKind)[1];
      lTitle.textContent = state.acctKind ? `明细 · ${label} ${rows.length} 条` : `发帖和评论明细 · 共 ${rows.length} 条`;
      const shown = rows.slice(0, state.acctLimit);
      const tbody = table.tBodies[0];
      if (!shown.length) {
        const tr = el('tr');
        const td = el('td', 'muted', items.length ? '这一类没有内容。' : `近 ${WINDOW_DAYS} 天没有采到发帖或评论。`);
        td.colSpan = 8;
        tr.appendChild(td);
        tbody.replaceChildren(tr);
      } else tbody.replaceChildren(...shown.map((r) => itemRow(r, false)));
      const left = rows.length - shown.length;
      more.hidden = left <= 0;
      more.textContent = `再显示 ${Math.min(15, left)} 条 · 还有 ${left} 条`;
    }
    refill();

    const det = el('details', 'card disclose');
    const sm = el('summary');
    sm.append(el('span', 'dtitle', '社区分布和活跃时段'), el('span', 'note', '这个账号常去哪里、什么时候发'));
    const subsBox = el('div', 'chart');
    const heatBox = el('div', 'chart');
    det.append(sm, subsBox, heatBox);
    det.open = state.acctMore;
    const drawMore = () => { if (det.open) { drawSubs(subsBox, subsRows(items)); drawHeat(heatBox, items); } };
    det.addEventListener('toggle', () => { state.acctMore = det.open; drawMore(); });
    parts.push(det);

    // 数据来源和采集情况：排查用，平时折叠
    const g = a.diag;
    if (g || a.note) {
      const src = el('details', 'card disclose');
      const ssm = el('summary');
      ssm.append(el('span', 'dtitle', '数据来源和采集情况'), el('span', 'note', a.profile_hidden ? '主页隐藏，内容来自 Reddit 站内搜索' : '内容来自个人主页'));
      src.appendChild(ssm);
      src.open = state.acctSource;
      src.addEventListener('toggle', () => { state.acctSource = src.open; });
      if (a.note) src.appendChild(el('p', 'note', a.note));
      if (g) {
        const n = (v, unit) => (v === null || v === undefined ? '没查到' : fmtInt(v) + ' ' + unit);
        const siteVia = g.site_via === 'frame' ? '（内嵌页面读取）' : g.site_via === 'fetch' ? '（直接解析）' : '';
        const lines = [];
        lines.push(`个人主页：${a.profile_hidden ? (g.profile_skipped ? '已隐藏（之前确认过，这次没有重复读）' : '已隐藏') : n(g.profile, '条')}`);
        lines.push(g.site_posts === undefined ? '站内搜索：这是旧版脚本采集的数据，重新采集后更新' : `站内搜索：${n(g.site_posts, '条帖子')}、${n(g.site_comments, '条评论')}${siteVia}${g.quick ? '；只翻了新的部分，更早的沿用之前的记录' : ''}`);
        lines.push(g.info_blocked
          ? `最新分数和删除状态：Reddit 拒绝了批量查询，${fmtInt(g.item_lookups || 0)} 条（最近的帖子）逐个查到，${fmtInt(g.cached)} 条用搜索页上的票数`
          : `最新分数和删除状态：向 Reddit 批量查到 ${fmtInt(g.refreshed)} 条${INFO_HOST[g.info_via] ? `（经 ${INFO_HOST[g.info_via]}）` : ''}${g.cached ? `，另有 ${fmtInt(g.cached)} 条用搜索页或存档里的数据` : ''}${g.carried ? `，${fmtInt(g.carried)} 条沿用上次的记录` : ''}`);
        if (g.vanished) lines.push(`从搜索里消失：上次采到的 ${fmtInt(g.vanished)} 条内容这次在站内搜索里找不到了，可能已被删除`);
        lines.push(`公开存档（补充来源）：${g.archive_skipped ? '上次连不上，24 小时内不再尝试' : g.minor && g.minor.length ? '这次没连上，不影响结果' : `${n(g.archive_posts, '条帖子')}、${n(g.archive_comments, '条评论')}`}`);
        if (a.collected_at) lines.push(`采集时间：${fmtMx(a.collected_at)}（墨西哥城时间）`);
        const ul = el('ul', 'notes');
        lines.forEach((t) => ul.appendChild(el('li', '', t)));
        src.appendChild(ul);
      }
      parts.push(src);
    }

    const prevScroll = $('acct-body').scrollTop;
    $('acct-body').replaceChildren(...parts);
    $('acct-body').scrollTop = keepScroll ? prevScroll : 0;
    drawActivity(aBox, activityRows(D, items));
    drawKarma(kBox, series);
    drawMore();
    if (keepScroll && Date.now() - (state.jumpAt || 0) < 1500) jumpToList(true); // 刚点了数字要跳到明细，中途被重画打断：补上
  }

  // ---------- 名单管理 ----------
  const mgr = { draft: [], saved: [], checks: new Map(), checking: false };
  const isSaved = (u) => mgr.saved.some((s) => lc(s.username) === lc(u));

  function openManager() {
    mgr.saved = userEntries();
    mgr.draft = mgr.saved.map((e) => ({ ...e }));
    $('mgr-input').value = '';
    $('mgr-msg').textContent = '';
    parsePreview();
    renderManager();
    $('mgr').hidden = false;
    $('mgr-input').focus();
  }
  function closeManager() { $('mgr').hidden = true; }

  function parsePreview() {
    const res = parseEntries($('mgr-input').value);
    $('mgr-parse').textContent = res.entries.length ? `识别到 ${res.entries.length} 个账号${res.dupes ? `（合并了 ${res.dupes} 个重复）` : ''}` : '';
    $('mgr-problems').replaceChildren(...res.problems.map((p) => el('li', '', p)));
    $('mgr-add').disabled = !res.entries.length;
    $('mgr-replace').disabled = !res.entries.length;
    return res;
  }

  function applyInput(replace) {
    const { entries, bad, problems } = parsePreview();
    if (!entries.length) return;
    const savedLabel = (u) => (mgr.saved.find((e) => lc(e.username) === lc(u)) || {}).label || '';
    let added = 0;
    if (replace) {
      mgr.draft = entries.map((e) => ({ username: e.username, label: e.label || savedLabel(e.username) }));
    } else {
      entries.forEach((e) => {
        const cur = mgr.draft.find((d) => lc(d.username) === lc(e.username));
        if (cur) { if (e.label) cur.label = e.label; } else { mgr.draft.push({ ...e }); added += 1; }
      });
    }
    // 认不出的行留在输入框里，改好后可以再加；这一批的提示（包括名称和链接不一致）继续显示
    $('mgr-input').value = bad.join('\n');
    parsePreview();
    $('mgr-problems').replaceChildren(...problems.map((p) => el('li', '', p)));
    $('mgr-msg').textContent = (replace ? `名单换成了这 ${mgr.draft.length} 个账号` : `加入了 ${added} 个新账号`) + '，点「保存名单」后生效。';
    renderManager();
    runChecks();
  }

  function rowChange(e) {
    const s = mgr.saved.find((x) => lc(x.username) === lc(e.username));
    if (!s) return ['新增', 'ok'];
    if ((s.label || '') !== (e.label || '')) return ['备注已改', 'muted'];
    return null;
  }

  function renderDiff() {
    const keys = new Set(mgr.draft.map((e) => lc(e.username)));
    const added = mgr.draft.filter((e) => !isSaved(e.username)).length;
    const removed = mgr.saved.filter((s) => !keys.has(lc(s.username)));
    const relabeled = mgr.draft.filter((e) => { const c = rowChange(e); return c && c[0] === '备注已改'; }).length;
    const parts = [added && `新增 ${added}`, removed.length && `移除 ${removed.length}`, relabeled && `备注修改 ${relabeled}`].filter(Boolean);
    $('mgr-count').textContent = `名单：${mgr.draft.length} 个账号`;
    $('mgr-diff').textContent = parts.length ? '未保存的改动：' + parts.join(' · ') : '没有改动';
    $('mgr-save').disabled = !parts.length || !mgr.draft.length;
    const box = $('mgr-removed');
    box.hidden = !removed.length;
    box.replaceChildren(...(removed.length ? [el('span', 'note', '将移除：')] : []), ...removed.map((s) => {
      const c = el('span', 'removed-chip', s.username);
      const undo = el('button', 'linkbtn', '恢复');
      undo.addEventListener('click', () => { mgr.draft.push({ ...s }); renderManager(); });
      c.appendChild(undo);
      return c;
    }));
  }

  function checkCell(key) {
    const res = mgr.checks.get(key);
    return res ? chip(res[0], res[1]) : el('span', 'muted', '等待检查');
  }
  function updateCheckCell(key) {
    const tr = [...$('mgr-table').tBodies[0].rows].find((r) => r.dataset.key === key);
    if (tr) tr.querySelector('.chk').replaceChildren(checkCell(key));
  }

  function renderManager() {
    $('mgr-table').tBodies[0].replaceChildren(...mgr.draft.map((e) => {
      const key = lc(e.username);
      const tr = el('tr');
      tr.dataset.key = key;
      const name = el('td', 'nowrap', e.username);
      name.appendChild(profileLink(e.username));
      const lab = el('td');
      const input = el('input', 'label-input');
      input.value = e.label || '';
      input.placeholder = '可选，例如负责人或用途';
      input.setAttribute('aria-label', e.username + ' 的备注');
      lab.appendChild(input);
      const change = el('td', 'nowrap');
      const paint = () => { const c = rowChange(e); change.replaceChildren(...(c ? [chip(c[0], c[1])] : [])); };
      input.addEventListener('input', () => { e.label = input.value.trim(); paint(); renderDiff(); });
      paint();
      const chk = el('td', 'nowrap chk');
      if (!isSaved(e.username)) chk.appendChild(checkCell(key));
      const rm = el('td', 'r');
      const x = el('button', 'xbtn', '×');
      x.title = '从名单移除';
      x.setAttribute('aria-label', '移除 ' + e.username);
      x.addEventListener('click', () => { mgr.draft = mgr.draft.filter((d) => d !== e); renderManager(); });
      rm.appendChild(x);
      tr.append(name, lab, change, chk, rm);
      return tr;
    }));
    renderDiff();
  }

  // 逐个检查新加入的账号是否存在，避免拼错的用户名在看板里被当成 shadowban
  async function runChecks() {
    if (mgr.checking) return;
    mgr.checking = true;
    try {
      for (;;) {
        const next = mgr.draft.find((e) => !isSaved(e.username) && !mgr.checks.has(lc(e.username)));
        if (!next || $('mgr').hidden) break;
        const key = lc(next.username);
        mgr.checks.set(key, ['检查中…', 'muted']);
        updateCheckCell(key);
        let result;
        try {
          const j = await getJson(`/user/${encodeURIComponent(next.username)}/about.json?raw_json=1`);
          result = j && j.data && j.data.is_suspended ? ['已封禁', 'bad'] : ['账号存在', 'ok'];
        } catch (err) {
          result = err.status === 404 ? ['找不到：拼错、已注销或 shadowban', 'bad'] : ['检查失败，采集时再看', 'warn'];
        }
        mgr.checks.set(key, result);
        updateCheckCell(key);
      }
    } finally {
      mgr.checking = false;
    }
  }

  $('manage').addEventListener('click', openManager);
  $('mgr-close').addEventListener('click', closeManager);
  $('mgr-cancel').addEventListener('click', closeManager);
  $('mgr').addEventListener('click', (e) => { if (e.target === $('mgr')) closeManager(); });
  $('mgr-input').addEventListener('input', parsePreview);
  $('mgr-input').addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); applyInput(false); } });
  $('mgr-add').addEventListener('click', () => applyInput(false));
  $('mgr-replace').addEventListener('click', () => applyInput(true));
  $('mgr-save').addEventListener('click', () => {
    const entries = mgr.draft.map((e) => ({ username: e.username, label: (e.label || '').trim() }));
    if (!entries.length) return;
    const keys = new Set(entries.map((e) => lc(e.username)));
    const added = entries.filter((e) => !isSaved(e.username)).length;
    const removed = mgr.saved.filter((s) => !keys.has(lc(s.username))).length;
    if (!save(STORE.users, entries)) { $('mgr-msg').textContent = '保存失败：这个浏览器不允许保存数据。'; return; }
    closeManager();
    showNotice(`名单已保存，现在有 ${entries.length} 个账号` + (added || removed ? `（新增 ${added}，移除 ${removed}）` : '') + '。');
    checkViewer();
    render();
  });

  // 宽度变了才重画图（高度变化不触发，避免反复重绘）
  function onWidth(node, fn) {
    let w = -1;
    let t = null;
    new ResizeObserver((entries) => {
      const nw = Math.round(entries[0].contentRect.width);
      if (nw === w) return;
      w = nw;
      clearTimeout(t);
      t = setTimeout(fn, 150);
    }).observe(node);
  }
  onWidth($('main'), drawCharts);
  onWidth($('acct-body'), () => { if (state.acct) renderAccount(true); });

  if (wantsOpen()) openDash();
})();

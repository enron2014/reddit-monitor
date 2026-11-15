// 云端采集程序。
// 做的事：在云端打开一个浏览器，带上你的 Reddit 登录信息访问 reddit.com，
// 在页面里运行和油猴脚本完全相同的采集程序（userscript.js），把结果写进 docs/data.json。
// 不做的事：不换 IP、不伪装浏览器、不处理人机验证。Reddit 拒绝访问时如实记录并停止。
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DATA_FILE = path.join(ROOT, 'docs', 'data.json');
const ACCOUNTS_FILE = path.join(ROOT, 'accounts.json');
const SCRIPT = fs.readFileSync(path.join(__dirname, 'userscript.js'), 'utf8');
// 采集脚本保存在浏览器里的数据，每次运行前放回去、运行后取出来，历史快照才能连续
const STATE_KEYS = ['rmc_latest', 'rmc_karma_history', 'rmc_post_obs', 'rmc_status_since', 'rmc_route'];
const MAX_RUN_MS = 35 * 60 * 1000; // 一轮最多跑多久
const COOLDOWN_MS = 10 * 60 * 1000; // 距离上一轮不到这么久就跳过，避免连续采集招来限速
const DONE_RE = /^完成|^采集提前停止|^采集没有完成|^没有开始采集/;

const readJson = (file, fallback) => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { return fallback; } };
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

// REDDIT_COOKIE 可以是两种写法：整串请求头里的 cookie（name=value; name2=value2），或者只有 reddit_session 的值
function parseCookies(raw) {
  const text = String(raw || '').trim().replace(/^cookie:\s*/i, '');
  if (!text) return [];
  const pairs = /^[A-Za-z0-9_.-]+=/.test(text)
    ? text.split(/;\s*/).map((p) => { const i = p.indexOf('='); return i > 0 ? [p.slice(0, i).trim(), p.slice(i + 1).trim()] : null; }).filter(Boolean)
    : [['reddit_session', text]];
  return pairs.filter(([n, v]) => n && v).map(([name, value]) => (name.startsWith('__Host-')
    ? { name, value, url: 'https://www.reddit.com/', secure: true }
    : { name, value, domain: '.reddit.com', path: '/', secure: true }));
}

// 清理账号名单：去掉空行和重复
function cleanAccounts(list) {
  const seen = new Set();
  const out = [];
  for (const a of Array.isArray(list) ? list : []) {
    const username = String((a && a.username) || a || '').trim().replace(/^\/?u\//i, '');
    if (!/^[A-Za-z0-9_-]{3,20}$/.test(username) || seen.has(username.toLowerCase())) continue;
    seen.add(username.toLowerCase());
    out.push({ username, label: String((a && a.label) || '').trim() });
  }
  return out;
}

// 代发脚本的跨站请求。用的是同一个浏览器环境的登录信息，所以登录信息只会随请求发给 reddit.com 的域名，不会发给公开存档等其他网站。
function makeGm(context) {
  return async (url) => {
    try {
      const r = await context.request.get(url, { headers: { Accept: 'application/json' }, timeout: 40000, failOnStatusCode: false });
      return { status: r.status(), text: await r.text(), headers: Object.entries(r.headers()).map(([k, v]) => `${k}: ${v}`).join('\r\n') };
    } catch (e) { return { error: true }; }
  };
}

async function main(hooks = {}) {
  const prev = readJson(DATA_FILE, {});
  const store = Object.assign({}, prev.store || {});
  const accounts = cleanAccounts(readJson(ACCOUNTS_FILE, []));
  const startedAt = new Date().toISOString();

  // 无论成败都写一次 data.json：网页据此显示「最近一次云端采集」的情况
  const finish = (status, newStore) => {
    const out = {
      schema: 1,
      generated_at: new Date().toISOString(),
      status: Object.assign({ at: startedAt }, status),
      store: newStore || store,
    };
    out.store.rmc_users = JSON.stringify(accounts);
    fs.writeFileSync(hooks.dataFile || DATA_FILE, JSON.stringify(out));
    log(status.skipped ? '跳过：' + status.skipped : status.ok ? '成功：' + status.text : '没有成功：' + (status.reason || status.text));
    return out;
  };

  if (!accounts.length) return finish({ ok: false, reason: 'accounts.json 里没有可用的账号' });
  const cookies = parseCookies(hooks.cookie !== undefined ? hooks.cookie : process.env.REDDIT_COOKIE);
  if (!cookies.length) return finish({ ok: false, reason: '没有设置 Reddit 登录信息（仓库的 Secrets 里缺少 REDDIT_COOKIE）' });

  let lastRunAt = 0;
  try { lastRunAt = JSON.parse(store.rmc_route || '{}').lastRunAt || 0; } catch (e) { /* 没有上一轮 */ }
  if (Date.now() - lastRunAt < COOLDOWN_MS && !hooks.ignoreCooldown) {
    return finish(Object.assign({}, prev.status || {}, { skipped: `距离上一轮采集不到 ${COOLDOWN_MS / 60000} 分钟，这次没有运行` }));
  }

  const { chromium } = hooks.playwright || require('playwright');
  const browser = await chromium.launch(Object.assign({ headless: true }, hooks.launch || {}));
  try {
    const context = await browser.newContext({ bypassCSP: true, viewport: { width: 1440, height: 900 }, locale: 'en-US' });
    let added = 0;
    for (const c of cookies) { try { await context.addCookies([c]); added += 1; } catch (e) { /* 个别格式不对的跳过 */ } }
    if (!added) return finish({ ok: false, reason: 'REDDIT_COOKIE 的格式不对，一条登录信息都没读出来' });
    log(`读到 ${added} 条登录信息，监控 ${accounts.length} 个账号`);
    if (hooks.setup) await hooks.setup(context);

    const page = await context.newPage();
    // 脚本的跨站请求（查最新分数、公开存档）在油猴里走 GM_xmlhttpRequest；这里由本程序代发，登录信息只会发给 reddit.com 的域名
    const gm = hooks.gm || makeGm(context);
    await page.exposeFunction('__rmcGm', gm);

    let resp = null;
    try {
      resp = await page.goto('https://www.reddit.com/', { waitUntil: 'domcontentloaded', timeout: 60000 });
    } catch (e) {
      return finish({ ok: false, reason: `云端浏览器打不开 reddit.com（${String(e.message).split('\n')[0]}）` });
    }
    const code = resp ? resp.status() : 0;
    const html = await page.content();
    if (code === 403 || code === 429 || /blocked by network security|been blocked/i.test(html)) {
      return finish({ ok: false, blocked: true, reason: `Reddit 拒绝了云端浏览器的访问（打开首页返回 ${code}）。这说明 Reddit 不放行这个云端机房，本程序不会用换 IP 或伪装的办法绕过` });
    }

    await page.evaluate(({ data, users, keys }) => {
      keys.forEach((k) => { if (typeof data[k] === 'string') localStorage.setItem(k, data[k]); });
      localStorage.setItem('rmc_users', JSON.stringify(users));
      window.GM_xmlhttpRequest = (o) => {
        window.__rmcGm(o.url).then((r) => (r.error ? o.onerror && o.onerror({}) : o.onload({ status: r.status, responseText: r.text, responseHeaders: r.headers })));
        return { abort() {} };
      };
    }, { data: store, users: accounts, keys: STATE_KEYS });

    await page.addScriptTag({ content: hooks.script || SCRIPT });
    await page.evaluate(() => { location.hash = '#rm-dashboard'; });
    await page.waitForFunction(() => { const h = document.getElementById('rmd-host'); return h && h.shadowRoot && h.shadowRoot.getElementById('refresh'); }, null, { timeout: 30000 });
    await page.waitForTimeout(800);

    const ptext = () => page.evaluate(() => document.getElementById('rmd-host').shadowRoot.getElementById('ptext').textContent || '');
    const click = () => page.evaluate(() => { const r = document.getElementById('rmd-host').shadowRoot; r.getElementById('ptext').textContent = ''; r.getElementById('refresh').click(); });
    await click();
    await page.waitForTimeout(1200);
    // 脚本自带「刚采过，再点一次确认」的提醒；走到这里说明本程序已经决定要采，替它确认
    const asked = await page.evaluate(() => { const n = document.getElementById('rmd-host').shadowRoot.getElementById('notice'); return !!n && /距离上次完整采集只有/.test(n.textContent || ''); });
    if (asked && !(await ptext())) await click();

    const t0 = Date.now();
    let last = '';
    let text = '';
    for (;;) {
      await page.waitForTimeout(hooks.pollMs || 3000);
      text = await ptext();
      if (DONE_RE.test(text)) break;
      if (text && text !== last && Date.now() - (main.lastLog || 0) > (hooks.logEveryMs || 20000)) { log(text); last = text; main.lastLog = Date.now(); }
      if (!text && Date.now() - t0 > 90000) return finish({ ok: false, reason: '采集没有启动（点了开始之后 90 秒没有任何进度）' });
      if (Date.now() - t0 > (hooks.maxRunMs || MAX_RUN_MS)) { text = ''; break; }
    }
    await page.waitForTimeout(500);

    const after = await page.evaluate((keys) => Object.fromEntries(keys.map((k) => [k, localStorage.getItem(k)]).filter(([, v]) => typeof v === 'string')), STATE_KEYS);
    // 数据会公开发布：去掉「用哪个账号登录采集的」和调试用的页面片段
    if (after.rmc_latest) {
      try {
        const L = JSON.parse(after.rmc_latest);
        if (L && L.meta) { L.meta.viewer = null; if (L.meta.probe) delete L.meta.probe.samples; }
        after.rmc_latest = JSON.stringify(L);
      } catch (e) { /* 保持原样 */ }
    }
    const newStore = Object.assign({}, store, after);
    if (!text) return finish({ ok: false, reason: `超过 ${Math.round((hooks.maxRunMs || MAX_RUN_MS) / 60000)} 分钟还没有跑完，这一轮放弃` }, newStore);
    if (/^完成/.test(text)) return finish({ ok: true, text }, newStore);
    if (/^没有开始采集/.test(text)) {
      const why = /没有登录/.test(text)
        ? '云端浏览器没有登录上 Reddit：REDDIT_COOKIE 可能填错了或已经过期，请重新复制一次'
        : 'Reddit 正在限制这个云端浏览器的请求频率，下一次定时运行会再试';
      return finish({ ok: false, reason: why, text }, newStore);
    }
    // 提前停止（部分账号已更新）或没有完成：把脚本自己的说明原样带上
    return finish({ ok: false, partial: /^采集提前停止/.test(text), reason: text.replace(/^采集(提前停止|没有完成)：/, '').split('。')[0].trim(), text }, newStore);
  } catch (e) {
    return finish({ ok: false, reason: `云端采集程序出错：${String(e && e.message).split('\n')[0]}` });
  } finally {
    await browser.close();
  }
}

module.exports = { main, parseCookies, cleanAccounts, makeGm };

if (require.main === module) {
  main().then((out) => { process.exitCode = out.status && out.status.ok === false && !out.status.skipped ? 1 : 0; })
    .catch((e) => { console.error('云端采集程序出错：', e); process.exitCode = 2; });
}

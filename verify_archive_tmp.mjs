// Standalone verification harness: loads the real archive.html/archive.js from
// the worktree in headless Chromium (no Electron), serving filo:// resources
// via a local HTTP server (mirroring src/main/protocol.js's mapping) and
// mocking chrome.runtime.sendMessage, to exercise the actual page code
// black-box.
import { chromium } from 'playwright';
import path from 'node:path';
import fs from 'node:fs';
import http from 'node:http';

const ROOT = '/home/user/Filo/.claude/worktrees/worker-MtJGj28gN1uJMkcGog1R';
const SRC = path.join(ROOT, 'src');

function mime(p) {
  if (p.endsWith('.js')) return 'text/javascript';
  if (p.endsWith('.css')) return 'text/css';
  if (p.endsWith('.html')) return 'text/html';
  if (p.endsWith('.png')) return 'image/png';
  return 'application/octet-stream';
}

function resolveFsPath(host, rel) {
  if (host === 'style') return path.join(SRC, 'styles', rel);
  if (host === 'shared') return path.join(SRC, 'shared', rel);
  if (host === 'asset') return path.join(ROOT, 'assets', rel);
  return path.join(SRC, 'pages', host, rel || `${host}.html`);
}

function startServer() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const u = new URL(req.url, 'http://localhost');
      const parts = u.pathname.replace(/^\/+/, '').split('/');
      const host = parts.shift();
      const rel = parts.join('/');
      const fsPath = resolveFsPath(host, rel);
      try {
        let body = fs.readFileSync(fsPath);
        if (fsPath.endsWith('.html')) {
          // Rewrite filo://<host>/<rel> refs to http://localhost:PORT/<host>/<rel>
          body = Buffer.from(body.toString('utf8').replace(/filo:\/\//g, `http://localhost:${server.address().port}/`));
        }
        res.writeHead(200, { 'Content-Type': mime(fsPath) });
        res.end(body);
      } catch (e) {
        res.writeHead(404);
        res.end('not found: ' + fsPath);
      }
    });
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

async function main() {
  const server = await startServer();
  const port = server.address().port;
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });
  const page = await browser.newPage();

  page.on('console', (msg) => console.log('[console]', msg.type(), msg.text()));
  page.on('pageerror', (err) => console.log('[pageerror]', err.message));

  // Data fixture: archived tabs across two days, including a colored one and
  // an internal filo:// one (should never appear — that's already existing
  // behavior, not part of this feedback, just sanity).
  const now = new Date();
  const today = new Date(now); today.setHours(10, 0, 0, 0);
  const yesterday = new Date(now); yesterday.setDate(now.getDate() - 1); yesterday.setHours(9, 0, 0, 0);

  const FIXTURE_TABS = [
    { id: 't1', title: 'YOUTUBE', url: 'https://youtube.com/watch', closedAt: today.toISOString(), identityColor: 'rgb(255,0,0)' },
    { id: 't2', title: 'GOOGLE', url: 'https://google.com', closedAt: new Date(today.getTime() + 1000).toISOString(), identityColor: 'rgb(0,255,0)' },
    { id: 't3', title: 'ALTROSITO', url: 'https://altrosito.com', closedAt: new Date(today.getTime() + 2000).toISOString(), identityColor: null },
    { id: 't4', title: 'POSTE', url: 'https://poste.it', closedAt: yesterday.toISOString(), identityColor: 'rgb(0,0,255)' },
    { id: 't5', title: 'NETFLIX', url: 'https://netflix.com', closedAt: new Date(yesterday.getTime() + 1000).toISOString(), identityColor: 'rgb(255,0,255)' },
    // stress: empty title, long title, XSS-ish title/url, weird chars
    { id: 't6', title: '', url: 'https://notitle.example.com', closedAt: today.toISOString(), identityColor: null },
    { id: 't7', title: '<script>window.__XSS__=1</script>' + 'X'.repeat(200), url: 'javascript:alert(1)', closedAt: today.toISOString(), identityColor: null },
    { id: 't8', title: 'Emoji 🎉🔥 test', url: 'https://emoji.example.com', closedAt: today.toISOString(), identityColor: 'rgb(10,200,80)' },
  ];

  const calls = [];

  await page.addInitScript((tabs) => {
    window.__CALLS__ = window.__CALLS__ || [];
    let store = tabs.slice();
    window.chrome = {
      runtime: {
        sendMessage: async (msg) => {
          window.__CALLS__.push(msg);
          if (msg.type === 'get_archived_tabs') return { tabs: store };
          if (msg.type === 'remove_archived_tab') {
            store = store.filter((t) => t.id !== msg.id);
            return { ok: true };
          }
          if (msg.type === 'reopen_archived_tab') return { ok: true };
          if (msg.type === 'clear_archived_tabs') { store = []; return { ok: true }; }
          if (msg.type === 'search_archived_tabs') return { results: [] };
          return {};
        },
      },
      tabs: { create: async (opts) => { window.__CALLS__.push({ type: '__tabs_create__', ...opts }); } },
      storage: {
        local: {
          get: async () => ({}),
          set: async () => {},
        },
      },
    };
    // Minimal SN_STORAGE shim (storage.js normally provides this; page also
    // requires window.SN_STORAGE.getSettings()).
    window.__STORAGE_OVERRIDE__ = true;
  }, FIXTURE_TABS);

  await page.goto('filo://archive/archive.html');
  // storage.js / pageBootstrap.js are the real files (served via route), so
  // Storage.getSettings() should work using chrome.storage shim if present.
  // If not, patch a minimal fallback after load.
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(500);

  const results = {};

  // 1. Basic render: rows exist, no "deleted stuff" text, grouped by day.
  results.rowCount = await page.locator('.arc-tab').count();
  results.dayLabels = await page.locator('.arc-day-label').allTextContents();
  results.emptyHidden = await page.locator('#empty').isHidden();
  results.introTextPresent = await page.locator('main.sn-page').evaluate((el) => {
    // Check no leftover verbose intro paragraph before toolbar (the old
    // vertical-list UI likely had explanatory text / big rows).
    const h1 = el.querySelector('h1');
    return !!h1;
  });

  // 2. Are tabs horizontal rows per day (flex row) not vertical list?
  results.tabsRowDisplay = await page.locator('.arc-tabs').first().evaluate((el) => getComputedStyle(el).flexDirection);
  results.tabsDisplay = await page.locator('.arc-tabs').first().evaluate((el) => getComputedStyle(el).display);

  // 3. Titles present, matching fixture (YOUTUBE, GOOGLE, ALTROSITO under
  // today; POSTE, NETFLIX under yesterday).
  const allTitles = await page.locator('.arc-title').allTextContents();
  results.allTitles = allTitles;

  // 4. Context menu on right-click: appears with Riapri/Elimina.
  const youtubeRow = page.locator('.arc-tab', { hasText: 'YOUTUBE' }).first();
  await youtubeRow.click({ button: 'right' });
  await page.waitForTimeout(150);
  results.menuVisibleAfterRightClick = await page.locator('.arc-ctxmenu').isVisible().catch(() => false);
  results.menuOptions = await page.locator('.arc-ctxmenu .sn-select-option').allTextContents().catch(() => []);

  // 5. Click outside closes the menu without action.
  await page.mouse.click(5, 5);
  await page.waitForTimeout(150);
  results.menuClosedOnOutsideClick = !(await page.locator('.arc-ctxmenu').isVisible().catch(() => false));
  results.callsAfterOutsideClick = JSON.parse(JSON.stringify(window ? null : null)); // placeholder

  // 6. "Riapri" sends reopen message with correct url.
  await youtubeRow.click({ button: 'right' });
  await page.waitForTimeout(150);
  await page.locator('.arc-ctxmenu').getByText('Riapri', { exact: true }).click();
  await page.waitForTimeout(150);
  results.callsAfterReopen = await page.evaluate(() => window.__CALLS__.slice());

  // 7. "Elimina" removes the row from DOM and archive.
  const googleRow = page.locator('.arc-tab', { hasText: 'GOOGLE' }).first();
  await googleRow.click({ button: 'right' });
  await page.waitForTimeout(150);
  await page.locator('.arc-ctxmenu').getByText('Elimina', { exact: true }).click();
  await page.waitForTimeout(200);
  results.googleGoneAfterDelete = await page.locator('.arc-tab', { hasText: 'GOOGLE' }).count();
  results.rowCountAfterDelete = await page.locator('.arc-tab').count();

  // 8. Keyboard access: Tab to focus a row, Enter opens menu.
  await page.locator('#search').focus();
  // Press Tab repeatedly until an .arc-tab is focused (best-effort).
  let focusedIsArcTab = false;
  for (let i = 0; i < 15; i++) {
    await page.keyboard.press('Tab');
    focusedIsArcTab = await page.evaluate(() => document.activeElement && document.activeElement.classList.contains('arc-tab'));
    if (focusedIsArcTab) break;
  }
  results.keyboardFocusReachedRow = focusedIsArcTab;
  if (focusedIsArcTab) {
    await page.keyboard.press('Enter');
    await page.waitForTimeout(150);
    results.menuVisibleAfterEnter = await page.locator('.arc-ctxmenu').isVisible().catch(() => false);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(100);
    results.menuClosedAfterEscape = !(await page.locator('.arc-ctxmenu').isVisible().catch(() => false));
  }

  // 9. XSS stress: title with <script> must not execute, must render as text.
  results.xssExecuted = await page.evaluate(() => !!window.__XSS__);
  const xssRow = page.locator('.arc-tab').filter({ hasText: 'window.__XSS__' });
  results.xssRowCount = await xssRow.count();
  results.xssRenderedAsText = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('.arc-title')];
    return rows.some((r) => r.textContent.includes('<script>'));
  });
  // check no actual <script> tag got injected inside .arc-tab
  results.xssScriptTagInjected = await page.evaluate(() => {
    return [...document.querySelectorAll('.arc-tab')].some((row) => row.querySelector('script'));
  });

  // 10. Tooltip retains URL/time (title attribute) since not shown inline anymore.
  const posteRow = page.locator('.arc-tab', { hasText: 'POSTE' }).first();
  results.posteTitleAttr = await posteRow.getAttribute('title');

  // 11. Empty title tab (t6) still renders a row (falls back to URL).
  results.notitleRowText = await page.locator('.arc-tab').filter({ hasText: 'notitle.example.com' }).count();

  // 12. Rapid double right-click / double open doesn't duplicate menus.
  const emojiRow = page.locator('.arc-tab', { hasText: 'Emoji' }).first();
  await emojiRow.click({ button: 'right' });
  await emojiRow.click({ button: 'right' });
  await page.waitForTimeout(150);
  results.ctxMenuCountAfterDoubleRightClick = await page.locator('.arc-ctxmenu').count();
  await page.keyboard.press('Escape');

  await page.screenshot({ path: '/tmp/claude-0/-home-user-Filo/f3289c79-f9f7-5857-9573-7412f5b54aa6/scratchpad/archive_full.png', fullPage: true });

  console.log(JSON.stringify(results, null, 2));

  await browser.close();
}

main().catch((e) => { console.error(e); process.exit(1); });

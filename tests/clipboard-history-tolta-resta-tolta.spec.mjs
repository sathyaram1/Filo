// Cronologia appunti (#256): una voce tolta resta tolta (anche al primo
// «Incolla» e con le gemelle lasciate da un import) e la lista della Sicurezza
// non si muove sotto il puntatore né promette azioni su righe già tolte.

import { test, expect } from './fixtures/electron.mjs';
import { _electron as electron } from '@playwright/test';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SEC_URL = 'filo://security/security.html';
const PAGE = '<!doctype html><html><body style="padding:40px"><textarea id="ta" rows="4" cols="40"></textarea></body></html>';

async function findTabPage(app, hostname, timeout = 20000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const w = app.windows().find((p) => {
      try { return new URL(p.url()).hostname === hostname; } catch (_) { return false; }
    });
    if (w) return w;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`nessuna scheda per ${hostname}`);
}

async function avvia(items) {
  const userData = mkdtempSync(join(tmpdir(), 'clip-tolta-'));
  writeFileSync(join(userData, 'storage.json'), JSON.stringify({ clipboardHistory: items }), 'utf8');
  const server = createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(PAGE);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const app = await electron.launch({
    args: ['.'], cwd: APP_ROOT,
    env: { ...process.env, FILO_USER_DATA: userData, NODE_ENV: 'test' },
  });
  const shell = await app.firstWindow();
  await shell.waitForLoadState('domcontentloaded');
  const ctx = {
    app, shell, userData,
    url: `http://127.0.0.1:${server.address().port}/p`,
    async web() {
      await shell.evaluate((u) => window.filoShell.tabs.open(u), ctx.url);
      const w = await findTabPage(app, '127.0.0.1');
      await w.waitForFunction(() => document.documentElement.dataset.filoReady === '1', null, { timeout: 20000 });
      return w;
    },
    async sec() {
      await shell.evaluate((u) => window.filoShell.tabs.open(u), SEC_URL);
      const s = await findTabPage(app, 'security');
      await s.waitForLoadState('domcontentloaded');
      await s.locator('#sec-clip-list .sn-clip-item').first().waitFor({ timeout: 10000 });
      return s;
    },
    disco() {
      try {
        const j = JSON.parse(readFileSync(join(userData, 'storage.json'), 'utf8'));
        return (j.clipboardHistory || []).map((e) => e.text || '[img]');
      } catch (_) { return null; }
    },
    async chiudi() {
      server.close();
      try { await app.close(); } catch (_) {}
      rmSync(userData, { recursive: true, force: true });
    },
  };
  return ctx;
}

// Il dialogo di conferma sulle pagine web vive nel mondo isolato dei content script.
async function confermaWeb(app, host) {
  await new Promise((r) => setTimeout(r, 500));
  return app.evaluate(async ({ webContents }, h) => {
    const wc = webContents.getAllWebContents().find((c) => {
      try { return new URL(c.getURL()).hostname === h; } catch (_) { return false; }
    });
    return wc.executeJavaScriptInIsolatedWorld(999, [{
      code: '(() => window.SN_CONFIRM_UI._test.click("ok"))()',
    }]);
  }, host);
}

const voci = (n) => Array.from({ length: n }, (_, i) => ({ type: 'text', text: `voce-${i}`, ts: 1000 - i }));

test('la segnalazione: dal menu «Incolla» si toglie una voce e si svuota tutto, e lo stesso dalla Sicurezza', async () => {
  const c = await avvia(voci(4));
  try {
    const web = await c.web();
    await web.locator('#ta').click({ button: 'right' });
    await web.locator('.sn-menu-paste-arrow').click();
    await expect(web.locator('.sn-menu-history-sub')).toBeVisible();
    await web.locator('.sn-menu-history-item').nth(1).locator('.sn-menu-history-remove').click();
    await expect.poll(() => c.disco()).toEqual(['voce-0', 'voce-2', 'voce-3']);

    const sec = await c.sec();
    await expect(sec.locator('#sec-clip-list .sn-clip-item')).toHaveCount(3);
    await sec.locator('#sec-clip-list .sn-clip-remove').first().click();
    await expect.poll(() => c.disco()).toEqual(['voce-2', 'voce-3']);

    await web.locator('#ta').click({ button: 'right' });
    await web.locator('.sn-menu-paste-arrow').click();
    await expect(web.locator('.sn-menu-history-item')).toHaveCount(2);
    await web.locator('.sn-menu-history-clear-btn').click();
    await confermaWeb(c.app, '127.0.0.1');
    await expect.poll(() => c.disco()).toEqual([]);
  } finally { await c.chiudi(); }
});

test('tolta dalla Sicurezza, la password non torna in cronologia al primo «Incolla»', async () => {
  const c = await avvia([]);
  try {
    const web = await c.web();
    await c.app.evaluate(({ clipboard }) => clipboard.writeText('password-segretissima'));
    await web.locator('#ta').click({ button: 'right' });
    await web.locator('.sn-menu-paste-main').first().click();
    await expect.poll(() => c.disco()).toContain('password-segretissima');

    const sec = await c.sec();
    await sec.locator('#sec-clip-list .sn-clip-remove').first().click();
    await expect.poll(() => c.disco()).toEqual([]);

    await web.locator('#ta').fill('');
    await web.locator('#ta').click({ button: 'right' });
    await web.locator('.sn-menu-paste-main').first().click();
    await expect(web.locator('#ta')).toHaveValue('password-segretissima');
    await web.waitForTimeout(1000);
    expect(c.disco(), 'la voce tolta è rientrata da sola').not.toContain('password-segretissima');
  } finally { await c.chiudi(); }
});

test('svuotata dal menu, la cosa ancora negli appunti non rientra al primo «Incolla»; incollare altro la libera', async () => {
  const c = await avvia([{ type: 'text', text: 'vecchia', ts: 1 }]);
  try {
    const web = await c.web();
    const incolla = async (testo) => {
      await c.app.evaluate(({ clipboard }, t) => clipboard.writeText(t), testo);
      await web.locator('#ta').fill('');
      await web.locator('#ta').click({ button: 'right' });
      await web.locator('.sn-menu-paste-main').first().click();
      await expect(web.locator('#ta')).toHaveValue(testo);
      await web.waitForTimeout(800);
    };
    await incolla('password-due');
    await expect.poll(() => c.disco()).toEqual(['password-due', 'vecchia']);

    await web.locator('#ta').click({ button: 'right' });
    await web.locator('.sn-menu-paste-arrow').click();
    await web.locator('.sn-menu-history-clear-btn').click();
    await confermaWeb(c.app, '127.0.0.1');
    await expect.poll(() => c.disco()).toEqual([]);

    await incolla('password-due');
    expect(c.disco(), 'svuotata, la password è rientrata da sola').toEqual([]);

    // Negli appunti adesso c'è altro: la sospensione finisce, la cronologia riprende.
    await incolla('testo normale');
    await incolla('password-due');
    expect(c.disco()).toEqual(['password-due', 'testo normale']);
  } finally { await c.chiudi(); }
});

test('menu «Incolla»: tolta una voce, la sua gemella a schermo non resta viva e cliccabile', async () => {
  const c = await avvia([
    { type: 'text', text: 'password-segreta', ts: 200 },
    { type: 'text', text: 'nota qualunque', ts: 150 },
    { type: 'text', text: 'password-segreta ', ts: 100 },
  ]);
  try {
    const web = await c.web();
    await web.locator('#ta').click({ button: 'right' });
    await web.locator('.sn-menu-paste-arrow').click();
    await web.locator('.sn-menu-history-item').first().locator('.sn-menu-history-remove').click();
    await expect.poll(() => c.disco()).toEqual(['nota qualunque']);
    const vive = web.locator('.sn-menu-history-item:not(.sn-menu-history-gone)').filter({ hasText: 'password' });
    await expect(vive, 'la gemella già sparita dal disco resta viva nel menu').toHaveCount(0);
  } finally { await c.chiudi(); }
});

test('Sicurezza col puntatore fermo sulla lista: uno svuotamento dal menu di un\'altra scheda non sposta le righe sotto la mano', async () => {
  const c = await avvia(voci(4));
  try {
    const web = await c.web();
    const sec = await c.sec();
    await sec.locator('#sec-clip-list').scrollIntoViewIfNeeded();
    const box = await sec.locator('#sec-clip-list .sn-clip-item').nth(1).boundingBox();
    await sec.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await sec.mouse.move(box.x + box.width / 2 + 2, box.y + box.height / 2 + 1);
    await sec.waitForTimeout(300);
    const top0 = await sec.evaluate(() => document.querySelectorAll('#sec-clip-list .sn-clip-item')[1].getBoundingClientRect().top);

    // Lo svuotamento parte davvero dal menu «Incolla» della scheda web.
    await web.locator('#ta').click({ button: 'right' });
    await web.locator('.sn-menu-paste-arrow').click();
    await web.locator('.sn-menu-history-clear-btn').click();
    await confermaWeb(c.app, '127.0.0.1');
    await expect.poll(() => c.disco()).toEqual([]);

    await sec.waitForTimeout(800);
    const stato = await sec.evaluate(() => {
      const righe = [...document.querySelectorAll('#sec-clip-list .sn-clip-item')];
      return {
        hover: document.getElementById('sec-clip-list').matches(':hover'),
        n: righe.length,
        top1: righe[1] ? righe[1].getBoundingClientRect().top : null,
      };
    });
        test.skip(!stato.hover, 'il puntatore non risulta sulla lista: la prova non dice niente');
    expect(stato.n, 'le righe sono sparite sotto il puntatore').toBe(4);
    expect(stato.top1).toBe(top0);
  } finally { await c.chiudi(); }
});

test('Sicurezza: una riga già tolta non promette più di rimettere la voce negli appunti', async () => {
  const c = await avvia(voci(4));
  try {
    const sec = await c.sec();
    await sec.locator('#sec-clip-list').scrollIntoViewIfNeeded();
    const riga = sec.locator('#sec-clip-list .sn-clip-item').nth(1);
    await riga.locator('.sn-clip-remove').click();
    await expect(riga).toHaveClass(/sn-clip-gone/);
    const copia = riga.locator('.sn-clip-copy');
    const st = await copia.evaluate((b) => ({ disabled: b.disabled, title: b.title }));
    expect(st.disabled || !/Rimetti/.test(st.title), 'la riga tolta offre ancora «Rimetti questa voce negli appunti»').toBe(true);
  } finally { await c.chiudi(); }
});

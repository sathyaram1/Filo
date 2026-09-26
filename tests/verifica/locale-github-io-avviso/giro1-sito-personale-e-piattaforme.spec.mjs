// Giro 1 della verifica «avviso GitHub su github.io»: il sito personale su GitHub Pages si legge senza avviso,
// le piattaforme dove chiunque pubblica non sono più fidate per intero. Il primo test apre una pagina vera in rete.
import { test, expect } from '../../fixtures/electron.mjs';

const tabLevel = (app, host) => app.evaluate(({ BrowserWindow }, h) => {
  for (const w of BrowserWindow.getAllWindows()) {
    if (!w._filoTabs) continue;
    for (const t of w._filoTabs.tabs) {
      let u = '';
      try { u = new URL(t.view.webContents.getURL()).hostname; } catch (_) {}
      if (u === h) return t.sbLevel || null;
    }
  }
  return null;
}, host);

test('sito personale su GitHub Pages: la pagina si legge e nessun avviso compare, nemmeno a rete arrivata', async ({ app, openTab }) => {
  const page = await openTab('https://octocat.github.io/');
  await page.waitForLoadState('load').catch(() => {});
  const visti = new Set();
  const fine = Date.now() + 15_000;
  while (Date.now() < fine) {
    const l = await tabLevel(app, 'octocat.github.io');
    if (l) visti.add(l);
    await page.waitForTimeout(500);
  }
  expect([...visti]).toEqual(['safe']);
  await expect(page.getByText(/Controlla l.indirizzo/)).toHaveCount(0);
  expect((await page.title()).length).toBeGreaterThan(0);
});

test('piattaforme della richiesta: i siti degli utenti non sono fidati per intero e un sosia viene segnalato', async ({ app }) => {
  const v = await app.evaluate(() => {
    const SB = globalThis.SN_SAFEBROWSE;
    const r = (u) => { const x = SB.checkSync(u, {}); return { level: x.level, wl: !!x.whitelisted }; };
    return {
      utenti: ['https://mybucket.s3.amazonaws.com/', 'https://lh3.googleusercontent.com/a', 'https://contoso.sharepoint.com/',
        'https://myblog.wordpress.com/', 'https://someone.medium.com/'].map(r),
      sosia: ['https://paypal-login.s3.amazonaws.com/', 'https://paypal-secure.googleusercontent.com/',
        'https://microsoft-login.sharepoint.com/', 'https://paypal-support.wordpress.com/', 'https://paypal-help.medium.com/',
        'https://paypal-verify.github.io/'].map(r),
      ufficiali: ['https://github.com/', 'https://microsoft.sharepoint.com/', 'https://wordpress.com/'].map(r),
    };
  });
  for (const x of v.utenti) expect(x).toEqual({ level: 'safe', wl: false });
  for (const x of v.sosia) expect(x.level).toBe('sospetto');
  for (const x of v.ufficiali) expect(x.level).toBe('safe');
});

test('contenuti pubblicati da chiunque sotto un indirizzo in whitelist, per percorso: non sono fidati per identità', async ({ app }) => {
  test.fail(true, 'rilievo aperto del giro 1: Google Sites, Moduli Google, Microsoft Forms, archive.org, Notion restano fidati');
  const wl = await app.evaluate(() => {
    const SB = globalThis.SN_SAFEBROWSE;
    return ['https://sites.google.com/view/paypal-login', 'https://docs.google.com/forms/d/e/x/viewform',
      'https://script.google.com/macros/s/x/exec', 'https://forms.office.com/r/abc',
      'https://archive.org/download/x/login.html', 'https://www.notion.so/user/page']
      .map((u) => !!SB.checkSync(u, { hasPassword: true }).whitelisted);
  });
  expect(wl).toEqual([false, false, false, false, false, false]);
});

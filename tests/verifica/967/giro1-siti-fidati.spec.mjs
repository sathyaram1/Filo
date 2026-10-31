// Verifica #967 giro 1: prove avversariali sui «Siti di cui ti fidi».
import { test, expect, aspettaFinestra } from '../../fixtures/electron.mjs';
import { createServer } from 'node:http';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const NOMI = ['team.com'];

async function miniServer() {
  const server = createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(`<title>V967 ${req.url}</title><h1>Pagina</h1>`);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { porta: server.address().port, chiudi: () => new Promise((r) => { try { server.closeAllConnections?.(); } catch (_) {} server.close(r); }) };
}

const apri = (shell, url) => shell.evaluate((u) => window.filoShell.tabs.open(u), url);
const fidatiSalvati = (app) => app.evaluate(async () => (await globalThis.SN_STORAGE.getSettings()).security.safeBrowse.trustedSites);
const statoScheda = (app, pezzo) => app.evaluate(({ BrowserWindow }, f) => {
  for (const w of BrowserWindow.getAllWindows()) {
    for (const t of (w._filoTabs && w._filoTabs.tabs) || []) {
      let u = '';
      try { u = t.view.webContents.getURL(); } catch (_) {}
      if (u.includes(f)) return { livello: t.sbLevel || null, avviso: t.sbAvviso ? t.sbAvviso.level : null };
    }
  }
  return null;
}, pezzo);
const vistaAvviso = (app) => aspettaFinestra(app, (w) => w.url().startsWith('filo://shell/avviso-sito.html'), 'avviso non nato');

test.describe('siti fidati, verifica', () => {
  test.use({ hostInPiu: NOMI });

  test('Sicurezza aperta: un «Continua» in un\'altra scheda fa comparire la voce senza ricaricare', async ({ app, shell }) => {
    const srv = await miniServer();
    try {
      await apri(shell, 'filo://security/security.html');
      const sic = await aspettaFinestra(app, (w) => w.url().startsWith('filo://security/'), 'Sicurezza');
      await expect(sic.locator('#sec-safebrowse-fidati-list')).toBeAttached({ timeout: 10_000 });
      await apri(shell, `http://team.com:${srv.porta}/live`);
      const avviso = await vistaAvviso(app);
      const continua = avviso.getByRole('button', { name: 'Continua' });
      await expect(continua).toBeEnabled({ timeout: 12_000 });
      // Due clic in fretta: una voce sola.
      await continua.click();
      await continua.click({ timeout: 1000 }).catch(() => {});
      await expect.poll(() => fidatiSalvati(app)).toEqual(['team.com']);
      await expect(sic.locator('#sec-safebrowse-fidati li', { hasText: 'team.com' })).toHaveCount(1, { timeout: 8000 });
    } finally { await srv.chiudi(); }
  });

  test('aspetto dell\'elenco, chiaro e scuro, con voci lunghe, IDN e pagine ospitate', async ({ app, shell }) => {
    await app.evaluate(() => globalThis.__filoHandlers.applySettingsUpdate({ security: { safeBrowse: { trustedSites: [
      'team.com', 'xn--mnchen-3ya.de', 'sites.google.com/view/la-mia-pagina',
      'unnomedidominiodavverolunghissimochenonfiniscemaiperchesiamoqui-e-ancora.com', '<b>x</b>.it',
    ] } } }));
    await apri(shell, 'filo://security/security.html');
    const sic = await aspettaFinestra(app, (w) => w.url().startsWith('filo://security/'), 'Sicurezza');
    const box = sic.locator('#sec-safebrowse-fidati');
    await expect(box).toBeVisible({ timeout: 10_000 });
    await expect(box.locator('li', { hasText: 'münchen.de' })).toBeVisible();
    await expect(box.locator('b')).toHaveCount(0);
    await box.scrollIntoViewIfNeeded();
    await box.screenshot({ path: join(APP_ROOT, 'tests', '.shots', 'v967-fidati-chiaro.png') });
    await app.evaluate(() => globalThis.__filoHandlers.applySettingsUpdate({ theme: 'dark' }));
    await sic.waitForTimeout(800);
    await box.screenshot({ path: join(APP_ROOT, 'tests', '.shots', 'v967-fidati-scuro.png') });
    const larg = await sic.evaluate(() => ({ doc: document.documentElement.scrollWidth, vista: window.innerWidth }));
    expect(larg.doc).toBeLessThanOrEqual(larg.vista);
    const btn = box.locator('li').first().getByRole('button', { name: 'Togli' });
    await btn.hover();
    await sic.waitForTimeout(300);
    await box.screenshot({ path: join(APP_ROOT, 'tests', '.shots', 'v967-fidati-hover.png') });
  });

  test('dalla chat: «togli questo sito» con team.com davanti lo toglie', async ({ app, shell }) => {
    const srv = await miniServer();
    try {
      await app.evaluate(() => globalThis.__filoHandlers.applySettingsUpdate({ security: { safeBrowse: { trustedSites: ['team.com'] } } }));
      await apri(shell, `http://team.com:${srv.porta}/questo`);
      await expect.poll(async () => (await statoScheda(app, '/questo'))?.livello, { timeout: 12_000 }).toBe('safe');
      const r = await app.evaluate(async () => {
        const x = await globalThis.__filoHandlers.executeFiloAction({ type: 'IMPOSTA_PREFERENZA', chiave: 'siti_di_cui_ti_fidi', valore: 'togli questo sito' });
        return { executed: !!(x && x.executed), out: x && x.output };
      });
      expect(r.executed, JSON.stringify(r.out)).toBe(true);
      await expect.poll(() => fidatiSalvati(app)).toEqual([]);
      await expect.poll(async () => (await statoScheda(app, '/questo'))?.avviso, { timeout: 12_000 }).toBe('sospetto');
    } finally { await srv.chiudi(); }
  });

});

test.describe('chat', () => {
  test.use({ hostInPiu: NOMI });

  test('dalla chat, confermato: «fidati di questo sito» tace l\'avviso aperto e lo salva', async ({ app, shell }) => {
    const srv = await miniServer();
    try {
      await apri(shell, `http://team.com:${srv.porta}/chat-aggiungi`);
      await expect.poll(async () => (await statoScheda(app, '/chat-aggiungi'))?.avviso, { timeout: 12_000 }).toBe('sospetto');
      const r = await app.evaluate(async () => {
        const x = await globalThis.__filoHandlers.executeFiloAction({ type: 'IMPOSTA_PREFERENZA', chiave: 'siti_di_cui_ti_fidi', valore: 'aggiungi questo sito' }, { confirmed: true, sender: { url: 'filo://newtab/' } });
        return { executed: !!(x && x.executed), out: JSON.stringify(x).slice(0, 600) };
      });
      expect(r.executed, r.out).toBe(true);
      await expect.poll(() => fidatiSalvati(app)).toEqual(['team.com']);
      await expect.poll(async () => (await statoScheda(app, '/chat-aggiungi'))?.avviso).toBe(null);
    } finally { await srv.chiudi(); }
  });
});

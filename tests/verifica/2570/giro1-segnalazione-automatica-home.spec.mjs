// Verifica #2570 giro 1: la segnalazione automatica parte quando il suo avviso se ne va, anche nella home, lungo le
// strade che il caso felice non prova (puntatore sopra, avviso nato su un sito e home aperta dopo, due di fila).
import { test, expect } from '../../fixtures/electron.mjs';

async function homePage(app) {
  let page = null;
  await expect.poll(() => {
    page = app.windows().find((w) => { try { return w.url().startsWith('filo://newtab'); } catch (_) { return false; } });
    return !!page;
  }, { timeout: 10_000 }).toBe(true);
  await page.waitForLoadState('domcontentloaded');
  await expect(page.locator('#sendBtn')).toBeVisible({ timeout: 8_000 });
  return page;
}

// L'avviso vero del main (biglietto di autoFeedbackAttesa e `shell:toast` con «Annulla»), con un invio finto.
async function segnalazioneAutomatica(app, durationSec = 2) {
  await app.evaluate(({ BrowserWindow }, durationSec) => {
    globalThis.__partite = globalThis.__partite || [];
    const M = process.getBuiltinModule('module');
    const k = Object.keys(M._cache).find((x) => /services[\\/]autoFeedbackAttesa\.js$/.test(x));
    const Attesa = M._cache[k].exports;
    const win = BrowserWindow.getAllWindows().find((w) => w._filoTabs);
    const n = globalThis.__partite.length + 1;
    const biglietto = Attesa.trattieni(async () => { globalThis.__partite.push(n); return { id: `fb-${n}` }; }, win);
    win.webContents.send('shell:toast', {
      text: 'L\'ho segnalato a chi sviluppa Filo',
      opts: { durationSec, tipo: 'segnalazione_automatica', actions: [{ label: 'Annulla', cancelAutoFeedback: biglietto }] },
    });
  }, durationSec);
}
const partite = (app) => app.evaluate(() => globalThis.__partite || []);

test('nella home, col puntatore sopra l\'avviso oltre la scadenza: tolto il puntatore parte e l\'avviso se ne va', async ({ app, shell, avvisi }) => {
  const home = await homePage(app);
  await segnalazioneAutomatica(app, 2);
  const vista = await avvisi();
  const toast = vista.locator('.shell-notif.show', { hasText: 'L\'ho segnalato' });
  await expect(toast).toBeVisible();
  await toast.hover();
  await vista.waitForTimeout(3_500);
  expect(await partite(app)).toEqual([]);
  await vista.mouse.move(1, 1);
  await expect.poll(() => partite(app), { timeout: 8_000 }).toEqual([1]);
  await expect(shell.locator('.shell-notif:not([data-closing="1"])')).toHaveCount(0);
  await expect(home.locator('#accade > .dash-carta[data-tipo="cornice"]')).toHaveCount(0);
});

test('nata su un sito e poi la home davanti: alla scadenza parte, e nella colonna non resta niente', async ({ app, shell, openTab, testServer }) => {
  const home = await homePage(app);
  await testServer.openReady(openTab, '<h1>Un sito</h1>');
  await segnalazioneAutomatica(app, 3);
  await expect(shell.locator('.shell-notif', { hasText: 'L\'ho segnalato' })).toHaveAttribute('data-luogo', 'angolo');
  const s = await shell.evaluate(() => window.filoShell.tabs.snapshot());
  const h = s.tabs.find((t) => String(t.url || '').startsWith('filo://newtab'));
  await shell.evaluate((id) => window.filoShell.tabs.activate(id), h.id);
  await expect.poll(() => partite(app), { timeout: 10_000 }).toEqual([1]);
  await expect(shell.locator('.shell-notif:not([data-closing="1"])')).toHaveCount(0);
  await expect(home.locator('#accade > .dash-carta[data-tipo="cornice"]')).toHaveCount(0);
});

test('nella home, due segnalazioni automatiche di fila: partono tutte e due, e «Annulla» sulla seconda ferma solo lei', async ({ app, shell, avvisi }) => {
  const home = await homePage(app);
  await segnalazioneAutomatica(app, 2);
  await segnalazioneAutomatica(app, 30);
  const vista = await avvisi();
  await expect.poll(() => partite(app), { timeout: 10_000 }).toEqual([1]);
  const seconda = vista.locator('.shell-notif.show', { hasText: 'L\'ho segnalato' });
  await expect(seconda).toHaveCount(1);
  await seconda.locator('.shell-notif-action', { hasText: 'Annulla' }).click();
  await expect(shell.locator('.shell-notif:not([data-closing="1"])', { hasText: 'L\'ho segnalato' })).toHaveCount(0);
  await home.waitForTimeout(1_500);
  expect(await partite(app)).toEqual([1]);
  await expect(home.locator('#accade > .dash-carta[data-tipo="cornice"]')).toHaveCount(0);
});

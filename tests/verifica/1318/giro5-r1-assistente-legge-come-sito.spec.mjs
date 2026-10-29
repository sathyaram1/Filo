// Verifica #1318, giro 5: r1, quello che l'assistente scrive come indirizzo ha una lettura sola, che riconosce percorsi
// e posta prima dei siti, per l'apertura e per il bottone in chat.

import { test, expect } from '../../fixtures/electron.mjs';
import { home, modelloFinto, ripristina, chiedi } from '../../helpers/chatFinta.mjs';

const schede = (app) => app.evaluate(({ BrowserWindow }) => {
  const tm = BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs;
  return tm.tabs.map((t) => { try { return t.view.webContents.getURL() || t.url || ''; } catch (_) { return t.url || ''; } });
});
const homeDiFilo = async (app, shell) => {
  await shell.evaluate(() => window.filoShell.tabs.open('filo://newtab/'));
  let h = null;
  await expect.poll(() => { h = app.windows().find((w) => w.url().startsWith('filo://newtab')); return Boolean(h); }).toBe(true);
  await h.waitForFunction(() => typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage);
  return h;
};
const naviga = (h, url) => h.evaluate((u) => chrome.runtime.sendMessage({ type: 'filo_run_action', action: { type: 'NAVIGA', url: u } }), url);

test.afterEach(async ({ app }) => { await ripristina(app); });

for (const scritto of ['./conto.pdf', '../Documenti/conto.pdf', 'conto.pdf', 'relazione.docx']) {
  test(`r1 «${scritto}» chiesto all'assistente non apre una pagina d'errore su un sito inventato data per aperta`, async ({ app, shell }) => {
    const h = await homeDiFilo(app, shell);
    const prima = await schede(app);
    const r = await naviga(h, scritto);
    expect(r && r.executed, 'non è una pagina aperta').toBeFalsy();
    await shell.waitForTimeout(1500);
    expect((await schede(app)).filter((u) => !prima.includes(u)), 'nessuna scheda nuova').toEqual([]);
  });
}

test('r1 il bottone in chat della posta chiesta senza «mailto:» riapre la posta, non una ricerca Google', async ({ app }) => {
  await app.evaluate(({ shell: s }) => { globalThis.__esterni = []; s.openExternal = async (u) => { globalThis.__esterni.push(String(u)); }; });
  await modelloFinto(app, [{ text: 'Ti apro la mail.', toolCalls: [{ id: 'm1', name: 'NAVIGA', arguments: JSON.stringify({ url: 'mario.rossi@esempio.it' }) }] }, { text: 'Fatto.' }]);
  const page = await home(app);
  await chiedi(page, 'scrivi una mail a mario.rossi@esempio.it');
  await expect.poll(() => app.evaluate(() => globalThis.__esterni), { timeout: 15_000 }).toEqual(['mailto:mario.rossi@esempio.it']);
  const bottone = page.locator('a.dash-action-link-chip');
  await expect(bottone).toHaveCount(1, { timeout: 15_000 });
  await expect(bottone).toHaveAttribute('href', 'mailto:mario.rossi@esempio.it');
  await expect(bottone).not.toContainText('google');
  await bottone.evaluate((a) => a.click());
  await expect.poll(() => app.evaluate(() => globalThis.__esterni), { timeout: 10_000 })
    .toEqual(['mailto:mario.rossi@esempio.it', 'mailto:mario.rossi@esempio.it']);
  expect((await schede(app)).filter((u) => /google\.[a-z]+\/search/.test(u))).toEqual([]);
});

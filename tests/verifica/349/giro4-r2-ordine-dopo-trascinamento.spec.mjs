// #349 giro 4 — una scheda spostata a mano subito dopo la riapertura resta dove l'ha messa l'utente.

import { test, expect } from '../../fixtures/electron.mjs';

const pagina = (titolo, colore) => `<!doctype html><html><head><title>${titolo}</title>`
  + `<meta name="theme-color" content="${colore}"></head><body><h1>${titolo}</h1></body></html>`;

const avvisi = (shell) => shell.evaluate(() => [...document.querySelectorAll('.shell-notif.show .shell-notif-msg')]
  .map((el) => el.textContent));

const titoli = (shell) => shell.evaluate(async () => (await window.filoShell.tabs.snapshot()).tabs
  .filter((t) => /\.test:/.test(t.url || '')).map((t) => ({ id: t.id, title: { blu: 'Blu', verde: 'Verde', rosso: 'Rosso' }[new URL(t.url).hostname.split('.')[0]] })));

test.describe('riapertura e trascinamento', () => {
  test.use({ hostInPiu: ['blu.test', 'verde.test', 'rosso.test'] });

  test('r2 l\'ordine scelto a mano dopo la riapertura non viene rimescolato dal riordino', async ({ app, shell, testServer }) => {
    const su = (host, html) => testServer.html(html).replace('127.0.0.1', host);
    const urls = [
      su('blu.test', pagina('Blu', 'rgb(40,80,200)')),
      su('verde.test', pagina('Verde', 'rgb(40,200,80)')),
      su('rosso.test', pagina('Rosso', 'rgb(200,40,40)')),
    ];
    await app.evaluate(async ({ BrowserWindow }, urls) => {
      await globalThis.SN_STORAGE.updateSettings({ autoArchive: { enabled: true, onClose: true, onIdle: false, idleHours: 6 } });
      // Il modello tiene tutto, con il tempo di una risposta vera.
      globalThis.SN_TAB_TRIAGE_DECIDE = async ({ tabs }) => {
        await new Promise((r) => setTimeout(r, 1500));
        return { decisions: tabs.map((t, i) => ({ i, action: 'keep', reason: 'test' })) };
      };
      const tm = BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs;
      await globalThis.SN_STORAGE.setRaw(tm._sessionKey(), {
        tabs: urls,
        colors: ['rgb(40, 80, 200)', 'rgb(40, 200, 80)', 'rgb(200, 40, 40)'],
        activeIndex: 0,
      });
      await tm.restoreSession();
    }, urls);

    // Appena riaperto, l'utente trascina Verde in fondo: Blu, Rosso, Verde.
    const prima = await titoli(shell);
    expect(prima.map((t) => t.title)).toEqual(['Blu', 'Verde', 'Rosso']);
    await shell.evaluate(async (id) => {
      const tutte = (await window.filoShell.tabs.snapshot()).tabs;
      return window.filoShell.tabs.move(id, tutte.length - 1);
    }, prima.find((t) => t.title === 'Verde').id);
    await expect.poll(async () => (await titoli(shell)).map((t) => t.title)).toEqual(['Blu', 'Rosso', 'Verde']);

    await expect.poll(async () => (await avvisi(shell)).some((t) => t.startsWith('Schede')), { timeout: 40_000 }).toBe(true);
    expect((await titoli(shell)).map((t) => t.title)).toEqual(['Blu', 'Rosso', 'Verde']);
  });
});

// Verifica #589 — giro 6, rilievo 2. La spinta sceglie cosa mandare guardando
// l'indirizzo di ogni riquadro; un sito può aprire nella propria pagina un
// riquadro su un indirizzo di Filo, e lì dentro arrivano chiavi e proxy.
// Le richieste dallo stesso riquadro, invece, sono trattate da sito.

import { test, expect } from '../../fixtures/electron.mjs';

const CHIAVE = 'sk-or-v1-GIRO6-589-RIQUADRO';
const PWD = 'PWD-GIRO6-589-RIQUADRO';

test('una pagina di Filo incorporata da un sito non riceve chiavi e proxy', async ({ app, shell, openTab, testServer }) => {
  await shell.evaluate(({ k, p }) => window.filoShell.message({
    type: 'update_settings',
    settings: { apiKeys: { openrouter: k }, proxy: { datacenter: `socks5://utente:${p}@gate.example.com:7000` } },
  }), { k: CHIAVE, p: PWD });

  await openTab('filo://options/options.html');
  const web = await testServer.openReady(openTab,
    '<h1>sito</h1><iframe src="filo://newtab/"></iframe><iframe src="filo://asset/"></iframe>');
  await expect.poll(() => app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows().find((w) => w._filoTabs);
    const tab = win._filoTabs.tabs.find((t) => /^https?:/.test(String(t.url || '')));
    return tab.view.webContents.mainFrame.framesInSubtree.filter((f) => String(f.url).startsWith('filo://')).length;
  }), { timeout: 8000 }).toBe(2);

  await app.evaluate(({ BrowserWindow }) => {
    globalThis.__g6r2 = [];
    const win = BrowserWindow.getAllWindows().find((w) => w._filoTabs);
    const frP = Object.getPrototypeOf(win.webContents.mainFrame);
    const frSend = frP.send;
    frP.send = function (ch, ...a) {
      if (ch === 'filo:broadcast' && a[0]?.type === 'settings_updated') {
        let dump = ''; try { dump = JSON.stringify(a[0].settings ?? null); } catch (_) {}
        globalThis.__g6r2.push({ url: String(this.url || ''), top: String(this.top?.url || ''), dump });
      }
      return frSend.call(this, ch, ...a);
    };
  });
  await shell.evaluate(() => window.filoShell.message({ type: 'update_settings', settings: { theme: 'dark' } }));
  await expect.poll(() => app.evaluate(() => globalThis.__g6r2.filter((c) => /^https?:/.test(c.top)).length), { timeout: 8000 })
    .toBeGreaterThan(0);

  const consegne = await app.evaluate(() => globalThis.__g6r2);
  const dentroIlSito = consegne.filter((c) => /^https?:/.test(c.top));
  expect(dentroIlSito.some((c) => c.url.startsWith('filo://')), 'la prova non ha visto i riquadri di Filo dentro il sito').toBe(true);
  for (const c of dentroIlSito) {
    expect(c.dump, `la chiave è arrivata dentro la pagina del sito, nel riquadro ${c.url}`).not.toContain(CHIAVE);
    expect(c.dump, `la password del proxy è arrivata dentro la pagina del sito, nel riquadro ${c.url}`).not.toContain(PWD);
  }
  const versoFilo = consegne.filter((c) => c.top.startsWith('filo://') && c.url === c.top && c.url !== '');
  expect(versoFilo.some((c) => c.dump.includes(CHIAVE)), 'le schede di Filo devono continuare a ricevere l\'oggetto intero').toBe(true);
});

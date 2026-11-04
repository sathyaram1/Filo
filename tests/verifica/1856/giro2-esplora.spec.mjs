// Verifica #1856 giro 2: porte vicine alla riapertura senza finestra principale.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect } from '../../fixtures/electron.mjs';

function negozioConAccesso(testServer) {
  const accesso = `${testServer.html('<title>Accedi</title><h1>Passkey</h1>')}?client_id=1&redirect_uri=x`;
  const negozio = `<title>Negozio</title><button id="b" style="width:220px;height:60px"
    onclick="window.open(${JSON.stringify(accesso).replace(/"/g, '&quot;')},'login','width=420,height=520')">Accedi</button>`;
  return { accesso: accesso.split('?')[0], negozio };
}

const stato = (app, base = '') => app.evaluate(({ BrowserWindow }, b) => {
  const vive = BrowserWindow.getAllWindows().filter((w) => !w.isDestroyed());
  const normali = vive.filter((w) => w._filoTabs && !w._filoIncognito);
  return {
    normali: normali.length,
    visibile: normali[0] ? normali[0].isVisible() : null,
    schede: normali[0] ? normali[0]._filoTabs.tabs.map((t) => t.url || '') : [],
    accesso: b ? vive.filter((w) => !w._filoTabs && w.webContents.getURL().startsWith(b)).length : 0,
    errori: globalThis.__err || [],
  };
}, base);

async function chiudiPrincipale(app, shell, openTab, testServer) {
  const { accesso, negozio: html } = negozioConAccesso(testServer);
  await app.evaluate(() => { globalThis.__err = []; process.on('uncaughtException', (e) => globalThis.__err.push(String(e?.stack || e))); });
  const page = await testServer.openReady(openTab, html);
  const negozio = page.url();
  await page.click('#b');
  await expect.poll(async () => (await stato(app, accesso)).accesso, { timeout: 10000 }).toBe(1);
  await expect.poll(() => app.evaluate(async () => {
    const s = await globalThis.SN_STORAGE.getRaw(globalThis.SN_CONST.STORAGE_KEYS.OPEN_TABS, null);
    return (s && s.tabs) || [];
  }), { timeout: 10000 }).toContain(negozio);
  await shell.locator('#win-close').click({ noWaitAfter: true }).catch(() => {});
  await expect.poll(async () => (await stato(app, accesso)).normali, { timeout: 10000 }).toBe(0);
  return { negozio, accesso };
}

test('Dock su Mac con la finestrella ridotta a icona (nessuna finestra visibile): torna la finestra con le schede', async ({ app, shell, openTab, testServer }) => {
  const { negozio, accesso } = await chiudiPrincipale(app, shell, openTab, testServer);
  await app.evaluate(({ app: a }) => { a.emit('activate', {}, false); });
  await expect.poll(async () => (await stato(app, accesso)).schede, { timeout: 15000 }).toContain(negozio);
  const s = await stato(app, accesso);
  expect(s.normali).toBe(1);
  expect(s.visibile).toBe(true);
  expect(s.errori).toEqual([]);
});

test('chiusa la principale, chi finisce l\'accesso e chiude la finestrella non perde le schede al riavvio', async ({ app, shell, openTab, testServer }) => {
  const userData = await app.evaluate(({ app: a }) => a.getPath('userData'));
  const { negozio, accesso } = await chiudiPrincipale(app, shell, openTab, testServer);
  const chiusa = app.waitForEvent('close', { timeout: 20000 });
  await app.evaluate(({ BrowserWindow }, b) => {
    for (const w of BrowserWindow.getAllWindows()) if (!w.isDestroyed() && !w._filoTabs && w.webContents.getURL().startsWith(b)) w.close();
  }, accesso).catch(() => {});
  await chiusa;
  const salvato = JSON.parse(readFileSync(join(userData, 'storage.json'), 'utf8'));
  expect(salvato.sn_open_tabs?.tabs || []).toContain(negozio);
});

test('seconda apertura col rapido doppio clic: dieci in fila senza attese fanno una finestra sola', async ({ app, shell, openTab, testServer }) => {
  const { negozio, accesso } = await chiudiPrincipale(app, shell, openTab, testServer);
  await app.evaluate(({ app: a }) => {
    for (let i = 0; i < 10; i++) { a.emit('second-instance', {}, ['filo.exe', '.'], process.cwd()); a.emit('activate', {}, true); }
  });
  await expect.poll(async () => (await stato(app, accesso)).schede, { timeout: 15000 }).toContain(negozio);
  await new Promise((r) => setTimeout(r, 1500));
  const s = await stato(app, accesso);
  expect(s.normali).toBe(1);
  expect(s.errori).toEqual([]);
});

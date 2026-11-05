// Verifica #2031, giro 1: le voci della barra dei menu su Mac quando la finestra con le schede non è quella davanti
// (chiusa, o dietro la finestrella di accesso).
import { test, expect } from '../../fixtures/electron.mjs';
import { voceDellaBarra } from '../../helpers/barraDeiMenu.mjs';

function negozioConAccesso(testServer) {
  const accesso = `${testServer.html('<title>Accedi</title><h1>Passkey</h1>')}?client_id=1&redirect_uri=x`;
  const negozio = `<title>Negozio</title><button id="b" style="width:220px;height:60px"
    onclick="window.open(${JSON.stringify(accesso).replace(/"/g, '&quot;')},'login','width=420,height=520')">Accedi</button>`;
  return { accesso: accesso.split('?')[0], negozio };
}

const stato = (app, base = '') => app.evaluate(({ BrowserWindow }, b) => {
  const vive = BrowserWindow.getAllWindows().filter((w) => !w.isDestroyed());
  const normale = vive.find((w) => w._filoTabs && !w._filoIncognito);
  return {
    accesso: b ? vive.filter((w) => !w._filoTabs && w.webContents.getURL().startsWith(b)).length : 0,
    normale: normale ? {
      visibile: normale.isVisible(),
      schede: normale._filoTabs.tabs.map((t) => t.url || ''),
    } : null,
  };
}, base);

const sessioneSalvata = (app) => app.evaluate(async () => {
  const s = await globalThis.SN_STORAGE.getRaw(globalThis.SN_CONST.STORAGE_KEYS.OPEN_TABS, null);
  return (s && s.tabs) || [];
});

async function apriAccesso(app, openTab, testServer) {
  const { accesso, negozio: html } = negozioConAccesso(testServer);
  const page = await testServer.openReady(openTab, html);
  const negozio = page.url();
  await page.click('#b');
  await expect.poll(async () => (await stato(app, accesso)).accesso, { timeout: 10000 }).toBe(1);
  return { negozio, accesso };
}

for (const voce of ['Barra laterale', 'Schermo intero', 'Ricarica']) {
  test(`r1 su Mac, senza la finestra principale, «${voce}» ridà Filo con le sue schede`, async ({ app, shell, openTab, testServer }) => {
    const { negozio, accesso } = await apriAccesso(app, openTab, testServer);
    await expect.poll(() => sessioneSalvata(app), { timeout: 10000 }).toContain(negozio);
    await shell.locator('#win-close').click({ noWaitAfter: true }).catch(() => {});
    await expect.poll(async () => (await stato(app, accesso)).normale, { timeout: 10000 }).toBeNull();
    await voceDellaBarra(app, voce);
    await expect.poll(async () => (await stato(app, accesso)).normale?.schede || [],
      { message: `«${voce}» senza finestra non fa niente: la finestra con le schede non torna`, timeout: 15000 }).toContain(negozio);
  });
}

test('r2 con la finestrella di accesso davanti, «Chiudi scheda» non chiude la scheda del negozio dietro', async ({ app, openTab, testServer }) => {
  const { negozio, accesso } = await apriAccesso(app, openTab, testServer);
  await app.evaluate(({ BrowserWindow }, b) => {
    const f = BrowserWindow.getAllWindows().find((w) => !w._filoTabs && w.webContents.getURL().startsWith(b));
    f.show(); f.focus();
  }, accesso);
  await voceDellaBarra(app, 'Chiudi scheda');
  await new Promise((r) => setTimeout(r, 1000));
  expect((await stato(app, accesso)).normale.schede, 'Cmd+W nella finestrella ha chiuso la scheda che aspetta l\'accesso').toContain(negozio);
});

// #2031 giro 2 — con la finestra principale chiusa e la finestrella di accesso davanti, le voci della pagina agiscono
// sulla finestrella come quando la principale c'è.

import { test, expect } from '../../fixtures/electron.mjs';
import { voceDellaBarra } from '../../helpers/barraDeiMenu.mjs';

function negozioConAccesso(testServer) {
  const accesso = `${testServer.html('<title>Accedi</title><h1>Passkey</h1>')}?client_id=1&redirect_uri=x`;
  const negozio = `<title>Negozio</title><button id="b" style="width:220px;height:60px"
    onclick="window.open(${JSON.stringify(accesso).replace(/"/g, '&quot;')},'login','width=420,height=520')">Accedi</button>`;
  return { accesso: accesso.split('?')[0], negozio };
}

const stato = (app, base) => app.evaluate(({ BrowserWindow }, b) => {
  const vive = BrowserWindow.getAllWindows().filter((w) => !w.isDestroyed());
  return {
    normali: vive.filter((w) => w._filoTabs && !w._filoIncognito).length,
    accesso: vive.filter((w) => { try { return !w._filoTabs && w.webContents.getURL().startsWith(b); } catch (_) { return false; } }).length,
  };
}, base);

const ricaricheFinestrella = (app, base) => app.evaluate(({ BrowserWindow }, b) => {
  const f = BrowserWindow.getAllWindows().find((w) => { try { return !w.isDestroyed() && !w._filoTabs && w.webContents.getURL().startsWith(b); } catch (_) { return false; } });
  return f ? f.webContents.executeJavaScript('window.__caricata || (window.__caricata = Date.now())', false) : null;
}, base);

async function principaleChiusaFinestrellaDavanti(app, shell, openTab, testServer) {
  const { accesso, negozio } = negozioConAccesso(testServer);
  const page = await testServer.openReady(openTab, negozio);
  await page.click('#b');
  await expect.poll(async () => (await stato(app, accesso)).accesso, { timeout: 10000 }).toBe(1);
  await shell.locator('#win-close').click({ noWaitAfter: true }).catch(() => {});
  await expect.poll(async () => (await stato(app, accesso)).normali, { timeout: 10000 }).toBe(0);
  const davanti = () => app.evaluate(({ BrowserWindow }, b) => {
    const f = BrowserWindow.getAllWindows().find((w) => !w._filoTabs && w.webContents.getURL().startsWith(b));
    f.show(); f.focus();
    return BrowserWindow.getFocusedWindow() === f;
  }, accesso);
  await expect.poll(davanti, { message: 'la finestrella non è andata davanti', timeout: 5000 }).toBe(true);
  return accesso;
}

for (const voce of ['Chiudi scheda', 'Chiudi finestra']) {
  test(`r1 principale chiusa, finestrella davanti: «${voce}» chiude la finestrella`, async ({ app, shell, openTab, testServer }) => {
    const accesso = await principaleChiusaFinestrellaDavanti(app, shell, openTab, testServer);
    await voceDellaBarra(app, voce);
    await expect.poll(async () => (await stato(app, accesso)).accesso, { message: `«${voce}» non ha chiuso la finestrella davanti`, timeout: 5000 }).toBe(0);
  });
}

test('r1 principale chiusa, finestrella davanti: «Ricarica» ricarica la finestrella, come con la principale aperta', async ({ app, shell, openTab, testServer }) => {
  const accesso = await principaleChiusaFinestrellaDavanti(app, shell, openTab, testServer);
  const segno = await ricaricheFinestrella(app, accesso);
  await new Promise((r) => setTimeout(r, 50));
  await voceDellaBarra(app, 'Ricarica');
  await expect.poll(() => ricaricheFinestrella(app, accesso), { message: '«Ricarica» non ha ricaricato la finestrella davanti', timeout: 8000 }).not.toBe(segno);
});

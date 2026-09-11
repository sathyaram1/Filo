// Verifica #583, giro 2 — l'altra metà della chiusura.
//
// Il giro 1 aveva trovato che le strade verso la posta delle segnalazioni
// restavano in vista a chiunque e finivano in un vicolo cieco. La correzione le
// mostra solo a chi i feedback li gestisce. Tutte le prove scritte finora
// guardano però il lato di chi NON è l'owner: se domani quel controllo
// rispondesse sempre «no», resterebbero tutte verdi e l'owner si troverebbe
// senza nessuna strada per aprire la sua posta — e senza nemmeno accorgersene,
// perché non c'è più niente che glielo dica.
//
// Qui si guarda il lato di chi gestisce: icona del menu del tasto destro, voci
// del menu App, e il passaggio dal vedere al non vedere quando la sessione
// finisce.

import { test, expect } from './../../fixtures/electron.mjs';

const HTML = `<!doctype html><html><body style="padding:40px;font:16px sans-serif">
  <h1>Filo test page</h1>
  <p>Click destro qui per aprire il menu Filo.</p>
</body></html>`;

// Fa credere al processo principale di avere davanti una sessione di chi
// gestisce i feedback. È l'unico pezzo che uno spec non può avere davvero (non
// esiste un modo di ottenere un token admin vero in un test); tutto il resto —
// la domanda che parte dal menu, il disegno delle voci — è il codice vero.
async function fingiOwner(app, acceso) {
  await app.evaluate(async ({ ipcMain }, on) => {
    if (!globalThis.__fingiOwnerInstallato) {
      const mappa = ipcMain._invokeHandlers;
      const vero = mappa.get('filo:message');
      mappa.set('filo:message', async (e, ...args) => {
        const msg = args[0];
        const res = await vero(e, ...args);
        if (globalThis.__fingiOwner && msg && msg.type === 'auth_status') {
          return {
            ok: true, signedIn: true, isAdmin: true,
            profile: { email: 'owner@filo.test', name: 'Owner' }, uid: 'uid-owner',
          };
        }
        return res;
      });
      globalThis.__fingiOwnerInstallato = true;
    }
    globalThis.__fingiOwner = !!on;
  }, acceso);
}

// Racconta alla shell che la sessione è cambiata, come fa il main dopo un
// accesso vero.
async function annunciaSessione(app, { signedIn, isAdmin }) {
  await app.evaluate(async ({ webContents }, m) => {
    for (const wc of webContents.getAllWebContents()) {
      try {
        wc.send('filo:broadcast', {
          type: 'auth_changed',
          signedIn: m.signedIn,
          isAdmin: m.isAdmin,
          profile: m.signedIn ? { email: 'owner@filo.test', name: 'Owner' } : null,
        });
      } catch (_) {}
    }
  }, { signedIn, isAdmin });
}

async function apriGriglia(page) {
  await page.locator('p').click({ button: 'right' });
  const menu = page.locator('.sn-menu').first();
  await expect(menu).toBeVisible();
  const overflow = menu.locator('.sn-menu-row-overflow').first();
  await expect(overflow).toBeVisible();
  await overflow.hover();
  const grid = page.locator('.sn-menu-icon-grid');
  await expect(grid).toBeVisible({ timeout: 2000 });
  return grid;
}

async function apriMenuApp(shell, app, escludi) {
  await shell.evaluate(() => document.getElementById('nav-apps')?.click());
  const scadenza = Date.now() + 8000;
  while (Date.now() < scadenza) {
    const win = app.windows().find((w) => (
      !w.isClosed() && w !== escludi && w.url().startsWith('data:text/html')
    ));
    if (win) {
      await win.waitForSelector('.item, .row', { timeout: 2000 }).catch(() => {});
      return win;
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('popup del menu App non aperto');
}

test.afterEach(async ({ app }) => {
  await fingiOwner(app, false).catch(() => {});
});

test('chi gestisce i feedback ritrova l\'icona nel menu del tasto destro', async ({ app, openTab, testServer }) => {
  const page = await testServer.openReady(openTab, HTML);

  // Prima: nessuna sessione, l'icona non c'è (è il comportamento del giro 1).
  const primaGriglia = await apriGriglia(page);
  await expect(primaGriglia.locator('.sn-menu-icon-btn[data-sn-icon-id="feedbackApp"]')).toHaveCount(0);
  await page.keyboard.press('Escape');

  // Poi: la sessione di chi gestisce. Il menu si richiede lo stato ad ogni
  // apertura, quindi NON serve riaprire la pagina.
  await fingiOwner(app, true);
  const griglia = await apriGriglia(page);
  await expect(
    griglia.locator('.sn-menu-icon-btn[data-sn-icon-id="feedbackApp"]'),
    'chi gestisce i feedback non ha più nessuna icona per aprirli',
  ).toBeVisible({ timeout: 5000 });
});

test('l\'icona di chi gestisce apre davvero la posta delle segnalazioni', async ({ app, openTab, testServer }) => {
  const page = await testServer.openReady(openTab, HTML);
  await fingiOwner(app, true);
  const griglia = await apriGriglia(page);
  const icona = griglia.locator('.sn-menu-icon-btn[data-sn-icon-id="feedbackApp"]');
  await expect(icona).toBeVisible({ timeout: 5000 });
  await icona.click();

  await expect.poll(async () => {
    return app.evaluate(async ({ BrowserWindow }) => {
      const urls = [];
      for (const w of BrowserWindow.getAllWindows()) {
        for (const t of (w._filoTabs?.tabs || [])) urls.push(String(t.url || ''));
      }
      return urls.filter((u) => u.includes('feedback/feedback.html')).length;
    });
  }, { timeout: 10_000 }).toBeGreaterThan(0);
});

test('nel menu App le voci riservate tornano a chi gestisce, e spariscono quando esce', async ({ app, shell }) => {
  // Sessione di chi gestisce: le due voci ci sono.
  await fingiOwner(app, true);
  await annunciaSessione(app, { signedIn: true, isAdmin: true });
  let popup = await apriMenuApp(shell, app);
  for (const voce of ['Feedback', 'Gestione']) {
    await expect(
      popup.getByText(voce, { exact: true }),
      `«${voce}» non c'è più nemmeno per chi gestisce i feedback`,
    ).toBeVisible({ timeout: 5000 });
  }
  const primo = popup;
  await shell.evaluate(() => document.getElementById('nav-apps')?.click());
  await new Promise((r) => setTimeout(r, 600));

  // Fine sessione: le due voci se ne vanno senza riavviare Filo.
  await fingiOwner(app, false);
  await annunciaSessione(app, { signedIn: false, isAdmin: false });
  popup = await apriMenuApp(shell, app, primo);
  for (const voce of ['Feedback', 'Gestione']) {
    await expect(popup.getByText(voce, { exact: true })).toHaveCount(0);
  }
  // E le voci di tutti restano.
  await expect(popup.getByText('Bacheca', { exact: true })).toBeVisible();
});

test('in chat /feedback torna ad aprire la posta per chi la gestisce', async ({ app, openTab }) => {
  await fingiOwner(app, true);
  const page = await openTab('filo://newtab/');
  await page.waitForLoadState('domcontentloaded');
  const input = page.locator('#dashInput, #input, textarea').first();
  await input.waitFor({ timeout: 15_000 });
  await input.fill('/feedback');
  await input.press('Enter');

  await expect.poll(async () => {
    return app.evaluate(async ({ BrowserWindow }) => {
      const urls = [];
      for (const w of BrowserWindow.getAllWindows()) {
        for (const t of (w._filoTabs?.tabs || [])) urls.push(String(t.url || ''));
      }
      return urls.filter((u) => u.includes('feedback/feedback.html')).length;
    });
  }, { timeout: 10_000 }).toBeGreaterThan(0);
});

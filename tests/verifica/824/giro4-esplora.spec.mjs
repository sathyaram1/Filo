// #824 giro 4: esplorazione (si cancella o si rinomina prima di registrare).

import { test, expect } from '../../fixtures/electron.mjs';

async function apriEsatta(app, shell, url) {
  await shell.evaluate((u) => window.filoShell.tabs.open(u), url);
  let page = null;
  await expect.poll(() => {
    page = app.windows().find((w) => { try { return w.url() === url; } catch (_) { return false; } });
    return !!page;
  }, { timeout: 10_000 }).toBe(true);
  await page.waitForFunction(() => document.documentElement.dataset.filoReady === '1', null, { timeout: 8000 });
  return page;
}

const titoliAperti = (shell) => shell.evaluate(async () => (await window.filoShell.tabs.snapshot()).tabs.map((t) => t.title));

async function pulisciTutto(app, shell, testServer) {
  await apriEsatta(app, shell, testServer.html('<!doctype html><title>Altra</title><p>altra pagina'));
  return app.evaluate(async ({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows().find((w) => w._filoTabs);
    globalThis.SN_TAB_TRIAGE_DECIDE = async ({ tabs }) => ({
      decisions: tabs.map((t, i) => ({ i, action: 'archive', reason: 'pulizia' })),
    });
    return win._filoTabs.runAutoTriage({ trigger: 'manual' });
  });
}

test('feedback a Filo inviato dal riquadro nella pagina', async ({ app, shell, testServer }) => {
  const page = await apriEsatta(app, shell, testServer.html('<!doctype html><html><head><title>Articolo</title></head><body><p>Un articolo qualunque.</p></body></html>'));
  await app.evaluate(() => {
    globalThis.SN_FEEDBACK.encryptionUnavailable = () => '';
  });
  await app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows().find((w) => w._filoTabs);
    const tab = win._filoTabs.tabs.find((t) => /Articolo/.test(t.title || ''));
    tab.view.webContents.mainFrame.send('filo:broadcast', { type: 'top_frame_command', surface: 'feedback' });
  });
  await expect(page.locator('.sn-fb-text')).toBeVisible({ timeout: 6000 });
  await page.locator('.sn-fb-text').click();
  await page.keyboard.type('Il bottone non funziona');
  await page.locator('.sn-fb-send').click();
  await expect(page.locator('.sn-fb-modal')).toHaveCount(0, { timeout: 8000 });
  await page.waitForTimeout(800);
  await pulisciTutto(app, shell, testServer);
  console.log('APERTE dopo feedback:', JSON.stringify(await titoliAperti(shell)));
});

test('accesso a una app senza cambio pagina', async ({ app, shell, testServer }) => {
  const page = await apriEsatta(app, shell, testServer.html(`<!doctype html><html><head><title>App</title></head><body>
    <form id="f"><input id="u" type="email" placeholder="Email"><input id="p" type="password" placeholder="Password"><button>Accedi</button></form>
    <script>f.addEventListener('submit', (e) => { e.preventDefault(); f.remove(); document.body.insertAdjacentHTML('beforeend', '<h1>Benvenuto</h1>'); history.pushState({}, '', '#/home'); });</script>
    </body></html>`));
  await page.locator('#u').click();
  await page.keyboard.type('mario.rossi@example.com');
  await page.locator('#p').click();
  await page.keyboard.type('segreta123');
  await page.keyboard.press('Enter');
  await expect(page.locator('h1')).toHaveText('Benvenuto');
  await page.waitForTimeout(800);
  await pulisciTutto(app, shell, testServer);
  console.log('APERTE dopo accesso:', JSON.stringify(await titoliAperti(shell)));
});

test('scrivere davvero in una textarea e /pulisci', async ({ app, shell, testServer }) => {
  const page = await apriEsatta(app, shell, testServer.html('<!doctype html><html><head><title>Bozza</title></head><body><textarea id="t"></textarea></body></html>'));
  await page.locator('#t').click();
  await page.keyboard.type('Caro Mario, ti scrivo');
  await pulisciTutto(app, shell, testServer);
  console.log('APERTE dopo bozza:', JSON.stringify(await titoliAperti(shell)));
});

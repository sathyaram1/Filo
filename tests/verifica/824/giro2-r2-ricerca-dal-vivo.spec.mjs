// #824 giro 2, rilievo 2: una ricerca dal vivo (risultati mentre si scrive, senza Invio)
// ha già dato quello che doveva: la parola rimasta nella casella non protegge la scheda.

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

const titoli = (shell) => shell.evaluate(async () => (await window.filoShell.tabs.snapshot()).tabs.map((t) => t.title));

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

const BRANI = ['Yesterday', 'Let It Be', 'Hey Jude', 'Imagine'];

for (const [nome, campo] of [
  ['casella di ricerca', '<input id="q" type="search" placeholder="Cosa vuoi ascoltare?">'],
  ['casella con ruolo di ricerca', '<div role="search"><input id="q" type="text" aria-label="Cerca"></div>'],
]) {
  test(`${nome} coi risultati già sullo schermo: la scheda si archivia come le altre`, async ({ app, shell, testServer }) => {
    const page = await apriEsatta(app, shell, testServer.html(`<!doctype html><html><head><title>Musica</title></head><body>
      ${campo}<ul id="ris"></ul>
      <script>const B = ${JSON.stringify(BRANI)};
        q.addEventListener('input', () => { ris.innerHTML = ''; for (const b of B.filter((x) => x.toLowerCase().includes(q.value.toLowerCase()))) { const li = document.createElement('li'); li.textContent = b; ris.append(li); } });</script>
      </body></html>`));
    await page.locator('#q').click();
    await page.keyboard.type('hey');
    await expect(page.locator('#ris li')).toHaveText(['Hey Jude']);
    await page.waitForTimeout(1000);

    await pulisciTutto(app, shell, testServer);
    expect(await titoli(shell)).not.toContain('Musica');
  });
}

// #824 giro 3, rilievo 3: senza testo scritto dall'utente la scheda non è protetta (valori messi
// dai pulsanti della pagina, ricerche coi risultati nella stessa pagina).

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

test('la quantità cambiata col pulsante + non protegge la scheda', async ({ app, shell, testServer }) => {
  const page = await apriEsatta(app, shell, testServer.html(`<!doctype html><html><head><title>Negozio</title></head><body>
    <input id="qta" type="number" value="1" min="1"><button id="piu">+</button>
    <script>piu.onclick = () => { qta.stepUp(); qta.dispatchEvent(new Event('change', { bubbles: true })); };</script>
    </body></html>`));
  await page.locator('#piu').click();
  await page.locator('#piu').click();
  await expect(page.locator('#qta')).toHaveValue('3');
  await page.waitForTimeout(800);
  await pulisciTutto(app, shell, testServer);
  expect(await titoliAperti(shell)).not.toContain('Negozio');
});

test('la data scelta dal calendario non protegge la scheda', async ({ app, shell, testServer }) => {
  const page = await apriEsatta(app, shell, testServer.html(`<!doctype html><html><head><title>Albergo</title></head><body>
    <input id="arrivo" type="text" placeholder="Arrivo" readonly><button id="giorno">12</button>
    <script>giorno.onclick = () => { arrivo.value = '12/10/2026'; arrivo.dispatchEvent(new Event('input', { bubbles: true })); arrivo.dispatchEvent(new Event('change', { bubbles: true })); };</script>
    </body></html>`));
  await page.locator('#giorno').click();
  await page.waitForTimeout(800);
  await pulisciTutto(app, shell, testServer);
  expect(await titoliAperti(shell)).not.toContain('Albergo');
});

test('una ricerca di voli coi risultati nella stessa pagina non protegge la scheda', async ({ app, shell, testServer }) => {
  const page = await apriEsatta(app, shell, testServer.html(`<!doctype html><html><head><title>Voli</title></head><body>
    <form id="f"><input id="da" placeholder="Da dove parti?"><input id="a" placeholder="Dove vuoi andare?"><button>Cerca voli</button></form><ul id="ris"></ul>
    <script>f.addEventListener('submit', (e) => { e.preventDefault(); ris.innerHTML = '<li>' + da.value + ' → ' + a.value + ' 49 €</li>'; });</script>
    </body></html>`));
  await page.locator('#da').click();
  await page.keyboard.type('Milano');
  await page.locator('#a').click();
  await page.keyboard.type('Parigi');
  await page.locator('button').click();
  await expect(page.locator('#ris li')).toHaveText('Milano → Parigi 49 €');
  await page.waitForTimeout(800);
  await pulisciTutto(app, shell, testServer);
  expect(await titoliAperti(shell)).not.toContain('Voli');
});

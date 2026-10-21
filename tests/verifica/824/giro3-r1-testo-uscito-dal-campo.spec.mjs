// #824 giro 3, rilievo 1: il testo uscito dal campo in cui è stato scritto (passo dopo di una
// procedura, anteprima o rifiuto del server, cambio di editor) non è inviato: la scheda resta aperta.

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

test('la lettera scritta al primo passo di una procedura resta protetta dopo «Avanti»', async ({ app, shell, testServer }) => {
  const page = await apriEsatta(app, shell, testServer.html(`<!doctype html><html><head><title>Domanda</title></head><body>
    <form id="f" onsubmit="event.preventDefault()"><div id="passo">
      <textarea id="lettera" style="width:400px;height:100px"></textarea>
      <button type="button" id="avanti">Avanti</button></div></form>
    <script>const dati = {}; avanti.onclick = () => { dati.lettera = lettera.value;
      passo.innerHTML = '<input id="tel" type="tel"><button id="invia">Invia candidatura</button>'; };</script>
    </body></html>`));
  await page.locator('#lettera').click();
  await page.keyboard.type('Lettera di presentazione lunga e scritta con cura');
  await page.locator('#avanti').click();
  await expect(page.locator('#tel')).toBeVisible();
  await pulisciTutto(app, shell, testServer);
  expect(await titoliAperti(shell)).toContain('Domanda');
});

test('il post scritto nell’editor ricco resta protetto passando a Markdown', async ({ app, shell, testServer }) => {
  const page = await apriEsatta(app, shell, testServer.html(`<!doctype html><html><head><title>Post</title></head><body>
    <div id="box"><div id="ed" contenteditable="true" style="min-height:80px;border:1px solid"></div></div>
    <button id="md">Markdown</button>
    <script>md.onclick = () => { const t = document.createElement('textarea'); t.id = 'ta';
      t.style.cssText = 'width:400px;height:100px'; t.value = ed.innerText; box.replaceChildren(t); };</script>
    </body></html>`));
  await page.locator('#ed').click();
  await page.keyboard.type('Il mio post lungo sul viaggio in Islanda');
  await page.locator('#md').click();
  await expect(page.locator('#ta')).toHaveValue('Il mio post lungo sul viaggio in Islanda');
  await pulisciTutto(app, shell, testServer);
  expect(await titoliAperti(shell)).toContain('Post');
});

test('il testo tornato nel campo dopo un’anteprima o un rifiuto del server resta protetto', async ({ app, shell, testServer }) => {
  const TESTO = 'Voce di enciclopedia riscritta con molta cura';
  const anteprima = testServer.html(`<!doctype html><html><head><title>Anteprima</title></head><body>
    <p class="err">Manca l'oggetto della modifica</p><div>${TESTO}</div>
    <form method="post" action=""><textarea name="m" id="m" style="width:400px;height:100px">${TESTO}</textarea><input name="ogg"><button>Salva</button></form>
    </body></html>`);
  const page = await apriEsatta(app, shell, testServer.html(`<!doctype html><html><head><title>Modifica</title></head><body>
    <form method="post" action="${anteprima}"><textarea name="m" id="m" style="width:400px;height:100px"></textarea><button id="ant">Mostra anteprima</button></form>
    </body></html>`));
  await page.locator('#m').click();
  await page.keyboard.type(TESTO);
  await page.locator('#ant').click();
  await page.waitForFunction(() => document.title === 'Anteprima');
  await expect(page.locator('#m')).toHaveValue(TESTO);
  await page.waitForFunction(() => document.documentElement.dataset.filoReady === '1', null, { timeout: 8000 });
  await pulisciTutto(app, shell, testServer);
  expect(await titoliAperti(shell)).toContain('Anteprima');
});


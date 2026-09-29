// #824 giro 3 — esplorazione: dove il testo ancora da inviare sfugge alla protezione,
// e dove la protezione tiene aperte schede senza niente da perdere.

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

test('A wizard: il passo 1 tolto dalla pagina dopo Avanti', async ({ app, shell, testServer }) => {
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

test('A2 editor che passa da ricco a Markdown', async ({ app, shell, testServer }) => {
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

test('B anteprima o rifiuto del server: il testo torna nel campo della pagina nuova', async ({ app, shell, testServer }) => {
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

test('D Tab da tastiera dentro un riquadro di un altro sito', async ({ app, shell, testServer }) => {
  const dentro = testServer.html('<!doctype html><html><body><textarea id="t" style="width:300px;height:100px"></textarea></body></html>', { pubblico: true });
  const page = await apriEsatta(app, shell, testServer.html(`<!doctype html><html><head><title>Tastiera</title></head><body>
    <input id="nome"><iframe id="f" src="${dentro}" style="width:400px;height:200px"></iframe></body></html>`));
  await page.frameLocator('#f').locator('#t').waitFor();
  await page.locator('#nome').click();
  await page.keyboard.press('Tab');
  await page.keyboard.type('Commento scritto arrivando col tasto Tab');
  await expect(page.frameLocator('#f').locator('#t')).toHaveValue('Commento scritto arrivando col tasto Tab');
  await pulisciTutto(app, shell, testServer);
  expect(await titoliAperti(shell)).toContain('Tastiera');
});

test('F riquadro in designMode', async ({ app, shell, testServer }) => {
  const page = await apriEsatta(app, shell, testServer.html(`<!doctype html><html><head><title>Vecchio</title></head><body>
    <iframe id="f" style="width:500px;height:200px"></iframe>
    <script>const d = document.getElementById('f').contentDocument; d.open(); d.write('<!doctype html><html><body style="min-height:150px"></body></html>'); d.close(); d.designMode = 'on';</script>
    </body></html>`));
  const corpo = page.frameLocator('#f').locator('body');
  await corpo.click();
  await page.keyboard.type('Articolo nel vecchio editor');
  await expect(corpo).toHaveText('Articolo nel vecchio editor');
  await pulisciTutto(app, shell, testServer);
  expect(await titoliAperti(shell)).toContain('Vecchio');
});

test('G campo in un componente chiuso', async ({ app, shell, testServer }) => {
  const page = await apriEsatta(app, shell, testServer.html(`<!doctype html><html><head><title>Chiuso</title></head><body>
    <x-campo id="c" style="display:block"></x-campo>
    <script>customElements.define('x-campo', class extends HTMLElement { constructor() { super();
      const r = this.attachShadow({ mode: 'closed' }); r.innerHTML = '<textarea style="width:300px;height:80px"></textarea>'; } });</script>
    </body></html>`));
  await page.locator('#c').click();
  await page.keyboard.type('Testo nel componente');
  await pulisciTutto(app, shell, testServer);
  expect(await titoliAperti(shell)).toContain('Chiuso');
});

test('H riquadro scritto dalla pagina dentro un componente', async ({ app, shell, testServer }) => {
  const page = await apriEsatta(app, shell, testServer.html(`<!doctype html><html><head><title>Ombra</title></head><body>
    <x-ed id="c" style="display:block"></x-ed>
    <script>customElements.define('x-ed', class extends HTMLElement { connectedCallback() {
      const r = this.attachShadow({ mode: 'open' }); const f = document.createElement('iframe');
      f.style.cssText = 'width:500px;height:200px'; r.append(f);
      const d = f.contentDocument; d.open(); d.write('<!doctype html><html><body contenteditable="true" style="min-height:150px"></body></html>'); d.close(); } });</script>
    </body></html>`));
  const corpo = page.frameLocator('#c >> internal:control=enter-frame').locator('body');
  await page.mouse.click(100, 60);
  await page.keyboard.type('Articolo nel componente');
  await pulisciTutto(app, shell, testServer);
  expect(await titoliAperti(shell)).toContain('Ombra');
  void corpo;
});

test('I quantità col pulsante + non protegge', async ({ app, shell, testServer }) => {
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

test('J data scelta dal calendario non protegge', async ({ app, shell, testServer }) => {
  const page = await apriEsatta(app, shell, testServer.html(`<!doctype html><html><head><title>Albergo</title></head><body>
    <input id="arrivo" type="text" placeholder="Arrivo" readonly><button id="giorno">12</button>
    <script>giorno.onclick = () => { arrivo.value = '12/10/2026'; arrivo.dispatchEvent(new Event('input', { bubbles: true })); arrivo.dispatchEvent(new Event('change', { bubbles: true })); };</script>
    </body></html>`));
  await page.locator('#giorno').click();
  await page.waitForTimeout(800);
  await pulisciTutto(app, shell, testServer);
  expect(await titoliAperti(shell)).not.toContain('Albergo');
});

test('K ricerca voli coi risultati nella stessa pagina non protegge', async ({ app, shell, testServer }) => {
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

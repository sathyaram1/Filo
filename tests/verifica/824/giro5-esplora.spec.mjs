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

test('D riepilogo: la lettera mostrata nel riepilogo prima di «Invia» resta protetta', async ({ app, shell, testServer }) => {
  const page = await apriEsatta(app, shell, testServer.html(`<!doctype html><html><head><title>Candidatura</title></head><body>
    <div id="passo"><textarea id="lettera" style="width:400px;height:100px"></textarea>
      <button type="button" id="avanti">Avanti</button></div>
    <script>let dati = {}; avanti.onclick = () => { dati.lettera = lettera.value;
      passo.innerHTML = '<h2>Controlla e invia</h2><p id="rie"></p><button id="invia">Invia candidatura</button>';
      rie.textContent = dati.lettera; };</script>
    </body></html>`));
  await page.locator('#lettera').click();
  await page.keyboard.type('Gentile ufficio, vorrei candidarmi per la posizione di grafico');
  await page.locator('#avanti').click();
  await expect(page.locator('#rie')).toContainText('Gentile ufficio');
  await page.waitForTimeout(800);
  await pulisciTutto(app, shell, testServer);
  expect(await titoliAperti(shell)).toContain('Candidatura');
});

test('G anteprima dal vivo: invio respinto, il testo resta protetto', async ({ app, shell, testServer }) => {
  const page = await apriEsatta(app, shell, testServer.html(`<!doctype html><html><head><title>Risposta</title></head><body>
    <form id="f"><textarea id="corpo" style="width:400px;height:100px"></textarea><button>Pubblica la risposta</button></form>
    <p id="err"></p><div id="ant"></div>
    <script>corpo.addEventListener('input', () => { ant.textContent = corpo.value; });
      f.addEventListener('submit', (e) => { e.preventDefault(); err.textContent = 'Devi accedere per rispondere'; });</script>
    </body></html>`));
  await page.locator('#corpo').click();
  await page.keyboard.type('Il problema nasce dal ciclo che non si ferma mai');
  await page.locator('button').click();
  await expect(page.locator('#err')).toHaveText('Devi accedere per rispondere');
  await page.waitForTimeout(800);
  await pulisciTutto(app, shell, testServer);
  expect(await titoliAperti(shell)).toContain('Risposta');
});

test('A voli senza form: risultati in pagina, la scheda non resta protetta', async ({ app, shell, testServer }) => {
  const page = await apriEsatta(app, shell, testServer.html(`<!doctype html><html><head><title>VoliSPA</title></head><body>
    <div><input id="da" placeholder="Da dove parti?"><input id="a" placeholder="Dove vuoi andare?"><button id="cerca">Cerca voli</button></div><ul id="ris"></ul>
    <script>cerca.onclick = () => { setTimeout(() => { ris.innerHTML = '<li>' + da.value + ' → ' + a.value + ' 49 €</li>'; }, 300); };</script>
    </body></html>`));
  await page.locator('#da').click();
  await page.keyboard.type('Milano');
  await page.locator('#a').click();
  await page.keyboard.type('Parigi');
  await page.locator('#cerca').click();
  await expect(page.locator('#ris li')).toHaveText('Milano → Parigi 49 €');
  await page.waitForTimeout(800);
  await pulisciTutto(app, shell, testServer);
  expect(await titoliAperti(shell)).not.toContain('VoliSPA');
});

test('B voli con form, scritto in minuscolo: la scheda non resta protetta', async ({ app, shell, testServer }) => {
  const page = await apriEsatta(app, shell, testServer.html(`<!doctype html><html><head><title>VoliMin</title></head><body>
    <form id="f"><input id="da" placeholder="Da dove parti?"><input id="a" placeholder="Dove vuoi andare?"><button>Cerca voli</button></form><ul id="ris"></ul>
    <script>const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
      f.addEventListener('submit', (e) => { e.preventDefault(); setTimeout(() => { ris.innerHTML = '<li>' + cap(da.value) + ' → ' + cap(a.value) + ' 49 €</li>'; }, 300); });</script>
    </body></html>`));
  await page.locator('#da').click();
  await page.keyboard.type('milano');
  await page.locator('#a').click();
  await page.keyboard.type('parigi');
  await page.locator('button').click();
  await expect(page.locator('#ris li')).toHaveText('Milano → Parigi 49 €');
  await page.waitForTimeout(800);
  await pulisciTutto(app, shell, testServer);
  expect(await titoliAperti(shell)).not.toContain('VoliMin');
});

test('C accesso in una app di una pagina sola: dopo l’accesso la scheda non resta protetta', async ({ app, shell, testServer }) => {
  const page = await apriEsatta(app, shell, testServer.html(`<!doctype html><html><head><title>App</title></head><body>
    <div id="vista"><form id="f"><input id="mail" type="email"><input id="pw" type="password"><button>Accedi</button></form></div>
    <script>f.addEventListener('submit', (e) => { e.preventDefault(); setTimeout(() => {
      vista.innerHTML = '<h1>I tuoi progetti</h1><p>Nessun progetto ancora.</p>'; history.pushState({}, '', '#/progetti'); }, 200); });</script>
    </body></html>`));
  await page.locator('#mail').click();
  await page.keyboard.type('giulia.verdi@example.com');
  await page.locator('#pw').click();
  await page.keyboard.type('segreta123');
  await page.locator('button').click();
  await expect(page.locator('h1')).toHaveText('I tuoi progetti');
  await page.waitForTimeout(800);
  await pulisciTutto(app, shell, testServer);
  expect(await titoliAperti(shell)).not.toContain('App');
});

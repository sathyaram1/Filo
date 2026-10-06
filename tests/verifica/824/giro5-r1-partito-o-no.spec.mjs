// #824 giro 5, rilievo 1: se il testo è partito non si capisce da cosa mostra la pagina.
// Il riepilogo di una procedura e l'anteprima dal vivo mostrano un testo non ancora mandato;
// una finestrella chiusa, un accesso, una ricerca mandano il testo senza mostrarlo uguale.

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

// Le pagine che mandano davvero il testo lo fanno con una richiesta, come un sito vero.
const MANDA = `const manda = (dati) => fetch(location.pathname + '?api=1', { method: 'POST', body: JSON.stringify(dati) }).catch(() => {});`;

test('r1 la lettera mostrata nel riepilogo, prima di «Invia candidatura», resta protetta', async ({ app, shell, testServer }) => {
  const page = await apriEsatta(app, shell, testServer.html(`<!doctype html><html><head><title>Candidatura</title></head><body>
    <div id="passo"><textarea id="lettera" style="width:400px;height:100px"></textarea>
      <button type="button" id="avanti">Avanti</button></div>
    <script>const dati = {}; avanti.onclick = () => { dati.lettera = lettera.value;
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

test('r1 la risposta con l’anteprima dal vivo, respinta all’invio, resta protetta', async ({ app, shell, testServer }) => {
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

test('r1 un post pubblicato da una finestrella che si chiude non protegge la scheda', async ({ app, shell, testServer }) => {
  const page = await apriEsatta(app, shell, testServer.html(`<!doctype html><html><head><title>Social</title></head><body>
    <main><p>Il tuo feed</p></main>
    <div id="modale" role="dialog"><div id="ed" contenteditable="true" style="min-height:80px;border:1px solid"></div><button id="pub">Pubblica</button></div>
    <p id="toast"></p>
    <script>${MANDA} pub.onclick = async () => { await manda({ post: ed.innerText });
      modale.remove(); toast.textContent = 'Post pubblicato'; };</script>
    </body></html>`));
  await page.locator('#ed').click();
  await page.keyboard.type('Oggi ho finito la maratona di Firenze, grazie a tutti');
  await page.locator('#pub').click();
  await expect(page.locator('#toast')).toHaveText('Post pubblicato');
  await page.waitForTimeout(800);
  await pulisciTutto(app, shell, testServer);
  expect(await titoliAperti(shell)).not.toContain('Social');
});

test('r1 l’indirizzo email di un accesso fatto senza cambiare pagina non protegge la scheda', async ({ app, shell, testServer }) => {
  const page = await apriEsatta(app, shell, testServer.html(`<!doctype html><html><head><title>App</title></head><body>
    <div id="vista"><form id="f"><input id="mail" type="email"><input id="pw" type="password"><button>Accedi</button></form></div>
    <script>${MANDA} f.addEventListener('submit', async (e) => { e.preventDefault(); await manda({ mail: mail.value, pw: pw.value });
      vista.innerHTML = '<h1>I tuoi progetti</h1><p>Nessun progetto ancora.</p>'; history.pushState({}, '', '#/progetti'); });</script>
    </body></html>`));
  // Il campo password su http fa comparire l'avviso di Filo sopra la pagina: si scrive col fuoco.
  await page.locator('#mail').focus();
  await page.keyboard.type('giulia.verdi@example.com');
  await page.locator('#pw').focus();
  await page.keyboard.type('segreta123');
  await page.keyboard.press('Enter');
  await expect(page.locator('h1')).toHaveText('I tuoi progetti');
  await page.waitForTimeout(800);
  await pulisciTutto(app, shell, testServer);
  expect(await titoliAperti(shell)).not.toContain('App');
});

test('r1 una ricerca di voli fatta senza modulo, coi risultati nella pagina, non protegge la scheda', async ({ app, shell, testServer }) => {
  const page = await apriEsatta(app, shell, testServer.html(`<!doctype html><html><head><title>VoliSPA</title></head><body>
    <div><input id="da" placeholder="Da dove parti?"><input id="a" placeholder="Dove vuoi andare?"><button id="cerca">Cerca voli</button></div><ul id="ris"></ul>
    <script>${MANDA} cerca.onclick = async () => { await manda({ da: da.value, a: a.value });
      ris.innerHTML = '<li>' + da.value + ' → ' + a.value + ' 49 €</li>'; };</script>
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

test('r1 una ricerca di voli scritta in minuscolo, coi risultati in maiuscolo, non protegge la scheda', async ({ app, shell, testServer }) => {
  const page = await apriEsatta(app, shell, testServer.html(`<!doctype html><html><head><title>VoliMin</title></head><body>
    <form id="f"><input id="da" placeholder="Da dove parti?"><input id="a" placeholder="Dove vuoi andare?"><button>Cerca voli</button></form><ul id="ris"></ul>
    <script>${MANDA} const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
      f.addEventListener('submit', async (e) => { e.preventDefault(); await manda({ da: da.value, a: a.value });
        ris.innerHTML = '<li>' + cap(da.value) + ' → ' + cap(a.value) + ' 49 €</li>'; });</script>
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

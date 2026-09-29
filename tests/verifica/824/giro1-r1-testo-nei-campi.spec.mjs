// #824 giro 1, rilievo 1: la pulizia decide da quello che c'è davvero nei campi.
// Testo ancora da inviare (riquadro, Indietro, invio rifiutato) → la scheda resta col testo;
// campo svuotato dalla pagina dopo l'invio → la scheda si archivia come le altre.

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

const moduloDi = (shell, title) => shell.evaluate(async (t) => {
  const s = await window.filoShell.tabs.snapshot();
  const tab = s.tabs.find((x) => x.title === t);
  return tab ? tab.formDirty : null;
}, title);

const titoli = (shell) => shell.evaluate(async () => (await window.filoShell.tabs.snapshot()).tabs.map((t) => t.title));

// Il modello archivia tutto; la scheda sotto esame non è l'attiva.
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

test('il testo scritto in un riquadro incorporato (editor, commenti, modulo di contatto) tiene aperta la scheda', async ({ app, shell, testServer }) => {
  const dentro = testServer.html('<!doctype html><html><body><textarea id="t" style="width:300px;height:100px"></textarea></body></html>');
  const page = await apriEsatta(app, shell, testServer.html(`<!doctype html><html><head><title>Riquadro</title></head><body>
    <iframe id="f" src="${dentro}" style="width:400px;height:200px"></iframe></body></html>`));
  const TESTO = 'Commento lungo scritto nel riquadro dei commenti';
  await page.frameLocator('#f').locator('#t').click();
  await page.keyboard.type(TESTO);
  await page.waitForTimeout(1000);

  await pulisciTutto(app, shell, testServer);
  expect(await titoli(shell)).toContain('Riquadro');
  expect(await page.frameLocator('#f').locator('#t').inputValue()).toBe(TESTO);
});

test('la bozza che il browser rimette nel campo tornando Indietro tiene aperta la scheda', async ({ app, shell, testServer }) => {
  const b = testServer.html('<!doctype html><title>Dopo</title><p>pagina dopo');
  const page = await apriEsatta(app, shell, testServer.html(`<!doctype html><html><head><title>Lettera</title></head><body>
    <form action="/x" method="post"><textarea name="m" id="m"></textarea><button>Invia</button></form><a id="via" href="${b}">vai</a></body></html>`));
  const TESTO = 'Bozza della lettera al padrone di casa';
  await page.locator('#m').click();
  await page.keyboard.type(TESTO);
  await expect.poll(() => moduloDi(shell, 'Lettera'), { timeout: 8000 }).toBe(true);
  await page.locator('#via').click();
  await expect.poll(() => moduloDi(shell, 'Dopo'), { timeout: 8000 }).toBe(false);
  await page.goBack();
  await page.waitForFunction(() => document.title === 'Lettera');
  await expect(page.locator('#m')).toHaveValue(TESTO);
  await page.waitForTimeout(1000);

  await pulisciTutto(app, shell, testServer);
  expect(await titoli(shell)).toContain('Lettera');
  expect(await page.locator('#m').inputValue()).toBe(TESTO);
});

test('un «Invia» respinto dalla pagina (manca un campo) non conta come inviato', async ({ app, shell, testServer }) => {
  const page = await apriEsatta(app, shell, testServer.html(`<!doctype html><html><head><title>Candidatura</title></head><body>
    <form id="f"><textarea id="m"></textarea><input id="mail" type="email"><button>Invia</button></form><p id="err"></p>
    <script>document.getElementById('f').addEventListener('submit', (e) => { e.preventDefault(); if (!document.getElementById('mail').value) document.getElementById('err').textContent = 'Manca la mail'; });</script>
    </body></html>`));
  const TESTO = 'Lettera di presentazione lunga e scritta con cura';
  await page.locator('#m').click();
  await page.keyboard.type(TESTO);
  await expect.poll(() => moduloDi(shell, 'Candidatura'), { timeout: 8000 }).toBe(true);
  await page.locator('button').click();
  await expect(page.locator('#err')).toHaveText('Manca la mail');
  await page.waitForTimeout(800);

  await pulisciTutto(app, shell, testServer);
  expect(await titoli(shell)).toContain('Candidatura');
  expect(await page.locator('#m').inputValue()).toBe(TESTO);
});

test('un commento già pubblicato (editor svuotato dalla pagina) non protegge più la scheda', async ({ app, shell, testServer }) => {
  const page = await apriEsatta(app, shell, testServer.html(`<!doctype html><html><head><title>Social</title></head><body>
    <div id="ed" contenteditable="true" style="min-height:60px;border:1px solid"></div><button id="pub">Pubblica</button><ul id="lista"></ul>
    <script>pub.onclick = () => { const li = document.createElement('li'); li.textContent = ed.textContent; lista.append(li); ed.innerHTML = ''; };</script>
    </body></html>`));
  await page.locator('#ed').click();
  await page.keyboard.type('Bel post!');
  await expect.poll(() => moduloDi(shell, 'Social'), { timeout: 8000 }).toBe(true);
  await page.locator('#pub').click();
  await expect(page.locator('#lista li')).toHaveText('Bel post!');
  await expect(page.locator('#ed')).toHaveText('');
  await page.waitForTimeout(800);

  await pulisciTutto(app, shell, testServer);
  expect(await titoli(shell)).not.toContain('Social');
});

test('un messaggio già mandato (campo svuotato dalla pagina) non protegge più la scheda', async ({ app, shell, testServer }) => {
  const page = await apriEsatta(app, shell, testServer.html(`<!doctype html><html><head><title>Chat</title></head><body>
    <textarea id="chat"></textarea><button id="manda">Manda</button><ul id="lista"></ul>
    <script>manda.onclick = () => { const li = document.createElement('li'); li.textContent = chat.value; lista.append(li); chat.value = ''; };</script>
    </body></html>`));
  await page.locator('#chat').click();
  await page.keyboard.type('Ciao, arrivo alle 8');
  await expect.poll(() => moduloDi(shell, 'Chat'), { timeout: 8000 }).toBe(true);
  await page.locator('#manda').click();
  await expect(page.locator('#lista li')).toHaveText('Ciao, arrivo alle 8');
  await expect(page.locator('#chat')).toHaveValue('');
  await page.waitForTimeout(800);

  await pulisciTutto(app, shell, testServer);
  expect(await titoli(shell)).not.toContain('Chat');
});

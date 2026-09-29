// #824 esplorazione verificatore: porte del testo scritto e non inviato.

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

async function pulisciTutto(app) {
  return app.evaluate(async ({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows().find((w) => w._filoTabs);
    globalThis.SN_TAB_TRIAGE_DECIDE = async ({ tabs }) => ({
      decisions: tabs.map((t, i) => ({ i, action: 'archive', reason: 'pulizia' })),
    });
    return win._filoTabs.runAutoTriage({ trigger: 'manual' });
  });
}
const titoli = (shell) => shell.evaluate(async () => (await window.filoShell.tabs.snapshot()).tabs.map((t) => t.title));

test('iframe', async ({ app, shell, testServer }) => {
  const dentro = testServer.html('<!doctype html><html><body><textarea id="t" style="width:300px;height:100px"></textarea></body></html>');
  const page = await apriEsatta(app, shell, testServer.html(`<!doctype html><html><head><title>Riquadro</title></head><body>
    <iframe id="f" src="${dentro}" style="width:400px;height:200px"></iframe></body></html>`));
  const campo = page.frameLocator('#f').locator('#t');
  await campo.click();
  await page.keyboard.type('Commento lungo scritto nel riquadro');
  await page.waitForTimeout(1500);
  console.log('formDirty iframe', await moduloDi(shell, 'Riquadro'));
  await apriEsatta(app, shell, testServer.html('<!doctype html><title>Altra</title><p>x'));
  const res = await pulisciTutto(app);
  console.log('archived', res, await titoli(shell));
});

test('indietro', async ({ app, shell, testServer }) => {
  const b = testServer.html('<!doctype html><title>B</title><p>pagina b');
  const page = await apriEsatta(app, shell, testServer.html(`<!doctype html><html><head><title>Lettera</title></head><body>
    <form action="/x" method="post"><textarea name="m" id="m"></textarea><button>Invia</button></form><a id="via" href="${b}">vai</a></body></html>`));
  await page.locator('#m').click();
  await page.keyboard.type('Bozza della lettera');
  await expect.poll(() => moduloDi(shell, 'Lettera'), { timeout: 8000 }).toBe(true);
  await page.locator('#via').click();
  await expect.poll(() => moduloDi(shell, 'B'), { timeout: 8000 }).toBe(false);
  await page.goBack();
  await page.waitForFunction(() => document.title === 'Lettera');
  await page.waitForTimeout(1500);
  console.log('valore dopo indietro', JSON.stringify(await page.locator('#m').inputValue()), 'formDirty', await moduloDi(shell, 'Lettera'));
  await apriEsatta(app, shell, testServer.html('<!doctype html><title>Altra</title><p>x'));
  const res = await pulisciTutto(app);
  console.log('archived', res, await titoli(shell));
});

test('rifiutato', async ({ app, shell, testServer }) => {
  const page = await apriEsatta(app, shell, testServer.html(`<!doctype html><html><head><title>Candidatura</title></head><body>
    <form id="f"><textarea id="m"></textarea><input id="mail" type="email"><button>Invia</button></form><p id="err"></p>
    <script>document.getElementById('f').addEventListener('submit', (e) => { e.preventDefault(); if (!document.getElementById('mail').value) document.getElementById('err').textContent = 'Manca la mail'; });</script>
    </body></html>`));
  await page.locator('#m').click();
  await page.keyboard.type('Lettera di presentazione lunga');
  await expect.poll(() => moduloDi(shell, 'Candidatura'), { timeout: 8000 }).toBe(true);
  await page.locator('button').click();
  await expect(page.locator('#err')).toHaveText('Manca la mail');
  await page.waitForTimeout(1000);
  console.log('valore', await page.locator('#m').inputValue(), 'formDirty', await moduloDi(shell, 'Candidatura'));
  await apriEsatta(app, shell, testServer.html('<!doctype html><title>Altra</title><p>x'));
  const res = await pulisciTutto(app);
  console.log('archived', res, await titoli(shell));
});

test('inviato da pulsante', async ({ app, shell, testServer }) => {
  const page = await apriEsatta(app, shell, testServer.html(`<!doctype html><html><head><title>Social</title></head><body>
    <div id="ed" contenteditable="true" style="min-height:60px;border:1px solid"></div><button id="pub">Pubblica</button>
    <textarea id="chat"></textarea><button id="manda">Manda</button><ul id="lista"></ul>
    <script>
      pub.onclick = () => { const li = document.createElement('li'); li.textContent = ed.textContent; lista.append(li); ed.innerHTML = ''; };
      manda.onclick = () => { const li = document.createElement('li'); li.textContent = chat.value; lista.append(li); chat.value = ''; };
    </script></body></html>`));
  await page.locator('#ed').click();
  await page.keyboard.type('Bel post!');
  await expect.poll(() => moduloDi(shell, 'Social'), { timeout: 8000 }).toBe(true);
  await page.locator('#pub').click();
  await page.waitForTimeout(1000);
  console.log('dopo pubblica editor', JSON.stringify(await page.locator('#ed').textContent()), 'formDirty', await moduloDi(shell, 'Social'));
  await apriEsatta(app, shell, testServer.html('<!doctype html><title>Altra</title><p>x'));
  const res = await pulisciTutto(app);
  console.log('archived', res, await titoli(shell));
});

test('chat svuotata da pulsante', async ({ app, shell, testServer }) => {
  const page = await apriEsatta(app, shell, testServer.html(`<!doctype html><html><head><title>Chat</title></head><body>
    <textarea id="chat"></textarea><button id="manda">Manda</button><ul id="lista"></ul>
    <script>
      manda.onclick = () => { const li = document.createElement('li'); li.textContent = chat.value; lista.append(li); chat.value = ''; };
    </script></body></html>`));
  await page.locator('#chat').click();
  await page.keyboard.type('Ciao, arrivo alle 8');
  await expect.poll(() => moduloDi(shell, 'Chat'), { timeout: 8000 }).toBe(true);
  await page.locator('#manda').click();
  await page.waitForTimeout(1000);
  console.log('dopo manda', JSON.stringify(await page.locator('#chat').inputValue()), 'formDirty', await moduloDi(shell, 'Chat'));
  await apriEsatta(app, shell, testServer.html('<!doctype html><title>Altra</title><p>x'));
  const res = await pulisciTutto(app);
  console.log('archived', res, await titoli(shell));
});

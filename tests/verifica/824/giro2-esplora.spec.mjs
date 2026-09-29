// #824 giro 2: esplorazione delle strade del testo non inviato.

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

test('P1 editor in riquadro about:blank scritto dalla pagina (TinyMCE/CKEditor 4)', async ({ app, shell, testServer }) => {
  const page = await apriEsatta(app, shell, testServer.html(`<!doctype html><html><head><title>Blog</title></head><body>
    <iframe id="f" style="width:500px;height:200px"></iframe>
    <script>const d = document.getElementById('f').contentDocument; d.open(); d.write('<!doctype html><html><body contenteditable="true" style="min-height:150px"><p><br></p></body></html>'); d.close();</script>
    </body></html>`));
  const TESTO = 'Articolo scritto nell editor del blog';
  await page.frameLocator('#f').locator('body').click();
  await page.keyboard.type(TESTO);
  await page.waitForTimeout(1200);
  console.log('P1 formDirty', await moduloDi(shell, 'Blog'));
  await pulisciTutto(app, shell, testServer);
  const t = await titoli(shell);
  console.log('P1 titoli', t);
  expect(t).toContain('Blog');
});

test('P2 riquadro srcdoc con area di testo', async ({ app, shell, testServer }) => {
  const page = await apriEsatta(app, shell, testServer.html(`<!doctype html><html><head><title>Srcdoc</title></head><body>
    <iframe id="f" srcdoc="<textarea id=t></textarea>" style="width:400px;height:200px"></iframe></body></html>`));
  await page.frameLocator('#f').locator('#t').click();
  await page.keyboard.type('Testo nel riquadro srcdoc');
  await page.waitForTimeout(1200);
  console.log('P2 formDirty', await moduloDi(shell, 'Srcdoc'));
  await pulisciTutto(app, shell, testServer);
  expect(await titoli(shell)).toContain('Srcdoc');
});

test('P3 riquadro dentro un riquadro, di un altro sito', async ({ app, shell, testServer }) => {
  const interno = testServer.html('<!doctype html><textarea id="t"></textarea>', { pubblico: true });
  const medio = testServer.html(`<!doctype html><iframe id="g" src="${interno}" style="width:350px;height:150px"></iframe>`, { pubblico: true });
  const page = await apriEsatta(app, shell, testServer.html(`<!doctype html><html><head><title>Annidato</title></head><body>
    <iframe id="f" src="${medio}" style="width:400px;height:200px"></iframe></body></html>`));
  await page.frameLocator('#f').frameLocator('#g').locator('#t').click();
  await page.keyboard.type('Testo nel riquadro annidato');
  await page.waitForTimeout(1200);
  console.log('P3 formDirty', await moduloDi(shell, 'Annidato'));
  await pulisciTutto(app, shell, testServer);
  expect(await titoli(shell)).toContain('Annidato');
});

test('P4 incollato con Ctrl+V in un editor ricco che gestisce da sé l incolla (ProseMirror, Tiptap, Slate)', async ({ app, shell, testServer }) => {
  const page = await apriEsatta(app, shell, testServer.html(`<!doctype html><html><head><title>Ricco</title></head><body>
    <div id="ed" contenteditable="true" style="min-height:80px;border:1px solid"></div>
    <script>
      ed.addEventListener('paste', (e) => {
        e.preventDefault();
        const t = e.clipboardData.getData('text/plain');
        const p = document.createElement('p'); p.textContent = t; ed.appendChild(p);
      });
    </script></body></html>`));
  const TESTO = 'Bozza lunga preparata altrove e incollata qui';
  await app.evaluate(({ clipboard }, t) => clipboard.writeText(t), TESTO);
  await page.locator('#ed').click();
  await page.keyboard.press('Control+V');
  await expect(page.locator('#ed')).toHaveText(TESTO);
  await page.waitForTimeout(1200);
  console.log('P4 formDirty', await moduloDi(shell, 'Ricco'));
  await pulisciTutto(app, shell, testServer);
  expect(await titoli(shell)).toContain('Ricco');
});

test('P5 incollato con Ctrl+V in una textarea', async ({ app, shell, testServer }) => {
  const page = await apriEsatta(app, shell, testServer.html(`<!doctype html><html><head><title>Semplice</title></head><body>
    <textarea id="t"></textarea></body></html>`));
  const TESTO = 'Bozza incollata nella textarea';
  await app.evaluate(({ clipboard }, t) => clipboard.writeText(t), TESTO);
  await page.locator('#t').click();
  await page.keyboard.press('Control+V');
  await expect(page.locator('#t')).toHaveValue(TESTO);
  await page.waitForTimeout(1200);
  console.log('P5 formDirty', await moduloDi(shell, 'Semplice'));
  await pulisciTutto(app, shell, testServer);
  expect(await titoli(shell)).toContain('Semplice');
});

test('P6 ricarica: il browser rimette il testo?', async ({ app, shell, testServer }) => {
  const page = await apriEsatta(app, shell, testServer.html(`<!doctype html><html><head><title>Ricarica</title></head><body>
    <textarea id="t"></textarea></body></html>`));
  await page.locator('#t').click();
  await page.keyboard.type('testo prima della ricarica');
  await page.waitForTimeout(800);
  await page.reload();
  await page.waitForFunction(() => document.documentElement.dataset.filoReady === '1', null, { timeout: 8000 });
  const v = await page.locator('#t').inputValue();
  await page.waitForTimeout(1000);
  console.log('P6 valore dopo ricarica', JSON.stringify(v), 'formDirty', await moduloDi(shell, 'Ricarica'));
  await pulisciTutto(app, shell, testServer);
  const t = await titoli(shell);
  console.log('P6 titoli', t);
  if (v) expect(t).toContain('Ricarica');
});

test('P7 home duplicata con un messaggio a metà nella casella', async ({ app, shell, testServer, openTab }) => {
  const h1 = await openTab('filo://newtab/');
  const h2 = await openTab('filo://newtab/');
  await h2.locator('#input').click();
  await h2.keyboard.type('Domanda lunga a Filo che non ho ancora mandato');
  await h2.waitForTimeout(1200);
  const s = await shell.evaluate(async () => (await window.filoShell.tabs.snapshot()).tabs.map((t) => ({ url: t.url, fd: t.formDirty, title: t.title })));
  console.log('P7 prima', JSON.stringify(s));
  await pulisciTutto(app, shell, testServer);
  const dopo = await shell.evaluate(async () => (await window.filoShell.tabs.snapshot()).tabs.map((t) => ({ url: t.url, fd: t.formDirty })));
  console.log('P7 dopo', JSON.stringify(dopo));
  let testi = [];
  for (const w of app.windows()) {
    try { if (/newtab/.test(w.url())) testi.push(await w.locator('#input').inputValue()); } catch (_) {}
  }
  console.log('P7 testi rimasti', JSON.stringify(testi));
  expect(testi).toContain('Domanda lunga a Filo che non ho ancora mandato');
});

test('P8 campo dentro uno shadow root aperto', async ({ app, shell, testServer }) => {
  const page = await apriEsatta(app, shell, testServer.html(`<!doctype html><html><head><title>Ombra</title></head><body>
    <x-box id="b"></x-box>
    <script>customElements.define('x-box', class extends HTMLElement { constructor() { super(); this.attachShadow({ mode: 'open' }).innerHTML = '<textarea id=t></textarea>'; } });</script>
    </body></html>`));
  await page.locator('#b').locator('#t').click();
  await page.keyboard.type('Testo nello shadow');
  await page.waitForTimeout(1200);
  console.log('P8 formDirty', await moduloDi(shell, 'Ombra'));
  await pulisciTutto(app, shell, testServer);
  expect(await titoli(shell)).toContain('Ombra');
});

test('P9 editor di codice con area nascosta svuotata a ogni tasto (CodeMirror 5)', async ({ app, shell, testServer }) => {
  const page = await apriEsatta(app, shell, testServer.html(`<!doctype html><html><head><title>Codice</title></head><body>
    <div id="vis" style="min-height:40px;border:1px solid;font-family:monospace"></div>
    <textarea id="hid" style="position:absolute;opacity:0;width:1px;height:1px"></textarea>
    <script>
      vis.addEventListener('mousedown', (e) => { e.preventDefault(); hid.focus(); });
      hid.addEventListener('input', () => { setTimeout(() => { vis.textContent += hid.value; hid.value = ''; }, 20); });
    </script></body></html>`));
  await page.locator('#vis').click();
  await page.keyboard.type('function ciao() {}');
  await expect(page.locator('#vis')).toHaveText('function ciao() {}');
  await page.waitForTimeout(1200);
  console.log('P9 formDirty', await moduloDi(shell, 'Codice'));
  await pulisciTutto(app, shell, testServer);
  expect(await titoli(shell)).toContain('Codice');
});

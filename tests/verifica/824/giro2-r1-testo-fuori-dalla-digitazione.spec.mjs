// #824 giro 2, rilievo 1: il testo che un editor mostra conta anche se non è arrivato con
// la digitazione normale in un campo dove Filo era già caricato (riquadro scritto dalla
// pagina, incolla gestito dall'editor, editor di codice). La scheda resta, col testo.

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

// Come ProseMirror, Tiptap, Slate, Lexical, Draft, CKEditor 5: l'incolla lo fa l'editor.
const EDITOR_RICCO = `<div id="ed" contenteditable="true" style="min-height:80px;border:1px solid"></div>
  <script>ed.addEventListener('paste', (e) => { e.preventDefault(); const p = document.createElement('p'); p.textContent = e.clipboardData.getData('text/plain'); ed.appendChild(p); });</script>`;

test('editor classico in un riquadro scritto dalla pagina (TinyMCE, CKEditor 4, editor classico di WordPress)', async ({ app, shell, testServer }) => {
  const page = await apriEsatta(app, shell, testServer.html(`<!doctype html><html><head><title>Blog</title></head><body>
    <iframe id="f" style="width:500px;height:200px"></iframe>
    <script>const d = document.getElementById('f').contentDocument; d.open(); d.write('<!doctype html><html><body contenteditable="true" style="min-height:150px"></body></html>'); d.close();</script>
    </body></html>`));
  const TESTO = 'Articolo scritto nell editor del blog';
  await page.frameLocator('#f').locator('body').click();
  await page.keyboard.type(TESTO);
  await expect(page.frameLocator('#f').locator('body')).toHaveText(TESTO);
  await page.waitForTimeout(1200);

  await pulisciTutto(app, shell, testServer);
  expect(await titoli(shell)).toContain('Blog');
  expect(await page.frameLocator('#f').locator('body').textContent()).toBe(TESTO);
});

test('una bozza incollata con Ctrl+V in un editor ricco', async ({ app, shell, testServer }) => {
  const page = await apriEsatta(app, shell, testServer.html(`<!doctype html><html><head><title>Ricco</title></head><body>${EDITOR_RICCO}</body></html>`));
  const TESTO = 'Bozza lunga preparata altrove e incollata qui';
  await app.evaluate(({ clipboard }, t) => clipboard.writeText(t), TESTO);
  await page.locator('#ed').click();
  await page.keyboard.press('Control+V');
  await expect(page.locator('#ed')).toHaveText(TESTO);
  await page.waitForTimeout(1200);

  await pulisciTutto(app, shell, testServer);
  expect(await titoli(shell)).toContain('Ricco');
  expect(await page.locator('#ed').textContent()).toBe(TESTO);
});

test('una bozza incollata con «Incolla» del tasto destro di Filo in un editor ricco', async ({ app, shell, testServer }) => {
  const page = await apriEsatta(app, shell, testServer.html(`<!doctype html><html><head><title>Menu</title></head><body>${EDITOR_RICCO}</body></html>`));
  const TESTO = 'Bozza incollata dal menu di Filo';
  await app.evaluate(({ clipboard }, t) => clipboard.writeText(t), TESTO);
  await page.locator('#ed').click();
  await page.locator('#ed').click({ button: 'right' });
  await expect(page.locator('.sn-menu')).toBeVisible();
  await page.locator('.sn-menu').getByText('Incolla', { exact: true }).first().click();
  await expect(page.locator('#ed')).toHaveText(TESTO);
  await page.waitForTimeout(1200);

  await pulisciTutto(app, shell, testServer);
  expect(await titoli(shell)).toContain('Menu');
  expect(await page.locator('#ed').textContent()).toBe(TESTO);
});

test('codice scritto in un editor che svuota a ogni tasto la sua casella nascosta (CodeMirror 5)', async ({ app, shell, testServer }) => {
  const page = await apriEsatta(app, shell, testServer.html(`<!doctype html><html><head><title>Codice</title></head><body>
    <div id="vis" style="min-height:40px;border:1px solid;font-family:monospace"></div>
    <textarea id="hid" style="position:absolute;opacity:0;width:1px;height:1px"></textarea>
    <script>
      vis.addEventListener('mousedown', (e) => { e.preventDefault(); hid.focus(); });
      hid.addEventListener('input', () => { setTimeout(() => { vis.textContent += hid.value; hid.value = ''; }, 20); });
    </script></body></html>`));
  const TESTO = 'function ciao() {}';
  await page.locator('#vis').click();
  await page.keyboard.type(TESTO);
  await expect(page.locator('#vis')).toHaveText(TESTO);
  await page.waitForTimeout(1200);

  await pulisciTutto(app, shell, testServer);
  expect(await titoli(shell)).toContain('Codice');
  expect(await page.locator('#vis').textContent()).toBe(TESTO);
});

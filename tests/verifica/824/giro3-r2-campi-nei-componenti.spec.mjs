// #824 giro 3, rilievo 2: il testo scritto in un campo dentro un componente della pagina
// (chiuso, o con dentro un riquadro scritto dalla pagina) tiene aperta la scheda.

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

test('il testo in un campo di un componente chiuso tiene aperta la scheda', async ({ app, shell, testServer }) => {
  const page = await apriEsatta(app, shell, testServer.html(`<!doctype html><html><head><title>Chiuso</title></head><body>
    <x-campo id="c" style="display:block"></x-campo>
    <script>customElements.define('x-campo', class extends HTMLElement { constructor() { super();
      const r = this.attachShadow({ mode: 'closed' }); r.innerHTML = '<textarea style="width:300px;height:80px"></textarea>'; window.__ta = r.querySelector('textarea'); } });</script>
    </body></html>`));
  await page.mouse.click(60, 40);
  await page.keyboard.type('Testo nel componente');
  expect(await page.evaluate(() => window.__ta.value)).toBe('Testo nel componente');
  await pulisciTutto(app, shell, testServer);
  expect(await titoliAperti(shell)).toContain('Chiuso');
});

test('il testo in un editor a riquadro dentro un componente tiene aperta la scheda', async ({ app, shell, testServer }) => {
  const page = await apriEsatta(app, shell, testServer.html(`<!doctype html><html><head><title>Ombra</title></head><body>
    <x-ed id="c" style="display:block"></x-ed>
    <script>customElements.define('x-ed', class extends HTMLElement { connectedCallback() {
      const r = this.attachShadow({ mode: 'open' }); const f = document.createElement('iframe');
      f.style.cssText = 'width:500px;height:200px'; r.append(f);
      const d = f.contentDocument; d.open(); d.write('<!doctype html><html><body contenteditable="true" style="min-height:150px"></body></html>'); d.close(); } });</script>
    </body></html>`));
  const corpo = page.frameLocator('x-ed iframe').locator('body');
  await corpo.click();
  await page.keyboard.type('Articolo nel componente');
  await expect(corpo).toHaveText('Articolo nel componente');
  await pulisciTutto(app, shell, testServer);
  expect(await titoliAperti(shell)).toContain('Ombra');
});


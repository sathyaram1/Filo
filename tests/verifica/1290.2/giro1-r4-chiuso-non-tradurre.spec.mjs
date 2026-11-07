// Verifica #1290.2 giro 1, rilievo 4: un componente chiuso che contiene solo testo segnato dal sito come da non tradurre
// fa dire «solo in parte» a una pagina tradotta tutta.
import { test, expect } from '../../fixtures/electron.mjs';
import { stubTranslationProvider, watchToasts, toasts, clickTranslateIcon } from './aiuti.mjs';

test('r4 componente chiuso con dentro solo testo da non tradurre: «Pagina tradotta», non «solo in parte»', async ({ app, openTab, testServer }) => {
  await stubTranslationProvider(app);
  const page = await testServer.openReady(openTab, `<!doctype html><html lang="en"><body style="font:16px sans-serif;padding:20px">
    <h1 id="head">A page with a brand widget sealed by the site</h1>
    <p id="p1">First paragraph of the page, long enough to be picked up by the translation.</p>
    <brand-box style="display:block;width:600px;height:120px"></brand-box>
    <script>customElements.define('brand-box', class extends HTMLElement { connectedCallback() {
      this.attachShadow({ mode: 'closed' }).innerHTML = '<div class="notranslate" style="font-size:40px">Acme Widget Pro</div>'
        + '<div translate="no">Acme Corporation Limited</div>';
    } });</script>
  </body></html>`);
  await watchToasts(page);
  await clickTranslateIcon(app);
  await expect(page.locator('#p1')).toHaveText(/^IT /, { timeout: 30000 });
  await expect.poll(async () => (await toasts(page)).join(' | '), { timeout: 30000 }).toMatch(/tradotta/);
  expect((await toasts(page)).join(' | ')).not.toContain('solo in parte');
});

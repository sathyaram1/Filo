// Verifica #1290.2 giro 1, rilievo 1: un riquadro incorporato avvolto in un componente aperto del sito, che finisce di
// caricarsi dopo il clic su Traduci, è preso per testo nuovo.
import { test, expect } from '../../fixtures/electron.mjs';
import { stubTranslationProvider, watchToasts, toasts, clickTranslateIcon, iconaTraduci, framePage, immagineLenta } from './aiuti.mjs';

test('r1 riquadro avvolto in un componente aperto che finisce di caricarsi dopo: tradotto, e niente «testo nuovo»', async ({ app, openTab, testServer }) => {
  test.setTimeout(120000);
  await stubTranslationProvider(app);
  const foto = await immagineLenta(7000);
  try {
    const src = testServer.html(`<!doctype html><html lang="en"><body style="font:16px sans-serif;margin:0;padding:10px">
      <p id="fbody">ZZWRAP an embedded post written in english and long enough to count as text.</p>
      <img src="${foto.url}" width="40" height="40" alt=""></body></html>`).replace('127.0.0.1', 'blocked.test');
    const page = await testServer.openReady(openTab, framePage(`<embed-post></embed-post>
      <script>customElements.define('embed-post', class extends HTMLElement { connectedCallback() {
        this.attachShadow({ mode: 'open' }).innerHTML = '<iframe id="emb" src="${src}" style="width:520px;height:220px"></iframe>'; } });</script>`));
    const riquadro = () => page.frames().find((f) => f.url().includes('blocked.test'));
    await expect.poll(() => !!riquadro(), { timeout: 30000 }).toBe(true);
    await expect.poll(() => riquadro().evaluate(() => (document.getElementById('fbody') || {}).textContent || ''), { timeout: 30000 }).toMatch(/^ZZWRAP /);
    // Il presupposto: si preme Traduci con il riquadro ancora in caricamento.
    expect(await riquadro().evaluate(() => document.readyState)).not.toBe('complete');
    await watchToasts(page);
    await clickTranslateIcon(app);

    await expect.poll(() => riquadro().evaluate(() => document.getElementById('fbody').textContent), { timeout: 60000 }).toMatch(/^IT ZZWRAP /);
    await expect.poll(async () => (await toasts(page)).includes('Pagina tradotta'), { timeout: 60000 }).toBe(true);
    await expect.poll(() => riquadro().evaluate(() => document.readyState), { timeout: 30000 }).toBe('complete');
    await page.waitForTimeout(800);
    expect((await toasts(page)).join(' | ')).not.toContain('aggiunta');
    // Tutto è tradotto: l'icona torna all'originale, non offre «Traduci il testo nuovo».
    await expect(await iconaTraduci(app)).toHaveAttribute('aria-label', 'Mostra originale');
  } finally { foto.chiudi(); }
});

// #1071 giro 3, rilievo 1: un sito che ascolta i tasti in cattura (sul documento o sulla finestra) vede l'host del
// riquadro chiuso, non una casella, e si prende «k» e lo spazio scritti nel feedback. Prima del ramo la casella stava
// nel documento e il sito la riconosceva.
import { test, expect } from '../../fixtures/electron.mjs';
import { nelMondoDiFilo, statoDi, clicca } from '../../helpers/riquadri.mjs';

const pagina = (corpo) => `<!doctype html><html><head><meta charset="utf-8"></head><body style="margin:0;padding:40px;font:16px sans-serif">${corpo}</body></html>`;
const sito = (bersaglio) => `<script>
  window.__comandi = [];
  ${bersaglio}.addEventListener('keydown', (e) => {
    const t = e.target;
    if (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) return;
    if (e.key === 'k' || e.key === ' ') { e.preventDefault(); window.__comandi.push(e.key); }
  }, true);
</script>`;

for (const bersaglio of ['document', 'window']) {
  test(`r1 feedback su un sito con scorciatoie in cattura su ${bersaglio}: quello che l'utente scrive resta nella casella`, async ({ app, openTab, testServer }) => {
    test.setTimeout(60_000);
    const page = await testServer.openReady(openTab, pagina(`<p>Video</p>${sito(bersaglio)}`));
    await nelMondoDiFilo(app, page, () => globalThis.SN_FEEDBACK_UI.open());
    await expect.poll(() => statoDi(app, page, '.sn-fb-text')).not.toBeNull();
    await clicca(app, page, '.sn-fb-text');
    await page.keyboard.type('ok kiwi poi', { delay: 20 });
    expect((await statoDi(app, page, '.sn-fb-text')).valore).toBe('ok kiwi poi');
    expect(await page.evaluate(() => window.__comandi), 'il sito non prende i tasti come comandi').toEqual([]);
  });
}

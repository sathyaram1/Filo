// Verifica #586 giro 14, rilievo 3: per cose che nessun browser chiede (l'orientamento del computer, lo spazio tenuto da
// parte) compare una domanda col nome tecnico di Chromium, e non si ricorda.
import { test, expect } from '../../fixtures/electron.mjs';

const riga = (shell) => shell.locator('#perm-bar .perm-row');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const PAGINA = `<!doctype html><title>Mappa</title><script>
  window.orientamento = () => { window.addEventListener('deviceorientation', () => {}); };
  window.spazio = () => navigator.storage.persist().then((r) => 'persist:' + r, (e) => 'err:' + e.name);
</script>`;

for (const [fn, cosa] of [['orientamento', 'un sito che ascolta l’orientamento'], ['spazio', 'un sito che si tiene lo spazio da parte']]) {
  test(`${cosa} non fa comparire una domanda che non si capisce`, async ({ shell, openTab, testServer }) => {
    test.setTimeout(60_000);
    const page = await testServer.openReady(openTab, PAGINA);
    await page.evaluate((f) => { window[f](); }, fn);
    await sleep(2500);
    const testo = (await riga(shell).count()) ? await riga(shell).first().innerText() : '';
    expect(testo, `compare: ${testo}`).not.toMatch(/non conosce|sensors|persistent-storage/);
  });
}

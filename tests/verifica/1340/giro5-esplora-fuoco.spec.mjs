// #1340 giro 5, esplorazione: il sito che si riprende il fuoco con un timer porta via i tasti veri scritti nell'Aiuto
// o nel feedback dello strato?
import { test, expect } from '../../fixtures/electron.mjs';
import { nelMondoDiFilo, statoDi, paginaDelloStrato } from '../../helpers/riquadri.mjs';
import * as Gesti from '../../helpers/gestiVeri.mjs';

const PAGINA = `<!doctype html><html><head><meta charset="utf-8"></head><body style="margin:0;padding:40px;font:16px sans-serif">
<p>Un sito</p><input id="spia" style="position:fixed;left:10px;top:200px;width:200px">
<script>
  window.__tasti = '';
  window.addEventListener('keydown', (e) => { window.__tasti += e.key; }, true);
  window.ruba = () => { setInterval(() => { try { window.focus(); document.getElementById('spia').focus(); } catch (_) {} }, 20); return true; };
</script></body></html>`;

test('Aiuto: il sito che si riprende il fuoco non riceve i tasti veri scritti nella casella', async ({ app, shell, openTab, testServer }) => {
  test.skip(!Gesti.disponibili(), 'servono X e XTest');
  test.setTimeout(90_000);
  const sito = await testServer.openReady(openTab, PAGINA);
  await Gesti.finestraASchermo(app);
  const id = await shell.evaluate(async () => (await window.filoShell.tabs.snapshot()).activeId);
  await shell.evaluate((tabId) => window.filoShell.tabs.help(tabId), id);
  const strato = await paginaDelloStrato(app, sito);
  const ta = strato.locator('.sn-sidebar-input textarea');
  await expect(ta).toBeVisible({ timeout: 10_000 });
  const p = await Gesti.sulloSchermo(app, sito, strato, '.sn-sidebar-input textarea');
  Gesti.trascina(p, p);
  await sito.waitForTimeout(300);
  Gesti.scrivi('dove');
  await expect(ta).toHaveValue('dove');
  await sito.evaluate(() => window.ruba());
  await sito.waitForTimeout(500);
  Gesti.scrivi('segreto');
  await sito.waitForTimeout(500);
  const spia = await sito.evaluate(() => ({ v: document.getElementById('spia').value, t: window.__tasti }));
  console.log('AIUTO', JSON.stringify({ casella: await ta.inputValue(), spia }));
  expect(spia.t).toBe('');
  await expect(ta).toHaveValue('dovesegreto');
});

test('feedback: il sito che si riprende il fuoco non riceve i tasti veri scritti nella casella', async ({ app, openTab, testServer }) => {
  test.skip(!Gesti.disponibili(), 'servono X e XTest');
  test.setTimeout(90_000);
  const sito = await testServer.openReady(openTab, PAGINA);
  await Gesti.finestraASchermo(app);
  await nelMondoDiFilo(app, sito, () => globalThis.SN_FEEDBACK_UI.open());
  await expect.poll(() => statoDi(app, sito, '.sn-fb-text')).not.toBeNull();
  const strato = await paginaDelloStrato(app, sito);
  const p = await Gesti.sulloSchermo(app, sito, strato, '.sn-fb-text');
  Gesti.trascina(p, p);
  await sito.waitForTimeout(300);
  Gesti.scrivi('pin');
  await expect.poll(async () => (await statoDi(app, sito, '.sn-fb-text'))?.valore).toBe('pin');
  await sito.evaluate(() => window.ruba());
  await sito.waitForTimeout(500);
  Gesti.scrivi('segreto');
  await sito.waitForTimeout(500);
  const spia = await sito.evaluate(() => ({ v: document.getElementById('spia').value, t: window.__tasti }));
  console.log('FEEDBACK', JSON.stringify({ casella: (await statoDi(app, sito, '.sn-fb-text'))?.valore, spia }));
  expect(spia.t).toBe('');
  expect((await statoDi(app, sito, '.sn-fb-text'))?.valore).toBe('pinsegreto');
});

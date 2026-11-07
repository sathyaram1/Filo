import { test, expect } from '../../fixtures/electron.mjs';

const fumetto = (page) => page.locator('[data-sn-fumetto] .tip');

test('home: Ferma che sparisce a fine risposta lascia il suo fumetto?', async ({ openTab }) => {
  const home = await openTab('filo://newtab/');
  await home.waitForFunction(() => document.documentElement.dataset.filoContentScripts === '1' && !!window.SN_SUGGERIMENTO, null, { timeout: 15_000 });
  // Come aggiornaTasto mentre Filo lavora: l'invio si nasconde, il quadrato prende il suo posto.
  await home.evaluate(() => { const s = document.getElementById('sendBtn'); const f = document.getElementById('stopBtn'); s.hidden = true; f.hidden = false; f.disabled = false; });
  const stop = home.locator('#stopBtn');
  const b = await stop.boundingBox();
  await home.mouse.move(b.x + b.width / 2 - 2, b.y + b.height / 2);
  await home.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  await expect(fumetto(home)).toHaveText('Ferma');
  // Fine della risposta: torna l'invio, il quadrato sparisce; il puntatore resta fermo.
  await home.evaluate(() => { const s = document.getElementById('sendBtn'); const f = document.getElementById('stopBtn'); s.hidden = false; f.hidden = true; });
  await home.waitForTimeout(1500);
  const vis = await fumetto(home).isVisible();
  const testo = vis ? await fumetto(home).textContent() : null;
  console.log('DOPO FINE RISPOSTA fumetto visibile:', vis, testo);
  await home.screenshot({ path: 'tests/.shots/2095-v2-ferma-stantio.png' });
});

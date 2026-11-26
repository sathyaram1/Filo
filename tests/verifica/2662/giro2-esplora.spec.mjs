// Verifica #2662 giro 2: esplorazione della riga del cambio con più valori, markup e finestra stretta.

import { test, expect } from '../../fixtures/electron.mjs';
import { home } from '../../helpers/chatFinta.mjs';

const misura = (riga) => riga.evaluate((r) => {
  const t = r.querySelector('.dash-cambio-testo');
  const tb = t.getBoundingClientRect();
  const qs = [...t.querySelectorAll('.dash-altrui')].map((q) => {
    const b = q.getBoundingClientRect();
    return { l: Math.round(b.left), r: Math.round(b.right), testo: q.textContent, sw: q.scrollWidth, cw: q.clientWidth };
  });
  return { l: Math.round(tb.left), r: Math.round(tb.right), sw: t.scrollWidth, cw: t.clientWidth, testo: t.textContent, html: t.innerHTML, qs, disp: getComputedStyle(t).display };
});

test('esplora più valori in un cambio solo', async ({ app }) => {
  test.setTimeout(90_000);
  const page = await home(app);
  const prima = await app.evaluate(() => globalThis.SN_STORAGE.getSettings());
  console.log('TTS', JSON.stringify(prima.tts));
  await app.evaluate((_e, tts) => globalThis.SN_STORAGE.updateSettings({
    agentStyle: 'Rispondi <b>breve</b> 🎉 e diretto, dammi del tu sempre',
    tts: { ...tts, voice: 'Microsoft Elsa Online Natural Italian Italy', modelVoice: 'voce-calda-numero-sette-molto-lunga' },
  }), prima.tts || {});
  const nata = page.locator('.dash-cambio', { hasText: 'stile dell' }).last();
  await expect(nata).toBeVisible({ timeout: 10_000 });
  const riga = page.locator(`.dash-cambio[data-id="${await nata.getAttribute('data-id')}"]`);
  await riga.scrollIntoViewIfNeeded();
  console.log('LARGA', JSON.stringify(await misura(riga)));
  await page.screenshot({ path: 'tests/.shots/v2662g2-multi-larga.png' });
  await app.evaluate(({ BrowserWindow }) => { for (const w of BrowserWindow.getAllWindows()) if (w._filoTabs) w.setSize(1000, 760); });
  await expect.poll(() => page.evaluate(() => window.innerWidth)).toBeLessThan(1100);
  await riga.scrollIntoViewIfNeeded();
  console.log('STRETTA', JSON.stringify(await misura(riga)));
  await page.screenshot({ path: 'tests/.shots/v2662g2-multi-stretta.png' });
  await riga.hover();
  console.log('HOVER', JSON.stringify(await misura(riga)));
  const tip = await riga.getAttribute('title');
  console.log('TITLE', tip, await riga.locator('.dash-cambio-testo').getAttribute('title'));
  await page.screenshot({ path: 'tests/.shots/v2662g2-multi-hover.png' });
  await riga.click({ button: 'right' });
  await page.waitForTimeout(800);
  await page.screenshot({ path: 'tests/.shots/v2662g2-multi-menu.png' });
});

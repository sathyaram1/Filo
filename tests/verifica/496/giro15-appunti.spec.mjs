// Verifica #496 — giro 15. La conferma della copia.
//
// «Copia riga e numero» scrive negli appunti e mostra una conferma. La scrittura
// è una promessa: quando non riesce (appunti negati, finestra non a fuoco) il
// rifiuto arriva dopo, e il `try/catch` che avvolge la chiamata non lo vede.
// Qui si forza il rifiuto e si guarda cosa legge chi ha premuto.

import { test, expect } from '../../fixtures/electron.mjs';

const URL = 'filo://manage/manage.html';
const ora = Date.now();
const iso = (g) => new Date(ora - g * 24 * 3600 * 1000).toISOString();

const FB = [{
  _id: 'a', seq: 901, subSeq: 0, clientId: 'tester@example.com',
  name: 'uno', text: 'uno', status: 'done',
  createdAt: iso(3), _updateTime: iso(1), resolvedInVersion: '1.0.0',
  notes: 'Verifica superata.',
}];

test('la conferma della copia dice «Copiato» anche quando la copia non riesce', async ({ openTab }) => {
  const page = await openTab(URL);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.__mgTest.whenReady);
  await page.evaluate(() => window.__mgTest.whenReady());
  await page.locator('.mg-tab[data-tab="fbstats"]').click();
  await page.evaluate((l) => window.__mgTest.setData(l), FB);
  await page.evaluate(() => window.__mgTest.setStatsWindow('all'));
  await page.waitForTimeout(200);

  await page.evaluate(() => {
    window.__rifiuti = 0;
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: () => { window.__rifiuti += 1; return Promise.reject(new Error('negato')); } },
    });
  });

  const riga = page.locator('#panel-fbstats [data-drill="categoria:valida"]').first();
  await riga.click({ button: 'right' });
  await page.waitForTimeout(80);
  await page.locator('.mg-ctxmenu .sn-select-option', { hasText: 'Copia' }).first().click();
  await page.waitForTimeout(300);

  const r = await page.evaluate(() => ({
    rifiuti: window.__rifiuti,
    messaggio: (document.getElementById('mgStFlash') || {}).textContent || '',
    visibile: !!document.querySelector('#mgStFlash.mg-st-flash--on'),
  }));
  console.log('APPUNTI ' + JSON.stringify(r));
  expect(r.rifiuti).toBe(1);
  // Chi ha premuto deve sapere che negli appunti non c'è niente.
  expect(r.messaggio).not.toBe('Copiato');
});

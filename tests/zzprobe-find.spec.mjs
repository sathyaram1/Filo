// PROBE temporaneo (audit prober): ricerca dentro una sezione collassata.
import { test, expect } from './fixtures/electron.mjs';

test('probe: Cerca trova risultati dentro una sezione chiusa ma non li mostra', async ({ openTab }) => {
  test.setTimeout(120000);
  const page = await openTab('filo://editor/editor.html');
  await page.waitForSelector('#doc');
  // Il modulo Cerca/Sostituisci sta sulla pagina 1 ("Revisione").
  await page.waitForSelector('.ed-module[data-type="switch"]');
  await page.locator('.ed-switch-icon').nth(1).click();
  await page.waitForSelector('.ed-sr');

  // Documento con due sezioni; la parola cercata sta SOLO nella seconda.
  await page.evaluate(() => {
    const doc = document.getElementById('doc');
    doc.innerHTML = '<h1>Introduzione</h1><p>Testo introduttivo qualunque.</p>'
      + '<h1>Capitolo segreto</h1><p>Qui dentro si parla di ornitorinco e altre cose.</p>';
    doc.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.waitForTimeout(300);

  // Chiudi la seconda sezione con la freccia del titolo.
  const toggles = page.locator('#doc .ed-collapse-toggle');
  console.log('PROBE toggles:', await toggles.count());
  await toggles.nth(1).click();
  await page.waitForTimeout(300);
  const visibleBefore = await page.evaluate(() => document.getElementById('doc').innerText);
  console.log('PROBE testo visibile con sezione chiusa:', JSON.stringify(visibleBefore));

  // Cerca la parola che sta nella sezione chiusa.
  const find = page.locator('.ed-sr [data-sr="find"]');
  await find.click();
  await find.fill('ornitorinco');
  await page.waitForTimeout(400);
  console.log('PROBE contatore:', await page.locator('.ed-sr-count').textContent());
  const hitVisible = await page.evaluate(() => {
    const mk = document.querySelector('#doc mark.ed-find-hit');
    if (!mk) return 'nessun mark';
    const r = mk.getBoundingClientRect();
    return { w: r.width, h: r.height, visible: r.width > 0 && r.height > 0 };
  });
  console.log('PROBE mark visibile?', JSON.stringify(hitVisible));
  await page.screenshot({ path: 'tests/.shots/probe-find-collapsed.png' });
});

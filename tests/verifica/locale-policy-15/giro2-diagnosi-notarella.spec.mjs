// Verifica locale, giro 2 — diagnosi: la notarella si apre col mouse?
// Si guarda ogni termine di gergo della pagina, non solo quello nuovo, per
// capire se il problema è del termine nuovo o della pagina.

import { test, expect } from '../../fixtures/electron.mjs';

const URL_PAGINA = 'filo://transparency/transparency.html';

test('diagnosi: quali notarelle si aprono passandoci sopra', async ({ openTab }) => {
  const page = await openTab(URL_PAGINA);
  await page.evaluate(() => {
    globalThis.__log = [];
    document.addEventListener('mouseover', (e) => {
      globalThis.__log.push('over:' + (e.target.className || e.target.nodeName));
    }, true);
    document.addEventListener('mouseout', (e) => {
      globalThis.__log.push('out:' + (e.target.className || e.target.nodeName));
    }, true);
  });

  const termini = await page.evaluate(() => [...document.querySelectorAll('#doc-body .sn-gloss')]
    .map((e) => e.textContent));

  const esiti = [];
  for (const termine of termini) {
    const el = page.locator('#doc-body .sn-gloss', { hasText: termine }).first();
    await el.scrollIntoViewIfNeeded();
    await page.waitForTimeout(250);
    await page.evaluate(() => { globalThis.__log = []; });
    await el.hover();
    await page.waitForTimeout(250);
    const stato = await page.evaluate(() => {
      const pop = document.getElementById('gloss-pop');
      const r = pop.getBoundingClientRect();
      return {
        hidden: pop.hidden,
        pop: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
        log: globalThis.__log.slice(0, 8),
      };
    });
    const box = await el.boundingBox();
    esiti.push({
      termine,
      aperta: !stato.hidden,
      parola: box && { x: Math.round(box.x), y: Math.round(box.y), w: Math.round(box.width), h: Math.round(box.height) },
      pop: stato.pop,
      log: stato.log,
    });
    await page.mouse.move(5, 5);
    await page.waitForTimeout(80);
  }

  console.log(JSON.stringify(esiti, null, 1));
  expect(esiti.length).toBeGreaterThan(0);
});

// Verifica locale, giro 2 — diagnosi: la notarella si apre col mouse?
// Si guarda ogni termine di gergo della pagina, non solo quello nuovo, per
// capire se il problema è del termine nuovo o della pagina.

import { test, expect } from '../../fixtures/electron.mjs';

const URL_PAGINA = 'filo://transparency/transparency.html';

async function provaHover(page, termine) {
  const el = page.locator('#doc-body .sn-gloss', { hasText: termine }).first();
  await el.scrollIntoViewIfNeeded();
  await page.waitForTimeout(250);
  await el.hover();
  await page.waitForTimeout(250);
  const stato = await page.evaluate(() => {
    const pop = document.getElementById('gloss-pop');
    return { aperta: !pop.hidden, testo: (pop.textContent || '').slice(0, 40) };
  });
  await page.mouse.move(5, 5);
  await page.waitForTimeout(80);
  return stato;
}

test('diagnosi: quali notarelle si aprono passandoci sopra', async ({ openTab }) => {
  const page = await openTab(URL_PAGINA);
  const termini = await page.evaluate(() => [...document.querySelectorAll('#doc-body .sn-gloss')]
    .map((e) => e.textContent));
  const esiti = [];
  for (const termine of termini) esiti.push({ termine, ...(await provaHover(page, termine)) });
  console.log('SENZA TEMA EMULATO ' + JSON.stringify(esiti.map((e) => `${e.termine}=${e.aperta}`)));
  expect(esiti.every((e) => e.aperta)).toBe(true);
});

test('diagnosi: la stessa notarella con il tema emulato dalla prova', async ({ openTab }) => {
  const page = await openTab(URL_PAGINA);
  const righe = [];
  for (const schema of ['light', 'dark']) {
    await page.emulateMedia({ colorScheme: schema });
    const stato = await provaHover(page, 'modelli stretti');
    righe.push(`${schema}=${stato.aperta}`);
  }
  console.log('CON TEMA EMULATO ' + JSON.stringify(righe));
  expect(righe.join(' ')).toBe('light=true dark=true');
});

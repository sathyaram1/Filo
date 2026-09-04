// VERIFICA INDIPENDENTE — da cancellare a fine verifica.
// Ricerca fra le schede archiviate con gli embedding nuovi (chiave vera).
import { test, expect } from './fixtures/electron.mjs';
import { readFileSync } from 'node:fs';

const KEY = (readFileSync('C:/Users/agenti AI/Desktop/Filo/agent-bench/.env', 'utf8')
  .match(/OPENROUTER_KEY=(\S+)/) || [])[1];

test('archivio: la ricerca per senso trova la scheda giusta', async ({ openTab, testServer }) => {
  test.setTimeout(300000);
  const opt = await openTab('filo://options/options.html');
  await opt.waitForTimeout(2500);
  const chk = opt.locator('#useDefaultModels');
  if (await chk.isChecked()) await chk.click();
  await opt.waitForTimeout(500);
  await opt.locator('#apiKey').fill(KEY);
  await opt.locator('#apiKey').blur();
  await opt.waitForTimeout(2500);

  const arc = await openTab('filo://archive/archive.html');
  await arc.waitForTimeout(1500);

  // Semino tre schede archiviate con contenuti diversi, poi le indicizzo dal
  // cammino vero (la ricerca reindicizza da sola ciò che non ha vettore).
  const pagine = [
    { title: 'Come si pota un ulivo', text: 'Guida alla potatura degli olivi: rami secchi, vaso policonico, periodo migliore in tarda primavera.' },
    { title: 'Ricetta della carbonara', text: 'Guanciale, uova, pecorino romano e pepe nero. Niente panna. Cottura della pasta al dente.' },
    { title: 'Manutenzione dei freni a disco', text: 'Sostituzione delle pastiglie, spurgo del liquido, controllo del disco e dello spessore minimo.' },
  ];
  for (const p of pagine) {
    const url = testServer.html(`<html lang="it"><head><title>${p.title}</title></head><body><h1>${p.title}</h1><p>${p.text}</p></body></html>`);
    const page = await openTab(url);
    await page.waitForLoadState('load');
    await page.waitForTimeout(1500);
    await page.evaluate(() => window.close());
    await arc.waitForTimeout(1500);
  }
  // enrichment (riassunto + embedding) in background
  await arc.waitForTimeout(30000);
  await arc.reload();
  await arc.waitForTimeout(2000);
  console.log('ARCHIVIO:\n' + (await arc.evaluate(() => document.body.innerText)).slice(0, 1500));

  const box = arc.locator('#search');
  await box.fill('quale pasta preparo stasera');
  await box.press('Enter');
  await arc.waitForTimeout(20000);
  const nota = (await arc.locator('#searchNote').textContent() || '').trim();
  const primo = (await arc.locator('#list').innerText()).split('\n').filter(Boolean).slice(0, 6);
  console.log('NOTA:', nota);
  console.log('PRIMI RISULTATI:', JSON.stringify(primo));
  expect(nota, 'la ricerca nei contenuti è disponibile').not.toContain('non disponibile');
  expect(primo.join(' ').toLowerCase(), 'in cima la scheda pertinente').toContain('carbonara');

  // seconda query, argomento diverso
  await box.fill('sistemare i freni della bicicletta');
  await box.press('Enter');
  await arc.waitForTimeout(15000);
  const primo2 = (await arc.locator('#list').innerText()).split('\n').filter(Boolean).slice(0, 6);
  console.log('PRIMI RISULTATI 2:', JSON.stringify(primo2));
  expect(primo2.join(' ').toLowerCase()).toContain('freni');
});

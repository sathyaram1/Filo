// Verifica #1596 giro 1: i criteri della segnalazione, con un modello finto a finestra piccola.
import { test, expect } from '../../fixtures/electron.mjs';
import { NEWTAB, stub, tre, PIANO_TRE, chiedi } from './aiuto.mjs';

test('tre pagine da 60.000 token con un modello a finestra piccola: arriva la risposta, con l\'avviso delle pagine tagliate, e la tagliata si rilegge chiedendolo', async ({ app, openTab, testServer }) => {
  test.setTimeout(120_000);
  const page = await openTab(NEWTAB);
  await tre(app, testServer);
  await stub(app, [...PIANO_TRE, { strumenti: [{ nome: 'LEGGI_PAGINA', rileggiFuori: true }] }, { finale: 'RISPOSTA_DUE' }]);

  await chiedi(page, 'cerca i sentieri delle dolomiti e leggimi le guide');
  const bolla = page.locator('.dash-bubble-filo', { hasText: 'RISPOSTA_UNO' });
  await expect(bolla).toBeVisible({ timeout: 40_000 });
  await expect(bolla).toContainText('ho lasciato fuori');
  await expect(bolla).toContainText(/chiedimi di rileggerl/);
  await page.screenshot({ path: 'tests/.shots/verifica-1596-avviso.png' });
  const g1 = await app.evaluate(() => ({ rifiuti: globalThis.__g.rifiuti, n: globalThis.__g.chiamate.length }));
  expect(g1.rifiuti).toBeGreaterThan(0);
  const testo1 = await bolla.innerText();
  const viste1 = (/viste=([^\s]+)/.exec(testo1) || [])[1] || '';
  expect(viste1.split(',').length, `pagine viste al primo turno: ${viste1}`).toBeLessThan(3);

  await chiedi(page, 'rileggi la pagina che hai lasciato fuori');
  const bolla2 = page.locator('.dash-bubble-filo', { hasText: 'RISPOSTA_DUE' });
  await expect(bolla2).toBeVisible({ timeout: 40_000 });
  const riletta = await app.evaluate(() => globalThis.__g.riletta);
  expect(riletta).toMatch(/^http:\/\/127\.0\.0\.1/);
  const testo2 = await bolla2.innerText();
  const viste2 = (/viste=([^\s]+)/.exec(testo2) || [])[1] || '';
  const nuove = viste2.split(',').filter((v) => !viste1.split(',').includes(v));
  expect(nuove.length, `al secondo turno viste ${viste2}, al primo ${viste1}`).toBeGreaterThan(0);
});

test('con la finestra del modello già nota dal listino, le pagine si tagliano prima di mandare: nessun rifiuto, e l\'avviso c\'è', async ({ app, openTab, testServer }) => {
  test.setTimeout(120_000);
  const page = await openTab(NEWTAB);
  await tre(app, testServer);
  await stub(app, PIANO_TRE);
  await app.evaluate(() => {
    const rq = process.mainModule.require;
    const L = rq(rq('node:path').join(process.cwd(), 'src/main/services/costoModelli.js'));
    L.listino = async () => ({});
    L.finestra = () => (globalThis.__g.base ? Math.floor((globalThis.__g.base + 45000) / 3.5) + globalThis.__g.out : null);
  });
  await chiedi(page, 'cerca i sentieri delle dolomiti e leggimi le guide');
  const bolla = page.locator('.dash-bubble-filo', { hasText: 'RISPOSTA_UNO' });
  await expect(bolla).toBeVisible({ timeout: 40_000 });
  await expect(bolla).toContainText(/ho lasciato fuori|ho tenuto solo l'inizio/);
  expect(await app.evaluate(() => globalThis.__g.rifiuti)).toBe(0);
});

test('il rifiuto senza misure (solo «input troppo lungo»): la risposta arriva lo stesso, con l\'avviso', async ({ app, openTab, testServer }) => {
  test.setTimeout(120_000);
  const page = await openTab(NEWTAB);
  await tre(app, testServer);
  await stub(app, PIANO_TRE, { rifiuto: 'nudo' });
  await chiedi(page, 'cerca i sentieri delle dolomiti e leggimi le guide');
  const bolla = page.locator('.dash-bubble-filo', { hasText: 'RISPOSTA_UNO' });
  await expect(bolla).toBeVisible({ timeout: 40_000 });
  await expect(bolla).toContainText(/ho lasciato fuori|ho tenuto solo l'inizio/);
});

test('se il rifiuto del fornitore arriva lo stesso, la frase dice cosa fare e non manda a cambiare modello', async ({ app, openTab, testServer }) => {
  test.setTimeout(120_000);
  const page = await openTab(NEWTAB);
  await tre(app, testServer);
  await stub(app, PIANO_TRE, { rifiuto: 'sempre' });
  await chiedi(page, 'cerca i sentieri delle dolomiti e leggimi le guide');
  const bolla = page.locator('.dash-bubble-filo').last();
  await expect(bolla).toContainText(/meno pagine|chat nuova/, { timeout: 40_000 });
  const testo = await bolla.innerText();
  expect(testo).not.toMatch(/Modelli predefiniti|scegli(?:ne)? un altro modello|cambia(?:re)? modello/i);
  const n = await app.evaluate(() => globalThis.__g.chiamate.length);
  expect(n, 'i tentativi finiscono').toBeLessThan(20);
  await page.screenshot({ path: 'tests/.shots/verifica-1596-errore.png' });
});

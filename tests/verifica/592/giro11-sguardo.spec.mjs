// Verifica #592, giro 11 — lo sguardo: la pagina dove l'utente rilegge e
// cancella quello che Filo sa di lui, con dentro i casi limite (una riga da
// 10.000 caratteri, cento righe, HTML e «javascript:» nel testo) e i due temi.
//
// Serve a due cose: che la pagina non si rompa sotto quei contenuti, e che la
// traccia visiva resti (le immagini finiscono in tests/.shots/).

import { test, expect } from '../../fixtures/electron.mjs';

const PREFS = 'filo://preferences/preferences.html';

const LUNGA = `Nota lunghissima ${'x'.repeat(10_000)} fine`;
const HTML = '<script>window.__pwned=1</script><img src=x onerror="window.__pwned=2">';
const JS = 'javascript:alert(1) — e un «link» finto';

test('il pannello della memoria regge righe enormi, cento righe, HTML e simboli', async ({ app, openTab }) => {
  await app.evaluate(async (_e, { lunga, html, js }) => {
    const M = globalThis.SN_FILO_MEMORY;
    const righe = [];
    for (let i = 1; i <= 100; i += 1) righe.push(`riga numero ${i} del profilo`);
    righe.push(lunga, html, js, '   ', '🙂🙂🙂 emoji e caratteri speciali ⚠️');
    await M.setMemory({ PROFILO: righe.join('\n'), PREFERENZE: 'Risposte corte' });
    for (const t of ['prima lezione', html, js, lunga]) await M.appendLesson(t);
  }, { lunga: LUNGA, html: HTML, js: JS });

  const page = await openTab(PREFS);
  await page.waitForSelector('#memoryGroups .mem-line');

  // Niente HTML eseguito: il testo è testo.
  expect(await page.evaluate(() => window.__pwned || 0), 'l\'HTML di una riga di memoria viene eseguito').toBe(0);

  // La pagina non deborda in orizzontale per colpa della riga da 10.000.
  const sborda = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 2);
  expect(sborda, 'la pagina scorre in orizzontale per colpa di una riga di memoria lunga').toBe(false);

  // Il × della prima riga è cliccabile e la riga se ne va.
  const prima = await page.locator('#memoryGroups .mem-line').first();
  const testoPrima = (await prima.locator('.mem-text').innerText()).slice(0, 20);
  await prima.locator('.mem-forget').click();
  await expect.poll(async () => (await page.locator('#memoryGroups').innerText()).includes(testoPrima),
    { timeout: 5000 }).toBe(false);

  await page.screenshot({ path: 'tests/.shots/592-giro11-memoria-chiaro.png', fullPage: true });

  // Tema scuro: stesso pannello, contrasto leggibile.
  await app.evaluate(async () => { await globalThis.SN_STORAGE.updateSettings({ theme: 'dark' }); });
  await page.waitForTimeout(400);
  await page.screenshot({ path: 'tests/.shots/592-giro11-memoria-scuro.png', fullPage: true });
});

test('il riquadro dello stile mostra conteggio e rifiuto, e in scuro si legge', async ({ app, openTab }) => {
  const page = await openTab(PREFS);
  await page.waitForSelector('#agentStyleText');
  await page.fill('#agentStyleText', 'x'.repeat(700));
  await page.dispatchEvent('#agentStyleText', 'input');
  await expect(page.locator('#agentStyleError')).toBeVisible();
  const messaggio = await page.locator('#agentStyleError').innerText();
  expect(messaggio, 'il rifiuto non dice il numero').toMatch(/600/);
  expect(await page.locator('#agentStyleCount').innerText()).toBe('700/600');

  await app.evaluate(async () => { await globalThis.SN_STORAGE.updateSettings({ theme: 'dark' }); });
  await page.waitForTimeout(400);
  await page.screenshot({ path: 'tests/.shots/592-giro11-stile-scuro.png' });
});

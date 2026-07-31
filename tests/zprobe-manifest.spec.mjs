// SPEC TEMPORANEO DI AUDIT (prober) — drift del manifesto capacità.

import { test, expect } from './fixtures/electron.mjs';

test('REPRO: il manifesto indica filo://home/home.html come "Home di Filo", ma quell\'indirizzo è "Aperti per dopo"', async ({ app, openTab }) => {
  // 1. Il DETTAGLIO che l'agente riceve per la capacità "Home di Filo".
  const detail = await app.evaluate(() => globalThis.SN_CAPABILITIES.renderDetailForPrompt(['home-page']));
  console.log('DETTAGLIO home-page:\n', detail);
  expect(detail).toContain('filo://home/home.html');

  // 2. Quell'indirizzo aperto davvero: NON è la home.
  const page = await openTab('filo://home/home.html');
  await page.waitForTimeout(800);
  const h1 = await page.locator('h1').first().innerText();
  const title = await page.title();
  console.log('filo://home/home.html → title:', JSON.stringify(title), 'h1:', JSON.stringify(h1));
  await page.screenshot({ path: 'tests/.shots/probe-manifest-home.png' });
  expect(h1).toBe('Aperti per dopo');

  // 3. La home vera (nuova scheda) è un'altra pagina.
  const nt = await openTab('filo://newtab/');
  await nt.waitForTimeout(1200);
  console.log('filo://newtab/ → title:', JSON.stringify(await nt.title()));
});

test('REPRO: il Red Team è un\'icona fissa nella home ma non esiste nel manifesto', async ({ app, openTab }) => {
  const page = await openTab('filo://newtab/');
  await page.waitForTimeout(1500);
  const btn = page.locator('[data-command="redteam"]');
  await expect(btn).toBeVisible();
  console.log('icona red-team visibile in home:', await btn.getAttribute('aria-label'));
  await page.screenshot({ path: 'tests/.shots/probe-manifest-redteam-home.png' });

  // La pagina che apre è una feature utente completa (codici, leaderboard, regole).
  const rt = await openTab('filo://redteam/redteam.html');
  await rt.waitForTimeout(1000);
  console.log('redteam page:', JSON.stringify((await rt.locator('body').innerText()).slice(0, 300)));
  await rt.screenshot({ path: 'tests/.shots/probe-manifest-redteam.png' });

  // Ma l'indice che l'agente tiene in contesto non la nomina mai.
  const idx = await app.evaluate(() => globalThis.SN_CAPABILITIES.renderIndexForPrompt());
  console.log('indice contiene "red"?', /red[\s-]?team/i.test(idx));
  const detail = await app.evaluate(() => globalThis.SN_CAPABILITIES.renderDetailForPrompt(['red-team', 'redteam']));
  console.log('DETTAGLIO red-team:', detail);
  expect(/red[\s-]?team/i.test(idx)).toBe(false);
});

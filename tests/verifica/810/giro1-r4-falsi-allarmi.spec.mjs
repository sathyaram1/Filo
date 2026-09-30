// Verifica #810 giro 1, rilievo 4: un prezzo o un identificativo vicino alle parole OTP, 2FA o
// one-time non è un codice monouso, e la ricerca o il comando che lo usa deve partire.

import { test, expect } from '../../fixtures/electron.mjs';
import { preparaModelli, modelloFinto, newtab } from './aiuti.mjs';

async function chat(app, shell) {
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtab(app);
  await expect(page.locator('#input')).toBeVisible();
  await preparaModelli(app);
  return page;
}

test('un prezzo dopo «one-time purchase» nei risultati non ferma la ricerca che lo usa', async ({ app, shell }) => {
  test.setTimeout(60_000);
  const page = await chat(app, shell);
  await app.evaluate(() => {
    globalThis.__ricerche = [];
    globalThis.SN_WEB_SEARCH.search = async ({ query }) => {
      globalThis.__ricerche.push(query);
      return { provider: 'finto', results: [{ title: 'MacBook Air M3', url: 'https://shop.example/mba', snippet: 'One-time purchase: $1299. Free shipping.' }] };
    };
  });
  await modelloFinto(app, {
    giri: [
      { toolCalls: [{ id: 'r1', name: 'CERCA_WEB', arguments: JSON.stringify({ query: 'prezzo MacBook Air' }) }] },
      { toolCalls: [{ id: 'r2', name: 'CERCA_WEB', arguments: JSON.stringify({ query: 'MacBook Air 1299 recensioni' }) }] },
      { text: 'Ecco le recensioni.' },
    ],
  });
  await page.locator('#input').fill('quanto costa il MacBook Air e com’è?');
  await page.locator('#sendBtn').click();
  await expect(page.locator('.dash-bubble-filo', { hasText: 'Ecco le recensioni.' })).toBeVisible({ timeout: 20_000 });
  expect(await app.evaluate(() => globalThis.__ricerche)).toEqual(['prezzo MacBook Air', 'MacBook Air 1299 recensioni']);
  await expect(page.locator('.dash-activity-row', { hasText: 'Non ho fatto la ricerca' })).toHaveCount(0);
});

test('l’identificativo di un servizio che si chiama «otp» non ferma il comando che lo usa', async ({ app, shell }) => {
  test.setTimeout(60_000);
  const page = await chat(app, shell);
  await modelloFinto(app, {
    giri: [
      { toolCalls: [{ id: 'c1', name: 'ESEGUI_COMANDO', arguments: JSON.stringify({ comando: 'echo "3f2a1b9c8d7e   otp-service   Up 2 hours"' }) }] },
      { toolCalls: [{ id: 'c2', name: 'ESEGUI_COMANDO', arguments: JSON.stringify({ comando: 'echo 3f2a1b9c8d7e' }) }] },
      { text: 'Fatto.' },
    ],
  });
  await page.locator('#input').fill('mostrami i log del servizio');
  await page.locator('#sendBtn').click();
  await expect(page.locator('.dash-bubble-filo', { hasText: 'Fatto.' })).toBeVisible({ timeout: 20_000 });
  const activity = page.locator('.dash-activity').last();
  await activity.locator('.dash-activity-head').click();
  await expect(activity.locator('.dash-activity-row', { hasText: 'Non ho eseguito il comando' })).toHaveCount(0);
});

test('in una pagina che spiega il 2FA, il numero di una norma citata vicino a «OTP» non ferma il collegamento', async ({ app }) => {
  const r = await app.evaluate(() => globalThis.SN_URL_EXFIL.valutaUscita(
    { type: 'NAVIGA', url: 'https://www.rfc-editor.org/rfc/rfc6238' },
    { pagina: { testo: 'La 2FA richiede un secondo fattore, spesso un OTP generato da un\'app, secondo la RFC 6238 del 2011.', host: 'it.wikipedia.org' } },
  ));
  expect(r.blocca, r.frase).toBe(false);
});

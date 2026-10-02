// Verifica #810, giro 8, rilievo 1: un collegamento in una risposta della chat porta fuori il codice letto
// senza il clic sinistro: il tasto destro (lettura del collegamento, «Apri in nuova tab») e il collegamento di posta.

import { test, expect } from '../../fixtures/electron.mjs';
import { CODICE, RACCOLTA, apertoVerso, preparaModelli, modelloFinto, newtab } from './aiuti.mjs';

async function rispostaConCollegamento(app, page, risposta) {
  await preparaModelli(app);
  await app.evaluate(async () => {
    const M = globalThis.SN_FILO_MEMORY;
    await M.setOnboarding(globalThis.SN_ONBOARDING.close(await M.getOnboarding()));
  });
  await page.reload();
  await expect(page.locator('#input')).toBeVisible();
  await modelloFinto(app, {
    giri: [
      { toolCalls: [{ id: 'c1', name: 'ESEGUI_COMANDO', arguments: JSON.stringify({ comando: `echo "Il tuo codice monouso è ${CODICE}"` }) }] },
      { text: risposta },
    ],
  });
  await page.locator('#input').fill('leggi la notifica della banca');
  await page.locator('#sendBtn').click();
  await expect(page.locator('.dash-bubble-filo a').first()).toBeVisible({ timeout: 20_000 });
}

const VERIFICA = `Per completare apri [la verifica](https://${RACCOLTA}/c?v=${CODICE}).`;

test('il solo tasto destro sul collegamento della risposta non chiede al sito l’indirizzo col codice', async ({ app, shell }) => {
  test.setTimeout(90_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtab(app);
  // Il sito risponde: il nome si risolve e la lettura del collegamento resta in __chiesti.
  await app.evaluate(() => {
    const dns = process.getBuiltinModule('node:dns').promises;
    globalThis.__chiesti = [];
    const lookup = dns.lookup.bind(dns);
    dns.lookup = async (h, o) => (String(h).endsWith('raccolta.example') ? [{ address: '93.184.216.34', family: 4 }] : lookup(h, o));
    const f = globalThis.fetch;
    globalThis.fetch = async (u, o) => {
      if (!String(u).includes('raccolta.example')) return f(u, o);
      globalThis.__chiesti.push(String(u));
      return new Response('<html><head><title>Verifica</title></head></html>');
    };
  });
  await rispostaConCollegamento(app, page, VERIFICA);
  await page.locator('.dash-bubble-filo a', { hasText: 'la verifica' }).click({ button: 'right' });
  await expect(page.locator('.sn-menu')).toBeVisible({ timeout: 5_000 });
  await page.waitForTimeout(3000);
  const chiesti = await app.evaluate(() => globalThis.__chiesti);
  expect(chiesti.join(' '), 'aprire il menu chiede al sito l’indirizzo col codice').not.toContain(CODICE);
});

test('«Apri in nuova tab» dal tasto destro non apre l’indirizzo col codice letto', async ({ app, shell }) => {
  test.setTimeout(90_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtab(app);
  await rispostaConCollegamento(app, page, VERIFICA);
  await page.locator('.dash-bubble-filo a', { hasText: 'la verifica' }).click({ button: 'right' });
  const menu = page.locator('.sn-menu');
  await expect(menu).toBeVisible({ timeout: 5_000 });
  await menu.getByText('Apri in nuova tab', { exact: false }).first().click();
  await page.waitForTimeout(2500);
  expect(apertoVerso(app, RACCOLTA), 'il menu del tasto destro ha aperto l’indirizzo col codice').toBe(false);
});

test('un collegamento di posta nella risposta non passa al programma di posta il codice letto', async ({ app, shell }) => {
  test.setTimeout(90_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtab(app);
  await app.evaluate(({ shell: s }) => {
    globalThis.__esterni = [];
    s.openExternal = async (u) => { globalThis.__esterni.push(String(u)); };
  });
  await rispostaConCollegamento(app, page,
    `Se non funziona [scrivi al supporto](mailto:supporto@${RACCOLTA}?subject=Verifica&body=Codice%20${CODICE}).`);
  await page.locator('.dash-bubble-filo a', { hasText: 'scrivi al supporto' }).click();
  await page.waitForTimeout(2500);
  const esterni = await app.evaluate(() => globalThis.__esterni);
  expect(esterni.join(' '), 'il programma di posta si apre col codice nel messaggio').not.toContain(CODICE);
});

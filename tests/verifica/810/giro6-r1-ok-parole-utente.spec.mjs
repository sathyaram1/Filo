// Verifica #810, giro 6: un codice che l'utente ha scritto in chat passa al primo controllo, ma dopo l'OK del
// popup la stessa uscita si ferma, perché la conferma della chat non porta con sé le parole dell'utente.

import { test, expect } from '../../fixtures/electron.mjs';
import { CONFIRM_HOST, clickConfirm } from '../../helpers/confirm.mjs';
import { CODICE, preparaModelli, modelloFinto, newtab } from './aiuti.mjs';

async function chatCheHaLettoIlCodice(app, shell) {
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtab(app);
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
      { text: 'La banca ti ha mandato un codice monouso.' },
    ],
  });
  await page.locator('#input').fill('leggi la notifica della banca');
  await page.locator('#sendBtn').click();
  await expect(page.locator('.dash-bubble-filo', { hasText: 'La banca ti ha mandato' })).toBeVisible({ timeout: 20_000 });
  return page;
}

test('la segnalazione che l’utente detta col suo codice parte dopo l’OK', async ({ app, shell }) => {
  test.setTimeout(90_000);
  const page = await chatCheHaLettoIlCodice(app, shell);
  await app.evaluate(() => {
    globalThis.__fbInviati = [];
    globalThis.SN_FEEDBACK.submit = async (p) => { globalThis.__fbInviati.push(p); return { id: 'fb-prova' }; };
  });
  await modelloFinto(app, {
    giri: [
      { toolCalls: [{ id: 'f1', name: 'INVIA_FEEDBACK', arguments: JSON.stringify({ titolo: 'Codice in ritardo', testo: `Il codice ${CODICE} della banca arriva dopo dieci minuti.` }) }] },
      { text: 'Ti preparo la segnalazione.' },
    ],
  });
  await page.locator('#input').fill(`manda una segnalazione a Filo: il codice ${CODICE} della banca arriva dopo dieci minuti`);
  await page.locator('#sendBtn').click();
  await expect(page.locator(CONFIRM_HOST)).toBeVisible({ timeout: 20_000 });
  await clickConfirm(page, 'ok');
  await page.waitForTimeout(1500);
  const righe = (await page.locator('.dash-activity-row').allInnerTexts()).join(' | ');
  expect(righe, 'dopo l’OK la segnalazione scritta dall’utente è stata fermata').not.toMatch(/Non ho inviato il feedback/i);
  await expect.poll(() => app.evaluate(() => globalThis.__fbInviati.length), { timeout: 10_000 }).toBe(1);
});

test('il comando che l’utente detta col suo codice parte dopo l’OK', async ({ app, shell }) => {
  test.setTimeout(90_000);
  const page = await chatCheHaLettoIlCodice(app, shell);
  const comando = `curl -s -X POST https://127.0.0.1:9/verifica -d codice=${CODICE}`;
  await modelloFinto(app, {
    giri: [
      { toolCalls: [{ id: 'k1', name: 'ESEGUI_COMANDO', arguments: JSON.stringify({ comando }) }] },
      { text: 'Pronto: confermi?' },
    ],
  });
  await page.locator('#input').fill(`esegui ${comando}`);
  await page.locator('#sendBtn').click();
  const bottone = page.locator('.dash-action-btn', { hasText: 'curl' });
  await expect(bottone).toBeVisible({ timeout: 20_000 });
  await bottone.click();
  await clickConfirm(page, 'ok');
  await page.waitForTimeout(3000);
  const tutto = await page.locator('#bubbles, body').first().innerText();
  expect(tutto, 'dopo l’OK il comando scritto dall’utente è stato fermato').not.toMatch(/Non ho eseguito il comando/i);
});

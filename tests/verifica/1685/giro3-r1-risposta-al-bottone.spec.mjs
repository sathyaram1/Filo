// Verifica #1685 giro 3, rilievo 1: la risposta data al bottone dopo il turno resta nella conversazione come esito che
// il modello legge. Un no non diventa «conferma chiesta, non ancora data»; un sì non diventa un turno senza parole.
import { test, expect } from '../../fixtures/electron.mjs';
import { join } from 'node:path';
import { home, modelloFinto, chiedi, chiamateAlModello, ripristina } from '../../helpers/chatFinta.mjs';
import { livelloAutonomia } from '../../helpers/autonomia.mjs';
import { clickConfirm, scrollConfirmToEnd, fillConfirmInput, CONFIRM_HOST } from '../../helpers/confirm.mjs';
import { cartellaTemporanea, togliCartella } from '../../helpers/percorsi.mjs';

const chatsDellaHome = (app) => app.evaluate(() => globalThis.SN_FILO_CHATS.list().then((l) => l.filter((c) => !c.app)));
const chatCon = async (app, testo) => (await chatsDellaHome(app)).find((c) => c.messages.some((m) => m.text === testo)) || null;
async function riapriDopoRiavvio(app, page, id) {
  await app.evaluate((_e, c) => globalThis.SN_CONTESTO_FILO.dimentica(c), id);
  await app.evaluate((_e, c) => globalThis.SN_CLOSE_FILO_CHAT(c), id);
  await page.goto(`filo://dashboard/dashboard.html?chat=${encodeURIComponent(id)}`);
}
const TERMINALE = { id: 'p1', name: 'IMPOSTA_PREFERENZA', arguments: '{"chiave":"modalita_terminale","valore":true}' };

test('r1 detto no al bottone, riaperta dopo un riavvio la chat e il modello sanno che l\'utente ha rifiutato', async ({ app }) => {
  test.setTimeout(60_000);
  const page = await home(app);
  await app.evaluate(() => globalThis.SN_STORAGE.updateSettings({ terminal: { enabled: false } }));
  await modelloFinto(app, [{ text: '', toolCalls: [TERMINALE] }, { text: 'Va bene.' }]);
  await chiedi(page, 'accendi il terminale');
  await expect(page.locator(CONFIRM_HOST)).toBeVisible({ timeout: 10_000 });
  await clickConfirm(page, 'cancel');
  await page.waitForTimeout(1500);
  const chat = await chatCon(app, 'accendi il terminale');
  await riapriDopoRiavvio(app, page, chat.id);
  const riga = page.locator('.dash-bubble-filo .dash-activity-row');
  await expect(riga).toHaveCount(1, { timeout: 8_000 });
  await expect(riga, 'riaperta, la chat non racconta un no come una domanda ancora aperta').not.toHaveText(/Conferma chiesta/);
  const prima = (await chiamateAlModello(app)).length;
  await chiedi(page, 'come va?');
  await expect.poll(async () => (await chiamateAlModello(app)).length, { timeout: 10_000 }).toBeGreaterThan(prima);
  const ch = await chiamateAlModello(app);
  const detto = JSON.stringify(ch[ch.length - 1]);
  expect(detto, 'dopo un riavvio il modello sa che l\'utente ha detto no').not.toMatch(/non l'aveva ancora data/);
  await ripristina(app);
});

test('r1 detto sì al bottone dopo il turno, il modello non riceve un turno suo senza parole', async ({ app }) => {
  test.setTimeout(60_000);
  const dir = cartellaTemporanea('v1685r1-');
  try {
    const page = await home(app);
    await app.evaluate(() => globalThis.SN_STORAGE.updateSettings({ terminal: { enabled: true } }));
    await livelloAutonomia(app, 'conservativo');
    await modelloFinto(app, [
      { text: 'Creo la cartella.', toolCalls: [
        { id: 'c1', name: 'ESEGUI_COMANDO', arguments: JSON.stringify({ comando: `mkdir "${join(dir, 'uno')}"`, spiegazione: 'Creo la cartella uno' }) },
      ] },
      { text: 'Aspetto il tuo OK.' },
      { text: 'Fatta.' },
      { text: 'Ok.' },
    ]);
    await chiedi(page, 'crea la cartella uno');
    await expect(page.locator('.dash-bubble-filo', { hasText: 'Aspetto il tuo OK' })).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('#sendBtn')).toBeVisible({ timeout: 10_000 });
    await page.locator('.dash-bubble-filo .dash-action-btn', { hasText: 'Creo la cartella uno' }).click();
    await expect(page.locator(CONFIRM_HOST)).toBeVisible({ timeout: 5_000 });
    if (await page.locator(`${CONFIRM_HOST} input`).count()) await fillConfirmInput(page, 'conferma');
    await scrollConfirmToEnd(page);
    await clickConfirm(page, 'ok');
    await expect(page.locator('.dash-bubble-filo', { hasText: 'Fatta.' })).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('#sendBtn')).toBeVisible({ timeout: 10_000 });
    const prima = (await chiamateAlModello(app)).length;
    await chiedi(page, 'e adesso?');
    await expect.poll(async () => (await chiamateAlModello(app)).length, { timeout: 10_000 }).toBeGreaterThan(prima);
    const ch = await chiamateAlModello(app);
    const vuoti = ch[ch.length - 1].filter((m) => m.role === 'assistant' && /^\(azioni di questo turno: [A-Z_, ]+\)$/.test(String(m.content || '').trim()));
    expect(vuoti, 'il sì resta come esito che il modello legge, non come un turno senza parole').toEqual([]);
  } finally {
    await ripristina(app);
    togliCartella(dir);
  }
});

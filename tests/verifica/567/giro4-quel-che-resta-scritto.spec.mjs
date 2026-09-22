// #567, quarto giro — la stessa famiglia dei giri 1-3 su due porte rimaste.
//
// A) La conversazione RIAPERTA racconta il turno coi soli nomi delle azioni:
//    non sa se sono riuscite, se l'utente le ha annullate, o se le ha portate
//    a termine lui cliccando. Quindi mente in tutte e due le direzioni.
// B) Il riordino delle schede che non è potuto partire si legge come riuscito.

import { test, expect } from '../../fixtures/electron.mjs';
import { newtabPage, configureModel, fakeProvider, restore, chiedi } from './aiuto.mjs';
import { clickConfirm } from '../../helpers/confirm.mjs';

const archivio = (app) => app.evaluate(() => globalThis.SN_FILO_CHATS.list());

// Il riassunto in cima al blocco del lavoro, in diretta.
async function titoloDiario(page) {
  const label = page.locator('.dash-activity .dash-activity-label').first();
  return ((await label.textContent()) || '').trim();
}

test('l\'evento aggiunto dall\'utente resta «proposto» nella conversazione riaperta', async ({ app, shell, openTab }) => {
  test.setTimeout(90_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);
  await expect(page.locator('#input')).toBeVisible();
  await configureModel(app);
  // L'intervista di benvenuto aperta si prende ogni chat: qui servono le chat normali.
  await app.evaluate(() => globalThis.SN_FILO_MEMORY.setOnboarding({ done: true, ticked: [], thread: [] }));

  await fakeProvider(app, [
    { toolCalls: [{ id: 'g4a', name: 'EVENTO_CALENDARIO', arguments: JSON.stringify({ titolo: 'Cena con Anna', data: '2026-10-02', ora: '20:30' }) }] },
    { text: 'Te lo segno.' },
  ], '__v567g4a');

  await chiedi(page, 'segnami la cena con Anna venerdì alle 20:30');
  await expect(page.locator('.dash-bubble-filo', { hasText: 'Te lo segno.' })).toBeVisible({ timeout: 15_000 });

  const btn = page.locator('.dash-action-btn', { hasText: 'Aggiungi al calendario' });
  await expect(btn).toBeVisible();
  await btn.click();
  // In diretta il diario sa che l'evento è stato aggiunto: è la cura del giro 2.
  await expect.poll(() => titoloDiario(page), { timeout: 15_000 }).toContain('aggiunto un evento al calendario');

  // La stessa conversazione, riaperta dalla Cronologia.
  const chats = await (async () => {
    for (let i = 0; i < 40; i += 1) {
      const c = await archivio(app);
      if (c.length && c[0].messages.some((m) => Array.isArray(m.actions) && m.actions.includes('EVENTO_CALENDARIO'))) return c;
      await new Promise((r) => setTimeout(r, 250));
    }
    return archivio(app);
  })();
  expect(chats.length, 'la chat non è arrivata nell\'archivio').toBeGreaterThan(0);
  const riaperta = await openTab(`filo://dashboard/dashboard.html?chat=${chats[0].id}`);
  await expect(riaperta.locator('.dash-bubble').first()).toBeVisible({ timeout: 10_000 });
  const note = (await riaperta.locator('.dash-bubble-note[data-replay="1"]').allTextContents()).join(' | ');
  await riaperta.screenshot({ path: 'tests/.shots/567-giro4-chat-riaperta-evento.png' });

  expect(note, 'la chat riaperta non racconta niente di quel turno').not.toBe('');
  expect(note, `la chat riaperta racconta: ${JSON.stringify(note)}`).not.toContain('proposto un evento');

  await restore(app, '__v567g4a');
});

test('una conferma mai data torna nella conversazione riaperta come cosa fatta', async ({ app, shell, openTab }) => {
  test.setTimeout(90_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);
  await expect(page.locator('#input')).toBeVisible();
  await configureModel(app);
  // L'intervista di benvenuto aperta si prende ogni chat: qui servono le chat normali.
  await app.evaluate(() => globalThis.SN_FILO_MEMORY.setOnboarding({ done: true, ticked: [], thread: [] }));

  await fakeProvider(app, [
    { toolCalls: [{ id: 'g4b', name: 'CANCELLA_MEMORIA', arguments: '{}' }] },
    { text: 'Posso cancellare tutto quello che so di te.' },
  ], '__v567g4b');

  await chiedi(page, 'dimentica tutto quello che sai di me');
  await expect(page.locator('.dash-bubble-filo', { hasText: 'Posso cancellare' })).toBeVisible({ timeout: 15_000 });
  // L'utente NON conferma: legge, ci ripensa, e chiude la conversazione.
  await expect(page.locator('.dash-action-btn').first()).toBeVisible();

  const chats = await (async () => {
    for (let i = 0; i < 40; i += 1) {
      const c = await archivio(app);
      if (c.length && c[0].messages.some((m) => Array.isArray(m.actions) && m.actions.includes('CANCELLA_MEMORIA'))) return c;
      await new Promise((r) => setTimeout(r, 250));
    }
    return archivio(app);
  })();
  expect(chats.length, 'la chat non è arrivata nell\'archivio').toBeGreaterThan(0);

  const riaperta = await openTab(`filo://dashboard/dashboard.html?chat=${chats[0].id}`);
  await expect(riaperta.locator('.dash-bubble').first()).toBeVisible({ timeout: 10_000 });
  const note = (await riaperta.locator('.dash-bubble-note[data-replay="1"]').allTextContents()).join(' | ');
  await riaperta.screenshot({ path: 'tests/.shots/567-giro4-chat-riaperta-memoria.png' });

  expect(note, 'la chat riaperta non racconta niente di quel turno').not.toBe('');
  expect(note, `la memoria non è stata cancellata, ma la chat riaperta racconta: ${JSON.stringify(note)}`).not.toContain('cancellato la memoria');

  await restore(app, '__v567g4b');
});

test('il riordino che non è potuto partire non deve leggersi come riuscito', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(120_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  // Due schede vere da valutare: senza candidati il riordino non parte affatto.
  await openTab(testServer.html('<html><body><h1>una</h1></body></html>'));
  await openTab(testServer.html('<html><body><h1>due</h1></body></html>'));

  // Il giudizio sulle schede non arriva: crediti finiti, chiave sbagliata, rete
  // giù. È il caso che il codice ingoia con un catch.
  await app.evaluate(() => {
    globalThis.__v567g4c = globalThis.SN_TAB_TRIAGE_DECIDE;
    globalThis.SN_TAB_TRIAGE_DECIDE = async () => { throw new Error('crediti finiti'); };
  });

  const page = await newtabPage(app);
  await expect(page.locator('#input')).toBeVisible();
  await configureModel(app);
  // L'intervista di benvenuto aperta si prende ogni chat: qui servono le chat normali.
  await app.evaluate(() => globalThis.SN_FILO_MEMORY.setOnboarding({ done: true, ticked: [], thread: [] }));

  await fakeProvider(app, [
    { toolCalls: [{ id: 'g4c', name: 'PULISCI_TAB', arguments: '{}' }] },
    { text: 'Valuto le schede aperte.' },
  ], '__v567g4c2');

  await chiedi(page, 'riordina le schede e archivia quelle che non servono');
  await expect(page.locator('.dash-bubble-filo', { hasText: 'Valuto le schede aperte.' })).toBeVisible({ timeout: 15_000 });

  // Il bottone si prende per posizione: il suo TESTO cambia al click, e un
  // locator che filtra sul testo smette di trovarlo proprio quando serve.
  const btn = page.locator('.dash-bubble-actions .dash-action-btn').first();
  await expect(btn).toHaveText(/Riordina e archivia/);
  await btn.click();
  await clickConfirm(page, 'ok', { timeout: 10_000 });
  await expect.poll(async () => ((await btn.textContent()) || '').trim(), { timeout: 30_000 }).not.toContain('Riordino in corso');

  const esito = ((await btn.textContent()) || '').trim();
  const titolo = await titoloDiario(page);
  await page.screenshot({ path: 'tests/.shots/567-giro4-riordino-non-partito.png' });

  expect(
    `${esito} — ${titolo}`,
    'il riordino non è potuto partire, e l\'utente legge lo stesso esito di un riordino riuscito senza niente da archiviare',
  ).not.toContain('Nessuna scheda da archiviare');

  await app.evaluate(() => { globalThis.SN_TAB_TRIAGE_DECIDE = globalThis.__v567g4c; });
  await restore(app, '__v567g4c2');
});

test('un\'impostazione che non si è potuta applicare torna come cambiata nella conversazione riaperta', async ({ app, shell, openTab }) => {
  test.setTimeout(90_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);
  await expect(page.locator('#input')).toBeVisible();
  await configureModel(app);
  await app.evaluate(() => globalThis.SN_FILO_MEMORY.setOnboarding({ done: true, ticked: [], thread: [] }));

  // Un valore che Filo non sa tradurre: l'impostazione NON cambia.
  await fakeProvider(app, [
    { toolCalls: [{ id: 'g4d', name: 'IMPOSTA_PREFERENZA', arguments: JSON.stringify({ chiave: 'terminalMode', valore: 'quando serve' }) }] },
    { text: 'Ci provo.' },
  ], '__v567g4d');

  await chiedi(page, 'attiva la modalità terminale quando serve');
  await expect(page.locator('.dash-bubble-filo', { hasText: 'Ci provo.' })).toBeVisible({ timeout: 15_000 });

  const chats = await (async () => {
    for (let i = 0; i < 40; i += 1) {
      const c = await archivio(app);
      if (c.length && c[0].messages.some((m) => Array.isArray(m.actions) && m.actions.includes('IMPOSTA_PREFERENZA'))) return c;
      await new Promise((r) => setTimeout(r, 250));
    }
    return archivio(app);
  })();
  expect(chats.length, 'la chat non è arrivata nell\u2019archivio').toBeGreaterThan(0);

  const riaperta = await openTab(`filo://dashboard/dashboard.html?chat=${chats[0].id}`);
  await expect(riaperta.locator('.dash-bubble').first()).toBeVisible({ timeout: 10_000 });
  const note = (await riaperta.locator('.dash-bubble-note[data-replay="1"]').allTextContents()).join(' | ');

  const acceso = await app.evaluate(() => globalThis.SN_STORAGE.getSettings().then((s) => !!s.terminalMode));
  expect(acceso, 'l\u2019impostazione non doveva cambiare').toBe(false);
  expect(note, `l\u2019impostazione non è cambiata, ma la chat riaperta racconta: ${JSON.stringify(note)}`).not.toMatch(/cambiato un.impostazione/);

  await restore(app, '__v567g4d');
});

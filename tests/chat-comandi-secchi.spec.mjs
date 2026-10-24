// #1130 — un comando secco in chat (un timer, un link) chiude il turno con UNA chiamata al modello: niente secondo giro
// da 26k token per ricevere un testo vuoto. Un esito da leggere, un'azione fallita o una lettura prima lo richiamano.
// La regola pura: tests/unit/giroChiudeIlTurno.test.mjs.

import { test, expect } from './fixtures/electron.mjs';
import { home, modelloFinto, chiedi, chiamateAlModello, ripristina } from './helpers/chatFinta.mjs';
import { livelloAutonomia } from './helpers/autonomia.mjs';

const SECONDO_GIRO = 'Questa frase arriva solo da un secondo giro.';
const timer = (secondi, etichetta) => ({ name: 'TIMER', arguments: JSON.stringify({ secondi, etichetta }) });
const etichetteTimer = (app) => app.evaluate(async () => (await globalThis.SN_FILO_MEMORY.listTimers()).map((t) => t.label));

async function ricercaFinta(app) {
  await app.evaluate(() => {
    globalThis.SN_WEB_SEARCH = { search: async ({ query }) => ({ provider: 'finto', results: [{ title: `Risultato ${query}`, url: 'https://example.com/', snippet: 'domani piove alle 15' }] }) };
  });
}

test('«timer 10 minuti»: una chiamata sola, il timer c\'è e la frase scritta col timer è la risposta', async ({ app }) => {
  test.setTimeout(60_000);
  const page = await home(app);
  await modelloFinto(app, [
    { text: 'Fatto, 10 minuti.', toolCalls: [{ id: 't1', ...timer(600, 'Tè') }] },
    { text: SECONDO_GIRO },
  ]);
  await chiedi(page, 'timer 10 minuti');

  await expect(page.locator('.dash-bubble-filo', { hasText: 'Fatto, 10 minuti.' })).toBeVisible({ timeout: 10_000 });
  const activity = page.locator('.dash-activity');
  await expect(activity).toHaveAttribute('data-phase', 'done');
  // Finché il turno gira al posto dell'invio c'è il quadrato per fermarlo: l'invio che torna vuol dire turno finito.
  await expect(page.locator('#sendBtn')).toBeVisible();
  expect(await etichetteTimer(app)).toContain('Tè');
  expect((await chiamateAlModello(app)).length).toBe(1);
  await expect(page.locator('.dash-bubble-filo', { hasText: SECONDO_GIRO })).toHaveCount(0);
  // La frase sta nella bolla, non anche fra le note di lavoro; la riga del timer è nel diario.
  await activity.locator('.dash-activity-head').click();
  await expect(activity.locator('.dash-activity-note')).toHaveCount(0);
  await expect(activity.locator('.dash-activity-row', { hasText: 'Tè' })).toHaveCount(1);
  await page.screenshot({ path: 'tests/.shots/chat-comando-secco-timer.png' });
  await ripristina(app);
});

test('«apri questa pagina» senza parole: una chiamata sola, la scheda si apre e la bolla ha solo l\'azione', async ({ app, shell, testServer }) => {
  test.setTimeout(60_000);
  const page = await home(app);
  const url = testServer.html('<title>Posta</title><h1>Posta</h1>');
  await modelloFinto(app, [
    { text: '', toolCalls: [{ id: 'n1', name: 'NAVIGA', arguments: JSON.stringify({ url }) }] },
    { text: SECONDO_GIRO },
  ]);
  await chiedi(page, 'apri la posta');

  await expect(shell.locator('.tab')).toHaveCount(2, { timeout: 10_000 });
  // Un turno di solo link è una bolla col solo collegamento, per riaprirlo.
  await expect(page.locator('.dash-bubble-filo.dash-bubble-actions-only', { hasText: '127.0.0.1' })).toBeVisible({ timeout: 10_000 });
  await expect(page.locator('#sendBtn')).toBeVisible();
  expect((await chiamateAlModello(app)).length).toBe(1);
  await expect(page.locator('.dash-bubble-filo', { hasText: SECONDO_GIRO })).toHaveCount(0);
  await ripristina(app);
});

test('un\'azione che chiede conferma: una chiamata sola, col popup e il pulsante in chat', async ({ app }) => {
  test.setTimeout(60_000);
  const page = await home(app);
  // A Conservativo il costo 2 chiede anche a compito pulito (#530).
  await livelloAutonomia(app, 'conservativo');
  await modelloFinto(app, [
    { text: '', toolCalls: [{ id: 'f1', name: 'INVIA_FEEDBACK', arguments: '{"testo":"Il timer non suona.","titolo":"Timer muto"}' }] },
    { text: SECONDO_GIRO },
  ]);
  await chiedi(page, 'segnala che il timer non suona');

  await expect(page.locator('.sn-confirm-host')).toBeVisible({ timeout: 10_000 });
  await expect(page.locator('.dash-action-btn', { hasText: 'Inviare questo feedback' })).toBeVisible();
  await expect(page.locator('#sendBtn')).toBeVisible();
  expect((await chiamateAlModello(app)).length).toBe(1);
  await expect(page.locator('.dash-bubble-filo', { hasText: SECONDO_GIRO })).toHaveCount(0);
  await ripristina(app);
});

test('un\'azione che chiede conferma col testo scritto insieme: il modello riparte, e la bolla non dà per fatto quello che aspetta l\'OK', async ({ app }) => {
  test.setTimeout(60_000);
  const page = await home(app);
  await livelloAutonomia(app, 'conservativo');
  await modelloFinto(app, [
    { text: 'Fatto, ho segnalato il timer muto.', toolCalls: [{ id: 'f1', name: 'INVIA_FEEDBACK', arguments: '{"testo":"Il timer non suona.","titolo":"Timer muto"}' }] },
    { text: 'Te lo mando appena confermi.' },
  ]);
  await chiedi(page, 'segnala che il timer non suona');

  await expect(page.locator('.sn-confirm-host')).toBeVisible({ timeout: 10_000 });
  await expect(page.locator('.dash-bubble-filo', { hasText: 'Te lo mando appena confermi.' })).toBeVisible({ timeout: 10_000 });
  const chiamate = await chiamateAlModello(app);
  expect(chiamate.length).toBe(2);
  expect(chiamate[1][chiamate[1].length - 1].content).toMatch(/In attesa della conferma/);
  await expect(page.locator('.dash-bubble-filo', { hasText: 'Fatto, ho segnalato' })).toHaveCount(0);
  await ripristina(app);
});

test('un timer fallito torna al modello, che risponde al secondo giro', async ({ app }) => {
  test.setTimeout(60_000);
  const page = await home(app);
  await modelloFinto(app, [
    { text: '', toolCalls: [{ id: 't0', ...timer(0, 'Niente') }] },
    { text: SECONDO_GIRO },
  ]);
  await chiedi(page, 'timer di zero minuti');

  await expect(page.locator('.dash-bubble-filo', { hasText: SECONDO_GIRO })).toBeVisible({ timeout: 10_000 });
  const chiamate = await chiamateAlModello(app);
  expect(chiamate.length).toBe(2);
  const esito = chiamate[1][chiamate[1].length - 1];
  expect(esito).toMatchObject({ role: 'tool', tool_call_id: 't0' });
  expect(esito.content).toMatch(/non riuscita/);
  await ripristina(app);
});

test('una ricerca, anche insieme a un timer, torna al modello come prima', async ({ app }) => {
  test.setTimeout(60_000);
  const page = await home(app);
  await ricercaFinta(app);
  await modelloFinto(app, [
    { text: '', toolCalls: [{ id: 'w1', name: 'CERCA_WEB', arguments: '{"query":"meteo domani"}' }, { id: 't2', ...timer(300, 'Ombrello') }] },
    { text: SECONDO_GIRO },
  ]);
  await chiedi(page, 'che tempo fa domani? e mettimi un timer di 5 minuti');

  await expect(page.locator('.dash-bubble-filo', { hasText: SECONDO_GIRO })).toBeVisible({ timeout: 10_000 });
  expect((await chiamateAlModello(app)).length).toBe(2);
  expect(await etichetteTimer(app)).toContain('Ombrello');
  await ripristina(app);
});

test('un timer messo dopo una ricerca non chiude il turno: il modello dice ancora cosa ha trovato', async ({ app }) => {
  test.setTimeout(60_000);
  const page = await home(app);
  await ricercaFinta(app);
  await modelloFinto(app, [
    { text: '', toolCalls: [{ id: 'w1', name: 'CERCA_WEB', arguments: '{"query":"quando piove domani"}' }] },
    { text: '', toolCalls: [{ id: 's1', ...timer(900, 'Pioggia') }] },
    { text: 'Domani piove alle 15: timer messo.' },
  ]);
  await chiedi(page, 'cerca quando piove e mettimi un timer');

  await expect(page.locator('.dash-bubble-filo', { hasText: 'Domani piove alle 15' })).toBeVisible({ timeout: 10_000 });
  expect((await chiamateAlModello(app)).length).toBe(3);
  expect(await etichetteTimer(app)).toContain('Pioggia');
  await ripristina(app);
});

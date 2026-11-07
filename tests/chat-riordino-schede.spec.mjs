// #1626 — «riordinami le tab» detto alla chat: la pulizia parte e la chat dice quante schede ha archiviato, o mostra
// il bottone quando la regola chiede; un giudizio che non arriva è un errore col suo perché, anche quando i doppioni
// sono stati chiusi. Il giudizio del modello è simulato (SN_TAB_TRIAGE_DECIDE); la regola: tests/unit/tabTriage.test.mjs.

import { test, expect } from './fixtures/electron.mjs';
import { home, modelloFinto, chiedi, chiamateAlModello, ripristina } from './helpers/chatFinta.mjs';
import { livelloAutonomia } from './helpers/autonomia.mjs';
import { clickConfirm } from './helpers/confirm.mjs';

const MOTIVO = 'I crediti sono finiti: ricaricali in Crediti.';

const titoli = (shell) => shell.evaluate(async () => (await window.filoShell.tabs.snapshot()).tabs
  .filter((t) => !String(t.url).startsWith('filo://')).map((t) => t.title).sort());

async function tornaAllaHome(shell) {
  const h = (await shell.evaluate(async () => (await window.filoShell.tabs.snapshot()).tabs))
    .find((t) => String(t.url).startsWith('filo://newtab'));
  await shell.evaluate((id) => window.filoShell.tabs.activate(id), h.id);
}

const esitoPerIlModello = async (app, id) => {
  for (const msgs of await chiamateAlModello(app)) {
    const m = msgs.find((x) => x.role === 'tool' && x.tool_call_id === id);
    if (m) return String(m.content);
  }
  return '';
};

// Due schede sulla stessa pagina (un doppione che Filo chiude da sé) e due pagine diverse.
async function schedeDaRiordinare(openTab, testServer, shell) {
  const doppia = testServer.html('<title>Doppia</title><p>doppia');
  await openTab(doppia);
  await openTab(doppia);
  await openTab(testServer.html('<title>Vecchia</title><p>vecchia'));
  await openTab(testServer.html('<title>Utile</title><p>utile'));
  await expect(shell.locator('.tab')).toHaveCount(5, { timeout: 10_000 });
  await tornaAllaHome(shell);
}

const giudizioCheArchivia = (app, titolo) => app.evaluate((_e, t) => {
  globalThis.SN_TAB_TRIAGE_DECIDE = async ({ tabs }) => ({
    decisions: tabs.map((x, i) => ({ i, action: x.title === t ? 'archive' : 'keep', reason: 'test' })),
  });
}, titolo);

const giudizioCheFallisce = (app) => app.evaluate((_e, motivo) => {
  globalThis.SN_TAB_TRIAGE_DECIDE = async () => { throw Object.assign(new Error('402'), { userMessage: motivo }); };
}, MOTIVO);

test('a Normale «riordinami le tab» archivia e la chat dice quante', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(90_000);
  const page = await home(app);
  await livelloAutonomia(app, 'default');
  await schedeDaRiordinare(openTab, testServer, shell);
  await giudizioCheArchivia(app, 'Vecchia');
  await modelloFinto(app, [
    { text: '', toolCalls: [{ id: 'p1', name: 'PULISCI_TAB', arguments: '{}' }] },
    { text: 'Ho archiviato due schede.' },
  ]);
  await chiedi(page, 'riordinami le tab');

  await expect.poll(() => titoli(shell), { timeout: 15_000 }).toEqual(['Doppia', 'Utile']);
  const riga = page.locator('.dash-activity').last();
  await expect(riga).toContainText('Schede riordinate · 2 archiviate', { timeout: 10_000 });
  expect(await esitoPerIlModello(app, 'p1')).toContain('Schede riordinate: 2 archiviate');
  await ripristina(app);
});

test('a Normale un giudizio che non arriva è un errore col perché, anche coi doppioni chiusi', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(90_000);
  const page = await home(app);
  await livelloAutonomia(app, 'default');
  await schedeDaRiordinare(openTab, testServer, shell);
  await giudizioCheFallisce(app);
  await modelloFinto(app, [
    { text: '', toolCalls: [{ id: 'f1', name: 'PULISCI_TAB', arguments: '{}' }] },
    { text: 'Non sono riuscito a valutare le schede: i crediti sono finiti.' },
  ]);
  await chiedi(page, 'riordinami le tab');

  await expect(page.locator('.dash-bubble-filo', { hasText: 'i crediti sono finiti' })).toBeVisible({ timeout: 15_000 });
  // Il doppione si chiude per regola, le altre restano: nessuna valutata.
  expect(await titoli(shell)).toEqual(['Doppia', 'Utile', 'Vecchia']);
  const riga = page.locator('.dash-activity').last();
  await riga.locator('.dash-activity-head').click();
  await expect(riga).toContainText('Riordino non riuscito');
  await expect(riga).toContainText('ha chiuso solo un doppione');
  await expect(riga).toContainText('crediti sono finiti');
  await expect(riga).not.toContainText('Schede riordinate');
  const esito = await esitoPerIlModello(app, 'f1');
  expect(esito).toContain('Riordino NON riuscito');
  expect(esito).toContain(MOTIVO);
  expect(esito).not.toMatch(/^Schede riordinate/);
  await page.screenshot({ path: 'tests/.shots/chat-riordino-giudizio-mancato.png' });
  await ripristina(app);
});

test('a Conservativo compare il bottone; al clic un giudizio mancato dice il perché sotto il bottone, e riprovando riesce', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(120_000);
  const page = await home(app);
  await livelloAutonomia(app, 'conservativo');
  await schedeDaRiordinare(openTab, testServer, shell);
  await giudizioCheFallisce(app);
  await modelloFinto(app, [
    { text: '', toolCalls: [{ id: 'c1', name: 'PULISCI_TAB', arguments: '{}' }] },
    { text: 'Premi il bottone per riordinare.' },
  ]);
  await chiedi(page, 'riordinami le tab');

  const btn = page.locator('.dash-bubble-actions .dash-action-btn').first();
  await expect(btn).toHaveText(/Riordina e archivia/, { timeout: 15_000 });
  await btn.click();
  await clickConfirm(page, 'ok', { timeout: 10_000 });
  await expect(btn).toHaveText(/Chiusi solo un doppione · riprova/, { timeout: 30_000 });
  const nota = page.locator('.dash-riordino-motivo');
  await expect(nota).toBeVisible();
  await expect(nota).toContainText('crediti sono finiti');
  await page.screenshot({ path: 'tests/.shots/chat-riordino-bottone-motivo.png' });

  // Ricaricati i crediti, lo stesso bottone riprova e il perché se ne va.
  await giudizioCheArchivia(app, 'Vecchia');
  await btn.click();
  await clickConfirm(page, 'ok', { timeout: 10_000 });
  await expect(btn).toHaveText(/Archiviate 1 scheda/, { timeout: 30_000 });
  await expect(nota).toHaveCount(0);
  expect(await titoli(shell)).toEqual(['Doppia', 'Utile']);
  await ripristina(app);
});

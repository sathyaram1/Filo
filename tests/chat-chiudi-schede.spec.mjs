// #413 — «chiudi tutte le schede tranne questa» chiesto alla chat della home: le schede si chiudono davvero, quella
// della conversazione resta, e a «tutte» resta aperta anche quella con del testo scritto e non inviato, nominata
// al modello. La scelta delle schede: tests/unit/chiudiSchede.test.mjs.

import { test, expect } from './fixtures/electron.mjs';
import { home, modelloFinto, chiedi, chiamateAlModello, ripristina } from './helpers/chatFinta.mjs';

const schede = (shell) => shell.evaluate(async () => (await window.filoShell.tabs.snapshot()).tabs
  .map((t) => ({ id: t.id, title: t.title, url: t.url, formDirty: t.formDirty })));

async function tornaAllaHome(shell) {
  const h = (await schede(shell)).find((t) => String(t.url).startsWith('filo://newtab'));
  await shell.evaluate((id) => window.filoShell.tabs.activate(id), h.id);
  return h.id;
}

// Il testo che il modello riceve come esito della chiamata `id`.
const esitoPerIlModello = async (app, id) => {
  for (const msgs of await chiamateAlModello(app)) {
    const m = msgs.find((x) => x.role === 'tool' && x.tool_call_id === id);
    if (m) return String(m.content);
  }
  return '';
};

test('«chiudi tutte le schede tranne questa»: restano la home con la chat, le altre si chiudono', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(90_000);
  const page = await home(app);
  await openTab(testServer.html('<title>Ricetta</title><p>ricetta'));
  await openTab(testServer.html('<title>Notizie</title><p>notizie', { pubblico: true }));
  await openTab(testServer.html('<title>Meteo</title><p>meteo'));
  await expect(shell.locator('.tab')).toHaveCount(4, { timeout: 10_000 });
  const idHome = await tornaAllaHome(shell);

  await modelloFinto(app, [
    { text: '', toolCalls: [{ id: 'c1', name: 'CHIUDI_SCHEDE', arguments: JSON.stringify({ tutte: true }) }] },
    { text: 'Questa frase arriva solo da un secondo giro.' },
  ]);
  await chiedi(page, 'chiudi tutte le schede tranne questa');

  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 10_000 });
  expect((await schede(shell)).map((t) => t.id)).toEqual([idHome]);
  const activity = page.locator('.dash-activity');
  await expect(activity).toHaveAttribute('data-phase', 'done', { timeout: 10_000 });
  await activity.locator('.dash-activity-head').click();
  await expect(activity.locator('.dash-activity-row', { hasText: 'Chiuse 3 schede' })).toBeVisible();
  // Un comando riuscito senza schede lasciate aperte parla da sé: una chiamata sola.
  expect((await chiamateAlModello(app)).length).toBe(1);
  // Il modello vede quale scheda è la sua, e i numeri da usare.
  const prompt = JSON.stringify((await chiamateAlModello(app))[0]);
  expect(prompt).toContain('[QUESTA CHAT]');
  expect(prompt).toContain('CHIUDI_SCHEDE');
  await page.screenshot({ path: 'tests/.shots/chat-chiudi-schede-tutte.png' });
  await ripristina(app);
});

test('per numero e per sito, e a «tutte» il testo non inviato resta aperto e il modello lo sa', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(90_000);
  const page = await home(app);
  await openTab(testServer.html('<title>Alfa</title><p>alfa'));
  await openTab(testServer.html('<title>Beta</title><p>beta', { pubblico: true }));
  await openTab(testServer.html('<title>Gamma</title><p>gamma', { pubblico: true }));
  const bozza = await openTab(testServer.html('<title>Bozza</title><textarea id="t"></textarea>'));
  await bozza.locator('#t').click();
  await bozza.keyboard.type('Una risposta lunga che non ho ancora mandato');
  await expect.poll(async () => (await schede(shell)).find((t) => t.title === 'Bozza')?.formDirty, { timeout: 8_000 }).toBe(true);
  await tornaAllaHome(shell);

  // L'elenco del modello va dalla più recente: 1 la home, 2 Bozza, 3 Gamma, 4 Beta, 5 Alfa.
  await modelloFinto(app, [
    { text: '', toolCalls: [{ id: 'n1', name: 'CHIUDI_SCHEDE', arguments: JSON.stringify({ schede: [5] }) }] },
    { text: 'Chiusa Alfa.' },
    { text: '', toolCalls: [{ id: 's1', name: 'CHIUDI_SCHEDE', arguments: JSON.stringify({ sito: 'sito-pubblico.test' }) }] },
    { text: 'Chiuse.' },
    { text: '', toolCalls: [{ id: 't1', name: 'CHIUDI_SCHEDE', arguments: JSON.stringify({ tutte: true }) }] },
    { text: 'Ho lasciato aperta la bozza.' },
  ]);
  await chiedi(page, 'chiudi la quinta');
  await expect.poll(async () => (await schede(shell)).map((t) => t.title).sort()).toEqual(['Beta', 'Bozza', 'Gamma', 'Nuova scheda'].sort());

  await chiedi(page, 'chiudi le schede di sito-pubblico');
  await expect.poll(async () => (await schede(shell)).map((t) => t.title).sort()).toEqual(['Bozza', 'Nuova scheda'].sort());

  await chiedi(page, 'chiudile tutte');
  await expect(page.locator('.dash-bubble-filo', { hasText: 'Ho lasciato aperta la bozza.' })).toBeVisible({ timeout: 10_000 });
  // Niente da chiudere oltre alla bozza: resta, e l'esito lo dice al modello col nome recintato.
  expect((await schede(shell)).map((t) => t.title).sort()).toEqual(['Bozza', 'Nuova scheda'].sort());
  const esito = await esitoPerIlModello(app, 't1');
  expect(esito).toContain('Nessuna scheda chiusa');
  expect(esito).toContain('testo scritto e non ancora inviato');
  expect(esito).toMatch(/<<<DATI_PAGINA>>>[\s\S]*Bozza[\s\S]*<<<FINE_DATI_PAGINA>>>/);
  await page.screenshot({ path: 'tests/.shots/chat-chiudi-schede-bozza.png' });
  await ripristina(app);
});

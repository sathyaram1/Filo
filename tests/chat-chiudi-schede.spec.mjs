// #413 — «chiudi tutte le schede tranne questa» chiesto alla chat della home: le schede si chiudono davvero, quella
// della conversazione resta (si chiude solo nominata), e a «tutte» resta aperta quella col testo non inviato, nominata
// al modello; all'OK si chiudono quelle che il popup ha mostrato. La scelta delle schede: tests/unit/chiudiSchede.test.mjs.

import { test, expect } from './fixtures/electron.mjs';
import { home, modelloFinto, chiedi, chiamateAlModello, ripristina } from './helpers/chatFinta.mjs';
import { livelloAutonomia } from './helpers/autonomia.mjs';
import { CONFIRM_HOST, confirmText, clickConfirm, scrollConfirmToEnd } from './helpers/confirm.mjs';

const schede = (shell) => shell.evaluate(async () => (await window.filoShell.tabs.snapshot()).tabs
  .map((t) => ({ id: t.id, title: t.title, url: t.url, formDirty: t.formDirty })));

async function tornaAllaHome(shell) {
  const h = (await schede(shell)).find((t) => String(t.url).startsWith('filo://newtab'));
  await shell.evaluate((id) => window.filoShell.tabs.activate(id), h.id);
  return h.id;
}

const pagineWeb = async (shell) => (await schede(shell)).filter((t) => !String(t.url).startsWith('filo://')).map((t) => t.title).sort();

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
  await expect(activity.locator('.dash-activity-head')).toContainText('Ha chiuso delle schede');
  await expect(activity.locator('.dash-activity-row', { hasText: 'Chiuse 3 schede' })).toHaveCount(1);
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

  // L'elenco del modello va dalla più recente: 1 la home, 2 Bozza, 3 Gamma, 4 Beta, 5 Alfa. Un comando riuscito
  // chiude il turno con una chiamata: il giro di testo serve solo all'ultimo, che lascia aperta la bozza.
  await modelloFinto(app, [
    { text: '', toolCalls: [{ id: 'n1', name: 'CHIUDI_SCHEDE', arguments: JSON.stringify({ schede: [5] }) }] },
    { text: '', toolCalls: [{ id: 's1', name: 'CHIUDI_SCHEDE', arguments: JSON.stringify({ sito: 'sito-pubblico.test' }) }] },
    { text: '', toolCalls: [{ id: 't1', name: 'CHIUDI_SCHEDE', arguments: JSON.stringify({ tutte: true }) }] },
    { text: 'Ho lasciato aperta la bozza.' },
  ]);
  const fermo = () => expect(page.locator('#sendBtn')).toBeVisible({ timeout: 10_000 });
  await chiedi(page, 'chiudi la quinta');
  await expect.poll(() => pagineWeb(shell), { timeout: 10_000 }).toEqual(['Beta', 'Bozza', 'Gamma']);
  await fermo();

  await chiedi(page, 'chiudi le schede di sito-pubblico');
  await expect.poll(() => pagineWeb(shell), { timeout: 10_000 }).toEqual(['Bozza']);
  await fermo();

  await chiedi(page, 'chiudile tutte');
  await expect(page.locator('.dash-bubble-filo', { hasText: 'Ho lasciato aperta la bozza.' })).toBeVisible({ timeout: 10_000 });
  // Niente da chiudere oltre alla bozza: resta, e l'esito lo dice al modello col nome recintato.
  expect(await pagineWeb(shell)).toEqual(['Bozza']);
  const esito = await esitoPerIlModello(app, 't1');
  expect(esito).toContain('Nessuna scheda chiusa');
  expect(esito).toContain('testo scritto e non ancora inviato');
  expect(esito).toMatch(/<<<DATI_PAGINA>>>[\s\S]*Bozza[\s\S]*<<<FINE_DATI_PAGINA>>>/);
  // L'utente ha detto «tutte», non ne ha indicata nessuna: la riga gli dice perché la bozza resta.
  const riga = page.locator('.dash-activity').last();
  await expect(riga).toContainText('una resta aperta col testo non inviato');
  await expect(riga).not.toContainText('indicata');
  await page.screenshot({ path: 'tests/.shots/chat-chiudi-schede-bozza.png' });
  await ripristina(app);
});

test('«chiudi questa scheda» detto nella home la chiude: si torna alla pagina di prima e Filo resta in piedi', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(60_000);
  const page = await home(app);
  await openTab(testServer.html('<title>Lettura</title><p>lettura'));
  const idHome = await tornaAllaHome(shell);

  // [QUESTA CHAT] è la più recente: numero 1. Nominata col suo numero si chiude.
  await modelloFinto(app, [
    { text: '', toolCalls: [{ id: 'q1', name: 'CHIUDI_SCHEDE', arguments: JSON.stringify({ schede: [1] }) }] },
    { text: 'Questa frase arriva solo da un secondo giro.' },
  ]);
  await chiedi(page, 'chiudi questa scheda');

  await expect.poll(async () => (await schede(shell)).map((t) => t.id), { timeout: 10_000 }).not.toContain(idHome);
  expect(await pagineWeb(shell)).toEqual(['Lettura']);
  const attiva = await shell.evaluate(async () => { const s = await window.filoShell.tabs.snapshot(); return s.tabs.find((t) => t.id === s.activeId)?.title; });
  expect(attiva).toBe('Lettura');
  // Il turno finisce anche senza la sua scheda: il processo risponde e la chiamata al modello è una.
  await expect.poll(() => app.evaluate(() => (globalThis.__chatFinta_calls || []).length)).toBe(1);
  await ripristina(app);
});

test('quando chiede conferma, il popup elenca le schede e all\'OK chiude proprio quelle', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(90_000);
  const page = await home(app);
  // A Conservativo più schede insieme (costo 2) chiedono anche a compito pulito (#530).
  await livelloAutonomia(app, 'conservativo');
  await openTab(testServer.html('<title>Ricetta della torta</title><p>ricetta'));
  await openTab(testServer.html('<title>Orari dei treni</title><p>treni', { pubblico: true }));
  await tornaAllaHome(shell);
  await modelloFinto(app, [
    { text: '', toolCalls: [{ id: 'k1', name: 'CHIUDI_SCHEDE', arguments: JSON.stringify({ tutte: true }) }] },
    { text: 'Questa frase arriva solo da un secondo giro.' },
  ]);
  await chiedi(page, 'chiudi tutte le altre schede');

  await expect(page.locator(CONFIRM_HOST)).toBeVisible({ timeout: 10_000 });
  const testo = await confirmText(page);
  expect(testo).toContain('queste 2 schede');
  expect(testo).toContain('Ricetta della torta');
  expect(testo).toContain('Orari dei treni');
  expect(testo).toContain('filo della home');
  expect(await pagineWeb(shell)).toEqual(['Orari dei treni', 'Ricetta della torta']);
  await page.screenshot({ path: 'tests/.shots/chat-chiudi-schede-conferma.png' });

  // Nel frattempo se ne apre un'altra: l'OK chiude quelle mostrate, non «tutte» di adesso.
  await openTab(testServer.html('<title>Aperta dopo</title><p>dopo'));
  await tornaAllaHome(shell);
  await scrollConfirmToEnd(page).catch(() => {});
  await clickConfirm(page, 'ok');
  await expect.poll(() => pagineWeb(shell), { timeout: 10_000 }).toEqual(['Aperta dopo']);
  await ripristina(app);
});

// Un modello che fa quello che farebbe uno vero: cerca Gmail nell'elenco che riceve e, se ha un numero, lo lascia fuori.
async function modelloCheTieneGmail(app) {
  await modelloFinto(app, [{ text: '' }]);
  await app.evaluate(() => {
    let n = 0;
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = async ({ attempts, messages }) => {
      globalThis.__chatFinta_calls.push(JSON.parse(JSON.stringify(messages)));
      n += 1;
      const tutto = messages.map((m) => (typeof m.content === 'string' ? m.content : JSON.stringify(m.content))).join('\n');
      const riga = tutto.split('\n').find((l) => /^\d+\. .*Gmail/.test(l.trim()));
      const numero = riga ? Number(riga.trim().split('.')[0]) : null;
      const calls = n === 1 && numero ? [{ id: 'g1', name: 'CHIUDI_SCHEDE', arguments: JSON.stringify({ tutte: true, tranne: [numero] }) }] : [];
      return {
        model: attempts[0].model, provider: attempts[0].provider, usage: {}, reasoningDetails: [],
        text: calls.length ? '' : (numero ? 'Fatto.' : 'Gmail non ha un numero: non posso lasciarla aperta.'),
        toolCalls: calls, finishReason: calls.length ? 'tool_calls' : 'stop',
      };
    };
  });
}

test('«chiudi tutto tranne Gmail» con quattordici schede: la più vecchia ha il suo numero e resta aperta', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(150_000);
  const page = await home(app);
  await openTab(testServer.html('<title>Posta in arrivo - Gmail</title><p>posta'));
  for (let i = 1; i <= 13; i += 1) await openTab(testServer.html(`<title>Articolo ${i}</title><p>articolo ${i}`));
  await expect(shell.locator('.tab')).toHaveCount(15, { timeout: 20_000 });
  await tornaAllaHome(shell);

  await modelloCheTieneGmail(app);
  await chiedi(page, 'chiudi tutto tranne Gmail');

  await expect.poll(() => pagineWeb(shell), { timeout: 15_000 }).toEqual(['Posta in arrivo - Gmail']);
  await ripristina(app);
});

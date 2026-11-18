// #2371 — le funzioni che la chat della home spiegava invece di farle (scheda dopo, riapri l'ultima, salva per dopo,
// cerca un'immagine) ora le fa, senza segnalazioni; un'azione secca non chiude il turno su una domanda; l'assistente vede
// la segnalazione automatica partita a nome dell'utente, intera e col suo autore, e ne parte una sola per voce.
import { test, expect } from './fixtures/electron.mjs';
import { home, modelloFinto, chiedi, chiamateAlModello } from './helpers/chatFinta.mjs';

const schede = (app) => app.evaluate(({ BrowserWindow }) => {
  const tm = BrowserWindow.getAllWindows().find((w) => w._filoTabs && !w.isDestroyed())._filoTabs;
  return tm.tabs.map((t) => ({ id: t.id, url: String(t.url || ''), attiva: t.id === tm.activeId }));
});
const attiva = async (app) => (await schede(app)).find((t) => t.attiva);
const portaDavanti = (shell, id) => shell.evaluate((i) => window.filoShell.tabs.activate(i), id);
const chiama = (id, name, args = {}) => ({ toolCalls: [{ id, name, arguments: JSON.stringify(args) }] });

// Nessuna segnalazione, né proposta in chat né invio anonimo: la funzione l'ha fatta.
async function spiaSegnalazioni(app) {
  await app.evaluate(() => {
    globalThis.__inviate = [];
    globalThis.SN_FEEDBACK.submit = async (voce) => { globalThis.__inviate.push(voce); return { id: `fb-${globalThis.__inviate.length}` }; };
  });
}
const inviate = (app) => app.evaluate(() => globalThis.__inviate);
async function nessunaSegnalazione(app, page) {
  await page.waitForTimeout(1_000);
  await expect(page.locator('.dash-bubble-filo', { hasText: /segnalazione|feedback/i })).toHaveCount(0);
  expect(await inviate(app)).toEqual([]);
}

test('«passa alla scheda dopo» e «riapri l\'ultima scheda chiusa» li fa la chat, senza segnalazioni', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(90_000);
  const prima = await home(app);
  const homeId = (await attiva(app)).id;
  const a = testServer.html('<title>Pagina A</title><h1>A</h1>');
  const b = testServer.html('<title>Pagina B</title><h1>B</h1>');
  await openTab(a);
  await openTab(b);
  await portaDavanti(shell, homeId);
  await spiaSegnalazioni(app);

  await modelloFinto(app, [chiama('m1', 'MOSTRA_SCHEDA', { verso: 'dopo' })]);
  await chiedi(prima, 'passa alla scheda dopo');
  const elenco = await schede(app);
  const dopo = elenco[elenco.findIndex((t) => t.id === homeId) + 1];
  await expect.poll(async () => (await attiva(app)).id, { timeout: 10_000, message: 'la chat non è passata alla scheda dopo' }).toBe(dopo.id);
  await nessunaSegnalazione(app, prima);

  // La scheda B si chiude, e «riapri l'ultima» la riporta in un passo, com'era.
  const idB = (await schede(app)).find((t) => t.url === b).id;
  await shell.evaluate((i) => window.filoShell.tabs.close(i), idB);
  await expect.poll(async () => (await schede(app)).some((t) => t.url === b)).toBe(false);
  await portaDavanti(shell, homeId);
  await modelloFinto(app, [chiama('r1', 'RIAPRI_SCHEDA', {}), { text: 'Riaperta.' }]);
  await chiedi(prima, 'riapri l\'ultima scheda chiusa');
  await expect.poll(async () => (await schede(app)).some((t) => t.url === b), { timeout: 10_000, message: 'l\'ultima chiusa non è tornata' }).toBe(true);
  expect(JSON.stringify((await chiamateAlModello(app)).at(-1))).toContain('Pagina B');
  await nessunaSegnalazione(app, prima);
});

test('«salvala per dopo» e «cerca questa immagine» li fa la chat sulla pagina davanti', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(90_000);
  const chat = await home(app);
  const homeId = (await attiva(app)).id;
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
  const img = testServer.asset(png, 'image/png');
  const pagina = testServer.html(`<title>Ricetta del pane</title><img src="${img}" style="width:400px;height:300px">`);
  await openTab(pagina);
  await portaDavanti(shell, homeId);
  await spiaSegnalazioni(app);
  // L'apertura di Google Lens resta qui: la si registra senza andare in rete.
  await app.evaluate(({ BrowserWindow }) => {
    const tm = BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs;
    globalThis.__aperte = [];
    const vera = tm.openTab.bind(tm);
    tm.openTab = (url, opts) => {
      if (/^https:\/\/lens\.google\.com\//.test(String(url))) { globalThis.__aperte.push({ url: String(url), invio: !!(opts && opts.invio) }); return 'scheda-lens'; }
      return vera(url, opts);
    };
  });

  await modelloFinto(app, [chiama('l1', 'CERCA_IMMAGINE', {}), { text: 'Ecco la ricerca.' }]);
  await chiedi(chat, 'cerca questa immagine');
  // L'immagine va a Google: la chat chiede prima l'OK, e il popup dice dove va.
  await expect.poll(() => confirmText(chat), { timeout: 15_000, message: 'nessuna conferma prima di mandare l\'immagine a Google' })
    .toContain('Google Lens');
  await clickConfirm(chat, 'ok');
  await expect.poll(() => app.evaluate(() => globalThis.__aperte), { timeout: 10_000, message: 'Google Lens non si è aperto' })
    .toEqual([{ url: `https://lens.google.com/uploadbyurl?url=${encodeURIComponent(img)}`, invio: false }]);
  await nessunaSegnalazione(app, chat);

  await modelloFinto(app, [chiama('s1', 'SALVA_PER_DOPO', {}), { text: 'Salvata.' }]);
  await chiedi(chat, 'salvala per dopo');
  await expect.poll(() => app.evaluate(async () => (await globalThis.SN_SAVED_PAGES.list()).map((p) => p.url)), { timeout: 10_000, message: 'la pagina non è in «Aperti per dopo»' })
    .toContain(pagina);
  await expect.poll(async () => (await schede(app)).some((t) => t.url === pagina), { message: 'la scheda salvata è rimasta aperta' }).toBe(false);
  await nessunaSegnalazione(app, chat);
});

test('«metti il tema scuro» con una domanda: il tema cambia e la domanda ha la sua risposta (#2349)', async ({ app }) => {
  test.setTimeout(60_000);
  const chat = await home(app);
  await modelloFinto(app, [
    chiama('t1', 'IMPOSTA_PREFERENZA', { chiave: 'tema', valore: 'scuro' }),
    { text: 'Quella era una segnalazione proposta in automatico, non scritta da me.' },
  ]);
  await chiedi(chat, 'metti il tema scuro. E quel feedback che mi hai proposto, cos\'era?');
  await expect(chat.locator('.dash-bubble-filo', { hasText: 'proposta in automatico' })).toBeVisible({ timeout: 15_000 });
  expect((await chiamateAlModello(app)).length, 'dopo il tema il modello non è stato richiamato per la domanda').toBe(2);
  expect((await app.evaluate(() => globalThis.SN_STORAGE.getSettings())).theme).toBe('dark');
});

test('la segnalazione automatica: una sola per voce, e il turno dopo l\'assistente la legge intera col suo autore', async ({ app, avvisi }) => {
  test.setTimeout(90_000);
  const chat = await home(app);
  await spiaSegnalazioni(app);
  // Solo l'invio anonimo: la proposta in chat ha la sua prova qui sotto.
  await app.evaluate(() => { globalThis.SN_AUTO_FEEDBACK.composeProposal = () => null; });
  const SPIEGA = 'Per aprire una finestra in incognito premi Ctrl+Shift+N oppure clicca l\'icona Nuova finestra '
    + 'incognito nella barra laterale: lì quello che visiti non resta.';
  await modelloFinto(app, [{ text: SPIEGA }, { text: SPIEGA }, { text: 'Era la segnalazione automatica.' }]);
  await chiedi(chat, 'aprimi una finestra in incognito');
  const vista = await avvisi();
  const toast = vista.locator('.shell-notif.show', { hasText: 'segnalato a chi sviluppa Filo' });
  await expect(toast).toHaveCount(1, { timeout: 20_000 });
  await toast.locator('.shell-notif-close').click();
  await expect.poll(() => inviate(app), { timeout: 10_000 }).toHaveLength(1);
  const voce = (await inviate(app))[0];
  expect(voce.text).toContain('«Finestra in incognito» (incognito, Navigazione e schede)');

  // La stessa richiesta di nuovo: nessun secondo invio per la stessa voce.
  await chiedi(chat, 'dai, aprimi una finestra in incognito');
  await expect(chat.locator('.dash-bubble-filo')).toHaveCount(2, { timeout: 15_000 });
  await chat.waitForTimeout(2_000);
  await expect(toast).toHaveCount(0);
  expect(await inviate(app)).toHaveLength(1);

  await chiedi(chat, 'cos\'era quella segnalazione?');
  await expect(chat.locator('.dash-bubble-filo', { hasText: 'Era la segnalazione automatica.' })).toBeVisible({ timeout: 15_000 });
  const visto = JSON.stringify((await chiamateAlModello(app)).at(-1));
  expect(visto).toContain('la segnalazione automatica di Filo (non l\'assistente): INVIA_FEEDBACK');
  expect(visto).toContain(JSON.stringify(voce.text).slice(1, -1));
});

test('la proposta in chat: l\'assistente la legge intera e sa che non l\'ha scritta lui (#2348)', async ({ app }) => {
  test.setTimeout(60_000);
  const chat = await home(app);
  await spiaSegnalazioni(app);
  const SPIEGA = 'Per aprire una finestra in incognito premi Ctrl+Shift+N oppure clicca l\'icona Nuova finestra '
    + 'incognito nella barra laterale: lì quello che visiti non resta.';
  await modelloFinto(app, [{ text: SPIEGA }, { text: 'Quella proposta l\'ha scritta la segnalazione automatica.' }]);
  await chiedi(chat, 'aprimi una finestra in incognito');
  await expect(chat.locator('.dash-bubble-filo', { hasText: 'Finestra in incognito' })).toBeVisible({ timeout: 15_000 });
  await chiedi(chat, 'chi ha scritto quella proposta?');
  await expect(chat.locator('.dash-bubble-filo', { hasText: 'segnalazione automatica.' })).toBeVisible({ timeout: 15_000 });
  const visto = JSON.stringify((await chiamateAlModello(app)).at(-1));
  expect(visto).toContain('proposta dalla segnalazione automatica di Filo, non da te');
  expect(visto).toContain('Filo sa fare «Finestra in incognito», ma l\'assistente non ha uno strumento per farlo');
  expect(visto).toContain('Mi piacerebbe poterlo chiedere all\'assistente e basta.');
});

test('una riflessione senza richieste non fa nascere nessuna segnalazione (#2348)', async ({ app }) => {
  test.setTimeout(60_000);
  const chat = await home(app);
  await spiaSegnalazioni(app);
  await modelloFinto(app, [{ text: 'Hai ragione: ereditare un default è una scelta per omissione. Le convenzioni restano '
    + 'perché nessuno le rimette in discussione; in Filo colori e animazioni li trovi in Preferenze, nella sezione Aspetto.' }]);
  await chiedi(chat, 'che sia ereditato non significa che non sia una scelta. i colori della selezione, le animazioni '
    + 'dello scorrimento: Apple li ha decisi decenni fa e tutti li tengono per inerzia');
  await expect(chat.locator('.dash-bubble-filo', { hasText: 'scelta per omissione' })).toBeVisible({ timeout: 15_000 });
  await nessunaSegnalazione(app, chat);
});

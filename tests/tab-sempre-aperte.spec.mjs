// «Tienimi sempre aperta X» (#823): detto in chat diventa una regola che la pulizia delle schede applica da sé,
// anche se il modello risponde «archivia»; si vede e si toglie con la memoria. Il modello della pulizia riceve
// profilo, preferenze e lezioni dentro il recinto della memoria (#592), non come istruzioni dell'utente.

import { test, expect } from './fixtures/electron.mjs';
import { home, modelloFinto, chiamateAlModello, ripristina, chiedi } from './helpers/chatFinta.mjs';

test.use({ hostInPiu: ['example.org'] });

const pagina = (titolo) => `<!doctype html><html><head><title>${titolo}</title></head><body><p>${titolo}</p></body></html>`;

// La decisione simulata della pulizia: archivia tutto quello che riceve e tiene i messaggi.
async function puliziaCheArchiviaTutto(app) {
  await app.evaluate(async () => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      models: { [C.ACTIONS.FILO_CHAT]: 'deepseek-flash', [C.ACTIONS.FILO_TAB_TRIAGE]: 'deepseek-flash' },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
    });
    globalThis.__pulizia = [];
    const orig = globalThis.SN_PROVIDERS.completeWithFallback;
    globalThis.SN_PROVIDERS.completeWithFallback = async (args) => {
      const testo = (args.messages || []).map((m) => (typeof m.content === 'string' ? m.content : JSON.stringify(m.content))).join('\n');
      if (!/gestore delle schede/.test(testo)) return orig(args);
      globalThis.__pulizia.push(testo);
      return {
        text: JSON.stringify({ decisions: Array.from({ length: 50 }, (_, i) => ({ i, action: 'archive', reason: 'test' })) }),
        model: args.attempts[0].model, provider: args.attempts[0].provider, usage: {},
      };
    };
  });
}

const pulisci = (app) => app.evaluate(async ({ BrowserWindow }) => {
  const win = BrowserWindow.getAllWindows().find((w) => w._filoTabs);
  return win._filoTabs.runAutoTriage({ trigger: 'manual' });
});

// Il testo arriva in streaming prima che l'azione sia fatta: la fine del turno la dice l'invio che torna al posto del
// quadrato.
const turnoFinito = (chat) => expect(chat.locator('#sendBtn')).toBeVisible({ timeout: 15_000 });

const urlAperte = (shell) => shell.evaluate(async () => (await window.filoShell.tabs.snapshot()).tabs.map((t) => t.url));

test('«tienimi sempre aperta example.org»: la chat salva la regola, la pulizia archivia le altre e lei resta', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(90_000);
  // Una regola salvata chiude il turno (#1130): la frase va scritta insieme, e l'esito resta nel diario.
  await modelloFinto(app, [
    { text: 'Fatto: example.org resta sempre aperto.', toolCalls: [{ id: 't1', name: 'TIENI_APERTA', arguments: JSON.stringify({ dominio: 'example.org' }) }] },
  ]);
  await puliziaCheArchiviaTutto(app);
  const chat = await home(app);
  await chiedi(chat, 'tienimi sempre aperta example.org');
  await expect(chat.locator('.dash-bubble-filo')).toContainText('example.org resta sempre aperto', { timeout: 15_000 });
  await turnoFinito(chat);
  await chat.locator('.dash-activity-head').click();
  await expect(chat.locator('.dash-activity-row', { hasText: 'Sempre aperto · example.org' })).toHaveCount(1);
  await chat.screenshot({ path: 'tests/.shots/sempre-aperte-chat.png' });
  expect(Object.keys(await app.evaluate(() => globalThis.SN_FILO_MEMORY.listKeepOpen()))).toEqual(['example.org']);
  expect(await chiamateAlModello(app)).toHaveLength(1);
  await ripristina(app);

  const tenuta = testServer.html(pagina('Tenuta')).replace('127.0.0.1', 'example.org');
  await openTab(tenuta);
  await testServer.openReady(openTab, pagina('Altra'), { pubblico: true });
  await testServer.openReady(openTab, pagina('Terza'));
  await testServer.openReady(openTab, pagina('Davanti'));
  await expect.poll(async () => (await urlAperte(shell)).some((u) => u.startsWith('http://example.org:'))).toBe(true);

  const r = await pulisci(app);
  expect(r.archived).toBeGreaterThanOrEqual(2);
  const dopo = await urlAperte(shell);
  expect(dopo.filter((u) => u.startsWith('http://example.org:'))).toHaveLength(1);
  expect(dopo.some((u) => u.startsWith('http://sito-pubblico.test:'))).toBe(false);
  expect(await shell.evaluate(async () => (await window.filoShell.tabs.snapshot()).tabs.map((t) => t.title))).not.toContain('Terza');
  // Al modello la scheda tenuta non arriva nemmeno: non può deciderne niente.
  const [prompt] = await app.evaluate(() => globalThis.__pulizia);
  expect(prompt).toContain('Altra');
  expect(prompt).not.toContain('Tenuta');

  // Anche se la scheda va su example.org mentre il modello decide, resta.
  const altra = testServer.html(pagina('Diventa tenuta'), { pubblico: true });
  await openTab(altra);
  await openTab(testServer.html(pagina('Davanti 2')));
  await app.evaluate(async ({ BrowserWindow }, nuova) => {
    const tm = BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs;
    const decide = globalThis.SN_TAB_TRIAGE_DECIDE;
    globalThis.__decideVero = decide;
    globalThis.SN_TAB_TRIAGE_DECIDE = async (arg) => {
      const t = tm.tabs.find((x) => /sito-pubblico\.test/.test(x.url || ''));
      if (t) await t.view.webContents.loadURL(nuova);
      return { decisions: arg.tabs.map((_, i) => ({ i, action: 'archive', reason: 'test' })) };
    };
  }, testServer.html(pagina('x')).replace('127.0.0.1', 'example.org'));
  try {
    await pulisci(app);
  } finally {
    await app.evaluate(() => { globalThis.SN_TAB_TRIAGE_DECIDE = globalThis.__decideVero; });
  }
  expect((await urlAperte(shell)).filter((u) => u.startsWith('http://example.org:'))).toHaveLength(2);
});

test('«tienimi sempre aperta questa scheda» davanti a un sito locale (localhost): si salva e la pulizia la lascia', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(90_000);
  await openTab(testServer.html(pagina('Locale')).replace('127.0.0.1', 'localhost'));
  await expect.poll(async () => (await urlAperte(shell)).some((u) => u.startsWith('http://localhost:'))).toBe(true);
  await modelloFinto(app, [{ text: 'Fatto.', toolCalls: [{ id: 'l1', name: 'TIENI_APERTA', arguments: JSON.stringify({}) }] }]);
  await puliziaCheArchiviaTutto(app);
  const chat = await home(app);
  await chiedi(chat, 'tienimi sempre aperta questa scheda');
  await expect(chat.locator('.dash-bubble-filo')).toContainText('Fatto.', { timeout: 15_000 });
  await turnoFinito(chat);
  await ripristina(app);
  expect(Object.keys(await app.evaluate(() => globalThis.SN_FILO_MEMORY.listKeepOpen()))).toEqual(['localhost']);

  await testServer.openReady(openTab, pagina('Altra'), { pubblico: true });
  await testServer.openReady(openTab, pagina('Davanti'));
  await pulisci(app);
  const dopo = await urlAperte(shell);
  expect(dopo.filter((u) => u.startsWith('http://localhost:'))).toHaveLength(1);
  expect(dopo.some((u) => u.startsWith('http://sito-pubblico.test:'))).toBe(false);
});

test('le regole si vedono nel quaderno delle memorie, la × le toglie, e «non tenerla più aperta» pure',async ({ app, openTab }) => {
  test.setTimeout(90_000);
  await app.evaluate(async () => {
    await globalThis.SN_FILO_MEMORY.addKeepOpen('example.org');
    await globalThis.SN_FILO_MEMORY.addKeepOpen('web.whatsapp.com');
  });
  const pref = await openTab('filo://quaderno/quaderno.html');
  const gruppo = pref.locator('.qd-gruppo', { hasText: 'Siti sempre aperti' });
  await expect(gruppo).toHaveCount(1, { timeout: 10_000 });
  const riga = (host) => pref.locator('.qd-riga', { hasText: host });
  await expect(riga('example.org')).toHaveCount(1);
  await expect(riga('web.whatsapp.com')).toHaveCount(1);
  await riga('example.org').scrollIntoViewIfNeeded();
  await pref.screenshot({ path: 'tests/.shots/sempre-aperte-preferenze.png' });
  for (const tema of ['dark', 'light']) {
    await app.evaluate((_e, t) => globalThis.SN_HANDLE_MESSAGE(
      { type: globalThis.SN_MSG.MSG.UPDATE_SETTINGS, settings: { theme: t } },
      { tab: { url: 'filo://preferences/' }, url: 'filo://preferences/' },
    ), tema);
    await pref.waitForTimeout(500);
    await riga('example.org').scrollIntoViewIfNeeded();
    await pref.screenshot({ path: `tests/.shots/sempre-aperte-preferenze-${tema}.png` });
  }

  await riga('example.org').hover();
  await riga('example.org').locator('.qd-tasto[title="Non tenerlo più aperto"]').click();
  await expect(riga('example.org')).toHaveCount(0);
  await expect(pref.locator('#esito')).toHaveText('example.org non resta più aperto');
  expect(Object.keys(await app.evaluate(() => globalThis.SN_FILO_MEMORY.listKeepOpen()))).toEqual(['web.whatsapp.com']);

  // Detto in chat: «non tenere più aperto WhatsApp» col dominio largo toglie la regola più precisa salvata.
  await modelloFinto(app, [{ text: 'Fatto.', toolCalls: [{ id: 'n1', name: 'NON_TENERE_APERTA', arguments: JSON.stringify({ dominio: 'whatsapp.com' }) }] }]);
  const chat = await home(app);
  await chiedi(chat, 'non tenere più aperto whatsapp');
  await expect(chat.locator('.dash-bubble-filo')).toContainText('Fatto.', { timeout: 15_000 });
  await turnoFinito(chat);
  await chat.locator('.dash-activity-head').click();
  await expect(chat.locator('.dash-activity-row', { hasText: 'Non più tenuto aperto · web.whatsapp.com' })).toHaveCount(1);
  await ripristina(app);
  expect(await app.evaluate(() => globalThis.SN_FILO_MEMORY.listKeepOpen())).toEqual({});
  // Il quaderno aperto si aggiorna da solo: niente gruppo, e nessuna riga rimasta indietro.
  await expect(gruppo).toHaveCount(0);
});

test('il modello della pulizia riceve preferenze e lezioni dentro il recinto della memoria', async ({ app, openTab, testServer }) => {
  await puliziaCheArchiviaTutto(app);
  const LEZIONE = 'L\'utente lavora tutto il giorno su Linear e lo vuole sempre a portata di mano';
  const PREFERENZA = 'Preferisce poche schede aperte';
  await app.evaluate(async (_e, { lezione, preferenza }) => {
    await globalThis.SN_FILO_MEMORY.setMemory({ PROFILO: 'Sviluppatore', PREFERENZE: preferenza });
    await globalThis.SN_FILO_MEMORY.appendLesson(lezione);
  }, { lezione: LEZIONE, preferenza: PREFERENZA });
  await testServer.openReady(openTab, pagina('Una'), { pubblico: true });
  await testServer.openReady(openTab, pagina('Davanti'));
  await pulisci(app);
  const [prompt] = await app.evaluate(() => globalThis.__pulizia);
  const m = await app.evaluate(() => globalThis.SN_ESTERNO.marcature('MEMORIA_FILO'));
  for (const ago of [LEZIONE, PREFERENZA]) {
    const i = prompt.indexOf(ago);
    expect(i, `${ago} nel messaggio della pulizia`).toBeGreaterThan(-1);
    const apre = prompt.lastIndexOf(m.inizio, i);
    expect(apre).toBeGreaterThan(-1);
    expect(prompt.indexOf(m.fine, apre)).toBeGreaterThan(i);
  }
  expect(prompt).not.toContain('Memoria/istruzioni dell\'utente');
});

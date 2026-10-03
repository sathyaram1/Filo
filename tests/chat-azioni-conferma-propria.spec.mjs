// Le due azioni sulle schede che si confermano dalla loro UI (#825.3): il
// riordino ha il suo bottone, la cancellazione dall'archivio il suo pannello.
// In chat finivano come «Azione non riuscita» e sparivano; il pannello poi
// proponeva le prime 20 schede della ricerca invece delle pertinenti, tutte.

import { test, expect } from './fixtures/electron.mjs';
import { clickConfirm, fillConfirmInput, CONFIRM_HOST } from './helpers/confirm.mjs';

async function newtabPage(app) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const win = app.windows().find((w) => w.url().startsWith('filo://newtab'));
    if (win) { await win.waitForLoadState('domcontentloaded'); return win; }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('newtab non trovata');
}

async function configure(app) {
  await app.evaluate(async () => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test', tavily: '' },
      models: { ...globalThis.SN_TEST_MODELS.models, [C.ACTIONS.FILO_CHAT]: 'deepseek-flash' },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
    });
  });
}

// `giri`: una risposta per giro del modello di chat.
async function fakeChat(app, giri) {
  await app.evaluate(async (_electron, g) => {
    globalThis.__chatCalls = [];
    let n = 0;
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = async ({ attempts, messages, onDelta, onToolCall }) => {
      globalThis.__chatCalls.push(JSON.parse(JSON.stringify(messages)));
      const giro = g[Math.min(n, g.length - 1)];
      n += 1;
      const calls = giro.toolCalls || [];
      for (const c of calls) { try { onToolCall && onToolCall({ id: c.id, name: c.name }); } catch (_) {} }
      if (giro.text) { try { onDelta && onDelta(giro.text); } catch (_) {} }
      return {
        model: attempts[0].model, provider: attempts[0].provider, usage: {},
        text: giro.text || '', toolCalls: calls, reasoningDetails: [],
        finishReason: calls.length ? 'tool_calls' : 'stop',
      };
    };
  }, giri);
}

// Archivio finto: `schede` = [{ title, gatto, senzaVettore? }]. Il vettore dice
// «gatto» o «altro»; il giudice finto prende le righe col titolo sui gatti.
// `guasti`: quante chiamate del giudice falliscono prima di rispondere (con
// `guastiSu`, solo quelle che contengono quel testo); `ritardo`: ms per giudizio;
// `indiceGiu`: l'indicizzazione risponde con un errore di rete.
async function seedArchive(app, schede, { guasti = 0, guastiSu = '', ritardo = 0, indiceGiu = false } = {}) {
  await app.evaluate(async (_electron, { schede: s, guasti: g, guastiSu: su, ritardo: rit, giu }) => {
    const EM = globalThis.SN_TEST_MODELS.registry['qwen-embed'].model;
    const items = s.map((x, i) => ({
      id: `t${i}`, url: x.url || `https://sito${i}.example.com/`, title: x.title, favicon: '',
      closedAt: new Date(Date.now() - i * 1000).toISOString(), reason: 'manual', coOpenUrls: [],
      snippet: x.title,
      ...(x.senzaVettore ? {} : { embedding: x.gatto ? [127, 0] : [0, 127], embedModel: EM }),
    }));
    await chrome.storage.local.set({ [globalThis.SN_CONST.STORAGE_KEYS.ARCHIVED_TABS]: items });
    globalThis.SN_PROVIDER_OPENROUTER.embed = async ({ texts }) => {
      if (giu) throw new Error('fetch failed');
      return { vectors: texts.map(() => [1, 0]) };
    };
    globalThis.__giudice = { chiamate: 0, guasti: g, testi: [] };
    globalThis.SN_PROVIDERS.completeWithFallback = async ({ attempts, messages }) => {
      const sys = String(messages[0] && messages[0].content || '');
      const out = (text) => ({ text, provider: attempts[0].provider, model: attempts[0].model, usage: {} });
      if (!/eliminare dall'archivio/.test(sys)) return out('{}');
      globalThis.__giudice.chiamate += 1;
      const user = String(messages[1].content || '');
      globalThis.__giudice.testi.push(user);
      if (rit) await new Promise((r) => setTimeout(r, rit));
      if (globalThis.__giudice.guasti > 0 && (!su || user.includes(su))) { globalThis.__giudice.guasti -= 1; throw new Error('rete giù'); }
      const presi = [...user.matchAll(/^#(\d+) (.*)$/gm)].filter((m) => /gatt/i.test(m[2])).map((m) => Number(m[1]));
      return out(JSON.stringify({ pertinenti: presi }));
    };
  }, { schede, guasti, guastiSu, ritardo, giu: indiceGiu });
}

const archiviate = (app) => app.evaluate(async () => (await globalThis.SN_ARCHIVED_TABS.list()).map((x) => x.title));

async function chiedi(page, testo) {
  await page.locator('#input').fill(testo);
  await page.locator('#sendBtn').click();
}

test('«fai pulizia delle schede»: il bottone del riordino c\'è, e confermato lo sa il diario e il modello', async ({ app, shell }) => {
  test.setTimeout(60_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);
  await expect(page.locator('#input')).toBeVisible();
  await configure(app);
  await fakeChat(app, [
    { toolCalls: [{ id: 'p1', name: 'PULISCI_TAB', arguments: '{}' }] },
    { text: 'Valuto le schede e archivio quelle che non servono.' },
    { text: 'Fatto.' },
  ]);
  await app.evaluate(({ BrowserWindow }) => {
    globalThis.__triage = 0;
    for (const w of BrowserWindow.getAllWindows()) {
      if (w._filoTabs) w._filoTabs.runAutoTriage = async () => { globalThis.__triage += 1; return { archived: 2 }; };
    }
  });

  await chiedi(page, 'fai pulizia delle schede');
  await expect(page.locator('.dash-bubble-filo', { hasText: 'Valuto le schede' })).toBeVisible({ timeout: 10_000 });
  const btn = page.locator('.dash-action-btn', { hasText: 'Riordina e archivia le schede' });
  await expect(btn).toBeVisible();

  const activity = page.locator('.dash-activity');
  await activity.locator('.dash-activity-head').click();
  const body = activity.locator('.dash-activity-body');
  await expect(body).not.toContainText('non riuscita');
  await expect(body.locator('.dash-activity-row', { hasText: 'Conferma chiesta · Riordinare le schede' })).toHaveCount(1);
  // Nessun popup si apre da solo: il riordino parte al clic.
  await expect(page.locator(CONFIRM_HOST)).toHaveCount(0);

  await btn.click();
  await clickConfirm(page, 'ok');
  await expect(page.locator('.dash-action-btn', { hasText: '✓ Archiviate 2 schede' })).toBeVisible({ timeout: 5_000 });
  expect(await app.evaluate(() => globalThis.__triage)).toBe(1);
  await expect(body.locator('.dash-activity-row', { hasText: 'Schede riordinate · 2 archiviate' })).toHaveCount(1);

  // Al turno dopo il modello sa che è fatto, invece di crederlo in attesa.
  await chiedi(page, 'grazie');
  await expect(page.locator('.dash-bubble-filo', { hasText: 'Fatto.' })).toBeVisible({ timeout: 10_000 });
  const ultimo = await app.evaluate(() => JSON.stringify(globalThis.__chatCalls[globalThis.__chatCalls.length - 1]));
  expect(ultimo).toContain('CONFERMATO');
  expect(ultimo).toContain('Schede riordinate: archiviate 2');
});

test('«cancella dall\'archivio le pagine sui gatti»: il pannello propone solo le schede sui gatti, anche quelle senza indice', async ({ app, shell }) => {
  test.setTimeout(60_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);
  await expect(page.locator('#input')).toBeVisible();
  await configure(app);
  const schede = [];
  for (let i = 0; i < 27; i++) schede.push({ title: `Ricetta numero ${i}`, gatto: false });
  schede.splice(4, 0, { title: 'Gatti persiani', gatto: true });
  schede.splice(17, 0, { title: 'Cibo per gatti', gatto: true });
  // Appena archiviata: il vettore non c'è ancora, ma è sui gatti lo stesso.
  schede.push({ title: 'Gattini in adozione', senzaVettore: true });
  await seedArchive(app, schede);
  await fakeChat(app, [
    { toolCalls: [{ id: 'c1', name: 'CANCELLA_ARCHIVIO', arguments: '{"query":"pagine sui gatti"}' }] },
    { text: 'Ecco le schede sui gatti: l\'eliminazione è definitiva.' },
  ]);

  await chiedi(page, 'cancella dall\'archivio le pagine sui gatti');
  await expect(page.locator('.dash-bubble-filo', { hasText: 'Ecco le schede sui gatti' })).toBeVisible({ timeout: 10_000 });
  const panel = page.locator('.dash-delete-panel');
  await expect(panel.locator('.dash-delete-note')).toHaveText(/Trovate 3 schede pertinenti a “pagine sui gatti”/, { timeout: 10_000 });
  await expect(panel.locator('.dash-delete-list li')).toHaveText(['Gatti persiani', 'Cibo per gatti', 'Gattini in adozione']);
  const activity = page.locator('.dash-activity');
  await activity.locator('.dash-activity-head').click();
  await expect(activity.locator('.dash-activity-body')).not.toContainText('non riuscita');

  await panel.locator('.dash-action-btn-danger', { hasText: 'Elimina definitivamente 3 schede' }).click();
  await expect(page.locator(CONFIRM_HOST)).toBeVisible();
  await fillConfirmInput(page, 'conferma');
  await clickConfirm(page, 'danger');
  await expect(panel.locator('.dash-delete-note')).toHaveText('✓ Eliminate definitivamente 3 schede.', { timeout: 5_000 });
  const rimaste = await archiviate(app);
  expect(rimaste).toHaveLength(27);
  expect(rimaste.filter((t) => /gatt/i.test(t))).toEqual([]);
  await expect(activity.locator('.dash-activity-row', { hasText: 'Eliminate dall’archivio · 3 schede' })).toHaveCount(1);
});

test('più di 20 schede pertinenti: il pannello le propone e le elimina tutte', async ({ app, shell }) => {
  test.setTimeout(60_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);
  await expect(page.locator('#input')).toBeVisible();
  await configure(app);
  const schede = [];
  for (let i = 0; i < 70; i++) schede.push(i % 3 === 0 ? { title: `Altro ${i}`, gatto: false } : { title: `Gatto ${i}`, gatto: true });
  const gatti = schede.filter((x) => x.gatto).length;
  // Il primo giudizio fallisce due volte (il tentativo e la ripresa): «Riprova» lo rifà.
  await seedArchive(app, schede, { guasti: 2 });
  await fakeChat(app, [
    { toolCalls: [{ id: 'c2', name: 'CANCELLA_ARCHIVIO', arguments: '{"query":"gatti"}' }] },
    { text: 'Ecco cosa eliminerei.' },
  ]);

  await chiedi(page, 'elimina dall\'archivio tutto sui gatti');
  const panel = page.locator('.dash-delete-panel');
  await expect(panel.locator('.dash-delete-note')).toHaveText(/Non sono riuscito a capire quali schede riguardano “gatti”/, { timeout: 10_000 });
  await expect(panel.locator('.dash-action-btn-danger')).toHaveCount(0);
  await panel.locator('.dash-action-btn', { hasText: 'Riprova' }).click();

  await expect(panel.locator('.dash-delete-note')).toHaveText(new RegExp(`Trovate ${gatti} schede pertinenti`), { timeout: 10_000 });
  await expect(panel.locator('.dash-delete-list li')).toHaveCount(gatti);
  await expect(panel.locator('.dash-action-btn', { hasText: 'Riprova' })).toHaveCount(0);
  await panel.locator('.dash-action-btn-danger', { hasText: `Elimina definitivamente ${gatti} schede` }).click();
  await fillConfirmInput(page, 'conferma');
  await clickConfirm(page, 'danger');
  await expect(panel.locator('.dash-delete-note')).toHaveText(`✓ Eliminate definitivamente ${gatti} schede.`, { timeout: 5_000 });
  const rimaste = await archiviate(app);
  expect(rimaste).toHaveLength(70 - gatti);
  expect(rimaste.every((t) => t.startsWith('Altro'))).toBe(true);
});

test('titolo lungo nell\'elenco: il pannello di cancellazione resta dentro la bolla di Filo', async ({ app, shell }) => {
  test.setTimeout(60_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);
  await expect(page.locator('#input')).toBeVisible();
  await configure(app);
  await seedArchive(app, [
    { title: 'Gatti persiani: carattere, cura del pelo e alimentazione, guida completa per chi vuole adottarne uno', gatto: true },
    { title: 'Cibo per gatti', gatto: true },
    { title: 'Ricetta della torta', gatto: false },
  ]);
  await fakeChat(app, [
    { toolCalls: [{ id: 'c3', name: 'CANCELLA_ARCHIVIO', arguments: '{"query":"gatti"}' }] },
    { text: 'Ecco le schede sui gatti.' },
  ]);

  await chiedi(page, 'cancella dall\'archivio le pagine sui gatti');
  const panel = page.locator('.dash-delete-panel');
  await expect(panel.locator('.dash-delete-list li')).toHaveCount(2, { timeout: 15_000 });
  const destra = (loc) => loc.evaluate((el) => el.getBoundingClientRect().right);
  const bolla = page.locator('.dash-bubble-filo', { has: panel });
  expect(await destra(panel)).toBeLessThanOrEqual(await destra(bolla));
});

// L'assistente sulla pagina conferma col popup generico: il riordino lì si
// esegue davvero, la cancellazione (che vuole l'elenco davanti) non si propone.
test('assistente sulla pagina: il riordino confermato parte, la cancellazione dall\'archivio non chiede un sì a vuoto', async ({ app, shell }) => {
  test.setTimeout(30_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);
  await app.evaluate(({ BrowserWindow }) => {
    globalThis.__triage = 0;
    for (const w of BrowserWindow.getAllWindows()) {
      if (w._filoTabs) w._filoTabs.runAutoTriage = async () => { globalThis.__triage += 1; return { archived: 1 }; };
    }
  });
  await seedArchive(app, [{ title: 'Gatti persiani', gatto: true }]);
  const invia = (type, action) => page.evaluate(([t, a]) => chrome.runtime.sendMessage({ type: t, action: a, assistente: true }), [type, action]);

  const riordino = { type: 'PULISCI_TAB' };
  expect((await invia('filo_run_action', riordino)).needsConfirm).toBeTruthy();
  const fatto = await invia('filo_confirm_action', riordino);
  expect(fatto).toMatchObject({ executed: true, output: { archived: 1 } });
  expect(await app.evaluate(() => globalThis.__triage)).toBe(1);

  const cancella = { type: 'CANCELLA_ARCHIVIO', query: 'gatti' };
  const r = await invia('filo_run_action', cancella);
  expect(r.needsConfirm).toBeFalsy();
  expect(r.output).toMatchObject({ rifiuto: true });
  expect(r.output.error).toContain('home');
  expect((await invia('filo_confirm_action', cancella)).executed).toBe(false);
  expect(await archiviate(app)).toEqual(['Gatti persiani']);
});


test('archivio grande: mentre giudica il pannello dice quante schede ha guardato, e «Riprova» rifà solo i blocchi mancati', async ({ app, shell }) => {
  test.setTimeout(60_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);
  await expect(page.locator('#input')).toBeVisible();
  await configure(app);
  const schede = [{ title: 'Gatti persiani', gatto: true }];
  for (let i = 0; i < 200; i++) schede.push({ title: i === 120 ? 'Gatto vecchio' : `Vecchia ${i}`, senzaVettore: true });
  // Il blocco con «Vecchia 199» fallisce al tentativo e alla ripresa.
  await seedArchive(app, schede, { guasti: 2, guastiSu: 'Vecchia 199', ritardo: 300 });
  await fakeChat(app, [
    { toolCalls: [{ id: 'c4', name: 'CANCELLA_ARCHIVIO', arguments: '{"query":"gatti"}' }] },
    { text: 'Ecco.' },
  ]);

  await chiedi(page, 'cancella dall\'archivio le pagine sui gatti');
  const note = page.locator('.dash-delete-panel .dash-delete-note');
  await expect(note).toContainText(/\d+ di 201 schede guardate/, { timeout: 10_000 });
  await expect(note).toHaveText(/Non sono riuscito a capire/, { timeout: 10_000 });
  const prima = await app.evaluate(() => globalThis.__giudice.chiamate);

  await page.locator('.dash-delete-panel .dash-action-btn', { hasText: 'Riprova' }).click();
  await expect(note).toHaveText(/Trovate 2 schede pertinenti/, { timeout: 10_000 });
  await expect(page.locator('.dash-delete-list li')).toHaveText(['Gatti persiani', 'Gatto vecchio']);
  expect(await app.evaluate(() => globalThis.__giudice.chiamate)).toBe(prima + 1);
});

test('una scheda proposta per sbaglio si toglie dall\'elenco e resta; senza spunte non si elimina niente', async ({ app, shell }) => {
  test.setTimeout(60_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);
  await expect(page.locator('#input')).toBeVisible();
  await configure(app);
  const lungo = 'Gatti persiani: carattere, cura del pelo e alimentazione, guida completa per chi vuole adottarne uno';
  // «Gattopardo» è un romanzo, ma il giudice finto lo prende.
  await seedArchive(app, [
    { title: lungo, gatto: true },
    { title: 'Il Gattopardo, recensione', gatto: true },
    { title: 'Ricetta della torta', gatto: false },
  ]);
  await fakeChat(app, [
    { toolCalls: [{ id: 'c5', name: 'CANCELLA_ARCHIVIO', arguments: '{"query":"gatti"}' }] },
    { text: 'Ecco.' },
  ]);

  await chiedi(page, 'cancella dall\'archivio le pagine sui gatti');
  const panel = page.locator('.dash-delete-panel');
  const righe = panel.locator('.dash-delete-list li');
  await expect(righe).toHaveCount(2, { timeout: 15_000 });
  // Il titolo accorciato coi puntini si legge intero al passaggio.
  expect(await righe.first().getAttribute('title')).toContain(lungo);

  const del = panel.locator('.dash-action-btn-danger');
  await righe.nth(0).getByRole('checkbox').uncheck();
  await righe.nth(1).getByRole('checkbox').uncheck();
  await expect(del).toBeDisabled();
  await expect(del).toHaveText('🗑 Elimina definitivamente 0 schede');
  await righe.nth(0).getByRole('checkbox').check();
  await expect(del).toHaveText('🗑 Elimina definitivamente 1 scheda');

  await del.click();
  await fillConfirmInput(page, 'conferma');
  await clickConfirm(page, 'danger');
  await expect(panel.locator('.dash-delete-note')).toHaveText('✓ Eliminata definitivamente 1 scheda.', { timeout: 5_000 });
  expect((await archiviate(app)).sort()).toEqual(['Il Gattopardo, recensione', 'Ricetta della torta']);
});

test('chat riaperta dall\'archivio: racconta la cancellazione confermata, non il riordino mai premuto', async ({ app, shell }) => {
  test.setTimeout(60_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);
  await expect(page.locator('#input')).toBeVisible();
  await app.evaluate(() => globalThis.SN_FILO_MEMORY.setOnboarding({ done: true, ticked: [], thread: [] }));
  await configure(app);
  await seedArchive(app, [{ title: 'Gatti persiani', gatto: true }, { title: 'Torta', gatto: false }]);
  await fakeChat(app, [
    { toolCalls: [{ id: 'p6', name: 'PULISCI_TAB', arguments: '{}' }, { id: 'c6', name: 'CANCELLA_ARCHIVIO', arguments: '{"query":"gatti"}' }] },
    { text: 'Ecco.' },
  ]);

  await chiedi(page, 'fai pulizia delle schede e cancella dall\'archivio le pagine sui gatti');
  const panel = page.locator('.dash-delete-panel');
  await expect(panel.locator('.dash-delete-list li')).toHaveCount(1, { timeout: 15_000 });
  const chat = () => app.evaluate(() => globalThis.SN_FILO_CHATS.list().then((l) => l[0]));
  await expect.poll(async () => ((await chat()) || { messages: [] }).messages.length, { timeout: 5_000 }).toBe(2);
  // Il turno salvato non dice fatto ciò che aspetta ancora un clic.
  expect((await chat()).messages[1].actions || []).toEqual([]);

  await panel.locator('.dash-action-btn-danger').click();
  await fillConfirmInput(page, 'conferma');
  await clickConfirm(page, 'danger');
  await expect(panel.locator('.dash-delete-note')).toHaveText('✓ Eliminata definitivamente 1 scheda.', { timeout: 5_000 });
  await expect.poll(async () => (await chat()).messages.flatMap((m) => m.actions || []), { timeout: 5_000 }).toEqual(['CANCELLA_ARCHIVIO']);

  const { id } = await chat();
  await app.evaluate((_e, chatId) => globalThis.SN_CLOSE_FILO_CHAT(chatId), id);
  await page.goto(`filo://dashboard/dashboard.html?chat=${encodeURIComponent(id)}`);
  await expect(page.locator('.dash-bubble')).toHaveCount(2, { timeout: 8_000 });
  const racconto = (await page.locator('.dash-bubble-note[data-replay]').allTextContents()).join(' | ');
  expect(racconto).toContain('eliminato schede dall\'archivio');
  expect(racconto).not.toContain('riordinato');
});

test('indicizzazione giù: il pannello propone lo stesso le schede pertinenti', async ({ app, shell }) => {
  test.setTimeout(60_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);
  await expect(page.locator('#input')).toBeVisible();
  await configure(app);
  await seedArchive(app, [{ title: 'Gatti persiani', gatto: true }, { title: 'Torta', gatto: false }], { indiceGiu: true });
  await fakeChat(app, [
    { toolCalls: [{ id: 'c7', name: 'CANCELLA_ARCHIVIO', arguments: '{"query":"gatti"}' }] },
    { text: 'Ecco.' },
  ]);

  await chiedi(page, 'cancella dall\'archivio le pagine sui gatti');
  const panel = page.locator('.dash-delete-panel');
  await expect(panel.locator('.dash-delete-note')).toHaveText(/Trovata 1 scheda pertinente/, { timeout: 15_000 });
  await expect(panel.locator('.dash-delete-list li')).toHaveText(['Gatti persiani']);
});

test('le pagine della rete di casa si propongono per parole, senza passare dal modello', async ({ app, shell }) => {
  test.setTimeout(60_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);
  await expect(page.locator('#input')).toBeVisible();
  await configure(app);
  await seedArchive(app, [
    { title: 'Gatti persiani', gatto: true },
    { title: 'Telecamera del gattino', gatto: true, url: 'http://192.168.1.20/' },
    { title: 'Pannello del router', gatto: false, url: 'http://192.168.1.1/' },
  ]);
  await fakeChat(app, [
    { toolCalls: [{ id: 'c8', name: 'CANCELLA_ARCHIVIO', arguments: '{"query":"pagine sui gatti"}' }] },
    { text: 'Ecco.' },
  ]);

  await chiedi(page, 'cancella dall\'archivio le pagine sui gatti');
  const panel = page.locator('.dash-delete-panel');
  await expect(panel.locator('.dash-delete-list li')).toHaveText(['Gatti persiani', 'Telecamera del gattino'], { timeout: 15_000 });
  const alGiudice = await app.evaluate(() => globalThis.__giudice.testi.join('\n'));
  expect(alGiudice).toContain('Gatti persiani');
  expect(alGiudice).not.toContain('192.168');
  expect(alGiudice).not.toContain('Telecamera');
});

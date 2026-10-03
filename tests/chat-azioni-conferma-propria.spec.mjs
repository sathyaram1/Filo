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
// `guasti`: quante chiamate del giudice falliscono prima di rispondere.
async function seedArchive(app, schede, { guasti = 0 } = {}) {
  await app.evaluate(async (_electron, { schede: s, guasti: g }) => {
    const EM = globalThis.SN_TEST_MODELS.registry['qwen-embed'].model;
    const items = s.map((x, i) => ({
      id: `t${i}`, url: `https://sito${i}.example.com/`, title: x.title, favicon: '',
      closedAt: new Date(Date.now() - i * 1000).toISOString(), reason: 'manual', coOpenUrls: [],
      snippet: x.title,
      ...(x.senzaVettore ? {} : { embedding: x.gatto ? [127, 0] : [0, 127], embedModel: EM }),
    }));
    await chrome.storage.local.set({ [globalThis.SN_CONST.STORAGE_KEYS.ARCHIVED_TABS]: items });
    globalThis.SN_PROVIDER_OPENROUTER.embed = async ({ texts }) => ({ vectors: texts.map(() => [1, 0]) });
    globalThis.__giudice = { chiamate: 0, guasti: g };
    globalThis.SN_PROVIDERS.completeWithFallback = async ({ attempts, messages }) => {
      const sys = String(messages[0] && messages[0].content || '');
      const out = (text) => ({ text, provider: attempts[0].provider, model: attempts[0].model, usage: {} });
      if (!/eliminare dall'archivio/.test(sys)) return out('{}');
      globalThis.__giudice.chiamate += 1;
      if (globalThis.__giudice.guasti > 0) { globalThis.__giudice.guasti -= 1; throw new Error('rete giù'); }
      const user = String(messages[1].content || '');
      const presi = [...user.matchAll(/^#(\d+) (.*)$/gm)].filter((m) => /gatt/i.test(m[2])).map((m) => Number(m[1]));
      return out(JSON.stringify({ pertinenti: presi }));
    };
  }, { schede, guasti });
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

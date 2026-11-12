// #845 — «Aperti per dopo» a parole. Dall'Aiuto sopra una pagina «salvala per dopo» fa quello del menu (voce con
// titolo, indirizzo e miniatura, poi la scheda si chiude); dalla chat della home una domanda su una pagina salvata
// la ritrova con un bottone che la apre e la toglie dalla lista, «aprila» fa lo stesso, e se non c'è lo si dice.
// Senza il lavoro di #845 ogni prova è rossa: gli strumenti e l'azione dell'Aiuto non esistevano.

import { test, expect } from './helpers/reteFinta.mjs';
import { home, modelloFinto, chiamateAlModello, ripristina, chiedi } from './helpers/chatFinta.mjs';
import { paginaDellAiuto } from './helpers/riquadri.mjs';

// Le tre pagine salvate stanno sulla rete finta: aprirle carica una pagina vera, non una d'errore.
function pagineDi(rete) {
  const RICETTA = rete.pagina('articolo.test', '/ricette/pasta-alla-carbonara-classica-romana', '<title>Carbonara</title><p>ok</p>');
  const LAGO = rete.pagina('sito.test', '/lazio/bolsena-piazzole-sul-lago', '<title>Bolsena</title><p>ok</p>');
  const SAPONE = rete.pagina('example.org', '/fai-da-te/ricetta-sapone-di-marsiglia', '<title>Sapone</title><p>ok</p>');
  return {
    RICETTA, LAGO, SAPONE,
    SALVATE: [
      { id: 'p1', url: RICETTA, title: 'Pasta alla carbonara classica romana - Cucina', favicon: '', thumbnail: '', savedAt: '2026-10-03T10:00:00.000Z', category: 'Cucina', categoryConfidence: null },
      { id: 'p2', url: LAGO, title: 'Campeggio sul lago di Bolsena: le piazzole', favicon: '', thumbnail: '', savedAt: '2026-10-02T10:00:00.000Z', category: null, categoryConfidence: null },
      { id: 'p3', url: SAPONE, title: 'Ricetta del sapone di Marsiglia fatto in casa', favicon: '', thumbnail: '', savedAt: '2026-10-01T10:00:00.000Z', category: null, categoryConfidence: null },
    ],
  };
}

const semina = (app, pagine) => app.evaluate(async (_e, p) => {
  await globalThis.chrome.storage.local.set({ [globalThis.SN_CONST.STORAGE_KEYS.SAVED_PAGES]: p });
}, pagine);
const salvate = (app) => app.evaluate(async () => (await globalThis.SN_SAVED_PAGES.list()).map((p) => p.id));
const schedaAperta = (shell, url) => shell.evaluate(async (u) => (await window.filoShell.tabs.snapshot()).tabs.some((t) => t.url === u), url);
const esitoDelloStrumento = (messaggi) => (messaggi || []).filter((m) => m.role === 'tool').map((m) => String(m.content || '')).join('\n');

test('dalla chat: la ricetta salvata torna col suo bottone, che la apre e la toglie dalla lista', async ({ app, shell, rete }) => {
  test.setTimeout(90_000);
  const { RICETTA, SAPONE, SALVATE } = pagineDi(rete);
  await semina(app, SALVATE);
  try {
    await modelloFinto(app, [
      { toolCalls: [{ id: 's1', name: 'CERCA_SALVATE', arguments: JSON.stringify({ cerca: 'ricetta' }) }] },
      { text: 'L\'avevi salvata il 3 ottobre: è «Pasta alla carbonara classica romana».' },
    ]);
    const page = await home(app);
    await chiedi(page, 'dov\'era quella ricetta che avevo salvato?');

    // Un bottone solo: la pagina che la risposta nomina, non l'altra «ricetta» trovata (il sapone).
    const bottone = page.locator('.dash-bubble-actions .dash-salvata-btn');
    await expect(bottone).toHaveCount(1, { timeout: 20_000 });
    await expect(bottone).toContainText('Pasta alla carbonara classica romana');
    await expect(bottone).toHaveAttribute('data-url', RICETTA);
    await expect(page.locator('.dash-bubble-actions .dash-salvata-btn', { hasText: 'sapone' })).toHaveCount(0);

    // Al modello sono arrivate le due pagine che hanno «ricetta» nel titolo o nell'indirizzo, con id e categoria.
    const esito = esitoDelloStrumento((await chiamateAlModello(app))[1]);
    expect(esito).toContain('[p1] Pasta alla carbonara classica romana');
    expect(esito).toContain('categoria Cucina');
    expect(esito).toContain(SAPONE);
    expect(esito).not.toContain('Bolsena');
    expect(esito).toContain('(2 su 3)');
    await page.screenshot({ path: 'tests/.shots/salvate-chat-bottone.png' });

    // Tasto destro: si apre tenendola in lista, come dal menu di «Aperti per dopo».
    await bottone.click({ button: 'right' });
    await page.locator('.sn-rinomina-menu .sn-select-option', { hasText: 'Apri e tienila in lista' }).click();
    await expect.poll(() => schedaAperta(shell, RICETTA), { timeout: 10_000 }).toBe(true);
    expect(await salvate(app)).toEqual(['p1', 'p2', 'p3']);

    // Il clic fa quello della lista: la apre e la toglie.
    await page.bringToFront();
    await bottone.click();
    await expect.poll(() => salvate(app), { timeout: 10_000 }).toEqual(['p2', 'p3']);
    await expect(bottone).toHaveClass(/dash-salvata-aperta/);
    await page.bringToFront();
    await shell.evaluate(() => window.filoShell.message({ type: 'update_settings', settings: { theme: 'dark' } }));
    await page.mouse.move(5, 5);
    await page.waitForTimeout(600);
    await page.screenshot({ path: 'tests/.shots/salvate-chat-bottone-scuro.png' });
  } finally {
    await ripristina(app);
  }
});

test('«aprila» al turno dopo: la pagina trovata si apre e lascia la lista; con «tienila» resta', async ({ app, shell, rete }) => {
  test.setTimeout(90_000);
  const { RICETTA, LAGO, SALVATE } = pagineDi(rete);
  await semina(app, SALVATE);
  try {
    await modelloFinto(app, [
      { toolCalls: [{ id: 's1', name: 'CERCA_SALVATE', arguments: JSON.stringify({ cerca: 'campeggio' }) }] },
      { text: 'Hai salvato «Campeggio sul lago di Bolsena: le piazzole».' },
      { toolCalls: [{ id: 'a1', name: 'APRI_SALVATA', arguments: JSON.stringify({ id: 'p2' }) }] },
      { text: 'Fatto.' },
      { toolCalls: [{ id: 'a2', name: 'APRI_SALVATA', arguments: JSON.stringify({ id: 'p1', tieni: 'true' }) }] },
      { text: 'Aperta, ed è rimasta in lista.' },
    ]);
    const page = await home(app);
    // «Aperti per dopo» resta aperta in un'altra scheda: tornandoci non deve mostrare la pagina che la chat ha aperto.
    await shell.evaluate(() => window.filoShell.tabs.open('filo://home/home.html'));
    let lista = null;
    await expect.poll(() => { lista = app.windows().find((w) => w.url().startsWith('filo://home/home.html')) || null; return !!lista; }, { timeout: 10_000 }).toBe(true);
    await expect(lista.locator('.sn-card')).toHaveCount(3, { timeout: 10_000 });
    const idDi = (prefisso) => shell.evaluate(async (p) => (await window.filoShell.tabs.snapshot()).tabs.find((t) => t.url.startsWith(p))?.id, prefisso);
    await shell.evaluate((id) => window.filoShell.tabs.activate(id), await idDi('filo://newtab'));
    await chiedi(page, 'aprimi le pagine salvate sul campeggio');
    await expect(page.locator('.dash-salvata-btn')).toHaveCount(1, { timeout: 20_000 });

    await chiedi(page, 'aprila');
    await expect.poll(() => schedaAperta(shell, LAGO), { timeout: 15_000 }).toBe(true);
    await expect.poll(() => salvate(app)).toEqual(['p1', 'p3']);
    // Il turno dopo ha ancora davanti quello che la ricerca aveva trovato: l'id viene da lì.
    const chiamate = await chiamateAlModello(app);
    expect(JSON.stringify(chiamate[2])).toContain('[p2] Campeggio sul lago di Bolsena');
    expect(esitoDelloStrumento(chiamate[3])).toContain('tolta da «Aperti per dopo»');
    await expect(page.locator('.dash-activity-row', { hasText: 'Aperta «Campeggio sul lago di Bolsena: le piazzole» · tolta da «Aperti per dopo»' })).toHaveCount(1, { timeout: 10_000 });
    await shell.evaluate((id) => window.filoShell.tabs.activate(id), await idDi('filo://home/home.html'));
    await expect(lista.locator('.sn-card')).toHaveCount(2, { timeout: 10_000 });
    await expect(lista.locator('.sn-card', { hasText: 'Bolsena' })).toHaveCount(0);
    await shell.evaluate((id) => window.filoShell.tabs.activate(id), await idDi('filo://newtab'));

    await page.bringToFront();
    await chiedi(page, 'apri anche la carbonara, ma tienila');
    await expect.poll(() => schedaAperta(shell, RICETTA), { timeout: 15_000 }).toBe(true);
    expect(await salvate(app)).toEqual(['p1', 'p3']);
    expect(esitoDelloStrumento((await chiamateAlModello(app))[5])).toContain('rimasta in «Aperti per dopo»');
  } finally {
    await ripristina(app);
  }
});

test('se la pagina salvata non c\'è, il modello lo sa e la chat non mostra bottoni', async ({ app, rete }) => {
  test.setTimeout(60_000);
  const { SALVATE } = pagineDi(rete);
  await semina(app, SALVATE);
  try {
    await modelloFinto(app, [
      { toolCalls: [{ id: 's1', name: 'CERCA_SALVATE', arguments: JSON.stringify({ cerca: 'astronomia' }) }] },
      { text: 'Fra le pagine salvate non ce n\'è nessuna sull\'astronomia.' },
      { toolCalls: [{ id: 's2', name: 'CERCA_SALVATE', arguments: JSON.stringify({ cerca: '' }) }] },
      { text: 'Hai salvato tre pagine.' },
      { toolCalls: [{ id: 'a1', name: 'APRI_SALVATA', arguments: JSON.stringify({ id: 'inventato' }) }] },
      { text: 'Non la trovo più.' },
    ]);
    const page = await home(app);
    await chiedi(page, 'aprimi quella pagina salvata sull\'astronomia');
    await expect(page.locator('.dash-bubble').filter({ hasText: 'non ce n\'è nessuna' })).toBeVisible({ timeout: 20_000 });
    expect(esitoDelloStrumento((await chiamateAlModello(app))[1])).toContain('Nessuna delle 3 pagine di «Aperti per dopo» ha "astronomia"');
    await expect(page.locator('.dash-salvata-btn')).toHaveCount(0);

    // Con la ricerca vuota tornano tutte, le più recenti prima.
    await chiedi(page, 'cosa ho salvato per dopo?');
    await expect(page.locator('.dash-bubble').filter({ hasText: 'Hai salvato tre pagine' })).toBeVisible({ timeout: 20_000 });
    const tutte = esitoDelloStrumento((await chiamateAlModello(app))[3]);
    expect(tutte.indexOf('[p1]')).toBeGreaterThan(-1);
    expect(tutte.indexOf('[p1]')).toBeLessThan(tutte.indexOf('[p2]'));
    expect(tutte.indexOf('[p2]')).toBeLessThan(tutte.indexOf('[p3]'));

    // Un id che non c'è: non si apre niente e il modello sa di dover ricercare.
    await chiedi(page, 'aprila');
    await expect(page.locator('.dash-bubble').filter({ hasText: 'Non la trovo più' })).toBeVisible({ timeout: 20_000 });
    expect(esitoDelloStrumento((await chiamateAlModello(app))[5])).toContain('Nessuna pagina con quell\'id');
    expect(await salvate(app)).toEqual(['p1', 'p2', 'p3']);

    // Con la lista vuota il modello lo sa, e sa come si salva.
    await semina(app, []);
    await modelloFinto(app, [
      { toolCalls: [{ id: 's3', name: 'CERCA_SALVATE', arguments: JSON.stringify({ cerca: 'ricetta' }) }] },
      { text: 'Non hai ancora salvato niente.' },
    ]);
    await chiedi(page, 'dov\'era la ricetta salvata?');
    await expect(page.locator('.dash-bubble').filter({ hasText: 'Non hai ancora salvato niente' })).toBeVisible({ timeout: 20_000 });
    expect(esitoDelloStrumento((await chiamateAlModello(app))[1])).toContain('«Aperti per dopo» è vuota');
  } finally {
    await ripristina(app);
  }
});

// I modelli accorciano i titoli e raccontano le pagine: il bottone non deve dipendere dalla citazione alla lettera.
test('la pagina nominata accorciata o raccontata ha comunque il suo bottone; una risposta che dice di no non ne ha', async ({ app, rete }) => {
  test.setTimeout(90_000);
  const CARBONARA = rete.pagina('cucina.test', '/ricette/carbonara', '<title>c</title>');
  const SAPONE = rete.pagina('example.org', '/fai-da-te/ricetta-sapone', '<title>s</title>');
  await semina(app, [
    { id: 'g1', url: CARBONARA, title: 'Spaghetti alla carbonara: la ricetta originale | Cucina Facile', favicon: '', thumbnail: '', savedAt: '2026-10-03T10:00:00.000Z', category: null },
    { id: 'g2', url: SAPONE, title: 'Ricetta del sapone di Marsiglia fatto in casa', favicon: '', thumbnail: '', savedAt: '2026-10-01T10:00:00.000Z', category: null },
  ]);
  const bottoniDi = (page, frase) => page.locator('.dash-bubble').filter({ hasText: frase }).locator('.dash-salvata-btn');
  try {
    await modelloFinto(app, [
      { toolCalls: [{ id: 's1', name: 'CERCA_SALVATE', arguments: JSON.stringify({ cerca: 'ricetta' }) }] },
      { text: 'È «Spaghetti alla carbonara», salvata il 3 ottobre.' },
      { toolCalls: [{ id: 's2', name: 'CERCA_SALVATE', arguments: JSON.stringify({ cerca: 'carbonara' }) }] },
      { text: 'È la tua ricetta della carbonara, del 3 ottobre.' },
      { toolCalls: [{ id: 's3', name: 'CERCA_SALVATE', arguments: JSON.stringify({ cerca: 'ricetta' }) }] },
      { text: 'Sono due: la carbonara e il sapone di Marsiglia.' },
      { toolCalls: [{ id: 's4', name: 'CERCA_SALVATE', arguments: JSON.stringify({ cerca: 'carbonara' }) }] },
      { text: 'Di carbonara con le zucchine non ne hai salvate.' },
    ]);
    const page = await home(app);
    await chiedi(page, 'dov\'era quella ricetta che avevo salvato?');
    await expect(bottoniDi(page, 'salvata il 3 ottobre')).toHaveCount(1, { timeout: 20_000 });
    await expect(bottoniDi(page, 'salvata il 3 ottobre')).toHaveAttribute('data-url', CARBONARA);

    await chiedi(page, 'e la carbonara?');
    await expect(bottoniDi(page, 'del 3 ottobre')).toHaveCount(1, { timeout: 20_000 });
    await expect(bottoniDi(page, 'del 3 ottobre')).toHaveAttribute('data-url', CARBONARA);

    await chiedi(page, 'quali ricette ho salvato?');
    const due = bottoniDi(page, 'Sono due');
    await expect(due).toHaveCount(2, { timeout: 20_000 });
    await expect(due.nth(0)).toHaveAttribute('data-url', CARBONARA);
    await expect(due.nth(1)).toHaveAttribute('data-url', SAPONE);

    await chiedi(page, 'quella della carbonara con le zucchine?');
    await expect(page.locator('.dash-bubble').filter({ hasText: 'non ne hai salvate' })).toBeVisible({ timeout: 20_000 });
    await expect(bottoniDi(page, 'non ne hai salvate')).toHaveCount(0);
  } finally {
    await ripristina(app);
  }
});

// L'Aiuto ha la risposta già pronta: l'azione di pagina che salva.
async function aiutoCheSalva(app) {
  await app.evaluate(async () => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_FILO_MEMORY.setOnboarding({ done: true, ticked: [], thread: [] });
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      models: { [C.ACTIONS.FILO_CHAT]: 'deepseek-flash', [C.ACTIONS.HELP]: 'deepseek-flash' },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
    });
    const P = globalThis.SN_PROVIDERS;
    globalThis.__aiutoSistema = '';
    const risposta = ({ attempts, messages }) => {
      const sistema = String((messages.find((m) => m.role === 'system') || {}).content || '');
      const base = { model: attempts[0].model, provider: attempts[0].provider, usage: {} };
      if (!sistema.includes('# Protocollo di risposta')) return { ...base, text: '{"message":"Ciao.","suggestions":[],"issues":[]}' };
      globalThis.__aiutoSistema = sistema;
      return { ...base, text: JSON.stringify({ action: 'page', page: { op: 'save_page' }, text: 'La metto in «Aperti per dopo» e chiudo la scheda.', status: 'continue' }) };
    };
    P.completeWithFallback = async (o) => risposta(o);
    P.streamCompleteWithFallback = async (o) => risposta(o);
  });
}

test('dall\'Aiuto «salvala per dopo» fa la voce del menu, senza l\'Aiuto nella miniatura, e chiude la scheda', async ({ app, shell, rete }) => {
  test.setTimeout(60_000);
  await semina(app, []);
  // Pagina tutta bianca: un pixel scuro nella miniatura è l'Aiuto finito nella foto.
  const url = rete.pagina('articolo.test', '/ricetta', '<!doctype html><title>Ricetta della carbonara</title><meta name="description" content="La vera carbonara"><body style="margin:0;height:100vh;background:#fff"></body>');
  await shell.evaluate((u) => window.filoShell.tabs.open(u), url);
  let page = null;
  await expect.poll(() => { page = app.windows().find((w) => w.url() === url) || null; return !!page; }, { timeout: 10_000 }).toBe(true);
  await page.waitForFunction(() => document.documentElement.dataset.filoReady === '1', null, { timeout: 10_000 });
  await aiutoCheSalva(app);
  const id = await shell.evaluate(async () => (await window.filoShell.tabs.snapshot()).activeId);
  await shell.evaluate((t) => window.filoShell.tabs.help(t), id);
  // Su un sito l'Aiuto sta nello strato sopra la scheda (#1509.3), con gli stessi px della pagina.
  const aiuto = await paginaDellAiuto(app, page);
  await expect(aiuto.locator('.sn-sidebar')).toBeVisible({ timeout: 8_000 });
  const chiusa = page.waitForEvent('close', { timeout: 20_000 });
  await aiuto.waitForSelector('.sn-sidebar-input textarea', { timeout: 8_000 });
  await aiuto.fill('.sn-sidebar-input textarea', 'salvala per dopo');
  await aiuto.press('.sn-sidebar-input textarea', 'Enter');

  // L'Aiuto lo dice, la conferma è quella del menu, e la scheda si chiude (anche se il modello voleva proseguire).
  await expect(aiuto.locator('.sn-sidebar-log').last()).toContainText('pagina salvata in «Aperti per dopo»: chiudo la scheda', { timeout: 15_000 });
  await expect(page.locator('.sn-save-confirm')).toBeVisible();
  await expect(page.locator('.sn-save-confirm-cta')).toHaveCount(1);
  // La conferma sta a sinistra dell'Aiuto, non sopra la sua casella.
  await expect(page.locator('.sn-save-confirm.sn-save-confirm-visible')).toBeVisible();
  const conferma = await page.locator('.sn-save-confirm').boundingBox();
  const casella = await aiuto.locator('.sn-sidebar-input').boundingBox();
  expect(conferma.x + conferma.width).toBeLessThanOrEqual(casella.x);
  await page.waitForTimeout(400);
  await page.screenshot({ path: 'tests/.shots/salvate-aiuto-conferma.png' });
  await chiusa;

  const voce = await app.evaluate(async (_e, u) => (await globalThis.SN_SAVED_PAGES.list()).find((p) => p.url === u) || null, url);
  expect(voce, 'la pagina non è in «Aperti per dopo»').toBeTruthy();
  expect(voce.title).toBe('Ricetta della carbonara');
  expect(voce.thumbnail).toMatch(/^data:image\/jpeg;base64,/);
  const scuri = await app.evaluate(({ nativeImage }, t) => {
    const img = nativeImage.createFromDataURL(t);
    const b = img.toBitmap();
    let n = 0;
    for (let i = 0; i < b.length; i += 4) if (Math.min(b[i], b[i + 1], b[i + 2]) < 200) n++;
    return n;
  }, voce.thumbnail);
  expect(scuri, `pixel scuri nella miniatura: ${scuri}`).toBeLessThan(50);
  // Il modello sa che quest'azione esiste e che chiude la scheda.
  expect(await app.evaluate(() => globalThis.__aiutoSistema)).toContain('"save_page"');
});

test('dall\'Aiuto su una pagina di Filo «salvala» non salva e non chiude niente', async ({ app, openTab }) => {
  test.setTimeout(30_000);
  const page = await openTab('filo://newtab/');
  await page.waitForFunction(() => typeof window.__filoSidebarTest?.runPageAction === 'function', null, { timeout: 8000 });
  await semina(app, []);
  await page.evaluate(() => window.SN_SIDEBAR.open());
  const ok = await page.evaluate(() => window.__filoSidebarTest.runPageAction({ op: 'save_page' }));
  expect(ok).toBe(false);
  await expect(page.locator('.sn-sidebar-log').last()).toContainText('le pagine di Filo non si salvano per dopo');
  expect(await salvate(app)).toEqual([]);
  await expect(page.locator('.sn-save-confirm')).toHaveCount(0);
});

// #872 — il quaderno delle memorie: quello che Filo ha capito dell'utente, con la data e il salto al messaggio da cui è
// nato; si corregge (vale dal messaggio dopo), si toglie (resta fra le nascoste e non torna dallo stesso tratto), si
// rimette. Prende il posto della Cronologia: ogni strada che portava lì porta qui, e le schede chiuse di prima del filo
// si ritrovano cercando nel filo. Senza il quaderno ogni prova è rossa: la pagina non c'era e le note non avevano fonti.

import { test, expect } from './fixtures/electron.mjs';
import { barraPage, comandaBarra, pannelloFermo } from './helpers/barra.mjs';
import { clickConfirm } from './helpers/confirm.mjs';
import { menuDi } from './helpers/menuContestuale.mjs';

const QUADERNO = 'filo://quaderno/quaderno.html';

// Chat, lezioni e compattatore finti: la chat risponde, il creatore di lezioni impara «vegetariano» dal messaggio che lo
// dice, il compattatore porta la lezione fra le preferenze citandone il segno. Ogni prompt resta in __q_prompt.
async function configura(app, { compattatore = 'PREFERENZE:\nÈ vegetariano (fonti: L1)' } = {}) {
  await app.evaluate(async (_e, uscitaCompattatore) => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      models: {
        [C.ACTIONS.FILO_CHAT]: 'deepseek-flash', [C.ACTIONS.FILO_CHAT_TRIAGE]: 'deepseek-flash', [C.ACTIONS.FILO_DASHBOARD]: 'deepseek-flash',
        [C.ACTIONS.FILO_LESSON]: 'deepseek-flash', [C.ACTIONS.FILO_COMPACT]: 'deepseek-flash',
      },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
    });
    globalThis.__q_prompt = [];
    globalThis.__q_compattatore = uscitaCompattatore;
    const rispondi = async ({ attempts, messages }) => {
      const joined = messages.map((m) => (typeof m.content === 'string' ? m.content : JSON.stringify(m.content))).join('\n');
      const base = { model: attempts[0].model, provider: attempts[0].provider, usage: {}, toolCalls: [], reasoningDetails: [], finishReason: 'stop' };
      if (joined.includes('analizzare l\'ultima interazione')) {
        return { ...base, text: /UTENTE: [^\n]*vegetarian/i.test(joined) ? 'LEZIONE: L’utente è vegetariano.' : 'NULLA DA IMPARARE' };
      }
      if (joined.includes('integrare le nuove lezioni')) {
        // Un compattatore lento, quando la prova lo trattiene: l'utente intanto lavora nel quaderno.
        if (globalThis.__q_attesa) await globalThis.__q_attesa;
        return { ...base, text: globalThis.__q_compattatore };
      }
      if (joined.includes('Classifichi le conversazioni')) return { ...base, text: JSON.stringify({ tipo: 'conversazione', titolo: 'Cibo' }) };
      globalThis.__q_prompt.push(joined);
      // Un giro con le azioni che il modello emette, se la prova le ha messe in fila.
      const giro = (globalThis.__q_giri || []).shift();
      if (giro && giro.toolCalls) return { ...base, text: '', toolCalls: giro.toolCalls, finishReason: 'tool_calls' };
      return { ...base, text: (giro && giro.text) || 'Ne terrò conto.' };
    };
    globalThis.SN_PROVIDERS.completeWithFallback = rispondi;
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = rispondi;
  }, compattatore);
}

const turno = (app, chatId, userMessage) => app.evaluate(
  (_e, a) => globalThis.SN_HANDLE_FILO_CHAT({ userMessage: a.userMessage, threadHistory: [], chatId: a.chatId }),
  { chatId, userMessage },
);
const memoria = (app) => app.evaluate(() => globalThis.SN_FILO_MEMORY.getMemory());
// La memoria che il modello ha davanti: quella del CONTESTO e le righe arrivate dopo nei messaggi, ognuna nella sua
// busta (#1562).
const memoriaNelPrompt = (prompt) => [...String(prompt).matchAll(/<<<MEMORIA_FILO>>>([\s\S]*?)<<<FINE_MEMORIA_FILO>>>/g)].map((m) => m[1]).join('\n');
const lezioni = (app) => app.evaluate(() => globalThis.SN_FILO_MEMORY.getLessonsBuffer());
// Una riga per il suo testo intero: «È vegetariano» è anche dentro «L’utente è vegetariano.».
const esatto = (t) => new RegExp(`^${t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`);
const riga = (page, testo) => page.locator('.qd-riga').filter({ has: page.locator('.qd-testo', { hasText: esatto(testo) }) });
const vociMenu = (page, testo) => page.evaluate((t) => {
  const el = [...document.querySelectorAll('.qd-riga')].find((r) => r.querySelector('.qd-testo').textContent === t);
  return (window.SN_VOCI_PAGINA || []).flatMap((f) => f(el) || []).map((v) => v.label);
}, testo);

async function finestraCon(app, prova) {
  let w = null;
  await expect.poll(() => Boolean(w = app.windows().find((x) => { try { return prova(x.url()); } catch (_) { return false; } })), { timeout: 10_000 }).toBe(true);
  await w.waitForLoadState('domcontentloaded');
  return w;
}

test('dico in chat che sono vegetariano: dopo il compattatore il quaderno lo mostra con la data, e il clic porta il filo a quel messaggio', async ({ app, shell, openTab }) => {
  test.setTimeout(90_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  await configura(app);
  await turno(app, 'chat-cibo', 'Ti dico una cosa: sono vegetariano');
  await expect.poll(async () => (await lezioni(app)).map((l) => l.text), { timeout: 10_000 }).toEqual(['L’utente è vegetariano.']);
  const [lezione] = await lezioni(app);
  expect(lezione.fonti.length).toBe(2);

  const page = await openTab(QUADERNO);
  // Prima del riordino è fra le cose imparate da poco, già col suo collegamento.
  await expect(page.locator('.qd-gruppo', { hasText: 'Imparato da poco' }).locator(riga(page, 'L’utente è vegetariano.'))).toHaveCount(1, { timeout: 8_000 });
  await page.evaluate((m) => chrome.runtime.sendMessage({ type: m }), 'filo_compact_memory');
  expect((await memoria(app)).PREFERENZE).toBe('È vegetariano');
  const pref = page.locator('.qd-gruppo', { hasText: 'Cosa preferisci' });
  const nota = pref.locator('.qd-riga').filter({ has: page.locator('.qd-testo', { hasText: esatto('È vegetariano') }) });
  await expect(nota).toHaveCount(1, { timeout: 8_000 });
  await expect(page.locator('.qd-gruppo', { hasText: 'Imparato da poco' })).toHaveCount(0);
  const data = nota.locator('.qd-salto');
  await expect(data).toHaveText(/^oggi, \d{2}:\d{2}$/);
  await expect(data).toHaveAttribute('title', /Vai alla conversazione da cui è nata/);

  await data.click();
  const home = await finestraCon(app, (u) => u.includes('evento='));
  const bolla = home.locator('.dash-trovato');
  await expect(bolla).toHaveCount(1, { timeout: 10_000 });
  await expect(bolla).toContainText('sono vegetariano');
  await expect(bolla).toBeInViewport();
});

test('correggo in «vegano»: al turno dopo Filo usa la correzione, e la riga tiene le sue fonti', async ({ app, shell, openTab }) => {
  test.setTimeout(90_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  await configura(app);
  await turno(app, 'chat-cibo', 'sono vegetariano');
  await expect.poll(async () => (await lezioni(app)).length, { timeout: 10_000 }).toBe(1);
  const page = await openTab(QUADERNO);
  await page.evaluate(() => chrome.runtime.sendMessage({ type: 'filo_compact_memory' }));
  const nota = riga(page, 'È vegetariano');
  await expect(nota).toHaveCount(1, { timeout: 8_000 });

  await nota.hover();
  await expect(nota.locator('.qd-tasto[title="Correggi"]')).toBeVisible();
  await nota.locator('.qd-tasto[title="Correggi"]').click();
  const campo = page.locator('.qd-campo');
  await expect(campo).toBeFocused();
  await campo.fill('È vegano');
  await campo.press('Enter');
  const corretta = riga(page, 'È vegano');
  await expect(corretta).toHaveCount(1, { timeout: 5_000 });
  await expect(corretta.locator('.qd-meta')).toContainText('corretta da te');
  await expect(corretta.locator('.qd-salto')).toHaveCount(1);
  expect((await memoria(app)).PREFERENZE).toBe('È vegano');

  await turno(app, 'chat-cena', 'cosa mi cucino stasera?');
  const prompt = await app.evaluate(() => globalThis.__q_prompt[globalThis.__q_prompt.length - 1]);
  expect(prompt).toContain('È vegano');
  expect(prompt).not.toContain('È vegetariano');

  // Esc lascia com'era; un testo oltre il tetto si rifiuta dicendolo e resta nel campo.
  await corretta.locator('.qd-testo').dblclick();
  await page.locator('.qd-campo').fill('qualcos’altro');
  await page.locator('.qd-campo').press('Escape');
  await expect(riga(page, 'È vegano')).toHaveCount(1);
  await corretta.locator('.qd-testo').dblclick();
  await page.locator('.qd-campo').fill('x'.repeat(900));
  await page.locator('.qd-campo').press('Enter');
  await expect(page.locator('.qd-errore:not([hidden])')).toContainText('800');
  await expect(page.locator('.qd-campo')).toBeFocused();
  expect((await memoria(app)).PREFERENZE).toBe('È vegano');
});

test('a parole «non sono vegetariano, sono vegano»: la riga cambia e tiene le sue fonti, come dal quaderno', async ({ app, shell }) => {
  test.setTimeout(90_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  await configura(app);
  await turno(app, 'chat-cibo', 'sono vegetariano');
  await expect.poll(async () => (await lezioni(app)).length, { timeout: 10_000 }).toBe(1);
  await app.evaluate(() => globalThis.SN_HANDLE_MESSAGE({ type: globalThis.SN_MSG.MSG.FILO_COMPACT_MEMORY }, { url: 'filo://quaderno/quaderno.html' }));
  expect((await memoria(app)).PREFERENZE).toBe('È vegetariano');
  const prima = await app.evaluate(async () => (await globalThis.SN_FILO_MEMORY.quaderno()).moduli.find((m) => m.nome === 'PREFERENZE').righe[0].fonti);

  await app.evaluate(() => {
    globalThis.__q_giri = [
      { toolCalls: [{ id: 'c1', name: 'CORREGGI_MEMORIA', arguments: JSON.stringify({ testo: 'vegetariano', nuovo: 'È vegano' }) }] },
      { text: 'Corretto.' },
    ];
  });
  await turno(app, 'chat-correzione', 'non sono vegetariano, sono vegano');
  await expect.poll(async () => (await memoria(app)).PREFERENZE, { timeout: 10_000 }).toBe('È vegano');
  const dopo = await app.evaluate(async () => (await globalThis.SN_FILO_MEMORY.quaderno()).moduli.find((m) => m.nome === 'PREFERENZE').righe[0]);
  expect(dopo.fonti).toEqual(prima);
  expect(dopo.corretta).toBeTruthy();
});

test('tolgo una riga: sparisce, il prompt non la vede, non ricompare dallo stesso tratto, e dalle nascoste si rimette', async ({ app, shell, openTab }) => {
  test.setTimeout(90_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  await configura(app);
  await turno(app, 'chat-cibo', 'sono vegetariano');
  await expect.poll(async () => (await lezioni(app)).length, { timeout: 10_000 }).toBe(1);
  const page = await openTab(QUADERNO);
  await page.evaluate(() => chrome.runtime.sendMessage({ type: 'filo_compact_memory' }));
  const nota = riga(page, 'È vegetariano');
  await expect(nota).toHaveCount(1, { timeout: 8_000 });

  await nota.hover();
  await nota.locator('.qd-tasto[title="Togli dalla memoria"]').click();
  await expect(page.locator('.qd-gruppo', { hasText: 'Cosa preferisci' })).toHaveCount(0, { timeout: 5_000 });
  await expect(page.locator('#esito')).toContainText('Tolta');
  expect((await memoria(app)).PREFERENZE).toBe('');
  const nascoste = page.locator('.qd-gruppo[data-gruppo="nascoste"]');
  await expect(nascoste).toContainText('Nascoste');
  await expect(riga(page, 'È vegetariano')).toBeHidden();
  await nascoste.locator('summary').click();
  await expect(riga(page, 'È vegetariano')).toBeVisible();
  await page.screenshot({ path: 'tests/.shots/quaderno-nascoste.png' });

  // Lo stesso scambio rianalizzato e il compattatore che lo riscrive: non torna.
  await app.evaluate(async () => {
    const F = globalThis.SN_IL_FILO;
    const c = await F.chat('chat-cibo');
    const eids = (await F.transazione(async (t) => globalThis.SN_FILO_EVENTI.copiaChat(t.chat('chat-cibo'), { ids: true }))).eids;
    await globalThis.SN_FILO_MEMORY.appendLesson('L’utente è vegetariano.', { fonti: eids });
    void c;
  });
  expect(await lezioni(app)).toEqual([]);
  await app.evaluate(async () => { await globalThis.SN_FILO_MEMORY.appendLesson('Ama le spezie', { fonti: ['altro-tratto'] }); });
  await app.evaluate(() => { globalThis.__q_compattatore = 'PREFERENZE:\nÈ vegetariano\nAma le spezie (fonti: L1)'; });
  await page.evaluate(() => chrome.runtime.sendMessage({ type: 'filo_compact_memory' }));
  expect((await memoria(app)).PREFERENZE).toBe('Ama le spezie');
  await expect(riga(page, 'Ama le spezie')).toHaveCount(1, { timeout: 5_000 });
  await turno(app, 'chat-cena', 'cosa mi cucino?');
  // La memoria del prompt non la porta più (il messaggio di allora resta nel filo, ed è giusto che il modello lo veda).
  const memoriaDopo = memoriaNelPrompt(await ultimoPrompt(app));
  expect(memoriaDopo).toContain('Ama le spezie');
  expect(memoriaDopo).not.toContain('vegetariano');

  // Tasto destro sulla nascosta: rimetti.
  const voci = await vociMenu(page, 'È vegetariano');
  expect(voci.slice(0, 2)).toEqual(['Rimetti in memoria', 'Cancella per sempre']);
  expect(voci[2]).toMatch(/^Vai al tuo messaggio · oggi, \d{2}:\d{2}$/);
  expect(voci[3]).toMatch(/^Vai alla risposta di Filo · oggi, \d{2}:\d{2}$/);
  expect(voci[4]).toBe('Copia il testo');
  await riga(page, 'È vegetariano').hover();
  await nascoste.locator('.qd-tasto[title="Rimetti in memoria"]').click();
  await expect(page.locator('.qd-gruppo', { hasText: 'Cosa preferisci' }).locator(riga(page, 'È vegetariano'))).toHaveCount(1, { timeout: 5_000 });
  expect((await memoria(app)).PREFERENZE.split('\n')).toContain('È vegetariano');

  // Per sempre: chiede conferma, poi il testo non è più da nessuna parte.
  await riga(page, 'È vegetariano').hover();
  await riga(page, 'È vegetariano').locator('.qd-tasto[title="Togli dalla memoria"]').click();
  await expect(page.locator('#esito button', { hasText: 'Rimetti' })).toBeVisible();
  await page.locator('.qd-nascoste').evaluate((d) => { d.open = true; });
  await riga(page, 'È vegetariano').hover();
  await nascoste.locator('.qd-tasto[title="Cancella per sempre"]').click();
  await clickConfirm(page, 'ok');
  await expect(page.locator('.qd-gruppo[data-gruppo="nascoste"]')).toHaveCount(0, { timeout: 5_000 });
  const disco = await app.evaluate(async () => JSON.stringify(await globalThis.SN_FILO_MEMORY.getFonti()));
  expect(disco).not.toContain('vegetariano');
});

test('una nota nata prima del filo si legge e si cambia, senza collegamento; tasto destro e passaggio del mouse', async ({ app, shell, openTab }) => {
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  await app.evaluate(async () => {
    await globalThis.SN_FILO_MEMORY.setMemory({ PROFILO: 'Si chiama Marta\nVive a Lisbona', PREFERENZE: 'Risposte brevi', PROGETTO_ORTO: 'Coltiva pomodori' });
    await globalThis.SN_FILO_MEMORY.addKeepOpen('web.whatsapp.com');
  });
  const page = await openTab(QUADERNO);
  for (const t of ['Si chiama Marta', 'Vive a Lisbona', 'Risposte brevi', 'Coltiva pomodori', 'Tieni sempre aperto web.whatsapp.com']) {
    await expect(riga(page, t)).toHaveCount(1, { timeout: 8_000 });
  }
  await expect(page.locator('.qd-gruppo h2', { hasText: 'Chi sei' })).toContainText('2');
  await expect(page.locator('.qd-gruppo h2', { hasText: 'Progetto orto' })).toHaveCount(1);
  await expect(riga(page, 'Vive a Lisbona').locator('.qd-salto')).toHaveCount(0);
  expect(await vociMenu(page, 'Vive a Lisbona')).toEqual(['Correggi', 'Togli dalla memoria', 'Copia il testo']);
  expect(await vociMenu(page, 'Tieni sempre aperto web.whatsapp.com')).toEqual(['Non tenerlo più aperto', 'Copia il testo']);
  await riga(page, 'Vive a Lisbona').hover();
  await expect(riga(page, 'Vive a Lisbona').locator('.qd-tasto[title="Correggi"]')).toBeVisible();
  await expect(riga(page, 'Si chiama Marta').locator('.qd-tasti')).toHaveCSS('opacity', '0');

  await riga(page, 'Vive a Lisbona').locator('.qd-testo').dblclick();
  await page.locator('.qd-campo').fill('Vive a Porto');
  await page.locator('.qd-campo').blur();
  await expect(riga(page, 'Vive a Porto')).toHaveCount(1, { timeout: 5_000 });
  expect((await memoria(app)).PROFILO).toBe('Si chiama Marta\nVive a Porto');

  // Testo dell'utente mostrato come testo, mai come markup.
  await app.evaluate(() => globalThis.SN_FILO_MEMORY.patchMemory({ PREFERENZE: '<img src=x onerror="window.__rotto=1"> Ama il <b>grassetto</b>' }));
  await expect(page.locator('.qd-testo', { hasText: 'Ama il <b>grassetto</b>' })).toHaveCount(1, { timeout: 5_000 });
  expect(await page.evaluate(() => window.__rotto || 0)).toBe(0);

  // Da un sito visitato il quaderno non si legge e non si tocca.
  const sito = await app.evaluate(async () => {
    const MSG = globalThis.SN_MSG.MSG;
    const s = { tab: { id: 1, url: 'https://evil.example/' }, url: 'https://evil.example/' };
    const H = globalThis.SN_HANDLE_MESSAGE;
    return [
      await H({ type: MSG.FILO_QUADERNO }, s),
      await H({ type: MSG.FILO_MEMORY_EDIT, via: { modulo: 'PROFILO', riga: 'Si chiama Marta' }, testo: 'x' }, s),
      await H({ type: MSG.FILO_MEMORY_RESTORE, id: 'x' }, s),
      await H({ type: MSG.FILO_MEMORY_FOREVER, id: 'x' }, s),
      await H({ type: MSG.FILO_DOVE, id: 'x' }, s),
    ].map((r) => r.ok);
  });
  expect(sito).toEqual([false, false, false, false, false]);

  for (const tema of ['light', 'dark']) {
    await app.evaluate((_e, t) => globalThis.SN_STORAGE.updateSettings({ theme: t }), tema);
    await page.reload();
    await riga(page, 'Si chiama Marta').hover();
    await expect(riga(page, 'Si chiama Marta').locator('.qd-tasti')).toHaveCSS('opacity', '1');
    await page.screenshot({ path: `tests/.shots/quaderno-${tema}.png` });
  }
});

test('una scheda chiusa un mese fa, prima del filo, si ritrova cercandola nel filo anche per contenuto e si riapre', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(60_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const url = testServer.html('<title>Orche</title><p>Le orche del Mar Glaciale</p>');
  const unMeseFa = new Date(Date.now() - 31 * 864e5).toISOString();
  await app.evaluate(async (_e, a) => {
    await globalThis.SN_ARCHIVED_TABS.importa([{ id: 'arch-orche', url: a.url, title: 'Appunti di viaggio', openedAt: a.ts, closedAt: a.ts, summary: 'Branchi di orche che cacciano aringhe in Norvegia', snippet: '' }]);
  }, { url, ts: unMeseFa });
  expect(await app.evaluate(() => globalThis.SN_SCHEDE_NEL_FILO())).toBe(1);
  expect(await app.evaluate(() => globalThis.SN_SCHEDE_NEL_FILO())).toBe(0);
  const pagine = await app.evaluate(() => globalThis.SN_IL_FILO.pagine(null));
  const migrata = pagine.find((p) => p.archivio === 'arch-orche');
  expect(migrata.ts).toBe(unMeseFa);

  const home = await openTab('filo://newtab/');
  const cerca = home.locator('#cercaInput');
  await cerca.fill('aringhe');
  const risultato = home.locator('.dash-cerca-pagina, [data-url]').filter({ hasText: 'Appunti di viaggio' }).first();
  await expect(risultato).toBeVisible({ timeout: 8_000 });
  await risultato.click();
  await finestraCon(app, (u) => u === url);
});

test('ogni strada che portava alla Cronologia porta al quaderno', async ({ app, shell, openTab }) => {
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const barra = await barraPage(app);
  await comandaBarra(app, 'clic');
  await pannelloFermo(barra);
  const bottone = barra.locator('#fisse [data-comando="history"]');
  await expect(bottone).toHaveAttribute('aria-label', 'Memorie');
  await bottone.click();
  await finestraCon(app, (u) => u.startsWith(QUADERNO));

  // Il vecchio indirizzo (una scheda ripristinata, un segnalibro) rimanda.
  const vecchia = await openTab('filo://archive/archive.html');
  await expect.poll(() => vecchia.url(), { timeout: 8_000 }).toBe(QUADERNO);

  // «altro» nella home, i tasti delle altre pagine, la barra dei menu.
  const C = await app.evaluate(() => globalThis.SN_CARTE_HOME.APP.find((a) => a.id === 'cronologia'));
  expect(C).toMatchObject({ titolo: 'Memorie', url: QUADERNO });
  for (const p of ['filo://home/home.html', 'filo://options/altro.html', 'filo://history/history.html']) {
    const pg = await openTab(p);
    await expect(pg.locator('#openArchive')).toHaveText('Memorie');
  }
  const menu = await app.evaluate(({ Menu }) => {
    const voci = [];
    const giro = (m) => { for (const v of (m && m.items) || []) { voci.push(v.label); giro(v.submenu); } };
    giro(Menu.getApplicationMenu());
    return voci;
  });
  if (menu.length) {
    expect(menu).toContain('Quaderno delle memorie');
    expect(menu).not.toContain('Cronologia');
  }
});

test('una correzione fatta mentre il compattatore lavora resta, anche su una lezione che lui intanto riordina', async ({ app, shell, openTab }) => {
  test.setTimeout(90_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  await configura(app);
  await turno(app, 'chat-cibo', 'sono vegetariano');
  await expect.poll(async () => (await lezioni(app)).length, { timeout: 10_000 }).toBe(1);
  const page = await openTab(QUADERNO);

  // Il campo aperto su una lezione mentre il compattatore la porta fra le preferenze: il campo resta, e la
  // correzione va alla riga che ne è nata.
  const lez = riga(page, 'L’utente è vegetariano.');
  await expect(lez).toHaveCount(1, { timeout: 8_000 });
  await lez.locator('.qd-testo').dblclick();
  await page.locator('.qd-campo').fill('È vegano');
  await page.evaluate(() => chrome.runtime.sendMessage({ type: 'filo_compact_memory' }));
  await expect(page.locator('.qd-gruppo', { hasText: 'Cosa preferisci' })).toHaveCount(1, { timeout: 5_000 });
  await expect(page.locator('.qd-campo')).toHaveValue('È vegano');
  await page.locator('.qd-campo').press('Enter');
  await expect(page.locator('#esito')).toContainText('Corretta');
  expect((await memoria(app)).PREFERENZE).toBe('È vegano');
  await expect(riga(page, 'È vegano')).toHaveCount(1, { timeout: 5_000 });

  // Una correzione salvata mentre il modello scrive: il compattatore non la riscrive com'era, e riparte al giro dopo.
  await app.evaluate(async () => {
    await globalThis.SN_FILO_MEMORY.appendLesson('Ama le spezie', { fonti: ['altro-tratto'] });
    globalThis.__q_compattatore = 'PREFERENZE:\nÈ vegano (fonti: R1)\nAma le spezie (fonti: L1)';
    globalThis.__q_attesa = new Promise((r) => { globalThis.__q_via = r; });
    globalThis.__q_fatto = globalThis.SN_HANDLE_MESSAGE({ type: globalThis.SN_MSG.MSG.FILO_COMPACT_MEMORY }, { url: 'filo://quaderno/quaderno.html' });
  });
  await riga(page, 'È vegano').locator('.qd-testo').dblclick();
  await page.locator('.qd-campo').fill('È vegano da tre anni');
  await page.locator('.qd-campo').press('Enter');
  await expect(riga(page, 'È vegano da tre anni')).toHaveCount(1, { timeout: 5_000 });
  await app.evaluate(async () => { globalThis.__q_attesa = null; globalThis.__q_via(); await globalThis.__q_fatto; });
  expect((await memoria(app)).PREFERENZE).toBe('È vegano da tre anni');
  expect((await lezioni(app)).map((l) => l.text)).toEqual(['Ama le spezie']);
  await page.evaluate(() => chrome.runtime.sendMessage({ type: 'filo_compact_memory' }));
  await expect.poll(async () => (await lezioni(app)).length).toBe(0);
});

test('una riga corretta nel testo di un\'altra diventa una riga sola, e togliendola se ne va', async ({ app, shell, openTab }) => {
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  await app.evaluate(() => globalThis.SN_FILO_MEMORY.setMemory({ PROFILO: '', PREFERENZE: 'Ama il tè\nAma il caffè' }));
  const page = await openTab(QUADERNO);
  await expect(page.locator('.qd-riga')).toHaveCount(2, { timeout: 8_000 });
  await riga(page, 'Ama il caffè').locator('.qd-testo').dblclick();
  await page.locator('.qd-campo').fill('Ama il tè');
  await page.locator('.qd-campo').press('Enter');
  await expect(page.locator('#esito')).toContainText('Corretta');
  expect((await memoria(app)).PREFERENZE).toBe('Ama il tè');
  await expect(page.locator('.qd-riga')).toHaveCount(1);
  await expect(page.locator('.qd-gruppo h2 .qd-conto').first()).toHaveText('1');
  await riga(page, 'Ama il tè').hover();
  await riga(page, 'Ama il tè').locator('.qd-tasto[title="Togli dalla memoria"]').click();
  await expect(page.locator('#esito')).toContainText('Tolta');
  expect((await memoria(app)).PREFERENZE).toBe('');
});

// #872.4 — i tasti accanto al campo aperto: la × annulla la correzione (non la salva prima), il ✓ la salva, e il tasto
// destro «Togli dalla memoria» toglie la riga com'era. Prima la × salvava «Ama il caffè» e diceva «Non c'era più».
test('correggo «Ama il tè» in «Ama il caffè» e ci ripenso: la × accanto al campo annulla, il ✓ salva, il tasto destro toglie la riga com’era', async ({ app, shell, openTab }) => {
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  await app.evaluate(() => globalThis.SN_FILO_MEMORY.setMemory({ PROFILO: '', PREFERENZE: 'Ama il tè\nVive a Lisbona' }));
  const page = await openTab(QUADERNO);
  await expect(riga(page, 'Ama il tè')).toHaveCount(1, { timeout: 8_000 });
  const campo = page.locator('.qd-campo');
  const inCorrezione = page.locator('.qd-riga', { has: campo });

  await riga(page, 'Ama il tè').locator('.qd-testo').dblclick();
  await campo.fill('Ama il caffè');
  await expect(inCorrezione.locator('.qd-tasto')).toHaveCount(2);
  await expect(inCorrezione.locator('.qd-tasto[title="Togli dalla memoria"]')).toHaveCount(0);
  await page.screenshot({ path: 'tests/.shots/quaderno-campo-aperto.png' });
  await inCorrezione.locator('.qd-tasto[title="Annulla la correzione"]').click();
  await expect(campo).toHaveCount(0);
  await expect(riga(page, 'Ama il tè')).toHaveCount(1);
  await expect(riga(page, 'Ama il tè').locator('.qd-tasto[title="Togli dalla memoria"]')).toHaveCount(1);
  expect((await memoria(app)).PREFERENZE).toBe('Ama il tè\nVive a Lisbona');
  await expect(page.locator('#esito')).toBeHidden();

  // Da tastiera: Tab porta sui tasti senza salvare, e Invio sulla × annulla.
  await riga(page, 'Ama il tè').locator('.qd-testo').dblclick();
  await campo.fill('Ama il caffè');
  await campo.press('Tab');
  await expect(inCorrezione.locator('.qd-tasto[title="Salva la correzione"]')).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(inCorrezione.locator('.qd-tasto[title="Annulla la correzione"]')).toBeFocused();
  expect((await memoria(app)).PREFERENZE).toBe('Ama il tè\nVive a Lisbona');
  await page.keyboard.press('Enter');
  await expect(campo).toHaveCount(0);
  expect((await memoria(app)).PREFERENZE).toBe('Ama il tè\nVive a Lisbona');

  // Il ✓ salva.
  await riga(page, 'Ama il tè').locator('.qd-testo').dblclick();
  await campo.fill('Ama il caffè');
  await inCorrezione.locator('.qd-tasto[title="Salva la correzione"]').click();
  await expect(page.locator('#esito')).toContainText('Corretta');
  await expect(riga(page, 'Ama il caffè')).toHaveCount(1);
  expect((await memoria(app)).PREFERENZE).toBe('Ama il caffè\nVive a Lisbona');

  // Il tasto destro sul campo aperto: «Togli dalla memoria» toglie la riga com'era, senza salvare quello che c'era scritto.
  await riga(page, 'Ama il caffè').locator('.qd-testo').dblclick();
  await campo.fill('Ama il cioccolato');
  await campo.click({ button: 'right' });
  const menu = menuDi(page);
  await menu.voce('Togli dalla memoria').click();
  await expect(page.locator('#esito')).toContainText('Tolta');
  await expect(campo).toHaveCount(0);
  expect((await memoria(app)).PREFERENZE).toBe('Vive a Lisbona');
  const fonti = await app.evaluate(async () => JSON.stringify(await globalThis.SN_FILO_MEMORY.getFonti()));
  expect(fonti).toContain('Ama il caffè');
  expect(fonti).not.toContain('cioccolato');
  await page.locator('.qd-nascoste').evaluate((d) => { d.open = true; });
  await expect(riga(page, 'Ama il caffè')).toBeVisible();
});

test('svuoto una riga e la confermo: si toglie e si rimette; una correzione troppo lunga lo dice senza parlare di lezioni', async ({ app, shell, openTab }) => {
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  await app.evaluate(() => globalThis.SN_FILO_MEMORY.setMemory({ PROFILO: 'Si chiama Marta', PREFERENZE: 'Ama il tè\nRisposte brevi' }));
  const page = await openTab(QUADERNO);
  await expect(riga(page, 'Ama il tè')).toHaveCount(1, { timeout: 8_000 });
  const campo = page.locator('.qd-campo');

  await riga(page, 'Ama il tè').locator('.qd-testo').dblclick();
  await campo.fill('');
  await campo.press('Enter');
  await expect(page.locator('#esito')).toContainText('Tolta: non entra più nelle conversazioni');
  await expect(page.locator('.qd-gruppo:not([data-gruppo="nascoste"])').locator(riga(page, 'Ama il tè'))).toHaveCount(0);
  expect((await memoria(app)).PREFERENZE).toBe('Risposte brevi');
  await page.locator('#esito button', { hasText: 'Rimetti' }).click();
  await expect(page.locator('#esito')).toContainText('Rimessa in memoria');
  expect((await memoria(app)).PREFERENZE.split('\n')).toContain('Ama il tè');

  // Solo spazi, e uscire dal campo (che salva): la stessa cosa.
  await riga(page, 'Risposte brevi').locator('.qd-testo').dblclick();
  await campo.fill('   ');
  await page.locator('h1').click();
  await expect(page.locator('#esito')).toContainText('Tolta');
  expect((await memoria(app)).PREFERENZE).toBe('Ama il tè');

  // Una riga del profilo corretta oltre il tetto: il messaggio parla della correzione, col numero, e il campo resta.
  await riga(page, 'Si chiama Marta').locator('.qd-testo').dblclick();
  await campo.fill('x'.repeat(900));
  await campo.press('Enter');
  const errore = page.locator('.qd-errore:not([hidden])');
  await expect(errore).toHaveText('La correzione è lunga 900 caratteri e il massimo è 800. Accorciala per salvarla.');
  await expect(campo).toBeFocused();
  await page.screenshot({ path: 'tests/.shots/quaderno-correzione-lunga.png' });
  await campo.press('Escape');
  await expect(campo).toHaveCount(0);
  expect((await memoria(app)).PROFILO).toBe('Si chiama Marta');
});

// La compattazione del filo (SPEC-CONTESTO fase 4, #1563): una chat che passerebbe la soglia compatta prima di
// rispondere, la richiesta dopo sta sotto i 100.000 token, il diario entra nel CONTESTO e la conversazione resta intera.
import { test, expect } from './fixtures/electron.mjs';
import { home, modelloFinto, ripristina, chiedi, chiamateAlModello } from './helpers/chatFinta.mjs';
import { GESTIONE, ricaricaSu } from './helpers/gestione.mjs';
import { menuDi } from './helpers/menuContestuale.mjs';

const ORA_MS = 60 * 60 * 1000;
const RIGA = '09:12 incollati quattro capitoli della tesi sulle api, discussi con Filo';

// Tre scambi di tre ore fa in un'altra chat, ognuno da circa 25.000 token: insieme passano la soglia di serie e il
// listino, e stanno in una compattazione sola.
const scriviVecchi = (app) => app.evaluate(async (_e, ore) => {
  const Chats = globalThis.SN_FILO_CHATS;
  const t0 = Date.now() - 3 * ore;
  const capitolo = (i) => `Capitolo ${i} della tesi sulle api. ${'Le api bottinatrici tornano all\'alveare e danzano. '.repeat(1700)}`;
  for (let i = 0; i < 3; i++) {
    await Chats.append('vecchia1', { role: 'user', text: capitolo(i), ts: new Date(t0 + i * 60000).toISOString() });
    await Chats.append('vecchia1', { role: 'filo', text: `Letto il capitolo ${i}.`, ts: new Date(t0 + i * 60000 + 5000).toISOString() });
  }
  return (await globalThis.SN_IL_FILO.chat('vecchia1')).messages.length;
}, ORA_MS);

// Il modello che compatta: risponde con una riga delle ore e si segna cosa ha ricevuto.
const compattatoreFinto = (app, riga) => app.evaluate((_e, riga) => {
  const C = globalThis.SN_COMPATTAZIONE;
  globalThis.__compattazioni = [];
  globalThis.__compattatoreVero = C._dip.chiama;
  C._dip.chiama = async ({ messages, motivo }) => {
    globalThis.__compattazioni.push({ motivo, testo: messages.map((m) => m.content).join('\n') });
    return JSON.stringify({ ore: [{ testo: riga }], memorie: [] });
  };
}, riga);
const rimettiCompattatore = (app) => app.evaluate(() => {
  if (globalThis.__compattatoreVero) globalThis.SN_COMPATTAZIONE._dip.chiama = globalThis.__compattatoreVero;
});

// La stima di una richiesta come la fa il main: caratteri dei messaggi e degli strumenti.
const tokenDi = (app, messages) => app.evaluate((_e, messages) => {
  const FC = globalThis.SN_FILO_CONTESTO;
  return Math.ceil((FC.caratteriDi(messages) + JSON.stringify(globalThis.SN_ACTION_TOOLS.definitions()).length) / FC.CARATTERI_PER_TOKEN);
}, messages);

test('una chat oltre la soglia compatta prima di rispondere: la richiesta sta sotto i 100.000 token e niente si perde', async ({ app }) => {
  const page = await home(app);
  expect(await scriviVecchi(app)).toBe(6);
  await modelloFinto(app, [{ text: 'Sì, ricordo la tesi sulle api.' }]);
  await compattatoreFinto(app, RIGA);
  try {
    await chiedi(page, 'ti ricordi di cosa parlava la mia tesi?');
    await expect(page.locator('.dash-bubble').filter({ hasText: 'ricordo la tesi sulle api' })).toBeVisible({ timeout: 20000 });

    const comp = await app.evaluate(() => globalThis.__compattazioni);
    expect(comp.length, 'una compattazione prima della risposta').toBe(1);
    expect(comp[0].motivo).toBe('soglia');
    expect(comp[0].testo).toContain('Capitolo 0 della tesi');
    expect(comp[0].testo).toContain('Capitolo 2 della tesi');

    const [richiesta] = await chiamateAlModello(app);
    expect(await tokenDi(app, richiesta), 'la richiesta dopo la compattazione sta sotto il listino').toBeLessThan(100000);
    const sistema = richiesta[0].content;
    expect(sistema, 'il diario entra nel CONTESTO').toContain(RIGA);
    expect(JSON.stringify(richiesta.slice(1)), 'i capitoli compattati non tornano grezzi').not.toContain('bottinatrici');
    expect(JSON.stringify(richiesta.at(-1)), 'la domanda parte intera').toContain('ti ricordi di cosa parlava la mia tesi?');

    // Il filo non perde niente: la conversazione vecchia è intera, e la chat di adesso mostra domanda e risposta.
    const vecchia = await app.evaluate(async () => (await globalThis.SN_IL_FILO.chat('vecchia1')).messages.map((m) => m.text.length));
    expect(vecchia.length).toBe(6);
    expect(vecchia[0]).toBeGreaterThan(80000);
    await expect(page.locator('.dash-bubble').filter({ hasText: 'ti ricordi di cosa parlava la mia tesi?' })).toBeVisible();

    // Il turno dopo non ricompatta: il tratto riparte dal grezzo e sta sotto la soglia.
    await chiedi(page, 'e il titolo?');
    await expect.poll(async () => (await chiamateAlModello(app)).length, { timeout: 20000 }).toBe(2);
    expect((await app.evaluate(() => globalThis.__compattazioni)).length).toBe(comp.length);
    const seconda = (await chiamateAlModello(app))[1];
    expect(seconda[0].content, 'il CONTESTO resta quello di prima: la cache lo riusa').toBe(sistema);
  } finally {
    await rimettiCompattatore(app);
    await ripristina(app);
  }
});

// Il listino di OpenRouter finto: ogni modello che l'app conosce, con un prezzo. Senza rete la stima direbbe solo che
// il listino manca, e la prova non vedrebbe il collegamento fra modello scelto, prezzo e frase. Il listino si rilegge
// subito: quello letto all'avvio (o il fallimento) vale per ore e coprirebbe quello finto.
const listinoFinto = (app) => app.evaluate(async () => {
  const ids = new Set();
  const regs = [globalThis.SN_TEST_MODELS && globalThis.SN_TEST_MODELS.registry];
  for (const r of regs) for (const v of Object.values(r || {})) if (v && v.model) ids.add(v.model);
  const data = [...ids].map((id) => ({ id, pricing: { prompt: '0.000001', completion: '0.000005', input_cache_read: '0.0000001' } }));
  const vero = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = String((input && input.url) || input);
    if (/^https:\/\/openrouter\.ai\/api\/v1\/models/.test(url)) {
      return new Response(JSON.stringify({ data: url.includes('output_modalities') ? [] : data }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    return vero(input, init);
  };
  // Senza una chiave (propria o dei crediti) la catena dei modelli è vuota, come per chi non può usare la chat.
  await globalThis.SN_STORAGE.updateSettings({ apiKeys: { openrouter: 'sk-or-v1-prova' } });
  const opzioni = { tab: { id: 5, url: 'filo://options/options.html' }, url: 'filo://options/options.html' };
  const r = await globalThis.SN_HANDLE_MESSAGE({ type: 'stima_costo_modelli', forzaListino: true }, opzioni);
  if (!r || !r.ok || !r.contesto || !r.contesto.listino) throw new Error('listino finto non letto: ' + JSON.stringify(r).slice(0, 200));
});
const STIMA = /^Circa [\d.,]+ \$ al mese con 600 messaggi .*\d+ s/;

test('la soglia si cambia nelle Preferenze, con la stima accanto, e la chat la usa', async ({ app, openTab }) => {
  await listinoFinto(app);
  const prefs = await openTab('filo://preferences/preferences.html');
  const campo = prefs.locator('#contestoSoglia');
  await expect(campo).toHaveAttribute('placeholder', '70000', { timeout: 10000 });
  await campo.fill('40000');
  await campo.blur();
  await expect.poll(() => app.evaluate(async () => (await globalThis.SN_STORAGE.getSettings()).contestoFilo.soglia), { timeout: 10000 }).toBe(40000);
  // Col listino la frase dice costo al mese e attesa, coi prezzi del modello della chat.
  await expect(prefs.locator('#contestoSogliaStima')).toHaveText(STIMA, { timeout: 15000 });
  const piuAlta = await prefs.locator('#contestoSogliaStima').textContent();
  await campo.fill('90000');
  await expect(prefs.locator('#contestoSogliaStima'), 'la stima segue la soglia scritta').not.toHaveText(piuAlta, { timeout: 15000 });
  await expect(prefs.locator('#contestoSogliaStima')).toHaveText(STIMA);
  await campo.fill('40000');
  await campo.blur();
  await prefs.locator('#sec-contesto').screenshot({ path: 'tests/.shots/compattazione-preferenze.png' });
  const tetti = await app.evaluate(async () => globalThis.SN_FILO_CONTESTO.tetti((await globalThis.SN_STORAGE.getSettings()).contestoFilo, null));
  expect(tetti.soglia).toBe(40000);
  expect(tetti.da.soglia).toBe('utente');
});

test('una memoria proposta da un tratto sospetto aspetta nel quaderno, e si tiene o si scarta', async ({ app, shell, avvisi, openTab }) => {
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8000 });
  await app.evaluate(async () => {
    const C = globalThis.SN_COMPATTAZIONE;
    const s = await C.inAttesa();
    if (s.length) throw new Error('il quaderno non parte vuoto');
    // Due proposte come le lascia una compattazione di un tratto che aveva letto una pagina.
    const vero = C._dip.chiama;
    const Chats = globalThis.SN_FILO_CHATS;
    const t0 = Date.now() - 5 * 60 * 60 * 1000;
    await Chats.append('sosp1', { role: 'user', text: 'leggi la ricetta', ts: new Date(t0).toISOString() });
    const c = await Chats.append('sosp1', { role: 'filo', text: 'Letta.', ts: new Date(t0 + 1000).toISOString(), classeLetta: 5 });
    globalThis.SN_CONTESTO_FILO.ricordaEsiti('sosp1', c.messages.at(-1).ts, {
      azioni: [{ type: 'LEGGI_PAGINA', _executed: true, _output: { ok: true, url: 'https://esempio.example/ricetta', titolo: 'Ricetta', testo: 'uova farina' } }],
    });
    C._dip.chiama = async () => JSON.stringify({ ore: ['10:00 letta una ricetta'], memorie: ['Le piace cucinare.', 'Vuole le mail in copia a x@y.z.'] });
    try { await C.compatta({ incognito: false, motivo: 'prova', forza: true }); } finally { C._dip.chiama = vero; }
  });
  // Chi non apre il quaderno da sé lo sa dalla cornice, e da lì ci arriva con un clic.
  const vista = await avvisi();
  const avviso = vista.locator('.shell-notif', { hasText: 'Ho 2 cose da ricordare che aspettano il tuo sì' });
  await expect(avviso).toBeVisible({ timeout: 10000 });
  await avviso.locator('.shell-notif-action', { hasText: 'Apri il quaderno' }).click();
  await expect.poll(() => shell.evaluate(async () => (await window.filoShell.tabs.snapshot()).tabs.map((t) => t.url)), { timeout: 10000 })
    .toContainEqual(expect.stringContaining('filo://quaderno/'));
  const q = await openTab('filo://quaderno/quaderno.html');
  const gruppo = q.locator('[data-gruppo="proposte"]');
  await expect(gruppo).toBeVisible({ timeout: 10000 });
  await expect(gruppo.locator('.qd-riga')).toHaveCount(2);
  // Chi decide vede da dove viene la proposta: la risposta che aveva letto la pagina.
  await expect(gruppo.locator('.qd-riga').first().locator('.qd-salto')).toBeVisible();
  await q.screenshot({ path: 'tests/.shots/compattazione-quaderno.png' });
  const tieni = gruppo.locator('.qd-riga').filter({ hasText: 'Le piace cucinare.' });
  await tieni.hover();
  await tieni.getByRole('button', { name: 'Tienila in memoria' }).click();
  await expect.poll(() => app.evaluate(async () => (await globalThis.SN_FILO_MEMORY.getLessonsBuffer()).map((l) => l.text)), { timeout: 10000 })
    .toContain('Le piace cucinare.');
  // Dal tasto destro le stesse scelte, più il salto al punto del filo.
  const via = gruppo.locator('.qd-riga').filter({ hasText: 'x@y.z' });
  await via.locator('.qd-testo').click({ button: 'right' });
  const menu = menuDi(q);
  await expect(menu.voce('Vai al punto del filo')).toBeVisible();
  await menu.voce('Non tenerla').click();
  await expect(gruppo).toHaveCount(0, { timeout: 10000 });
  expect(await app.evaluate(async () => JSON.stringify(await globalThis.SN_FILO_MEMORY.getLessonsBuffer()))).not.toContain('x@y.z');
  expect(await app.evaluate(async () => (await globalThis.SN_COMPATTAZIONE.inAttesa()).length)).toBe(0);
});

// Quanto pesano strumenti e parte fissa: le soglie delle prove si misurano da lì, non da un numero scritto oggi.
const base = (app) => app.evaluate(() => globalThis.SN_FILO_CONTESTO.stimaToken(
  JSON.stringify(globalThis.SN_ACTION_TOOLS.definitions()) + globalThis.SN_CONST.PROMPTS.filoChatStatic()));
const conSoglia = (app, soglia) => app.evaluate(async (_e, soglia) => {
  const s = await globalThis.SN_STORAGE.getSettings();
  await globalThis.SN_STORAGE.updateSettings({ contestoFilo: { ...(s.contestoFilo || {}), soglia } });
}, soglia);
// Una conversazione di tre ore fa da `token` token circa.
const vecchiaDa = (app, token) => app.evaluate(async (_e, token) => {
  const t0 = Date.now() - 3 * 60 * 60 * 1000;
  await globalThis.SN_FILO_CHATS.append('vecchia2', { role: 'user', text: `Appunti sulle api: ${'il favo è fatto di cera. '.repeat(Math.ceil((token * 3.5) / 25))}`, ts: new Date(t0).toISOString() });
  await globalThis.SN_FILO_CHATS.append('vecchia2', { role: 'filo', text: 'Annotato.', ts: new Date(t0 + 5000).toISOString() });
}, token);

test('a metà di un giro di strumenti: l\'esito che porta la richiesta oltre la soglia compatta prima del giro dopo', async ({ app, testServer }) => {
  const page = await home(app);
  await vecchiaDa(app, 8000);
  const url = testServer.html(`<!doctype html><title>Le api</title><p>${'Le api comunicano con la danza. '.repeat(3000)}</p>`);
  await app.evaluate(() => { globalThis.SN_LETTURA_PAGINE._dip.scarica = (u, o) => fetch(u, o); });
  await modelloFinto(app, [
    { text: 'Ciao.' },
    { toolCalls: [{ id: 'p1', name: 'LEGGI_PAGINA', arguments: JSON.stringify({ url }) }] },
    { text: 'Letta la pagina sulle api.' },
  ]);
  await compattatoreFinto(app, RIGA);
  try {
    // Il primo turno misura quanto pesa la richiesta qui; la soglia le sta poco sopra, sotto l'esito della pagina.
    await chiedi(page, 'ciao');
    await expect(page.locator('.dash-bubble').filter({ hasText: 'Ciao.' })).toBeVisible({ timeout: 20000 });
    await conSoglia(app, (await tokenDi(app, (await chiamateAlModello(app))[0])) + 4000);
    await chiedi(page, `leggi ${url}`);
    await expect(page.locator('.dash-bubble').filter({ hasText: 'Letta la pagina sulle api.' })).toBeVisible({ timeout: 20000 });
    const comp = await app.evaluate(() => globalThis.__compattazioni);
    expect(comp[0] && comp[0].motivo).toBe('soglia');
    expect(comp[0].testo).toContain('il favo è fatto di cera');
    const [, primo, secondo] = await chiamateAlModello(app);
    expect(primo[0].content, 'il primo giro parte col tratto intero').not.toContain(RIGA);
    expect(secondo[0].content, 'il secondo giro ha il diario').toContain(RIGA);
    expect(JSON.stringify(secondo), 'l\'esito del giro resta').toContain('Le api comunicano con la danza');
    expect(JSON.stringify(secondo)).not.toContain('il favo è fatto di cera');
  } finally {
    await rimettiCompattatore(app);
    await ripristina(app);
  }
});

test('una risposta già vicina alla soglia compatta subito dopo, in sottofondo; e da fermo, passata la cache', async ({ app }) => {
  const page = await home(app);
  await vecchiaDa(app, 18000);
  await modelloFinto(app, [{ text: 'Eccomi.' }]);
  await compattatoreFinto(app, RIGA);
  // Un primo turno con la soglia lontana misura la parte fissa come la misura la chat (strumenti, istruzioni, CONTESTO):
  // l'anticipo scatta all'80% dello spazio fra lei e la soglia.
  await conSoglia(app, 2000000);
  await chiedi(page, 'ciao');
  await expect.poll(async () => (await chiamateAlModello(app)).length, { timeout: 20000 }).toBe(1);
  const parteFissa = await app.evaluate(() => globalThis.SN_COMPATTAZIONE.base(false));
  await conSoglia(app, Math.round(parteFissa + 21000));
  // Il timer della pausa: si prende la funzione che il turno lascia, per farla partire senza aspettare un'ora.
  await app.evaluate(() => {
    const C = globalThis.SN_COMPATTAZIONE;
    globalThis.__fermoVero = C.programmaFermo;
    globalThis.__fermo = [];
    C.programmaFermo = (fn, ms) => { if (fn) globalThis.__fermo.push({ fn, ms }); return globalThis.__fermoVero(null); };
  });
  try {
    expect(await app.evaluate(() => globalThis.__compattazioni.length)).toBe(0);
    await chiedi(page, 'ancora qui?');
    await expect.poll(async () => (await chiamateAlModello(app)).length, { timeout: 20000 }).toBe(2);
    expect((await chiamateAlModello(app))[1][0].content, 'la risposta non ha aspettato la compattazione').not.toContain(RIGA);
    await expect.poll(() => app.evaluate(() => globalThis.__compattazioni.map((c) => c.motivo)), { timeout: 10000 }).toEqual(['anticipo']);

    // Da fermo: il turno lascia il timer della durata della cache più un minuto; scattato, col tratto grande compatta.
    await chiedi(page, `ci sei? ${'appunto lungo sulle api. '.repeat(3000)}`);
    await expect.poll(async () => (await chiamateAlModello(app)).length, { timeout: 20000 }).toBe(3);
    expect((await chiamateAlModello(app))[2][0].content, 'il messaggio dopo ha il diario').toContain(RIGA);
    expect(await app.evaluate(() => globalThis.__fermo.at(-1).ms)).toBe(61 * 60 * 1000);
    const chiesti = await app.evaluate(async () => {
      const C = globalThis.SN_COMPATTAZIONE;
      const vera = C.compatta;
      const motivi = [];
      C.compatta = (o) => { motivi.push(o.motivo); return vera(o); };
      try { await globalThis.__fermo.at(-1).fn(); } finally { C.compatta = vera; }
      return motivi;
    });
    expect(chiesti).toEqual(['fermo']);
  } finally {
    await app.evaluate(() => { if (globalThis.__fermoVero) globalThis.SN_COMPATTAZIONE.programmaFermo = globalThis.__fermoVero; });
    await rimettiCompattatore(app);
    await ripristina(app);
  }
});

test('oltre i 100.000 token con la compattazione non riuscita escono gli esiti vecchi, il testo dell\'utente resta', async ({ app }) => {
  const page = await home(app);
  // Sette pagine lette dieci minuti fa, ancora nel grezzo: ognuna entra fino al tetto della sua busta (32 KB), e insieme
  // portano la richiesta oltre il listino.
  await app.evaluate(async () => {
    const s = await globalThis.SN_STORAGE.getSettings();
    await globalThis.SN_STORAGE.updateSettings({ contestoFilo: { ...(s.contestoFilo || {}), token: 400000 } });
    const t0 = Date.now() - 10 * 60 * 1000;
    const Chats = globalThis.SN_FILO_CHATS;
    await Chats.append('lett1', { role: 'user', text: 'leggi la tesi', ts: new Date(t0).toISOString() });
    const c = await Chats.append('lett1', { role: 'filo', text: 'Letta.', ts: new Date(t0 + 5000).toISOString(), actions: Array.from({ length: 7 }, () => ({ type: 'LEGGI_PAGINA' })) });
    const testo = 'Il miele matura nelle celle opercolate. '.repeat(900);
    globalThis.SN_CONTESTO_FILO.ricordaEsiti('lett1', c.messages.at(-1).ts, {
      azioni: Array.from({ length: 7 }, (_, i) => {
        const url = `https://api.example/tesi/${i}`;
        return { type: 'LEGGI_PAGINA', _executed: true, params: { url }, _output: { ok: true, pageRead: url, url, titolo: `Tesi ${i}`, testo, da: 0, fino: testo.length, totale: testo.length } };
      }),
    });
  });
  await modelloFinto(app, [{ text: 'Va bene.' }]);
  // Chi compatta non risponde (rete giù): il tratto resta com'è, e la richiesta deve comunque stare sotto il listino.
  await app.evaluate(() => {
    const C = globalThis.SN_COMPATTAZIONE;
    globalThis.__compattazioni = [];
    globalThis.__compattatoreVero = C._dip.chiama;
    C._dip.chiama = async ({ motivo }) => { globalThis.__compattazioni.push({ motivo }); throw new Error('rete giù'); };
  });
  try {
    const lunga = `adesso riassumila tenendo conto di questo: ${Array(200).fill('nota mia.').join(' ')}`;
    await chiedi(page, lunga);
    await expect(page.locator('.dash-bubble').filter({ hasText: 'Va bene.' })).toBeVisible({ timeout: 20000 });
    expect(await app.evaluate(() => globalThis.__compattazioni.length), 'una compattazione tentata, non riuscita').toBe(1);
    const [richiesta] = await chiamateAlModello(app);
    const testo = JSON.stringify(richiesta);
    // Le pagine c'erano davvero: messe a parte, la richiesta passerebbe il listino.
    expect(await tokenDi(app, richiesta) + Math.ceil((7 * 36000) / 3.5)).toBeGreaterThan(100000);
    expect(await tokenDi(app, richiesta), 'tolti gli esiti, la richiesta sta sotto il listino').toBeLessThan(100000);
    expect(testo).not.toContain('celle opercolate');
    expect(testo).toContain('esiti sono stati tolti per stare nel contesto');
    expect(testo, 'il messaggio dell\'utente parte intero').toContain(lunga);
  } finally {
    await rimettiCompattatore(app);
    await ripristina(app);
  }
});

// La strada vera di chi compatta: niente funzione sostituita, il fornitore finto risponde dietro il cancello dei modelli.
const fornitoreDiChiCompatta = (app, riga) => app.evaluate((_e, riga) => {
  const P = globalThis.SN_PROVIDERS;
  globalThis.__completaVera = P.completeWithFallback;
  globalThis.__compattazioniVere = [];
  P.completeWithFallback = async ({ attempts, messages }) => {
    globalThis.__compattazioniVere.push({ modello: attempts[0].model, messages: JSON.parse(JSON.stringify(messages)) });
    return {
      model: attempts[0].model, provider: attempts[0].provider, usage: {}, toolCalls: [], reasoningDetails: [], finishReason: 'stop',
      text: JSON.stringify({ ore: [{ testo: riga }], memorie: [] }),
    };
  };
}, riga);
const rimettiFornitore = (app) => app.evaluate(() => {
  if (globalThis.__completaVera) globalThis.SN_PROVIDERS.completeWithFallback = globalThis.__completaVera;
});

test('la compattazione vera passa dal cancello dei modelli: col suo modello vuoto usa quello della chat, e la Cronologia AI la segna', async ({ app }) => {
  const page = await home(app);
  expect(await scriviVecchi(app)).toBe(6);
  await modelloFinto(app, [{ text: 'Sì, ricordo la tesi sulle api.' }]);
  await fornitoreDiChiCompatta(app, RIGA);
  try {
    // Nell'app il modello della compattazione nasce vuoto: vale quello della chat.
    const { scelto, chat } = await app.evaluate(async () => {
      const prima = await globalThis.SN_STORAGE.getSettings();
      await globalThis.SN_STORAGE.updateSettings({ models: { ...prima.models, filo_compattazione: '' } });
      const s = await globalThis.SN_STORAGE.getSettings();
      return { scelto: (s.models || {}).filo_compattazione || '', chat: globalThis.SN_TEST_MODELS.registry[s.models.filo_chat].model };
    });
    expect(scelto, 'nessun modello scelto per la compattazione').toBe('');
    await chiedi(page, 'ti ricordi di cosa parlava la mia tesi?');
    await expect(page.locator('.dash-bubble').filter({ hasText: 'ricordo la tesi sulle api' })).toBeVisible({ timeout: 20000 });
    // Altre funzioni del turno (il titolo della chat) passano dallo stesso fornitore: contano solo le compattazioni.
    const comp = (await app.evaluate(() => globalThis.__compattazioniVere))
      .filter((c) => JSON.stringify(c.messages).includes('DA COMPATTARE'));
    expect(comp.length).toBe(1);
    expect(comp[0].modello, 'il modello della chat').toBe(chat);
    expect(comp[0].messages[0].role).toBe('system');
    expect(comp[0].messages[1].content).toContain('Capitolo 0 della tesi');
    const [richiesta] = await chiamateAlModello(app);
    expect(richiesta[0].content, 'la risposta letta dal cancello entra nel diario').toContain(RIGA);
    const voce = await app.evaluate(async () => (await globalThis.SN_HISTORY.list()).find((v) => v.action === 'filo_compattazione') || null);
    expect(voce, 'la compattazione ha la sua riga nella Cronologia AI').toBeTruthy();
    expect(voce.model).toBe(chat);
    expect(voce.input.daCompattare.messaggi).toBe(2);
  } finally {
    await rimettiFornitore(app);
    await ripristina(app);
  }
});

test('una domanda che da sola passa i 100.000 token parte intera, e la Cronologia AI segna il listino passato', async ({ app }) => {
  const page = await home(app);
  await modelloFinto(app, [{ text: 'Letto tutto.' }]);
  await compattatoreFinto(app, RIGA);
  try {
    const lunga = `rileggi questi appunti: ${'il favo è fatto di cera e le api lo scaldano. '.repeat(8000)}`;
    await chiedi(page, lunga);
    await expect(page.locator('.dash-bubble').filter({ hasText: 'Letto tutto.' })).toBeVisible({ timeout: 30000 });
    const [richiesta] = await chiamateAlModello(app);
    expect(await tokenDi(app, richiesta)).toBeGreaterThan(100000);
    expect(JSON.stringify(richiesta.at(-1)), 'la domanda parte intera').toContain(lunga.slice(-200));
    const voce = await app.evaluate(async () => (await globalThis.SN_HISTORY.list()).find((v) => v.action === 'filo_chat') || null);
    expect(voce && voce.input && voce.input.oltreListino, 'la riga della chiamata dice di quanto').toBeGreaterThan(100000);
  } finally {
    await rimettiCompattatore(app);
    await ripristina(app);
  }
});

// La pagina dell'owner vuole un admin loggato: la configurazione condivisa è finta, la stima la dà il main vero.
test('nei Modelli predefiniti l\'owner cambia la soglia di serie con la stima accanto, e il salvataggio la porta', async ({ app, openTab }) => {
  await listinoFinto(app);
  const page = await openTab(GESTIONE);
  await page.addInitScript(() => {
    const config = () => ({
      apiKeysPresent: { openrouter: true, tavily: false }, safeBrowsingKeyPresent: false, models: {}, modelRegistry: {},
      excludedProviders: [], contestoFilo: { soglia: 50000 }, contestoFiloDiSerie: { giorni: 3, token: 100000, soglia: 70000, cache: '1h' },
    });
    window.__mandati = [];
    const stub = async (msg) => {
      if (msg.type === 'defaults_get') return { ok: true, config: config() };
      if (msg.type === 'defaults_update') { window.__mandati.push(msg.config); return { ok: true, config: config() }; }
      return window.__veroSend ? window.__veroSend(msg) : { ok: true };
    };
    window.__veroSend = window.chrome.runtime.sendMessage.bind(window.chrome.runtime);
    window.chrome.runtime.sendMessage = stub;
  });
  await ricaricaSu(page, 'predefiniti');
  const campo = page.locator('#contestoSoglia');
  await expect(campo).toHaveValue('50000', { timeout: 10000 });
  await expect(campo).toHaveAttribute('placeholder', '70000');
  await expect(page.locator('#contestoSogliaStima')).toHaveText(STIMA, { timeout: 15000 });
  await campo.fill('45000');
  await page.click('#saveBtn');
  await expect.poll(() => page.evaluate(() => (window.__mandati.at(-1) || {}).contestoFilo || null), { timeout: 10000 })
    .toEqual({ soglia: 45000 });
});

test('riaperto Filo dopo ore di pausa, col tratto grande il primo messaggio compatta per la pausa', async ({ app }) => {
  // L'app appena aperta non ha una richiesta precedente in memoria, come dopo un riavvio.
  const page = await home(app);
  const T = 30000;
  const { soglia } = await app.evaluate(async (_e, T) => {
    const FC = globalThis.SN_FILO_CONTESTO;
    const b = FC.stimaToken(JSON.stringify(globalThis.SN_ACTION_TOOLS.definitions()) + globalThis.SN_CONST.PROMPTS.filoChatStatic());
    // Una soglia che la richiesta non passa, nemmeno all'80% (niente compattazione in anticipo), col tratto oltre il 30%.
    const soglia = Math.ceil((b + T + 6000) / 0.8 / 1000) * 1000;
    const s = await globalThis.SN_STORAGE.getSettings();
    await globalThis.SN_STORAGE.updateSettings({ contestoFilo: { ...(s.contestoFilo || {}), soglia } });
    const t0 = Date.now() - 3 * 60 * 60 * 1000;
    for (let i = 0; i < 3; i++) {
      await globalThis.SN_FILO_CHATS.append('vecchia9', { role: 'user', text: `Appunti ${i}: ${'il favo è fatto di cera. '.repeat(Math.ceil((T / 3) * 3.5 / 25))}`, ts: new Date(t0 + i * 60000).toISOString() });
      await globalThis.SN_FILO_CHATS.append('vecchia9', { role: 'filo', text: 'Annotato.', ts: new Date(t0 + i * 60000 + 5000).toISOString() });
    }
    return { soglia };
  }, T);
  expect(T, 'il tratto è «grande»').toBeGreaterThan(0.3 * soglia);
  await modelloFinto(app, [{ text: 'Bentornato.' }]);
  await compattatoreFinto(app, RIGA);
  try {
    await chiedi(page, 'eccomi, riprendiamo');
    await expect(page.locator('.dash-bubble').filter({ hasText: 'Bentornato.' })).toBeVisible({ timeout: 20000 });
    expect((await app.evaluate(() => globalThis.__compattazioni)).map((c) => c.motivo)).toEqual(['fermo']);
    const [richiesta] = await chiamateAlModello(app);
    expect(richiesta[0].content, 'la richiesta ha il diario al posto del tratto vecchio').toContain(RIGA);
    expect(JSON.stringify(richiesta.slice(1))).not.toContain('il favo è fatto di cera');
  } finally {
    await rimettiCompattatore(app);
    await ripristina(app);
  }
});

// Turni pesanti (un capitolo incollato a ogni messaggio, circa 5.000 token): dopo una compattazione resta spazio sotto
// la soglia, così la chat non compatta a ogni messaggio e la risposta non la aspetta (giro 4 di #1563).
test('turni da circa 5.000 token: la chat compatta ogni qualche messaggio, in sottofondo, non prima di ogni risposta', async ({ app }) => {
  test.setTimeout(300000);
  const page = await home(app);
  await modelloFinto(app, [{ text: 'Letto, ecco il punto.' }]);
  await compattatoreFinto(app, '10:00 letto un capitolo della tesi');
  const perMessaggio = [];
  try {
    for (let i = 0; i < 12; i++) {
      await chiedi(page, `Capitolo ${i}: ${'Le api tornano all\'alveare e danzano per le compagne. '.repeat(330)}`);
      await expect.poll(async () => (await chiamateAlModello(app)).length, { timeout: 30000 }).toBe(i + 1);
      // La compattazione in anticipo parte dopo la risposta: le si dà il tempo di finire.
      await page.waitForTimeout(1500);
      perMessaggio.push((await app.evaluate(() => globalThis.__compattazioni)).map((c) => c.motivo));
    }
  } finally {
    await rimettiCompattatore(app);
    await ripristina(app);
  }
  const nuove = perMessaggio.map((c, i) => c.slice(i ? perMessaggio[i - 1].length : 0));
  const con = nuove.map((c, i) => (c.length ? i : -1)).filter((i) => i >= 0);
  expect(con.length, 'la chat compatta').toBeGreaterThan(1);
  for (const i of con) expect(con.includes(i + 1) || con.includes(i + 2), `compattazioni per messaggio: ${JSON.stringify(nuove)}`).toBe(false);
  expect(nuove.flat().filter((m) => m === 'soglia'), 'nessuna risposta aspetta la compattazione').toEqual([]);
  const ultima = (await chiamateAlModello(app)).at(-1);
  expect(await tokenDi(app, ultima)).toBeLessThan(70000);
});

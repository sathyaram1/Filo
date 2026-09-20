// #525 — le chat con Filo si salvano, si ritrovano e si riaprono.
//
// Prima: una chat viveva solo nella pagina aperta, e tornando alla home
// spariva. Restava un registro interno coi primi 200 caratteri di ogni
// messaggio, che serve all'agente delle lezioni e non all'utente: una
// discussione di ieri non era recuperabile da nessuna parte.
//
// Qui si prova il cammino dell'utente per intero: si fa una chat, la si
// chiude, la si ritrova in Cronologia, la si cerca per una parola detta a metà
// conversazione, la si riapre e ci si continua a scrivere dentro.
//
// Senza la cura ogni assert di questo file è rosso: prima del #525 non c'era
// nessun posto in cui una chat finita potesse esistere.

import { test, expect } from './fixtures/electron.mjs';

const ARCHIVE = 'filo://archive/archive.html';

// Modelli di prova + chiave finta: senza, la chat non parte nemmeno. E
// l'intervista di benvenuto chiusa: su un profilo appena nato è APERTA, e
// finché lo è ogni chat è l'intervista — cioè sempre una conversazione (#524,
// ed è il comportamento giusto). Qui vogliamo provare le chat normali.
async function configura(app) {
  await app.evaluate(async () => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_FILO_MEMORY.setOnboarding({ done: true, ticked: [], thread: [] });
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      models: {
        [C.ACTIONS.FILO_CHAT]: 'deepseek-flash',
        [C.ACTIONS.FILO_DASHBOARD]: 'deepseek-flash',
        [C.ACTIONS.FILO_CHAT_TRIAGE]: 'deepseek-flash',
      },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
    });
  });
}

// Un provider finto per tutta la sessione: la chat risponde con una frase
// fissa, e il classificatore con il tipo e il titolo che gli si dice di dare.
// `triage` è una mappa: pezzo di testo trovato nella trascrizione → risposta.
async function stubProvider(app, triage) {
  await app.evaluate(async (_e, { triage }) => {
    globalThis.__filoTriage = triage;
    if (!globalThis.__filoOrigComplete) {
      globalThis.__filoOrigComplete = globalThis.SN_PROVIDERS.completeWithFallback;
    }
    const rispondi = ({ attempts, messages }) => {
      const joined = messages
        .map((m) => (typeof m.content === 'string' ? m.content : JSON.stringify(m.content)))
        .join('\n');
      const base = { model: attempts[0].model, provider: attempts[0].provider, usage: {} };
      // Il classificatore delle chat: lo si riconosce dalle sue istruzioni.
      if (joined.includes('Classifichi le conversazioni')) {
        for (const [ago, risposta] of Object.entries(globalThis.__filoTriage || {})) {
          if (joined.includes(ago)) return { ...base, text: JSON.stringify(risposta) };
        }
        return { ...base, text: JSON.stringify({ tipo: 'conversazione', titolo: 'Senza etichetta' }) };
      }
      return { ...base, text: JSON.stringify({ text: 'Va bene, ci penso.', actions: [] }) };
    };
    globalThis.SN_PROVIDERS.completeWithFallback = async (o) => rispondi(o);
    // Un turno che arriva dalla HOME passa dallo streaming, non da
    // completeWithFallback: stubbare solo quello faceva fallire il turno con
    // «chiave rifiutata» e la prova non provava niente.
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = async (o) => rispondi(o);
  }, { triage });
}

// Un turno di chat dentro la chat `chatId`, come lo manda la home.
function turno(app, chatId, userMessage) {
  return app.evaluate(
    (_e, { chatId, userMessage }) => globalThis.SN_HANDLE_FILO_CHAT({ userMessage, threadHistory: [], chatId }),
    { chatId, userMessage },
  );
}

// La chiusura della chat: è quello che fa la home tornando alla home.
function chiudi(app, chatId) {
  return app.evaluate((_e, id) => globalThis.SN_CLOSE_FILO_CHAT(id), chatId);
}

function leggiArchivio(app) {
  return app.evaluate(() => globalThis.SN_FILO_CHATS.list());
}

// Due chat pronte: una discussione e un comando.
async function preparaDueChat(app) {
  await configura(app);
  await stubProvider(app, {
    coscienza: { tipo: 'conversazione', titolo: 'La coscienza è emergente?' },
    sveglia: { tipo: 'comando', titolo: 'Sveglia alle sette' },
  });
  await turno(app, 'chat-discussione', 'Secondo te la coscienza è emergente?');
  await turno(app, 'chat-comando', 'Metti una sveglia alle 7');
  await chiudi(app, 'chat-discussione');
  await chiudi(app, 'chat-comando');
}

test('una chat finita si salva per intero e si ritrova in Cronologia', async ({ app, openTab }) => {
  await preparaDueChat(app);

  // Su disco c'è TUTTA la conversazione, non i primi 200 caratteri.
  const salvate = await leggiArchivio(app);
  expect(salvate.length).toBe(2);
  const disc = salvate.find((c) => c.id === 'chat-discussione');
  expect(disc.messages.map((m) => m.role)).toEqual(['user', 'filo']);
  expect(disc.messages[0].text).toBe('Secondo te la coscienza è emergente?');
  expect(disc.messages[1].text).toBe('Va bene, ci penso.');
  expect(disc.title).toBe('La coscienza è emergente?');
  expect(disc.kind).toBe('conversazione');
  const cmd = salvate.find((c) => c.id === 'chat-comando');
  expect(cmd.kind).toBe('comando');
  // Classificata «comando» ma conservata intera: la classificazione decide
  // cosa si VEDE, mai cosa si conserva.
  expect(cmd.messages.length).toBe(2);

  // In pagina: la conversazione si vede, il comando no (ma esiste).
  const page = await openTab(ARCHIVE);
  const righe = page.locator('.arc-chat');
  await expect(righe).toHaveCount(1);
  await expect(righe.first()).toContainText('La coscienza è emergente?');
  await expect(page.locator('#chatsSection')).toBeVisible();
});

test('i comandi ci sono sempre: stanno sotto l’interruttore, non nel cestino', async ({ app, openTab }) => {
  await preparaDueChat(app);
  const page = await openTab(ARCHIVE);

  await expect(page.locator('.arc-chat')).toHaveCount(1);
  await expect(page.locator('#showCommandsLabel')).toBeVisible();
  await expect(page.locator('#showCommandsText')).toContainText('Mostra anche i comandi (1)');

  await page.locator('#showCommands').check();
  await expect(page.locator('.arc-chat')).toHaveCount(2);
  await expect(page.locator('.arc-chat[data-kind="comando"]')).toContainText('Sveglia alle sette');

  // E si richiude: nascondere e mostrare sono la stessa strada nei due versi.
  await page.locator('#showCommands').uncheck();
  await expect(page.locator('.arc-chat')).toHaveCount(1);
});

test('la ricerca trova una parola detta a metà conversazione, non solo nel titolo', async ({ app, openTab }) => {
  await configura(app);
  await stubProvider(app, {
    Marte: { tipo: 'conversazione', titolo: 'Due chiacchiere' },
    torta: { tipo: 'conversazione', titolo: 'Altro discorso' },
  });
  await turno(app, 'c-marte', 'Parlami della gravità su Marte');
  await turno(app, 'c-torta', 'Come si fa la torta di mele');
  await chiudi(app, 'c-marte');
  await chiudi(app, 'c-torta');

  const page = await openTab(ARCHIVE);
  await expect(page.locator('.arc-chat')).toHaveCount(2);

  // "Marte" non compare in nessun titolo: sta dentro il messaggio.
  await page.locator('#search').fill('marte');
  await expect(page.locator('.arc-chat')).toHaveCount(1);
  await expect(page.locator('.arc-chat').first()).toContainText('Due chiacchiere');

  // Senza accenti e senza maiuscole, come si scrive di fretta.
  await page.locator('#search').fill('GRAVITA');
  await expect(page.locator('.arc-chat')).toHaveCount(1);

  // Nessun risultato: lo dice, invece di sembrare un archivio cancellato.
  await page.locator('#search').fill('astronomia siderale');
  await expect(page.locator('.arc-chat')).toHaveCount(0);
  await expect(page.locator('#chatEmpty')).toContainText('Nessuna chat per');

  await page.locator('#search').fill('');
  await expect(page.locator('.arc-chat')).toHaveCount(2);
});

test('una chat si riapre per intero e ci si continua a scrivere dentro', async ({ app, openTab }) => {
  await preparaDueChat(app);

  const dash = await openTab('filo://dashboard/dashboard.html?chat=chat-discussione');
  const bolle = dash.locator('.dash-bubble');
  await expect(bolle).toHaveCount(2);
  await expect(bolle.nth(0)).toContainText('Secondo te la coscienza è emergente?');
  await expect(bolle.nth(1)).toContainText('Va bene, ci penso.');
  // La conversazione riaperta è in primo piano, non la home.
  await expect(dash.locator('body')).toHaveAttribute('data-state', 'thread');

  // Si scrive ancora: il messaggio nuovo va nella STESSA chat, non in una gemella.
  await dash.locator('#input').fill('E il libero arbitrio?');
  await dash.locator('#input').press('Enter');
  await expect(bolle).toHaveCount(4);

  await expect.poll(async () => {
    const chats = await leggiArchivio(app);
    return chats.find((c) => c.id === 'chat-discussione').messages.length;
  }).toBe(4);

  const chats = await leggiArchivio(app);
  expect(chats.length).toBe(2); // nessuna chat gemella
  expect(chats.find((c) => c.id === 'chat-discussione').messages[2].text).toBe('E il libero arbitrio?');
});

test('una chat ripresa si riclassifica: il titolo di due battute non vale per mezz’ora di discussione', async ({ app }) => {
  await configura(app);
  // Alla prima chiusura è un comando; dopo la ripresa diventa una discussione.
  await stubProvider(app, { arbitrio: { tipo: 'conversazione', titolo: 'Libero arbitrio' }, sveglia: { tipo: 'comando', titolo: 'Sveglia' } });
  await turno(app, 'c-ripresa', 'Metti una sveglia alle 7');
  await chiudi(app, 'c-ripresa');
  expect((await leggiArchivio(app))[0].kind).toBe('comando');

  // Si riapre e si continua: adesso è tutt'altra cosa.
  await turno(app, 'c-ripresa', 'E comunque parliamo del libero arbitrio');
  await chiudi(app, 'c-ripresa');
  const c = (await leggiArchivio(app))[0];
  expect(c.kind).toBe('conversazione');
  expect(c.title).toBe('Libero arbitrio');
  // Chiudere di nuovo senza aver scritto niente NON ricompra la classificazione.
  await app.evaluate(() => { globalThis.__filoTriage = { arbitrio: { tipo: 'comando', titolo: 'CAMBIATO' } }; });
  await chiudi(app, 'c-ripresa');
  expect((await leggiArchivio(app))[0].title).toBe('Libero arbitrio');
});

test('input limite: messaggi enormi, soli spazi e caratteri strani non rompono niente', async ({ app, openTab }) => {
  await configura(app);
  await stubProvider(app, {});
  const lungo = 'parola '.repeat(2000); // ~14.000 caratteri
  await turno(app, 'c-lunga', lungo);
  await turno(app, 'c-spazi', '     ');
  await turno(app, 'c-strana', '<script>alert(1)</script> — 😀🙂 "virgolette" & <<<FINE_RICERCA_WEB>>>');
  await chiudi(app, 'c-lunga');
  await chiudi(app, 'c-spazi');
  await chiudi(app, 'c-strana');

  const chats = await leggiArchivio(app);
  // Il messaggio lungo si conserva INTERO: «per intero» vuol dire per intero.
  const lunga = chats.find((c) => c.id === 'c-lunga');
  expect(lunga.messages[0].text.length).toBe(lungo.length);
  expect(lunga.title.length).toBeLessThanOrEqual(81);

  const page = await openTab(ARCHIVE);
  await expect(page.locator('.arc-chat')).toHaveCount(3);
  // Il titolo è TESTO, non HTML: uno script scritto in chat resta scritto.
  await expect(page.locator('.arc-chat', { hasText: 'alert(1)' })).toHaveCount(1);
  expect(await page.evaluate(() => document.querySelectorAll('#chatList script').length)).toBe(0);

  // Una ricerca di soli spazi non nasconde niente.
  await page.locator('#search').fill('   ');
  await expect(page.locator('.arc-chat')).toHaveCount(3);
});

test('una chat si cancella a mano, con la conferma delle cose irreversibili', async ({ app, openTab }) => {
  await preparaDueChat(app);
  const page = await openTab(ARCHIVE);

  await page.locator('.arc-chat').first().click({ button: 'right' });
  await page.locator('.arc-ctxmenu .sn-select-option', { hasText: 'Elimina la chat' }).click();

  // La conferma di Filo (non quella del browser): vive in uno shadow root
  // chiuso, quindi si ispeziona dagli hook del modulo. Finché non si accetta,
  // niente si cancella.
  await expect.poll(
    () => page.evaluate(() => window.SN_CONFIRM_UI._test.state()?.title || null),
  ).toBe('Elimina la chat');
  expect((await leggiArchivio(app)).length).toBe(2);

  // Prima si prova a rinunciare: annullare NON deve cancellare niente.
  expect(await page.evaluate(() => window.SN_CONFIRM_UI._test.click('cancel'))).toBe(true);
  await expect(page.locator('.arc-chat')).toHaveCount(1);
  expect((await leggiArchivio(app)).length).toBe(2);

  // E adesso davvero.
  await page.locator('.arc-chat').first().click({ button: 'right' });
  await page.locator('.arc-ctxmenu .sn-select-option', { hasText: 'Elimina la chat' }).click();
  await expect.poll(
    () => page.evaluate(() => window.SN_CONFIRM_UI._test.state()?.title || null),
  ).toBe('Elimina la chat');
  expect(await page.evaluate(() => window.SN_CONFIRM_UI._test.click('danger') || window.SN_CONFIRM_UI._test.click('ok'))).toBe(true);
  await expect(page.locator('.arc-chat')).toHaveCount(0);
  await expect.poll(async () => (await leggiArchivio(app)).length).toBe(1);
});

test('una chat lasciata aperta da una sessione finita di colpo viene chiusa e classificata dopo', async ({ app }) => {
  await configura(app);
  await stubProvider(app, { fotosintesi: { tipo: 'conversazione', titolo: 'Fotosintesi' } });
  await turno(app, 'c-appesa', 'Spiegami la fotosintesi');

  // Nessuna chiusura: è quello che succede quando l'app muore a metà chat.
  let chats = await leggiArchivio(app);
  expect(chats[0].closedAt).toBe(null);
  expect(chats[0].kind).toBe(null);

  // Il giro di riordino che parte all'avvio successivo.
  await app.evaluate(() => globalThis.SN_SWEEP_FILO_CHATS());
  await expect.poll(async () => (await leggiArchivio(app))[0].kind).toBe('conversazione');
  chats = await leggiArchivio(app);
  expect(chats[0].title).toBe('Fotosintesi');
  expect(chats[0].closedAt).not.toBe(null);
  // La conversazione non è stata toccata: era già tutta lì da prima.
  expect(chats[0].messages.length).toBe(2);
});

test('senza modello la chat non si perde: prende il primo messaggio come titolo e resta in vista', async ({ app, openTab }) => {
  await configura(app);
  // Il classificatore fallisce (provider che lancia): è il caso "niente
  // chiave", "limite di spesa", "rete assente".
  await app.evaluate(async () => {
    if (!globalThis.__filoOrigComplete) {
      globalThis.__filoOrigComplete = globalThis.SN_PROVIDERS.completeWithFallback;
    }
    const rispondi = ({ attempts, messages }) => {
      const joined = messages
        .map((m) => (typeof m.content === 'string' ? m.content : JSON.stringify(m.content)))
        .join('\n');
      if (joined.includes('Classifichi le conversazioni')) throw new Error('niente modello');
      return {
        text: JSON.stringify({ text: 'Ecco.', actions: [] }),
        model: attempts[0].model, provider: attempts[0].provider, usage: {},
      };
    };
    globalThis.SN_PROVIDERS.completeWithFallback = async (o) => rispondi(o);
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = async (o) => rispondi(o);
  });

  await turno(app, 'c-senza-modello', 'Quanto dista la Luna?');
  await chiudi(app, 'c-senza-modello');

  const chats = await leggiArchivio(app);
  expect(chats[0].title).toBe('Quanto dista la Luna?');
  expect(chats[0].kind).toBe(null);

  // E in pagina si vede lo stesso: nel dubbio si mostra.
  const page = await openTab(ARCHIVE);
  await expect(page.locator('.arc-chat')).toHaveCount(1);
  await expect(page.locator('.arc-chat').first()).toContainText('Quanto dista la Luna?');
});

test('Filo ritrova una conversazione di prima e la rilegge', async ({ app }) => {
  await configura(app);
  await stubProvider(app, { coscienza: { tipo: 'conversazione', titolo: 'La coscienza' } });
  await turno(app, 'c-vecchia', 'La coscienza secondo te è emergente?');
  await chiudi(app, 'c-vecchia');

  // La ricerca: torna l'elenco con id, titolo e il frammento che combacia.
  const ricerca = await app.evaluate(
    () => globalThis.SN_EXECUTE_FILO_ACTION({ type: 'CERCA_CHAT', query: 'coscienza' }, { confirmed: false }),
  );
  expect(ricerca.executed).toBe(true);
  expect(ricerca.output.results.length).toBe(1);
  expect(ricerca.output.results[0].id).toBe('c-vecchia');
  expect(ricerca.output.results[0].title).toBe('La coscienza');

  // La rilettura per id: torna la conversazione, con chi ha detto cosa.
  const lettura = await app.evaluate(
    () => globalThis.SN_EXECUTE_FILO_ACTION({ type: 'CERCA_CHAT', id: 'c-vecchia' }, { confirmed: false }),
  );
  expect(lettura.output.found).toBe(true);
  expect(lettura.output.transcript).toContain('Utente: La coscienza secondo te è emergente?');
  expect(lettura.output.transcript).toContain('Filo:');

  // Una chat che non c'è non finge di esserci.
  const vuota = await app.evaluate(
    () => globalThis.SN_EXECUTE_FILO_ACTION({ type: 'CERCA_CHAT', id: 'mai-esistita' }, { confirmed: false }),
  );
  expect(vuota.output.found).toBe(false);
});

test('la chat in corso non torna fra i risultati: non è un ricordo, è adesso', async ({ app }) => {
  await configura(app);
  await stubProvider(app, {});
  await turno(app, 'c-aperta', 'Parliamo di vulcani');

  const r = await app.evaluate(
    () => globalThis.SN_EXECUTE_FILO_ACTION({ type: 'CERCA_CHAT', query: 'vulcani' }, { confirmed: false }),
  );
  expect(r.output.results.length).toBe(0);
});

test('una chat vuota non lascia un guscio senza titolo in Cronologia', async ({ app, openTab }) => {
  await preparaDueChat(app);
  // Una home aperta e mai usata: la targa c'è, i messaggi no.
  await chiudi(app, 'chat-mai-usata');
  const page = await openTab(ARCHIVE);
  await expect(page.locator('.arc-chat')).toHaveCount(1);
  expect((await leggiArchivio(app)).length).toBe(2);
});

test('l’intervista di benvenuto resta una conversazione anche se il modello dice "comando"', async ({ app, openTab }) => {
  // Niente `configura`: su un profilo nuovo l'intervista è APERTA, e la prima
  // chat È l'intervista. Il classificatore qui risponde sempre "comando":
  // deve perdere.
  await app.evaluate(async () => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      models: {
        [C.ACTIONS.FILO_CHAT]: 'deepseek-flash',
        [C.ACTIONS.FILO_CHAT_TRIAGE]: 'deepseek-flash',
      },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
    });
  });
  await stubProvider(app, { Utente: { tipo: 'comando', titolo: 'Due parole' } });

  await turno(app, 'c-accoglienza', 'Ciao, mi chiamo Ada');
  await chiudi(app, 'c-accoglienza');

  const chats = await leggiArchivio(app);
  expect(chats[0].onboarding).toBe(true);
  expect(chats[0].kind).toBe('conversazione');

  // E quindi si vede senza toccare l'interruttore dei comandi.
  const page = await openTab(ARCHIVE);
  await expect(page.locator('.arc-chat')).toHaveCount(1);
});

test('l’intervista spezzata su più aperture resta UNA chat, non cinque', async ({ app, shell }) => {
  test.setTimeout(90_000);
  // L'intervista di benvenuto si svolge nella home vera, e chi la lascia a
  // metà la riprende riaprendo Filo. Se ogni caricamento della scheda aprisse
  // una chat nuova, in Cronologia se ne troverebbe una manciata di monconi.
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await pagineNuovaScheda(app);
  await app.evaluate(async () => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      models: {
        [C.ACTIONS.FILO_CHAT]: 'deepseek-flash',
        [C.ACTIONS.FILO_LESSON]: 'deepseek-flash',
        [C.ACTIONS.FILO_COMPACT]: 'deepseek-flash',
        [C.ACTIONS.FILO_DASHBOARD]: 'deepseek-flash',
        [C.ACTIONS.FILO_CHAT_TRIAGE]: 'deepseek-flash',
      },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
    });
    const P = globalThis.SN_PROVIDERS;
    const reply = () => JSON.stringify({ text: 'Piacere!', actions: [] });
    P.streamCompleteWithFallback = async ({ attempts }) => ({ text: reply(), model: attempts[0].model, provider: attempts[0].provider, usage: {} });
    P.completeWithFallback = async ({ attempts }) => ({ text: reply(), model: attempts[0].model, provider: attempts[0].provider, usage: {} });
  });
  await page.reload();
  await expect(page.locator('body')).toHaveAttribute('data-state', 'thread', { timeout: 15_000 });

  await page.locator('#input').fill('Mi chiamo Ada');
  await page.locator('#input').press('Enter');
  await expect(page.locator('.dash-bubble-filo', { hasText: 'Piacere!' }).first()).toBeVisible({ timeout: 20_000 });

  // Si chiude Filo a metà intervista e si riapre: la conversazione riprende.
  await page.reload();
  await expect(page.locator('body')).toHaveAttribute('data-state', 'thread', { timeout: 15_000 });
  await page.locator('#input').fill('Lavoro sui compilatori');
  await page.locator('#input').press('Enter');
  await expect.poll(async () => {
    const chats = await leggiArchivio(app);
    return chats.length === 1 ? chats[0].messages.length : `${chats.length} chat`;
  }, { timeout: 20_000 }).toBe(4);

  const chats = await leggiArchivio(app);
  expect(chats[0].onboarding).toBe(true);
});

test('la sezione delle chat non compare quando non c’è ancora nessuna chat', async ({ app, openTab }) => {
  await configura(app);
  const page = await openTab(ARCHIVE);
  await expect(page.locator('#chatsSection')).toBeHidden();
  await expect(page.locator('#tabsSection')).toBeHidden();
});

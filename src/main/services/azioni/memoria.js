// Le azioni di Filo sulla memoria, sulle chat archiviate e sulle pagine del filo.
// Ogni file esporta la tabella tipo -> funzione che eseguiAzioneFilo (handlers.js) consulta dopo il preambolo.

const Defaults = require('../defaultsStore');
const { SN_CONST, SN_MSG } = globalThis;
const { ACTIONS, PROMPTS } = SN_CONST;
const FiloChats = globalThis.SN_FILO_CHATS;       // #525 — archivio delle chat con Filo
const ChatArchive = globalThis.SN_CHAT_ARCHIVE;   // #525 — titoli, tipi, ricerca (logica pura)
const FiloMem = globalThis.SN_FILO_MEMORY;
const Onboarding = globalThis.SN_ONBOARDING;
const { broadcastLiveUpdate } = require('../broadcast');
const { getEffectiveSettings, modelForAction } = require('../impostazioniEffettive');
const { paginePerChat, cambiPerChat, rilettura, espandiFilo } = require('../osservazioniPerModello');
const { maybeRunCompactor } = require('../chiamateModello');
const { cancellaChatPerSempre, nascondiChat } = require('../archivioChat');
const { saveOnboarding } = require('../intervista');
const { finestreDeiModelli } = require('../turnoChat');

async function azioneSalvaAppunto(action) {
  // Filo scrive l'appunto in un file dell'editor: accoda al file attivo finché l'argomento
  // resta lo stesso. Punti di ripristino prima e dopo, quindi è sempre annullabile.
  const text = action.text || action.testo;
  const topic = action.context || action.contesto || action.argomento || '';
  const forceNew = !!(action.nuovo || action.new || action.newFile || action.nuovoAppunto);
  let wrote = false;
  if (text) {
    try {
      const EF = require('../editorFiles');
      const r = await EF.writeNote({ text, topic, forceNew });
      wrote = !!(r && r.wrote);
    } catch (e) {
      console.warn('[Filo] salvataggio appunto fallito', e?.message || e);
    }
  }
  if (wrote) broadcastLiveUpdate();
  return { executed: wrote, kept: false };
}

async function azioneSalvaLezione(action, { chatId }) {
  // Qui ci si arriva solo dopo l'OK dell'utente sul testo esatto (livello
  // 2, #592). La lezione entra nel buffer e da subito in LEZIONI RECENTI
  // di ogni conversazione; l'utente la rilegge e la toglie in Preferenze.
  const l = global.SN_PREF.lezioneDaAzione(action);
  if (l.rifiuto) return { executed: false, kept: false, output: { error: l.rifiuto, rifiuto: true } };
  let fissata = false;
  let nuova = null;
  if (l.testo) {
    try {
      let fonte = '';
      try { fonte = chatId ? await globalThis.SN_IL_FILO.ultimaDomanda(chatId) : ''; } catch (_) {}
      const w = await FiloMem.scriviLezione(l.testo, { fonti: fonte ? [fonte] : [] });
      if (w.riga) nuova = { ts: w.riga.ts, text: w.riga.text };
      fissata = true;
      if (await FiloMem.lessonsBufferShouldCompact()) {
        maybeRunCompactor().catch((e) => console.warn('[Filo] compact failed', e));
      }
    } catch (e) {
      console.warn('[Filo] salvataggio lezione fallito', e?.message || e);
    }
  }
  // Nel benvenuto la chat la dice in una riga col suo Annulla, che la riconosce da data e testo (#1297).
  const ricordo = fissata && nuova && globalThis.SN_ACTION_LEVELS.lezioneDellAccoglienza(action);
  return ricordo
    ? { executed: true, kept: true, output: { ricordo: nuova } }
    : { executed: fissata, kept: false };
}

async function azioneEspandiFilo(action) {
  // SPEC-CONTESTO § Tre livelli: sotto una riga del diario, il grezzo di quelle ore. Sola lettura.
  const r = await espandiFilo(action.da, action.a);
  return r.errore
    ? { executed: false, kept: true, output: { espanso: true, error: r.errore } }
    : { executed: true, kept: true, output: { espanso: true, ...r } };
}

async function azioneCercaChat(action, { chatId, nascostiDellaChat, capRilettura }) {
  // #525 — l'archivio delle chat passate, per «riprendi la discussione
  // di ieri sulla coscienza». Due passi come LEGGI_FILE: prima l'elenco
  // di cosa combacia, poi — se serve — una conversazione per intero.
  // Sola lettura.
  const query = String(action.query ?? action.testo ?? action.q ?? '').trim();
  const id = String(action.id ?? action.chatId ?? '').trim();
  try {
    if (id) {
      const chat = await FiloChats.get(id);
      if (!chat) return { executed: false, kept: true, output: { chatRead: id, found: false } };
      // Nascosta dall'utente (#1295): Filo sa che c'è e come si chiama, il testo torna solo dopo RIMETTI_CHAT.
      if (chat.nascosta) {
        return { executed: true, kept: true, output: { chatRead: id, found: true, nascosta: true, title: chat.title || ChatArchive.fallbackTitle(chat.messages) } };
      }
      // Una rilettura sta nella finestra del modello insieme al resto della richiesta (#868.7): oltre, testa, coda e
      // il resto a pezzi della stessa misura. Fuori dalla chat vale il tetto in token.
      let cap = globalThis.SN_FILO_CONTESTO.RILETTURA_MIN;
      try {
        if (typeof capRilettura === 'function') cap = await capRilettura();
        else {
          const FC = globalThis.SN_FILO_CONTESTO;
          const s = await getEffectiveSettings();
          const finestra = finestreDeiModelli.get(String(modelForAction(s, ACTIONS.FILO_CHAT) || ''));
          cap = FC.capRilettura({ tetto: Math.min(FC.tetti(s.contestoFilo, Defaults.get().contestoFilo).token, finestra ?? Infinity) });
        }
      } catch (_) {}
      return { executed: true, kept: true, output: rilettura(chat, { da: action.da, cap }) };
    }
    // #868 — tutto il filo: le conversazioni di ogni scheda, le pagine visitate e i cambi. Di quella di adesso solo
    // i messaggi che il modello non ha davanti: ritrovarsi come risultato quelli che ha gliel'avrebbe fatti
    // raccontare come un ricordo, ma una conversazione ripresa o lunga ha un inizio che si cerca.
    const all = await FiloChats.list();
    const altre = all.filter((c) => c && c.id !== chatId && Array.isArray(c.messages) && c.messages.length);
    const nascosti = Array.isArray(nascostiDellaChat) ? nascostiDellaChat : [];
    const corrente = chatId && nascosti.length ? all.find((c) => c && c.id === chatId) : null;
    if (corrente) altre.push({ ...corrente, messages: nascosti });
    // «Riprendi la discussione di ieri sulla coscienza» arriva qui come
    // frase, non come parola chiave: pretendere che compaiano tutte le
    // parole faceva rispondere "non c'è niente" su una chat che c'era.
    // Se la ricerca stretta non trova niente si allarga alle parole che
    // distinguono, e l'esito dice con quali ha cercato davvero.
    const { results: found, termini, allargata } = ChatArchive.searchWide(altre, query, { limit: 8 });
    // Le nascoste che combaciano: solo nome e data, così Filo può proporre di rimetterle senza leggerle.
    // Senza parole, o chiedendo proprio delle nascoste («quelle che ho tolto»), tornano tutte: si vedono tutte.
    const tutteNascoste = (await FiloChats.list({ nascoste: 'solo' })).filter((c) => c && c.id !== chatId && (c.messages || []).length);
    const combaciano = query ? ChatArchive.searchWide(tutteNascoste, query, { limit: 8 }).results : [];
    const nascosteTutte = !combaciano.length && (!query || ChatArchive.chiedeLeNascoste(query));
    const nascosteTrovate = (nascosteTutte ? tutteNascoste : combaciano)
      .map((c) => ({ id: c.id, title: c.title || ChatArchive.fallbackTitle(c.messages), date: c.closedAt || c.updatedAt || null }));
    const nessunCambio = { cambi: [], termini: [], allargata: false };
    const [pagine, cambiCercati] = query
      ? await Promise.all([paginePerChat(query).catch(() => []), cambiPerChat(query).catch(() => nessunCambio)])
      : [[], nessunCambio];
    const cambiTrovati = cambiCercati.cambi;
    const results = found.map((c) => ({
      id: c.id,
      title: c.title || ChatArchive.fallbackTitle(c.messages),
      date: c.closedAt || c.updatedAt || null,
      kind: c.kind || null,
      snippet: ChatArchive.snippetFor(c, termini.join(' ')),
    }));
    // Un frammento preso da un testo venuto da fuori (l'esito di un comando dato in chat, le parole scritte nell'Aiuto
    // sopra un sito) resta quella lettura; uno preso da una risposta di Filo porta la classe che lei aveva letto (#1508).
    const daFuori = [];
    let classeLetta = 1;
    found.forEach((c, i) => {
      const p = globalThis.SN_FILO_CONTESTO.provenienzaDelFrammento(c, results[i].snippet);
      daFuori.push(...p.daFuori);
      classeLetta = Math.max(classeLetta, p.classeLetta);
    });
    return {
      executed: true,
      kept: true,
      output: {
        chatSearch: query,
        cercatoCon: termini,
        allargata,
        results,
        ...(daFuori.length ? { daFuori } : {}),
        ...(classeLetta > 1 ? { classeLetta } : {}),
        ...(pagine.length ? { pagine } : {}),
        ...(cambiTrovati.length ? { cambi: cambiTrovati } : {}),
        ...(cambiTrovati.length && cambiCercati.allargata ? { cambiCercatiCon: cambiCercati.termini } : {}),
        ...(nascosteTrovate.length ? { nascoste: nascosteTrovate, ...(nascosteTutte ? { nascosteTutte: true } : {}) } : {}),
      },
    };
  } catch (e) {
    return { executed: false, kept: true, output: { chatSearch: query, results: [], error: e?.message || String(e) } };
  }
}

async function azioneCancellaArchivio(action, { confirmed, decisione, daChiedere, sospesa }) {
  // Aspetta il clic sul suo pannello: è un'attesa di conferma, e detta come «non eseguita» la chat la
  // nascondeva come fallita (#825.3). Come chiedere lo dice la risposta di SN_AUTONOMIA (#530), non il
  // pannello: `domanda` viaggia con l'azione.
  if (confirmed) return { executed: false, kept: true };
  return {
    ...(daChiedere ? sospesa() : { executed: false, kept: true }),
    domanda: decisione.digita ? 'conferma' : (daChiedere ? 'chiede' : 'si'), perche: decisione.perche,
  };
}

async function azioneCancellaPagine(action) {
  const cancellate = await globalThis.SN_IL_FILO.cancellaPagine(action._periodo);
  return { executed: true, kept: false, output: { cancellate } };
}

async function azioneCancellaMemoria(action) {
  // Livello 3: l'utente ha già digitato «conferma». Azzera i moduli di memoria e il buffer
  // delle lezioni non compattate. Irreversibile.
  try {
    await FiloMem.setMemory({ PROFILO: '', PREFERENZE: '' });
    await FiloMem.clearLessonsBuffer();
    // Anche le righe nascoste del quaderno: «tutto» comprende quello che l'utente aveva solo tolto (#872).
    await FiloMem.svuotaQuaderno();
    // E le interviste di benvenuto conservate: sono quello che l'utente gli ha raccontato di sé (#1297).
    if (Onboarding) await saveOnboarding(Onboarding.dimentica(await FiloMem.getOnboarding()));
    try { globalThis.SN_CONTATORI_MAIN?.memoriaCorretta('chat', 'svuota', null); } catch (_) {}
    broadcastLiveUpdate();
    return { executed: true, kept: false };
  } catch (e) {
    console.warn('[Filo] cancella memoria fallito', e?.message || e);
    return { executed: false, kept: false };
  }
}

async function azioneCorreggiMemoria(action, { rigaDaCorreggere }) {
  const l = global.SN_PREF.lezioneDaAzione({ testo: String(action.nuovo ?? '').replace(/\s*[\r\n]+\s*/g, ' ') }, { cosa: 'la correzione' });
  if (l.rifiuto) return { executed: false, kept: false, output: { error: l.rifiuto, rifiuto: true } };
  if (!rigaDaCorreggere || !l.testo) {
    return { executed: false, kept: false, output: { corrette: 0, trovate: (action._righe || []).length } };
  }
  const com = await FiloMem.descriviRiga(rigaDaCorreggere.via);
  const ok = await FiloMem.editLine(rigaDaCorreggere.via, l.testo);
  if (ok) { try { globalThis.SN_CONTATORI_MAIN?.memoriaCorretta('chat', 'correggi', com); } catch (_) {} }
  return { executed: ok, kept: false, output: ok ? { corretta: l.testo, prima: rigaDaCorreggere.testo } : { corrette: 0, trovate: 0 } };
}

async function azioneTogliChat(action) {
  if (action.per_sempre === true) {
    const via = await cancellaChatPerSempre(action.id);
    return { executed: via, kept: false, output: { cancellata: via, perSempre: true } };
  }
  const c = await nascondiChat(action.id, true);
  return { executed: !!c, kept: false, output: { nascosta: !!c } };
}

async function azioneRimettiChat(action) {
  const c = await nascondiChat(action.id, false);
  return { executed: !!c, kept: false, output: { rimessa: !!c } };
}

async function azioneDimentica(action, { righeDaDimenticare }) {
  if (!righeDaDimenticare.length) {
    return { executed: false, kept: false, output: { dimenticate: [] } };
  }
  const tolte = [];
  for (const r of righeDaDimenticare) {
    if (r.via && typeof r.via.sempreAperta === 'string') {
      if (await FiloMem.forgetLine(r.via)) tolte.push(r.testo);
      continue;
    }
    const com = await FiloMem.descriviRiga(r.via);
    const id = await FiloMem.hideLine(r.via);
    if (!id) continue;
    try { globalThis.SN_CONTATORI_MAIN?.memoriaCorretta('chat', 'togli', com); } catch (_) {}
    if (action.per_sempre === true) await FiloMem.forgetHiddenForever(id);
    tolte.push(r.testo);
  }
  return { executed: tolte.length > 0, kept: false, output: { dimenticate: tolte, perSempre: action.per_sempre === true } };
}

module.exports = {
  SALVA_APPUNTO: azioneSalvaAppunto,
  SALVA_LEZIONE: azioneSalvaLezione,
  ESPANDI_FILO: azioneEspandiFilo,
  CERCA_CHAT: azioneCercaChat,
  CANCELLA_ARCHIVIO: azioneCancellaArchivio,
  CANCELLA_PAGINE: azioneCancellaPagine,
  CANCELLA_MEMORIA: azioneCancellaMemoria,
  CORREGGI_MEMORIA: azioneCorreggiMemoria,
  TOGLI_CHAT: azioneTogliChat,
  RIMETTI_CHAT: azioneRimettiChat,
  DIMENTICA: azioneDimentica,
};

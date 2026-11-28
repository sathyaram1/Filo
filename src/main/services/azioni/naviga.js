// Le azioni di Filo sulle schede e sulle pagine (aprire, cercare, riaprire, zoom, stile, audio).
// Nata da handlers.js: esporta la tabella tipo -> funzione che eseguiAzioneFilo consulta dopo il preambolo.

const PageRead = require('../pageRead');
const { daFilo, origineDi, paginaNonDiFilo } = require('../handlers/origine');
const SempreAperte = require('../sempreAperte');
const FiloMem = globalThis.SN_FILO_MEMORY;
const { winOf, targetWebTab, nomeDellaScheda } = require('../handlersComuni');
const { chiediAllaPagina } = require('../domandaAllaPagina');
const { getEffectiveSettings } = require('../impostazioniEffettive');
const { contaZoomDallaChat, contaPaginaDallaChat, dallaChat } = require('../autonomiaFonti');
const {
  schedeChiusePerChat, voceChiusa, schedeNumerate, schedaPerNumero, schedaDaMostrare, schedaDaBloccare, bersaglioPausa, bersaglioAudio, salvatePerChat,
  apriPaginaSalvata, leggiPaginaDa, contoRestano,
} = require('../osservazioniPerModello');

async function azioneNaviga(action, { sender, assistente, parole }) {
  // #162 — Filo apre il link DIRETTAMENTE in una nuova scheda, invece di
  // limitarsi a mostrare un bottone che l'utente deve cliccare. La chat di
  // Filo vive nella dashboard (scheda interna): apriamo nel TabManager
  // della finestra, attivando la nuova scheda (l'utente ha chiesto di
  // aprire → vuole arrivarci) — a meno che l'azione chieda il SECONDO
  // PIANO (#376, vedi sotto). La bolla conserva comunque un riferimento
  // cliccabile per riaprirlo (kept:true).
  let url = globalThis.SN_ACTION_LEVELS.indirizzoDi(action);
  if (!url) return { executed: false, kept: false };
  // Un file del computer passa solo col giudizio scritto prima del gate (handlers.js, #1905): lì si apre com'è sul disco.
  const file = globalThis.SN_URL_NAV.fileDiQuestoComputer(url);
  if (file) {
    if (typeof action._fileDelComputer !== 'string' || !action._fileDelComputer) return { executed: false, kept: true, output: { blocked: 'file', motivo: 'non_giudicato' } };
    url = require('../fileDelComputer').indirizzoDi(action._fileDelComputer);
  }
  // SICUREZZA: oltre al file giudicato qui sopra, l'agente non apre schemi non-web. Una pagina ostile può
  // iniettare istruzioni nel modello (prompt injection) per fargli aprire
  // un file://attacker (leak hash NTLM su Windows) o data:/javascript:.
  // NAVIGA è livello 1 (nessuna conferma), quindi il filtro è qui. Un URL
  // "nudo" (es. "example.com") non parsa e prosegue: openTab → normalizeUrl
  // gli antepone https://.
  // Si giudica quello che diventerà caricandolo: un percorso del computer scritto com'è è un file (#482 giro 2).
  const caricato = /^[a-z][a-z0-9+.-]*:/i.test(url) ? url : (globalThis.SN_URL_NAV?.normalizeUrl?.(url) || url);
  try {
    const proto = new URL(caricato).protocol.toLowerCase();
    if (!file && !['http:', 'https:', 'filo:'].includes(proto)) {
      return { executed: false, kept: true, output: { blocked: 'scheme' } };
    }
  } catch (_) { /* URL non assoluto: lo normalizza openTab */ }
  // Apertura in SECONDO PIANO quando ciò che Filo apre non va guardato adesso: la scheda
  // nasce senza rubare il primo piano. Il flag accetta anche «true» stringa, dai più piccoli.
  const truthy = (v) => v === true || v === 1 || /^(true|1|si|sì|yes)$/i.test(String(v ?? ''));
  const background = truthy(action.background ?? action.secondoPiano
    ?? action.secondo_piano ?? action.sfondo ?? action.inBackground);
  let opened = false;
  let tabId = null;
  try {
    const win = winOf(sender);
    const tm = win && win._filoTabs;
    if (tm && typeof tm.openTab === 'function') {
      // Per il giudizio sui siti chiedere a parole vale un clic (la pagina di ringraziamento scarica per richiesta), e
      // l'assistente di una pagina apre un indirizzo che quella pagina gli ha messo davanti: arriva da quel sito.
      // Vale anche il clic vero sull'interfaccia di Filo sopra la pagina (il tasto destro «Apri in nuova tab»).
      const chiesto = !!String(parole || '').trim() || require('../permessiPagine').gestoDellUtente(sender && sender.wc);
      let daPagina = '';
      try { daPagina = assistente && sender && sender.wc ? String(sender.wc.getURL() || '') : ''; } catch (_) {}
      const origine = paginaNonDiFilo(daPagina) ? { tipo: 'link', da: daPagina, gesto: chiesto } : { tipo: 'filo', gesto: chiesto };
      contaPaginaDallaChat(url, win);
      tabId = tm.openTab(url, { activate: !background, origine, fileDelComputer: !!file });
      // Gli schemi non web sono esclusi qui sopra: una scheda che non
      // nasce è la lista dei siti bloccati (#590), e la chat lo deve dire.
      // L'assistente sulla pagina può poi chiedere «Apri comunque» solo per quello che gli è stato fermato.
      const fermata = (host, reason, target) => {
        if (assistente && sender && sender.wc && typeof tm.ricordaApribile === 'function') tm.ricordaApribile(sender.wc, target);
        return { executed: false, kept: true, output: { blocked: 'site', host: host || '', reason: reason || '', url: target } };
      };
      if (!tabId) {
        const assoluto = /^[a-z][a-z0-9+.-]*:/i.test(url) ? url : `https://${url}`;
        let d = null;
        try { d = require('../siteBlock').shouldBlockNavigation(assoluto); } catch (_) {}
        return fermata(d && d.host, d && d.reason, assoluto);
      }
      // Un blocco che la pagina provoca dopo l'attesa qui sotto arriva lo stesso a chi l'ha chiesta:
      // la chat della home o l'assistente sulla pagina.
      const seguibile = assistente || daFilo(origineDi(sender), sender);
      if (sender && sender.wc && seguibile && action._callId && typeof tm.seguiApertura === 'function') {
        tm.seguiApertura(tabId, { wc: sender.wc, verso: sender.strato || sender.wc, callId: action._callId, assistente });
      }
      // Prima dell'attesa qui sotto: un rinvio della pagina arriva durante, e la rilettura deve conoscerlo (#553).
      const t = (tm.tabs || []).find((x) => x && x.id === tabId);
      if (t && t.view) PageRead.ricordaApertura(t.view.webContents, url);
      // La scheda nata può fermarla dopo un rimbalzo verso la lista (un link accorciato, un rinvio della pagina).
      const esito = typeof tm.esitoApertura === 'function' ? await tm.esitoApertura(tabId) : null;
      if (esito && esito.bloccata) return fermata(esito.bloccata.host, esito.bloccata.reason, esito.bloccata.target);
      opened = true;
      // Una scheda chiusa che la chat riapre col suo indirizzo è riaperta come dalla home (#1467, #1476).
      if (typeof tm.tornataPerIndirizzo === 'function') tm.tornataPerIndirizzo(url);
    }
  } catch (e) {
    console.warn('[Filo] apertura link fallita', e?.message || e);
  }
  // In secondo piano l'apertura è quasi invisibile: al client va l'id della scheda, così il
  // chip in chat ci porta invece di aprirne una seconda.
  const output = (opened && background) ? { background: true, tabId } : null;
  return { executed: opened, kept: true, opened, background, ...(output ? { output } : {}) };
}

async function azioneCercaWeb(action) {
  // La ricerca web si esegue DAVVERO qui e i risultati tornano come `output`, che il client
  // re-immette nel contesto: così l'agente risponde con link reali (#368).
  const query = String(action.query ?? action.q ?? action.testo ?? action.text ?? '').trim();
  if (!query) return { executed: false, kept: true };
  const WS = globalThis.SN_WEB_SEARCH;
  if (!WS || typeof WS.search !== 'function') {
    return { executed: false, kept: true, output: { search: query, results: [], error: 'ricerca non disponibile' } };
  }
  try {
    const settings = await getEffectiveSettings();
    const tavilyKey = settings.apiKeys?.tavily || '';
    const r = await WS.search({ query, tavilyKey, maxResults: 5, da: 'chat' });
    const results = Array.isArray(r?.results) ? r.results : [];
    return { executed: results.length > 0, kept: true, output: { search: query, results, provider: r?.provider || '', reason: r?.reason || '' } };
  } catch (e) {
    return { executed: false, kept: true, output: { search: query, results: [], error: e?.message || String(e) } };
  }
}

async function azioneCercaSalvate(action) {
  const cercato = String(action.cerca ?? action.query ?? action.testo ?? '').trim();
  try {
    return { executed: true, kept: true, output: await salvatePerChat(cercato) };
  } catch (e) {
    return { executed: false, kept: true, output: { cercato, pagine: [], errore: e?.message || String(e) } };
  }
}

async function azioneSchedeChiuse(action) {
  const r = await schedeChiusePerChat(action);
  if (r.errore) return { executed: false, kept: true, output: { error: r.errore } };
  return { executed: true, kept: true, output: r };
}

async function azioneRiapriScheda(action, { sender }) {
  const tm = winOf(sender)?._filoTabs;
  if (!tm) return { executed: false, kept: true, output: { riaperta: false, error: 'nessuna finestra con schede' } };
  if (!String(action.id ?? '').trim()) return riapriUltima(tm);
  const v = await voceChiusa(action.id);
  if (!v.voce) return { executed: false, kept: true, output: { riaperta: false, trovata: false } };
  const base = { titolo: v.perModello.titolo, url: v.perModello.url, chiusa: v.perModello.chiusa };
  // Un indirizzo tagliato alla misura (#1525) porterebbe altrove: resta il riassunto, come per una pagina sparita.
  if (v.voce.urlTagliato) return { executed: false, kept: true, output: { ...base, riaperta: false, tagliato: true, riassunto: v.perModello.riassunto } };
  const aperta = tm.apertaCon(v.voce.url);
  if (aperta) { tm.activate(aperta.id); return { executed: true, kept: true, output: { ...base, riaperta: true, giaAperta: true } }; }
  // Dietro finché non si sa se la pagina c'è: se non c'è più, l'utente resta in chat, dove vede il riassunto.
  const id = await tm.riapriDallArchivio(v.voce, { activate: false });
  if (!id) return { executed: false, kept: true, output: { ...base, riaperta: false } };
  const esito = await tm.esitoRiapertura(id, { tetto: 8_000 });
  if (esito === 'sparita') return { executed: true, kept: true, output: { ...base, riaperta: true, nonRaggiungibile: true, riassunto: v.perModello.riassunto } };
  tm.activate(id);
  return { executed: true, kept: true, output: { ...base, riaperta: true } };
}

async function azioneRiprendiAudio(action, { sender, schedeViste }) {
  const tm = winOf(sender)?._filoTabs;
  if (!tm) return { executed: false, kept: true, output: { error: 'nessuna finestra con schede' } };
  const b = await bersaglioAudio(tm, action, schedeViste);
  const nome = await nomeDellaScheda();
  if (b.errore) return { executed: false, kept: true, output: { error: b.errore } };
  if (b.giaSuona) return { executed: false, kept: true, output: { giaSuona: true, titolo: nome(b.giaSuona) } };
  if (b.nessuna) return { executed: false, kept: true, output: { nessuna: true } };
  const id = b.tab ? b.tab.id : await tm.riapriCheSuonava(b.chiusa);
  if (!id) return { executed: false, kept: true, output: { nessuna: true } };
  const titolo = nome(b.tab || { url: b.chiusa.url, title: b.chiusa.titolo });
  const esito = await tm.riprendiAudio(id);
  if (action.vai === true) tm.activate(id);
  const numero = tm.tabs.findIndex((t) => t.id === id) + 1;
  return {
    executed: true, kept: true,
    output: {
      titolo, riaperta: !b.tab, ...(numero > 0 ? { numero } : {}), ...(action.vai === true ? { davanti: true } : {}),
      ...(esito !== 'suona' ? { nonPartita: true, perche: esito } : {}),
    },
  };
}

async function azionePausaAudio(action, { sender, schedeViste }) {
  const tm = winOf(sender)?._filoTabs;
  if (!tm) return { executed: false, kept: true, output: { error: 'nessuna finestra con schede' } };
  const b = await bersaglioPausa(tm, action, schedeViste);
  if (b.errore) return { executed: false, kept: true, output: { error: b.errore } };
  const nome = await nomeDellaScheda();
  const fermate = [];
  for (const tab of b.tabs) if (await tm.pausaAudio(tab.id)) fermate.push(nome(tab));
  if (!fermate.length) return { executed: false, kept: true, output: { nessuna: true } };
  return { executed: true, kept: true, output: { titolo: fermate.join(', '), fermate: fermate.length } };
}

async function azioneMostraScheda(action, { sender, schedeViste }) {
  const tm = winOf(sender)?._filoTabs;
  if (!tm) return { executed: false, kept: true, output: { error: 'nessuna finestra con schede' } };
  const b = await schedaDaMostrare(tm, action, schedeViste);
  if (!b) return { executed: false, kept: true, output: { error: 'manca il numero della scheda, o il verso (dopo o prima)' } };
  if (b.errore) return { executed: false, kept: true, output: { error: b.errore } };
  tm.activate(b.tab.id);
  return { executed: true, kept: true, output: { titolo: (await nomeDellaScheda())(b.tab) } };
}

// «Riapri l'ultima scheda chiusa» (#2371): la stessa pila di Ctrl+Shift+T, in un passo.
async function riapriUltima(tm) {
  if (typeof tm.ciSonoChiuse === 'function' && !(await tm.ciSonoChiuse())) {
    return { executed: false, kept: true, output: { riaperta: false, nessuna: true, error: 'nessuna scheda chiusa da riaprire' } };
  }
  const id = await tm.riapriChiusa();
  const tab = id ? tm.tabs.find((t) => t.id === id) : null;
  if (!tab) return { executed: false, kept: true, output: { riaperta: false } };
  return { executed: true, kept: true, output: { riaperta: true, ultima: true, titolo: (await nomeDellaScheda())(tab), url: tab.url || '' } };
}

// «Salvala per dopo» (#2371): la stessa strada di Alt+S, sulla scheda col numero o su quella web davanti.
async function azioneSalvaPerDopo(action, { sender, schedeViste }) {
  const win = winOf(sender);
  const tm = win && win._filoTabs;
  if (!tm) return { executed: false, kept: true, output: { error: 'nessuna finestra con schede' } };
  let tab = null;
  if (action.scheda != null) {
    const b = await schedaPerNumero(tm, action, schedeViste);
    if (!b || b.errore) return { executed: false, kept: true, output: { error: (b && b.errore) || 'numero di scheda non valido' } };
    tab = b.tab;
  } else tab = targetWebTab(sender).tab;
  if (!tab || tab.isInternal || !/^https?:\/\//i.test(tab.url || '')) {
    return { executed: false, kept: true, output: { error: 'nessuna pagina web da salvare: le schermate di Filo non si salvano per dopo' } };
  }
  const titolo = (await nomeDellaScheda())(tab);
  const r = await require('../../shortcuts').saveForLater(win, tab, { attendiConferma: false });
  if (!r) return { executed: false, kept: true, output: { error: 'salvataggio già in corso per questa scheda' } };
  return { executed: true, kept: true, output: { salvata: true, titolo } };
}

// «Cerca questa immagine» (#2371): la ricerca per immagine dell'Aiuto (Google Lens), su un'immagine scelta da Filo.
async function azioneCercaImmagine(action, { sender, chatId, schedeViste }) {
  const win = winOf(sender);
  const tm = win && win._filoTabs;
  if (!tm) return { executed: false, kept: true, output: { error: 'nessuna finestra con schede' } };
  let chat = chatId || '';
  try { chat = chat || require('../registroCambi').corrente()?.chat || ''; } catch (_) {}
  const im = await require('../immagineDaCercare').scegli(action, { sender, chatId: chat, schedeViste });
  if (im.errore) return { executed: false, kept: true, output: { error: im.errore } };
  const L = globalThis.SN_URL_NAV;
  let id = null;
  if (im.url) id = tm.openTab(L.indirizzoRicercaImmagine(im.url), { activate: true, origine: { tipo: 'filo', gesto: true } });
  else {
    const invio = L.invioRicercaImmagine(im.dataUrl);
    if (!invio) return { executed: false, kept: true, output: { error: 'l\'immagine non si legge' } };
    id = tm.openTab(invio.url, { activate: true, invio, origine: { tipo: 'filo', gesto: true } });
  }
  if (!id) return { executed: false, kept: true, output: { error: 'la scheda della ricerca non si è aperta' } };
  return { executed: true, kept: true, output: { cercata: true, di: im.url ? 'indirizzo' : 'immagine', ...(im.numero ? { numero: im.numero } : {}) } };
}

async function azioneApriSalvata(action, { sender }) {
  // La porta delle uscite l'ha già guardata prima del gate, con l'indirizzo dell'elenco.
  const r = await apriPaginaSalvata(action.id, { sender, tieni: action.tieni === true, porta: false });
  if (!r.ok) {
    return { executed: false, kept: true, output: { aperta: false, trovata: r.trovata !== false, ...(r.blocked ? { blocked: r.blocked, host: r.host, reason: r.reason, url: r.url } : {}) } };
  }
  return { executed: true, kept: true, output: { aperta: true, tolta: r.tolta, id: r.id, titolo: r.titolo, url: r.url } };
}

async function azioneLeggiPagina(action, { sender, schedeViste }) {
  // #553 — il testo di una pagina web torna al modello (dalla scheda se è aperta, se no scaricato):
  // prima poteva solo cercare e aprire, e ogni dato DENTRO una pagina restava da indovinare dagli snippet.
  let url = globalThis.SN_ACTION_LEVELS.indirizzoDi(action);
  const da = Number(action.da ?? action.offset ?? action.from ?? 0) || 0;
  // «Cosa dice la pagina che ho aperto?»: nello STATO il modello vede le schede per titolo e numero, non per
  // indirizzo. Il numero si risolve qui, sullo stesso elenco nello stesso ordine.
  const numero = Number(action.scheda ?? action.tab ?? 0);
  let r = null;
  if (!String(url || '').trim() && Number.isInteger(numero) && numero > 0) {
    let schede = [];
    try {
      const tutte = await globalThis.SN_FILO_STATE.listTabs({ windowId: winOf(sender)?.id ?? null });
      schede = (await schedeNumerate(winOf(sender), schedeViste)).map((id) => tutte.find((x) => x.id === id) || null);
    } catch (_) {}
    const t = schede[numero - 1];
    if (!t) r = { pageRead: `scheda ${numero}`, ok: false, errore: 'scheda', dettaglio: `nessuna scheda numero ${numero}`, testo: '' };
    else url = t.url || '';
  }
  if (!r) r = await leggiPaginaDa(url, da, sender);
  return { executed: !!r.ok, kept: true, output: r };
}

async function azionePulisciTab(action, { confirmed, sender, decisione, daChiedere, sospesa }) {
  // Il popup generico spiega lo stesso riordino del bottone: confermato lì, si esegue. Quando la regola
  // dice sì il riordino parte qui, come ogni azione (#530); se no il pannello chiede come dice `domanda`.
  if (confirmed || !daChiedere) {
    const tm = winOf(sender)?._filoTabs;
    if (!tm) return { executed: false, kept: confirmed, output: { error: 'nessuna finestra con schede' } };
    try {
      const r = await tm.runAutoTriage({ trigger: 'manual', da: 'chat' });
      const archived = (r && r.archived) || 0;
      const error = globalThis.SN_TAB_TRIAGE.riordinoNonRiuscito({ ...(r || {}), ok: !!r });
      if (error) {
        return {
          executed: false, kept: false,
          output: { archived, giaInCorso: !!r?.giaInCorso, giudizioMancato: !!r?.giudizioMancato, incognito: !!r?.incognito, error },
        };
      }
      return { executed: true, kept: confirmed, output: { archived } };
    } catch (e) {
      return { executed: false, kept: false, output: { error: String(e?.message || e) } };
    }
  }
  return { ...sospesa(), domanda: decisione.digita ? 'conferma' : 'chiede', perche: decisione.perche };
}

async function azioneTieniAperta(action) {
  if (!action._voce) {
    return { executed: false, kept: false, output: { sempreAperta: 'non_salvata', error: 'nessun sito riconosciuto: serve il dominio (es. web.whatsapp.com), per un sito locale l\'indirizzo con la porta (es. localhost:3000), o una scheda web davanti' } };
  }
  await SempreAperte.aggiungi(action._voce);
  return { executed: true, kept: false, output: { sempreAperta: 'salvata', sito: action._voce } };
}

async function azioneNonTenereAperta(action) {
  const tolte = await FiloMem.removeKeepOpen(action._voci || []);
  if (!tolte.length) {
    return { executed: false, kept: false, output: { sempreAperta: 'nessuna', error: 'nessun sito da tenere aperto corrisponde', salvati: await SempreAperte.voci() } };
  }
  return { executed: true, kept: false, output: { sempreAperta: 'tolta', siti: tolte } };
}

async function azioneStilePagina(action, { sender }) {
  // Le regole {selettore, css} prodotte dall'LLM si SANIFICANO qui: mai fidarsi del suo CSS.
  // Iniezione live nella scheda attiva, effimera (un reload la toglie) e reversibile.
  const R = globalThis.SN_PAGE_RESTYLE;
  if (!R) return { executed: false, kept: false };
  const css = R.buildCss(R.normalizeRules(action));
  if (!css) return { executed: false, kept: false };
  const { tm, tab } = targetWebTab(sender);
  if (!tm || !tab) return { executed: false, kept: false, output: { restyle: 'no-page' } };
  const r = await tm.applyPageStyle(css, tab);
  return { executed: !!(r && r.ok), kept: false };
}

async function azioneRipristinaStilePagina(action, { sender }) {
  const { tm, tab } = targetWebTab(sender);
  if (!tm || !tab) return { executed: false, kept: false, output: { restyle: 'no-page' } };
  const r = await tm.clearPageStyle(tab);
  return { executed: !!(r && r.ok), kept: false };
}

async function azioneZoomPagina(action, { sender }) {
  // #686 — lo zoom della pagina si chiede anche a parole, non solo con
  // Ctrl +/-/0. Non zooma da qui: gira la richiesta alla scheda attiva
  // dalla stessa porta dei tasti (tabs.applicaZoom → filo:zoom-key), così
  // i due cammini non possono scavalcarsi né perdere la memoria per sito.
  const Z = globalThis.SN_ZOOM;
  const win = winOf(sender);
  const tm = win && win._filoTabs;
  if (!tm || typeof tm.applicaZoom !== 'function') return { executed: false, kept: false };
  const perc = Z ? Z.leggiPercentuale(action.percentuale ?? action.percent ?? action.valore) : null;
  const verso = String(action.verso ?? action.direzione ?? action.direction ?? '').trim().toLowerCase();
  if (perc == null && !(Z && Z.VERSI.includes(verso))) {
    return { executed: false, kept: false, output: { zoom: 'invalid' } };
  }
  const esito = await tm.applicaZoom(perc != null ? { percentuale: perc } : { verso });
  if (!esito) return { executed: false, kept: false, output: { zoom: 'no-tab' } };
  if (esito.muto) return { executed: false, kept: false, output: { zoom: 'muto' } };
  contaZoomDallaChat(esito, perc != null ? '' : verso, win);
  // `sconosciuto`: la pagina zooma da sé (l'editor scala il foglio) e la
  // percentuale la sa solo lei. Fatto sì, numero no.
  if (esito.sconosciuto) return { executed: true, kept: false, output: { zoom: 'propria' } };
  return {
    executed: true,
    kept: false,
    output: {
      zoom: 'ok',
      percentuale: esito.percentuale,
      richiesto: esito.richiesto ?? null,
      limitato: !!esito.limitato,
      min: esito.min,
      max: esito.max,
    },
  };
}

// #504 — «traducimi la pagina», «riprendi la traduzione», «torna all'originale»: la traduzione la fa la pagina, come
// dall'icona (page-preload.js → SN_TRANSLATE_PAGE.daChat), e risponde com'è andata (src/shared/traduzioneDellaPagina.js).
const ATTESA_TRADUZIONE_MS = 5000;
// «Apri … e traducilo»: la pagina appena aperta può metterci molto ad arrivare e a far montare Filo, e la risposta
// «non risponde» lì sarebbe falsa. Il tetto copre un sito lento, non uno fermo.
const CARICAMENTO_TRADUZIONE_MS = 30000;
const MARGINE_RISPOSTA_MS = 1500;

async function chiediTraduzione(tab, originale) {
  const wc = tab.view && tab.view.webContents;
  const r = await chiediAllaPagina(wc, {
    canale: 'filo:traduci-pagina', eco: 'filo:traduci-pagina-esito', attesaMs: ATTESA_TRADUZIONE_MS,
    caricamentoMs: CARICAMENTO_TRADUZIONE_MS, margineMs: MARGINE_RISPOSTA_MS, dati: { originale },
  });
  return r || { stato: 'muto' };
}

async function azioneTraduciPagina(action, { sender }) {
  const S = globalThis.SN_TRADUZIONE_PAGINA;
  const originale = globalThis.SN_ACTION_LEVELS.alOriginale(action);
  const { win, tm, tab } = targetWebTab(sender);
  if (!tm || !tab) return { executed: false, kept: false, output: { traduzione: 'no-page', originale } };
  // Sotto l'avviso del sito pericoloso la pagina non si vede: le sue azioni aspettano, come nella barra laterale.
  if (typeof tm.paginaScoperta === 'function' && !tm.paginaScoperta(tab)) {
    return { executed: false, kept: false, output: { traduzione: 'coperta', originale } };
  }
  const r = await chiediTraduzione(tab, originale);
  const stato = S.stato(r && r.stato);
  const output = { traduzione: stato, originale };
  // Chiesta dalla home, la pagina è l'ultima scheda web usata: l'utente non la vede cambiare, e va detto dove.
  if (tab.id !== tm.activeId) output.dietro = true;
  if (stato === 'partita') {
    output.come = ['ripresa', 'nuovo'].includes(r.come) ? r.come : 'pagina';
    const intero = (n) => (Number.isInteger(n) && n >= 0 ? n : 0);
    if (output.come === 'ripresa') { output.mancanti = intero(r.mancanti); output.di = intero(r.di); }
  }
  if (globalThis.SN_ACTION_LEVELS.traduzioneFatta(stato) && dallaChat()) {
    require('../contatoriStrade').misura('azione', 'translate', 'chat', { incognito: !!(win && win._filoIncognito) });
  }
  return { executed: S.STATI[stato].fatta, kept: false, output };
}

async function azioneChiudiSchede(action, { sender }) {
  const tm = winOf(sender)?._filoTabs;
  const ids = Array.isArray(action._targetIds) ? action._targetIds : [];
  const bloccate = tm ? tm.tabs.filter((t) => t.bloccata && ids.includes(t.id)).map((t) => t.id) : [];
  const chiuse = tm ? tm.chiudiSchede(ids) : [];
  const nBloccate = bloccate.filter((id) => chiuse.includes(id)).length;
  return {
    executed: chiuse.length > 0, kept: false,
    output: { chiuse: chiuse.length, ...(nBloccate ? { bloccate: nBloccate } : {}), ...contoRestano(action._restano) },
  };
}

// #2086 — «blocca questa scheda», «sblocca la terza»: quello che fanno Blocca e Sblocca nel menu della linguetta.
async function azioneBloccaScheda(action, { sender, schedeViste }, on) {
  const tm = winOf(sender)?._filoTabs;
  if (!tm) return { executed: false, kept: true, output: { error: 'nessuna finestra con schede' } };
  const b = await schedaDaBloccare(tm, action, schedeViste, sender);
  if (!b || b.errore) return { executed: false, kept: true, output: { error: (b && b.errore) || 'numero di scheda non valido' } };
  const titolo = (await nomeDellaScheda())(b.tab);
  const gia = !!b.tab.bloccata === on;
  if (tm.bloccaScheda(b.tab.id, on) === null) {
    return { executed: false, kept: true, output: { error: 'questa scheda è un passaggio di Filo e non si blocca', titolo } };
  }
  return { executed: true, kept: true, output: { titolo, ...(gia ? { gia: true } : {}) } };
}

module.exports = {
  NAVIGA: azioneNaviga,
  CERCA_WEB: azioneCercaWeb,
  CERCA_SALVATE: azioneCercaSalvate,
  SCHEDE_CHIUSE: azioneSchedeChiuse,
  RIAPRI_SCHEDA: azioneRiapriScheda,
  RIPRENDI_AUDIO: azioneRiprendiAudio,
  PAUSA_AUDIO: azionePausaAudio,
  MOSTRA_SCHEDA: azioneMostraScheda,
  SALVA_PER_DOPO: azioneSalvaPerDopo,
  CERCA_IMMAGINE: azioneCercaImmagine,
  APRI_SALVATA: azioneApriSalvata,
  LEGGI_PAGINA: azioneLeggiPagina,
  PULISCI_TAB: azionePulisciTab,
  TIENI_APERTA: azioneTieniAperta,
  NON_TENERE_APERTA: azioneNonTenereAperta,
  STILE_PAGINA: azioneStilePagina,
  RIPRISTINA_STILE_PAGINA: azioneRipristinaStilePagina,
  ZOOM_PAGINA: azioneZoomPagina,
  TRADUCI_PAGINA: azioneTraduciPagina,
  CHIUDI_SCHEDE: azioneChiudiSchede,
  BLOCCA_SCHEDA: (action, ctx) => azioneBloccaScheda(action, ctx, true),
  SBLOCCA_SCHEDA: (action, ctx) => azioneBloccaScheda(action, ctx, false),
};

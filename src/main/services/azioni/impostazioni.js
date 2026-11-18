// Le azioni di Filo su preferenze, aspetto, intervista, segnalazioni, account e home.
// Nata da handlers.js: esporta la tabella tipo -> funzione che eseguiAzioneFilo consulta dopo il preambolo.

const Registro = require('../registroCambi');
const { SN_MSG } = globalThis;
const { MSG } = SN_MSG;
const Storage = globalThis.SN_STORAGE;
const FiloMem = globalThis.SN_FILO_MEMORY;
const Onboarding = globalThis.SN_ONBOARDING;
const { cancelliAperti, broadcastToFiloPages, annunciaCarteHome, annunciaBarraSiti } = require('../broadcast');
const { winOf, bannerDellaScheda } = require('../handlersComuni');
const { getEffectiveSettings, applySettingsUpdate, resolveTheme } = require('../impostazioniEffettive');
const { idDelCambio } = require('../porteUscita');
const { compitoSenzaTestoDiAltri, segnalazioneConfermataPulita, eseguiAccount } = require('../autonomiaFonti');
const {
  saveOnboarding, ricominciaIntervista, ripristinaImpostazioni, apriIntervistaRifatta,
} = require('../intervista');
const { carteSinistraPerChat, descriviCarte, rimettiSinistraDaChat, cartaSinistraDaChat } = require('../homeDashboard');

async function azioneOnboarding(action, { intervista }) {
  // Tocca solo il taccuino dell'intervista: ciò che l'intervista APPLICA passa dalle azioni
  // vere (IMPOSTA_PREFERENZA, SALVA_LEZIONE), col loro livello.
  if (!Onboarding) return { executed: false, kept: false };
  // Lo strumento c'è in ogni chat (gli strumenti sono uguali per ogni ruolo): vale solo nel turno dell'intervista.
  if (!intervista) return { no: true, executed: false, kept: false, error: 'l\'intervista di benvenuto non è in corso in questa conversazione' };
  const state = await FiloMem.getOnboarding();
  if (state.done) return { executed: false, kept: false };
  const raw = action.spunta ?? action.spunte ?? action.fatto ?? action.done_items ?? action.ids;
  const truthy = (v) => v === true || v === 1 || /^(true|1|si|sì|yes)$/i.test(String(v ?? ''));
  // #1188 — la scelta dell'autonomia la fa l'utente sotto la risposta: qui si mostra e basta, il livello no.
  // Finché è a schermo senza risposta la voce non si spunta e l'intervista non si chiude, anche da un'altra
  // azione dello stesso turno: chiusa, la scelta sparirebbe con la chat. La regola sta nello stato dell'intervista.
  const sceltaAutonomia = truthy(action.autonomia);
  // #1589 — la scelta del livello di privacy segue la stessa regola: si mostra, la fa l'utente.
  const sceltaPrivacy = truthy(action.privacy);
  // #1461 — la scelta dei contatori anonimi segue la stessa regola: si mostra, la fa l'utente, poi si spunta.
  const sceltaContatori = !sceltaAutonomia && !sceltaPrivacy && truthy(action.contatori);
  const autonomiaSospesa = sceltaAutonomia || Onboarding.autonomiaInSospeso(state);
  const privacySospesa = sceltaPrivacy || Onboarding.privacyInSospeso(state);
  const contatoriSospesi = sceltaContatori || Onboarding.contatoriInSospeso(state);
  const inSospeso = autonomiaSospesa || privacySospesa || contatoriSospesi;
  const ids = (Array.isArray(raw) ? raw : (raw ? [raw] : []))
    .filter((x) => {
      const id = String(x || '').trim().toLowerCase();
      return !(autonomiaSospesa && id === 'autonomia') && !(privacySospesa && id === 'privacy')
        && !(contatoriSospesi && id === 'contatori');
    });
  const spuntato = Onboarding.tick(state, ids).state;
  const conAutonomia = sceltaAutonomia ? Onboarding.mostraSceltaAutonomia(spuntato) : spuntato;
  const conPrivacy = sceltaPrivacy ? Onboarding.mostraSceltaPrivacy(conAutonomia) : conAutonomia;
  const ticked = sceltaContatori ? Onboarding.mostraSceltaContatori(conPrivacy) : conPrivacy;
  // L'intervista finisce quando lo dice Filo, quando l'elenco è finito, o
  // quando è andata troppo per le lunghe: chiudere è comunque lo stato in
  // cui l'utente vuole trovarsi, e da Preferenze la si rilancia.
  const wantsEnd = !inSospeso && truthy(action.fine ?? action.chiudi ?? action.done ?? action.finito);
  const next = (wantsEnd || Onboarding.shouldForceClose(ticked))
    ? Onboarding.close(ticked)
    : ticked;
  await saveOnboarding(next);
  if (sceltaContatori) {
    let attivi = true;
    try { attivi = !(((await Storage.getSettings()) || {}).contatori?.attivi === false); } catch (_) {}
    return { executed: true, kept: true, output: { sceltaContatori: true, attivi } };
  }
  if (!sceltaAutonomia && !sceltaPrivacy) return { executed: true, kept: false };
  let livello = '';
  let livelloPrivacy = '';
  try {
    const impostazioni = (await Storage.getSettings()) || {};
    livello = globalThis.SN_AUTONOMIA.livelloAttivo(impostazioni.autonomia?.livello);
    livelloPrivacy = globalThis.SN_LIVELLI_PRIVACY.regola(impostazioni).livello;
  } catch (_) {}
  return {
    executed: true,
    kept: true,
    output: {
      ...(sceltaAutonomia ? { sceltaAutonomia: true, livello } : {}),
      ...(sceltaPrivacy ? { sceltaPrivacy: true, livelloPrivacy } : {}),
    },
  };
}

async function azioneInviaFeedback(action, {
  confirmed, sender, contesto, fontiLette, assistente, chatId, impostazioni,
}) {
  // Filo invia un feedback a nome dell'utente (#146.5). Livello 2: a
  // questo punto la conferma è già passata (il gate sopra ha lasciato
  // procedere solo con confirmed:true). Il feedback parte come quelli
  // inviati dal box: stesso schema, ma clientId 'filo:chat' così in
  // dashboard si vede che l'ha mandato Filo. Dall'owner porta la sua prova; è suo solo a compito pulito (#953).
  const testo = String(action.testo ?? action.text ?? action.messaggio ?? '').trim();
  if (!testo) return { executed: false, kept: false };
  const FB = globalThis.SN_FEEDBACK;
  if (!FB || typeof FB.submit !== 'function') return { executed: false, kept: false };
  const titolo = String(action.titolo ?? action.title ?? action.name ?? '').trim()
    || (typeof FB.fallbackName === 'function' ? FB.fallbackName(testo) : '');
  let userAgent = 'Filo desktop';
  try { const { app } = require('electron'); userAgent = `Filo desktop ${app.getVersion()}`; } catch (_) {}
  try {
    const Mittente = require('../feedbackMittente');
    const pulita = confirmed
      ? segnalazioneConfermataPulita(sender, action)
      : compitoSenzaTestoDiAltri(sender, { contesto, fontiLette, assistente, impostazioni });
    const firmato = Mittente.firma('filo:chat', { perConto: !pulita });
    let payload = { text: testo, name: titolo, clientId: firmato.clientId, userAgent };
    // #1668 — gli allegati li prende il main dalla conversazione, di nuovo qui. Con degli allegati si passa sempre dal
    // riquadro, e FILO_CONFIRM_ACTION lascia solo quelli che l'utente ha visto in miniatura e tenuto.
    const conAllegati = globalThis.SN_ALLEGATI_SEGNALAZIONE.haAllegati(action);
    if (conAllegati) {
      const chatDellAzione = chatId || (Registro.corrente() && Registro.corrente().chat) || '';
      const { voci } = await require('../allegatiDellaChat').voci(action, chatDellAzione);
      const p = globalThis.SN_ALLEGATI_SEGNALAZIONE.payload(payload, voci);
      if (p.errore) return { executed: false, kept: false, output: { error: p.errore } };
      payload = p.payload;
    }
    const r = firmato.dallOwner ? await Mittente.spedisciDallOwner(payload) : await FB.submit(payload);
    const allegati = (payload.images || []).length + (payload.files || []).length;
    const nonSaliti = r && Array.isArray(r.failed) ? r.failed.map((f) => f && f.name).filter(Boolean) : [];
    // Il modello deve sapere quanti sono partiti davvero: l'utente può averne tolti nel riquadro.
    const esitoAllegati = conAllegati || action._allegatiIndicati === true
      ? { output: { allegati, ...(nonSaliti.length ? { allegatiNonSaliti: nonSaliti } : {}) } }
      : {};
    // In coda ad aspettare l'accesso dell'owner: nella sua lista è «in partenza», e la coda la aggiorna.
    if (r && r.queued) {
      try { await globalThis.SN_SEGNALAZIONI_MIE?.registra?.({ id: r.id, testo, titolo }); } catch (_) {}
      return { executed: true, kept: false, ...esitoAllegati };
    }
    // #986 — scritta da Filo ma confermata dall'utente: è sua, e la ritrova con le altre.
    if (r && r.id) {
      try {
        await globalThis.SN_SEGNALAZIONI_MIE?.registra?.({
          id: r.id, feedbackId: r.id, testo, titolo, stato: 'inviata',
          num: FB.formatNum ? FB.formatNum(r.seq, 0) : '',
        });
      } catch (_) {}
    }
    if (r && r.id) return { executed: true, kept: false, ...esitoAllegati };
    return { executed: false, kept: false, output: { error: 'il server delle segnalazioni non l\'ha presa' } };
  } catch (e) {
    console.warn('[Filo] invio feedback fallito', e?.message || e);
    // Il perché resta nel diario e arriva al modello (#1294): una frase, non il messaggio grezzo.
    const CE = globalThis.SN_CHAT_ERRORS;
    const frase = CE && typeof CE.friendly === 'function' ? CE.friendly(e) : '';
    return { executed: false, kept: false, output: { error: frase || 'invio non riuscito' } };
  }
}

async function azioneImpostaPreferenza(action, { sender }) {
  // La scrittura passa da applySettingsUpdate, lo stesso percorso della pagina Preferenze,
  // così la modifica si applica live (la dashboard ascolta SETTINGS_UPDATED).
  const chiave = action.chiave ?? action.key ?? action.nome ?? action.name ?? action.preferenza;
  const valore = action.valore ?? action.value ?? action.valoreNuovo ?? action.val;
  const correnti = await Storage.getSettings();
  const built = global.SN_PREF.buildPreferencePartial(chiave, valore, { attuali: correnti });
  // Un rifiuto spiegato resta nel diario col suo perché: non è successo
  // niente, ma l'utente deve saperlo anche se il modello non lo dice.
  // `perModello` (le chiavi, i valori ammessi) va solo al modello.
  const no = built ? (built.rifiuto ? built : null) : global.SN_PREF.spiegaNonValida(chiave, valore);
  if (no) return { executed: false, kept: false, output: { error: no.rifiuto, rifiuto: true, ...(no.perModello ? { perModello: no.perModello } : {}) } };
  if (action._invariato) return { executed: false, kept: false, output: { error: action._invariato, invariato: true } };
  // Un elenco (siti bloccati, fidati…) si cambia a voci sull'elenco di adesso (#949).
  let partial = built.partial;
  let dimenticate = 0;
  if (built.elenco) {
    const r = global.SN_PREF.applicaElenco(built.elenco, correnti);
    if (built.elenco.percorso === 'documenti.cartelle' && built.elenco.op === 'togli') {
      const Indice = require('../documentiIndice');
      for (const c of await Indice.occasionaliFra(built.elenco.voci)) dimenticate += (await Indice.dimentica(c)).tolta ? 1 : 0;
    }
    if (r.invariato && dimenticate) return { executed: true, kept: true, output: { etichetta: `${built.label} (Filo ne dimentica i documenti già letti)` } };
    if (r.invariato) return { executed: false, kept: false, output: { error: r.invariato, invariato: true } };
    partial = r.partial;
    if (await bannerDellaScheda(built.elenco, sender)) return { executed: true, kept: true, output: { etichetta: built.label } };
  }
  await applySettingsUpdate(partial);
  // Il nome leggibile serve alla riga della chat quando il valore era già quello (niente evento).
  const stile = globalThis.SN_ACTION_LEVELS.stileDellAccoglienza(action);
  const costo = typeof action._costoModello === 'string' && action._costoModello ? { costoModello: action._costoModello } : {};
  const avviso = built.avviso ? { avviso: built.avviso } : {};
  return { executed: true, kept: true, output: { etichetta: built.label, ...(stile ? { stile } : {}), ...costo, ...avviso } };
}

async function azioneImpostaEstetica(action) {
  // Filo cambia un token estetico dalla chat, subito, e la bolla mostra un controllo per
  // raffinarlo. Il token si fonde nella mappa: themeTokens è REPLACE e azzererebbe gli altri.
  const T = globalThis.SN_THEME_TOKENS;
  const token = action.token ?? action.nome ?? action.name ?? action.chiave ?? action.elemento;
  const valore = action.valore ?? action.value ?? action.val ?? action.colore;
  // Il ↺ della riga nelle Preferenze, chiesto a parole (#949): il token torna al suo valore di serie.
  if (T && T.get(token) && /^(predefinit[oa]|default|di serie|originale|ripristina(lo|la)?)$/i.test(String(valore ?? '').trim())) {
    const correnti = await Storage.getSettings();
    const restanti = { ...(correnti.themeTokens || {}) };
    if (!Object.prototype.hasOwnProperty.call(restanti, token)) {
      return { executed: false, kept: false, output: { error: `${T.get(token).label} è già al suo valore predefinito`, invariato: true } };
    }
    delete restanti[token];
    await applySettingsUpdate({ themeTokens: restanti });
    return { executed: true, kept: true };
  }
  if (!T || !T.validate(token, valore)) {
    return { executed: false, kept: false, ...(T ? { output: { error: T.errorMessage(token) } } : {}) };
  }
  const settings = await Storage.getSettings();
  const overrides = { ...(settings.themeTokens || {}) };
  overrides[token] = T.normalize(token, valore);
  await applySettingsUpdate({ themeTokens: overrides });
  // kept:true → il client renderizza il bottone di raffinamento.
  return { executed: true, kept: true };
}

async function azioneLeggiTrasparenza(action) {
  // I documenti di trasparenza sono le scelte dell'owner messe per iscritto: alla domanda
  // «perché questo modello» si risponde con quel testo, non a memoria. Sola lettura.
  const T = globalThis.SN_TRANSPARENCY;
  // Il nome del documento lo sceglie il MODELLO, e torna nel prompt in
  // due posti (questo esito e l'etichetta del blocco reimmesso nel giro
  // dopo). Una riga sola e di lunghezza sensata: un nome con dentro degli
  // a capo saprebbe fingere l'inizio di un altro blocco di sistema.
  let doc = String(action.doc ?? action.documento ?? action.id ?? '').replace(/\s+/g, ' ').trim();
  if (doc.length > 120) doc = doc.slice(0, 120) + '…';
  const text = T ? T.asText(doc) : '';
  // Un documento chiesto per nome che non esiste NON è una lettura
  // riuscita: il testo torna lo stesso (dice all'agente che non c'è, così
  // non lo ricostruisce a memoria), ma il diario non deve scrivere
  // «riletto la trasparenza» per una cosa che nessuno ha letto (#515).
  // La nota di una sezione non scritta invece si legge davvero (#888).
  const trovato = !!(T && (!doc || T.get(doc) || (typeof T.nota === 'function' && T.nota(doc))));
  return { executed: trovato, kept: true, output: { doc: doc || null, text, missing: !trovato } };
}

async function azioneLeggiImpostazioni(action) {
  // #949 — com'è impostato Filo adesso, per «com'è impostato X?». Sola lettura, senza le chiavi.
  const V = globalThis.SN_VOCI_IMPOSTAZIONI;
  const cerca = String(action.cerca ?? action.query ?? action.chiave ?? action.testo ?? '').replace(/\s+/g, ' ').trim().slice(0, 200);
  if (!V) return { executed: false, kept: true, output: { error: 'lettura non disponibile' } };
  const settings = await Storage.getSettings();
  let permessiSiti = null;
  try { permessiSiti = require('../permessiPagine').righeRicordate(); } catch (_) {}
  let cartelleCercate = null;
  try {
    cartelleCercate = (await require('../documentiIndice').stato()).occasionali
      .map((o) => `${o.nome} (${o.percorso}, ${o.documenti} documenti già letti${o.esiste ? '' : ', ora non c\'è'})`);
  } catch (_) {}
  const r = V.righePerModello(settings, { cerca, tema: resolveTheme(settings), sistema: process.platform, altrove: { permessiSiti, cartelleCercate } });
  return { executed: true, kept: true, output: { cerca, righe: r.righe, trovate: r.trovate, totale: r.totale } };
}

async function azioneTogliPermessoSito(action) {
  // #949 — la stessa cosa del «Togli» nella pagina Sicurezza: una risposta ricordata se ne va, il sito tornerà a chiedere.
  const r = require('../permessiPagine').togliPerChat(action.sito ?? action.dominio ?? action.site, action.permesso ?? action.parte);
  if (r.errore) return { executed: false, kept: false, output: { error: r.errore, rifiuto: true } };
  if (!r.tolte.length) {
    const ci = r.restano.length ? `ci sono: ${r.restano.join('; ')}` : 'non ce n\'è nessuna';
    return { executed: false, kept: false, output: { error: `nessuna risposta ricordata per ${r.host}${action.permesso ? ` (${action.permesso})` : ''}: ${ci}`, invariato: true } };
  }
  broadcastToFiloPages({ type: MSG.PERMESSI_SITI_CAMBIATI });
  return { executed: true, kept: false, output: { tolte: r.tolte } };
}

async function azioneCapacitaDettaglio(action) {
  // Dettaglio del manifesto per id, restituito come output. Sola lettura, nessun effetto.
  const Caps = globalThis.SN_CAPABILITIES;
  const ids = Array.isArray(action.ids) ? action.ids
    : (action.id ? [action.id]
      : (action.capacita != null ? [].concat(action.capacita) : []));
  const detail = Caps ? Caps.renderDetailForPrompt(ids, cancelliAperti()) : '';
  return { executed: true, kept: true, output: { capabilities: ids, detail } };
}

async function azioneAnnullaCambio(action, { assistente }) {
  // «Rimetti come prima»: vale per i cambi chiesti in chat e per quelli fatti dalle pagine.
  // Il cancello ha già chiesto la parola scritta: un annullo che alza quanto esce ha il livello di una difesa.
  const r = await Registro.annulla(idDelCambio(action), { via: assistente ? 'assistente' : 'chat', confermato: true });
  if (!r.ok) return { executed: false, kept: false, output: { error: r.motivo, ...(r.id ? { id: r.id } : {}) } };
  return { executed: true, kept: false, output: { annullato: r.id, frase: r.frase, saltati: r.saltati || [], ...(r.saltatiPerche ? { saltatiPerche: r.saltatiPerche } : {}) } };
}

async function azioneRimedioCrediti(action) {
  // #818 — i rimedi dell'avviso dei crediti a parole: la stessa porta dei pulsanti, col suo «com'era».
  const AC = globalThis.SN_AVVISO_CREDITI_MAIN;
  if (!AC || !AC.rimedioDaChat) return { executed: false, kept: false, output: { error: 'non disponibile' } };
  const r = await AC.rimedioDaChat({ rimedio: action.rimedio, operazione: action.operazione || 'elenca' });
  return { executed: r.ok !== false, kept: false, output: r.ok === false ? { ...r, error: r.frase || r.error } : r };
}

async function azioneSpostaIcona(action, { sender }) {
  // #871, #1246, #1434 — la disposizione delle icone (barra laterale, fila del tasto destro e i loro «Altro…») a
  // parole: stessa porta del trascinamento, così menu e barre di tutte le finestre la ricevono uguale.
  const D = globalThis.SN_DISPOSIZIONE_ICONE;
  const id = String(action.icona ?? action.id ?? '').trim();
  const dove = D ? D.parolaDove(action.dove) : String(action.dove ?? '');
  const prima = String(action.prima_di ?? '').trim();
  const target = D ? D.zonaDellAzione(action) : '';
  if (!D || !D.esiste(id) || !target) {
    const serveContesto = dove === 'fila' || dove === 'altro_fila';
    // Gli id non stanno nello strumento (tetto degli strumenti, SPEC-CONTESTO): li dà l'esito di un id sbagliato.
    const icone = D && !D.esiste(id) ? [...Object.keys(D.ICONE), ...Object.keys(D.AZIONI || {})].map((i) => `${i} (${D.nome(i)})`).join(', ') : null;
    return { executed: false, kept: false, output: { icona: 'invalid', id, dove, ...(icone ? { icone } : {}), ...(serveContesto ? { motivo: 'per la fila del tasto destro serve il contesto' } : {}) } };
  }
  if (!D.ammessa(id, target)) {
    return { executed: false, kept: false, output: { icona: 'invalid', id, dove, contesto: D.contestoDiZona(target), motivo: `«${D.nome(id)}» è un'azione ${D.CONTESTI[D.AZIONI[id].contesto].su}: resta nella sua fila o nel suo «Altro…»` } };
  }
  const incognito = !!winOf(sender)?._filoIncognito;
  const layout = await require('../layoutIcone').posa(
    { id, target, beforeId: D.esiste(prima) && prima !== id ? prima : null }, { incognito, via: 'chat' });
  if (!layout) return { executed: false, kept: false, output: { icona: 'invalid', id, dove } };
  return { executed: true, kept: false, output: { icona: id, ...D.doveDaZona(target), layout } };
}

async function azionePannelloApp(action, { sender }) {
  // #1433 — il pannello di destra delle app a parole: le stesse porte del mouse (la pagina per aprire e chiudere,
  // il main per gli strumenti, le Preferenze per il lucchetto).
  const P = globalThis.SN_PANNELLI_APP;
  const op = String(action.operazione ?? action.op ?? '').trim().toLowerCase();
  const win = winOf(sender);
  const tabs = win && win._filoTabs;
  const lista = (tabs && tabs.tabs) || [];
  const daChi = sender?.tab?.id ? lista.find((t) => t.id === sender.tab.id) : null;
  const davanti = lista.find((t) => t.id === tabs?.activeId) || null;
  const scheda = [daChi, davanti].find((t) => t && t.pannelloApp) || null;
  const app = scheda ? scheda.pannelloApp.app : (P && P.catalogo(String(action.app || '')) ? String(action.app) : 'editor');
  if (op === 'aggiungi' || op === 'togli') {
    const id = P ? P.risolvi(app, action.elemento ?? action.id) : null;
    if (!id) return { executed: false, kept: false, output: { elemento: 'sconosciuto', disponibili: P ? P.catalogo(app).elementi.map((e) => e.nome) : [] } };
    const esito = await require('../pannelliApp').modifica(app, { op: op === 'aggiungi' ? 'posa' : 'togli', id });
    const dentro = !!(esito && esito.stato && esito.stato.elementi.includes(id));
    return { executed: true, kept: false, output: { app, elemento: id, nelPannello: dentro, giaCosi: !!(esito && !esito.cambiato) } };
  }
  if (op === 'blocca' || op === 'sblocca') {
    await applySettingsUpdate({ pannelloDestro: { bloccato: op === 'blocca' } });
    if (op === 'blocca' && scheda && tabs.barra?.destro) tabs.barra.destro.comanda(scheda, 'apri', 'chat');
    return { executed: true, kept: false, output: { bloccato: op === 'blocca', apertoSu: scheda ? app : null } };
  }
  if (op === 'apri' || op === 'chiudi') {
    if (!scheda || !tabs?.barra?.destro) return { executed: false, kept: false, output: { pannello: 'nessuna app col pannello davanti' } };
    tabs.barra.destro.comanda(scheda, op, 'chat');
    return { executed: true, kept: false, output: { pannello: op === 'apri' ? 'aperto' : 'chiuso', app } };
  }
  return { executed: false, kept: false, output: { error: 'operazione sconosciuta' } };
}

async function azioneCartaHome(action, { sender, chatId }) {
  const op = String(action.operazione ?? action.op ?? '').trim().toLowerCase();
  const tipo = { togli: 'togli', rimetti: 'aggiungi', aggiungi: 'aggiungi', sposta: 'sposta', ripristina: 'ripristina' }[op];
  if (!tipo) return { executed: false, kept: false, output: { error: 'operazione sconosciuta' } };
  const verso = String(action.verso ?? '').trim().toLowerCase().replace('giù', 'giu') || undefined;
  const CH = globalThis.SN_CARTE_HOME;
  // Una carta di sinistra si cerca prima per chiave, poi un nome esatto di destra, poi per nome a sinistra:
  // «lo scaricamento del file» non deve finire sull'Editor, che fra i suoi nomi ha «file».
  // «Rimetti» una carta di sinistra tolta (uno scaricamento, un lavoro): torna lei sola, la disposizione resta.
  if (tipo === 'aggiungi' && !CH.risolvi(action.carta, { esatto: true })) {
    const rimessa = await rimettiSinistraDaChat({ action, sender, chatId });
    if (rimessa) return rimessa;
  }
  if (tipo !== 'ripristina') {
    const sx = await carteSinistraPerChat(sender, chatId);
    const perChiave = sx.find((v) => v.chiave === String(action.carta ?? '').trim());
    if (perChiave || !CH.risolvi(action.carta, { esatto: true })) {
      const trovate = perChiave ? { voci: [perChiave], perTipo: false, tipo: perChiave.tipo } : CH.trovaSinistra(action.carta, sx);
      if (trovate.voci.length || trovate.tipo || !CH.risolvi(action.carta)) return cartaSinistraDaChat({ tipo, verso, action, sx, trovate, sender });
    }
  }
  // Il Deck builder in pausa (#1592) non ha una carta da rimettere o spostare: per chi chiede non esiste.
  if (CH.risolvi(action.carta) === 'mazzi' && !require('../inPausa').aperti().mazzi) {
    return { executed: false, kept: false, output: { error: 'carta sconosciuta', ...descriviCarte(await require('../carteHome').leggi()) } };
  }
  const esito = await require('../carteHome').modifica({ tipo, carta: action.carta, verso, prima: action.prima_di ?? null });
  const dove = descriviCarte(esito.layout);
  if (esito.errore) return { executed: false, kept: false, output: { error: esito.errore, ...dove } };
  if (esito.cambiato) annunciaCarteHome(esito.layout, sender);
  return { executed: true, kept: true, output: dove };
}

// #1803 — la barra dei siti: la stessa mossa dei gesti della home, dallo stesso servizio.
async function azioneBarraSiti(action, { sender }) {
  const { cambiate, impostazioni, ...esito } = await require('../barraSiti').daChat(action);
  if (cambiate) annunciaBarraSiti(cambiate, sender);
  if (impostazioni) await applySettingsUpdate(impostazioni);
  return esito;
}

async function azionePulsantePreferenze(action, { sender }) {
  // #1619 — i pulsanti delle Preferenze con le loro stesse funzioni: la chat li preme invece di spiegarli.
  const P = globalThis.SN_PULSANTI_PREFERENZE;
  const pulsante = P ? P.pulsanteDi(action) : '';
  const no = (error, extra) => ({ executed: false, kept: false, output: { error, ...(extra || {}) } });
  if (!pulsante) return no(`pulsante sconosciuto: si sceglie fra ${P ? P.PULSANTI.join(', ') : 'quelli delle Preferenze'}`, { rifiuto: true });
  if (pulsante === 'ripristina_tutto') {
    const n = action._ripristino && Array.isArray(action._ripristino.frasi) ? action._ripristino.frasi.length : 0;
    if (!n) return no('le impostazioni sono già tutte ai valori di serie', { invariato: true });
    await ripristinaImpostazioni();
    return { executed: true, kept: false, output: { ripristinate: n } };
  }
  if (pulsante === 'ripristina_aspetto') {
    // Il «Ripristina tutti i predefiniti» dell'aspetto: la mappa dei token si sostituisce intera, vuota.
    const correnti = await Storage.getSettings();
    const n = Object.keys(correnti.themeTokens || {}).length;
    if (!n) return no('l\'aspetto è già tutto ai valori di serie', { invariato: true });
    await applySettingsUpdate({ themeTokens: {} });
    return { executed: true, kept: false, output: { ripristinati: n } };
  }
  if (pulsante === 'rifai_intervista') {
    if (!Onboarding) return no('l\'intervista di benvenuto non è disponibile');
    await ricominciaIntervista();
    return apriIntervistaRifatta(sender)
      ? { executed: true, kept: false, output: { aperta: true } }
      : no('l\'intervista è pronta, ma non c\'è una finestra dove aprirla: la ritrovi aprendo una home nuova');
  }
  const settings = await getEffectiveSettings();
  if (pulsante === 'prova_voce_sistema') {
    const v = P.provaVoceSistema(settings);
    const wc = sender && sender.wc;
    if (!wc || (typeof wc.isDestroyed === 'function' && wc.isDestroyed())) return no('non c\'è una pagina dove far sentire la voce');
    wc.send('filo:broadcast', { type: MSG.TTS_PROVA, testo: v.testo, sistema: true });
    return { executed: true, kept: false, output: { voce: v.etichetta, sistema: true } };
  }
  if (pulsante === 'prova_voce') {
    const v = P.provaVoce(action, settings);
    if (v.rifiuto) return no(v.rifiuto, { rifiuto: true });
    // La legge la pagina della chat, come «Leggi ad alta voce»: senza la voce naturale ripiega su quella del sistema.
    const wc = sender && sender.wc;
    if (!wc || (typeof wc.isDestroyed === 'function' && wc.isDestroyed())) return no('non c\'è una pagina dove far sentire la voce');
    wc.send('filo:broadcast', { type: MSG.TTS_PROVA, testo: v.testo, voce: v.voce });
    return { executed: true, kept: false, output: { voce: v.etichetta } };
  }
  const t = P.provaTono(action, settings);
  if (t.rifiuto) return no(t.rifiuto, { rifiuto: true });
  const win = winOf(sender);
  if (!win || win.isDestroyed()) return no('non c\'è una finestra di Filo dove suonare');
  win.webContents.send('shell:suona', { tono: t.tono, volume: t.volume });
  return {
    executed: true,
    kept: false,
    output: { etichetta: t.etichetta, volume: t.volume, ...(t.volume === 0 ? { muto: true } : {}), ...(t.acceso ? {} : { spento: true }) },
  };
}

async function azioneAccount(action, { sender }) {
  return eseguiAccount(action, sender);
}

module.exports = {
  ONBOARDING: azioneOnboarding,
  INVIA_FEEDBACK: azioneInviaFeedback,
  IMPOSTA_PREFERENZA: azioneImpostaPreferenza,
  IMPOSTA_ESTETICA: azioneImpostaEstetica,
  LEGGI_TRASPARENZA: azioneLeggiTrasparenza,
  LEGGI_IMPOSTAZIONI: azioneLeggiImpostazioni,
  TOGLI_PERMESSO_SITO: azioneTogliPermessoSito,
  CAPACITA_DETTAGLIO: azioneCapacitaDettaglio,
  ANNULLA_CAMBIO: azioneAnnullaCambio,
  RIMEDIO_CREDITI: azioneRimedioCrediti,
  SPOSTA_ICONA: azioneSpostaIcona,
  PANNELLO_APP: azionePannelloApp,
  CARTA_HOME: azioneCartaHome,
  PULSANTE_PREFERENZE: azionePulsantePreferenze,
  ACCOUNT: azioneAccount,
};

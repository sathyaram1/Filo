// Le osservazioni per il modello: i *ForPrompt, toolResultText e i testi degli esiti che la chat rilegge.
// Libreria nata da handlers.js: niente registrazioni di messaggi qui.

const PageRead = require('./pageRead');
const { storiaAiuto } = require('./storiaAiuto');
const ContatoriServizio = require('./contatoriServizio');
const Registro = require('./registroCambi');
const ContestoFilo = require('./contestoFilo');
const CercaChiuse = require('./cercaSchedeChiuse');
const { SN_CONST } = globalThis;
const { PROMPTS } = SN_CONST;
const SavedPages = globalThis.SN_SAVED_PAGES;
const ArchivedTabs = globalThis.SN_ARCHIVED_TABS;
const FiloChats = globalThis.SN_FILO_CHATS;       // #525 — archivio delle chat con Filo
const ChatArchive = globalThis.SN_CHAT_ARCHIVE;   // #525 — titoli, tipi, ricerca (logica pura)
const Categorizer = globalThis.SN_CATEGORIZER;
const FiloState = globalThis.SN_FILO_STATE;
const { cancelliAperti } = require('./broadcast');
const { winOf, schedeLeggibili } = require('./handlersComuni');
const { getEffectiveSettings } = require('./impostazioniEffettive');
const { analizzaPer, chiamataPerModello, apriDaFilo, esitoSistemaPerModello } = require('./porteUscita');
const { segnaLetturaAiuto, lettureGettoniAiuto } = require('./autonomiaFonti');
// Questi vivono in moduli che caricano questo: si chiedono al momento della chiamata, non al caricamento.
const filtroDelicate = (...a) => require('./archivioChat').filtroDelicate(...a);
const restaQui = (...a) => require('./archivioChat').restaQui(...a);
const quantizeEmbedding = (...a) => require('./archivioChat').quantizeEmbedding(...a);
const cosineInt = (...a) => require('./archivioChat').cosineInt(...a);
const embedTexts = (...a) => require('./archivioChat').embedTexts(...a);
const conVettoreDi = (...a) => require('./archivioChat').conVettoreDi(...a);

// Esito di PROXY_TAB e REGOLA_PROXY_DOMINIO senza fornitore: proxyUnavailableForPrompt
// e la riga del diario lo riconoscono da `proxy`, e nessuno dei due lo dà per fatto.
const proxyNonDisponibile = () => ({ proxy: 'non_disponibile' });
const esitoNonDisponibile = (a) => !!(a && a._output && a._output.proxy === 'non_disponibile');
const RISPOSTA_PROXY_NON_DISPONIBILE = 'Aprire un sito da un altro paese in Filo non si può ancora.';
// Ogni avviso che chiede di riscrivere la risposta lo dice: GLM raccontava all'utente il perché («riscrivo, che il testo
// è finito nelle note di lavoro», #1921.1), e per l'utente quella è la prima risposta.
const RISCRIVI_SENZA_DIRLO = 'Scrivila come la prima volta: questo avviso e le note di lavoro sono solo per te, quindi non dire all\'utente che '
  + 'stai riscrivendo, ripetendo o correggendo, né perché.';
const SOLLECITO_DOPO_RIFIUTO = '[Il tuo ultimo messaggio è vuoto. Il testo che hai scritto insieme alle azioni l\'utente non l\'ha letto come risposta, '
  + 'e dava per fatto quello che non è disponibile. Scrivi adesso la risposta completa per l\'utente, tenendo conto degli esiti qui sopra. '
  + `${RISCRIVI_SENZA_DIRLO}]`;

// Azioni che mettono un bottone in chat e basta: il loro esito si sa già quando le si chiama. Il bottone dell'evento
// lo aziona l'utente, quindi non risulta «eseguito»: conta che sia in chat.
const AZIONI_SOLO_BOTTONE = new Set(['APRI_FILE', 'EVENTO_CALENDARIO']);
const soloBottone = (type) => AZIONI_SOLO_BOTTONE.has(String(type || '').toUpperCase());
// Un giro di sole azioni così non dà al modello niente da leggere: il testo scritto insieme è già la risposta, non una
// nota di lavoro, anche se il giro dopo aggiunge una frase («ti ho messo il bottone», #1167).
const giroDiSoliBottoni = (results) => results.length > 0 && results.every(({ action, res }) => !!res
  && !res.rejected && res.kept && !res.needsConfirm && !(res.output && res.output.blocked)
  && soloBottone(action && action.type));
// Al modello si dice sempre dove è finito il testo del giro: «l'utente la sta leggendo» solo se è rimasto nella bolla.
// Un testo finito fra le note senza dirglielo restava sepolto lì, con qualunque azione nel giro (#1167).
const NON_RIPETERE_LA_RISPOSTA = 'Il testo che hai scritto insieme a questa chiamata l\'utente lo sta leggendo come risposta: non ripeterlo e non '
  + 'annunciare il bottone. Se non hai altro da fare, chiudi senza scrivere altro.';
const RISPOSTA_FRA_LE_NOTE = 'Il testo che hai scritto insieme a queste chiamate l\'utente lo vede fra le note di lavoro, non come risposta: '
  + `se conteneva la risposta, riscrivila per intero nel prossimo messaggio. ${RISCRIVI_SENZA_DIRLO}`;
const doveStaIlTesto = (giro) => (giro && giro.risposta ? ` ${NON_RIPETERE_LA_RISPOSTA}` : '');
const unisciTesti = (parti) => parti.map((t) => String(t || '').trim()).filter(Boolean).join('\n\n');
// L'esito al modello di un'azione che il tetto ha tagliato a metà degli argomenti.
const ARGOMENTI_TAGLIATI = 'la tua risposta ha raggiunto la lunghezza massima mentre scrivevi gli argomenti di questa azione; '
  + 'se l\'utente ti chiede di continuare, rifalla più corta o dividila in più azioni';
// Letture (elenco in SN_ACTION_LEVELS.LETTURE): una che aspetta l'OK, o fermata per un segreto, ha già la sua parola
// sotto la risposta.
const soloLetture = (azioni) => azioni.every((a) => !a || a._auto || (globalThis.SN_ACTION_LEVELS.diSolaLettura(a.type)
  && !a._confirm && !a._domanda && !(a._output && a._output.blocked)));
const fraseSenzaRisposta = (passi) => `Mi sono fermato dopo ${passi === 1 ? 'un passo' : `${passi} passi`} senza arrivare a una risposta.`;

// L'output dei comandi torna al modello come osservazione accodata al suo messaggio.
// La dimensione è limitata per non far esplodere il prompt.
function commandOutputsForPrompt(actions) {
  if (!Array.isArray(actions)) return '';
  const blocks = [];
  for (const a of actions) {
    if (!a || String(a.type || '').toUpperCase() !== 'ESEGUI_COMANDO') continue;
    const out = a._output;
    if (!out || out.blocked) continue; // comando bloccato (terminale spento): niente output reale
    const E = globalThis.SN_ESTERNO;
    const cmd = String(out.command || a.comando || a.command || a.cmd || '').trim();
    let body = String(out.stdout || '');
    if (out.stderr) body += (body ? '\n' : '') + out.stderr;
    body = body.trim();
    const meta = [];
    if (typeof out.code === 'number') meta.push(`uscita ${out.code}`);
    if (out.cwd) meta.push(`cartella ${out.cwd}`);
    // La cartella dove stavi guardando non c'è più (rinominata, cancellata,
    // chiavetta staccata): il comando è girato nella home. Va detto, o il
    // modello continua a ragionare su una cartella che non esiste e all'utente
    // racconta un guasto che non c'è (#551, quarto giro).
    if (out.cwdPersa) {
      meta.push('la cartella di prima non esiste più (rinominata, spostata o cancellata): '
        + 'il comando è girato nella cartella personale, dillo all\'utente');
    }
    if (out.timedOut) meta.push('interrotto per timeout');
    // #593 (terzo giro di verifica) — IL COMANDO È DI FILO, QUELLO CHE STAMPA
    // NO. Un `curl`, un `cat` di un file appena scaricato, la risposta di un
    // servizio: dentro l'output ci finisce testo scritto da chi sta dall'altra
    // parte. Arrivava nudo, sotto etichette fra parentesi quadre che l'output
    // stesso poteva riscrivere riga per riga, e proprio mentre le istruzioni
    // insegnavano all'assistente che quello che viene da fuori arriva sempre
    // fra due marcature. La riga del comando e l'esito restano fuori: quelli
    // li scrive Filo, e il comando passa comunque dalla rete del canale di
    // sistema perché non apra una riga per conto suo.
    blocks.push(
      `[${a._dallaChat ? 'L\'utente ha eseguito nel terminale, scrivendolo in chat' : 'Ho eseguito nel terminale'}: ${E.perCanaleSistema(cmd)}]\n` +
      (body
        ? E.imbusta({ tipo: 'ESITO_COMANDO', testo: body, conIntestazione: true, max: 4000 })
        : '[Nessun output]') +
      (meta.length ? `\n[Esito] ${meta.join(' · ')}` : ''),
    );
  }
  return blocks.join('\n\n').trim();
}

// Re-immissione del DETTAGLIO delle capacità richieste con CAPACITA_DETTAGLIO in
// un turno precedente (F2): l'agente vede i dati esatti (cosa fa / come si attiva
// / limiti) e risponde all'utente senza indovinare l'invocazione a memoria.
// Sono DATI affidabili di sistema, non istruzioni.
// Le impostazioni lette con LEGGI_IMPOSTAZIONI (#949), anche nei turni dopo. I valori li può aver scritti
// un modello (lo stile, i nomi delle voci, i siti in elenco): stanno nel recinto dei testi salvati.
function impostazioniLetteForPrompt(actions) {
  if (!Array.isArray(actions)) return '';
  const E = globalThis.SN_ESTERNO;
  const blocchi = [];
  for (const a of actions) {
    if (!a || String(a.type || '').toUpperCase() !== 'LEGGI_IMPOSTAZIONI') continue;
    const o = a._output;
    if (!o || !Array.isArray(o.righe)) continue;
    const cerca = o.cerca ? E.neutralizza(o.cerca, { unaRiga: true }) : '';
    const testa = !cerca ? 'tutte le voci'
      : (o.trovate ? `le voci che c'entrano con «${cerca}»` : `nessuna voce c'entra con «${cerca}», quindi tutte`);
    blocchi.push(`[Impostazioni di Filo lette con impostazioni(leggi) (${testa}): sono i valori veri di quel momento, `
      + 'rispondi con questi; se nel frattempo ne hai cambiata una, rileggila. Per cambiarne una usa la chiave fra parentesi quadre.]\n'
      + E.imbusta({ tipo: 'TESTO_SALVATO', conIntestazione: true, testo: o.righe.map((r) => E.neutralizza(r, { unaRiga: true })).join('\n') }));
  }
  return blocchi.join('\n\n').trim();
}

function capabilityDetailsForPrompt(actions) {
  if (!Array.isArray(actions)) return '';
  const blocks = [];
  for (const a of actions) {
    if (!a || String(a.type || '').toUpperCase() !== 'CAPACITA_DETTAGLIO') continue;
    const out = a._output;
    if (!out || !out.detail) continue;
    blocks.push(`[Dettaglio delle capacità di Filo richiesto]\n${out.detail}`);
  }
  return blocks.join('\n\n').trim();
}

// #2536.1 — la memoria letta con memoria(leggi), già nella sua busta come nel CONTESTO.
function memoriaLettaForPrompt(actions) {
  if (!Array.isArray(actions)) return '';
  const blocchi = [];
  for (const a of actions) {
    if (!a || String(a.type || '').toUpperCase() !== 'LEGGI_MEMORIA') continue;
    const o = a._output;
    if (!o || typeof o.memoria !== 'string') continue;
    blocchi.push(o.memoria
      ? `[La memoria di Filo sull'utente, letta con memoria(leggi): com'era in quel momento. Per togliere o correggere una cosa usa memoria(dimentica) o memoria(correggi) con un pezzo del suo testo.]\n${o.memoria}`
      : '[La memoria di Filo sull\'utente, letta con memoria(leggi): è vuota, di lui non hai salvato niente.]');
  }
  return blocchi.join('\n\n').trim();
}

// Re-immissione dei RISULTATI di una CERCA_WEB eseguita in un turno precedente
// (#368): l'agente vede titoli, URL e snippet REALI e può rispondere con link
// veri (o aprirne uno con NAVIGA usando l'URL esatto).
//
// #593 (secondo giro di verifica) — NON SONO DATI DI SISTEMA, e per un po' sono
// stati trattati come tali. Titolo, indirizzo e riassunto li scrive chi possiede
// la pagina trovata, e comparire fra i primi risultati per una query non è
// difficile; la ricerca, senza chiave, passa dal motore pubblico. Arrivavano
// nudi, sotto una riga che l'assistente legge come una comunicazione di Filo:
// la stessa falla del feedback, sull'agente della nuova scheda invece che
// sull'Aiuto — e questo ha in mano gli strumenti grossi (apre siti, cambia
// impostazioni, chiede di eseguire comandi). Adesso passano dalla stessa busta
// dell'Aiuto: `SN_CONST.PROMPTS.ricercaWebImbustata`, cioè intestazione che li
// dichiara dati, due marcature e la pulizia che impedisce al contenuto di
// scriversele da sé. Una funzione sola per i due agenti: due composizioni a
// mano divergerebbero in silenzio, che è esattamente com'era nata questa.
function webSearchResultsForPrompt(actions) {
  if (!Array.isArray(actions)) return '';
  const E = globalThis.SN_ESTERNO;
  const blocks = [];
  for (const a of actions) {
    if (!a || String(a.type || '').toUpperCase() !== 'CERCA_WEB') continue;
    const out = a._output;
    if (!out || !('search' in out)) continue;
    const query = String(out.search || a.query || '').trim();
    const results = Array.isArray(out.results) ? out.results : [];
    if (!results.length) {
      // Anche qui niente testo di fuori nella riga di Filo: il motivo può
      // essere il corpo della risposta di un servizio remoto, e la query la
      // scrive il modello ricopiando spesso qualcosa che ha letto.
      const why = out.error || out.reason || 'nessun risultato';
      blocks.push(`[Ricerca web "${E.perCanaleSistema(query)}": nessun risultato (${E.perCanaleSistema(why)})]`);
      continue;
    }
    blocks.push(PROMPTS.ricercaWebImbustata({ query, provider: out.provider || '', results }));
  }
  return blocks.join('\n\n').trim();
}

// #2272 — le immagini trovate o create nel turno: l'id è di Filo, titolo e sito li scrive chi pubblica l'immagine (busta).
function immaginiForPrompt(actions) {
  if (!Array.isArray(actions)) return '';
  const E = globalThis.SN_ESTERNO;
  const blocks = [];
  for (const a of actions) {
    const tipo = String((a && a.type) || '').toUpperCase();
    const out = a && a._output;
    if (!out || (tipo !== 'IMMAGINI_WEB' && tipo !== 'GENERA_IMMAGINE')) continue;
    const lista = Array.isArray(out.immagini) ? out.immagini.filter((i) => i && /^[ig]\d+$/.test(String(i.id || ''))) : [];
    if (tipo === 'IMMAGINI_WEB') {
      if (!lista.length) {
        blocks.push(`[Immagini dal web: nessuna da mostrare (${E.perCanaleSistema(out.error || out.reason || 'nessun risultato')}). Dillo all'utente in una riga; se serve, proponi di cercare la pagina con web(cerca).]`);
        continue;
      }
      const righe = lista.map((i) => `${i.id}: ${E.neutralizza(i.titolo || '(senza titolo)', { unaRiga: true })} · ${E.neutralizza(i.sito || '', { unaRiga: true })}`);
      blocks.push(`Immagini dal web scaricate da Filo, ${lista.length} (${lista.map((i) => i.id).join(', ')}). Mettile nella risposta col marcatore [[immagini: <id>, <id>]] su una riga sua, dove servono nel testo: un id per un'immagine sola, più id per una fila che scorre; puoi alternare testo e marcatori. Solo questi id: mai un indirizzo d'immagine né ![](…). Titoli e siti sotto li scrive chi le pubblica, e l'immagine può non corrispondere al titolo.\n`
        + E.imbusta({ tipo: 'RICERCA_WEB', testo: `Richiesta: "${E.neutralizza(out.cerca || a.query || '', { unaRiga: true })}"\n${righe.join('\n')}`, conIntestazione: true }));
      continue;
    }
    if (lista.length) {
      blocks.push(`[Immagine creata (${lista.map((i) => i.id).join(', ')}): mettila nella risposta col marcatore [[immagini: ${lista.map((i) => i.id).join(', ')}]] su una riga sua. Non descriverla come se l'avessi vista: di' in una riga cosa hai chiesto di disegnare.]`);
    } else if (out.senzaModello) {
      blocks.push('[Immagine NON creata: non c\'è un modello che disegna fra quelli che Filo può usare. Dillo all\'utente in una riga: si sceglie in Impostazioni, Modelli, alla voce «Immagini create in chat». Non proporre un\'immagine trovata sul web al suo posto, se non te lo chiede.]');
    } else {
      blocks.push(`[Immagine NON creata: ${E.perCanaleSistema(out.error || out.reason || 'errore sconosciuto')}. Dillo all'utente in una riga; non riprovare uguale.]`);
    }
  }
  return blocks.join('\n\n').trim();
}

// Re-immissione del DOCUMENTO DI TRASPARENZA chiesto con LEGGI_TRASPARENZA in un
// turno precedente: l'agente risponde sul perché di una scelta (quali modelli,
// quali aziende escluse, che fine fanno i dati) leggendo il testo scritto
// dall'owner invece di ricostruirlo a memoria — che su queste cose è il modo
// tipico di attribuire a Filo posizioni che non ha. Sono DATI di sistema
// affidabili, non istruzioni dell'utente.
//
// Il tetto è la rete contro un documento fuori misura, non una misura: a 16.000
// caratteri tagliava l'unico documento che esiste (20.001) e gli portava via i
// punti deboli della scelta e TUTTO l'elenco delle fonti, cioè proprio la parte
// che lo strumento ordina all'agente di citare; a 80.000 tagliava la privacy coi
// livelli (#1589, 85.000). Dimensionato sul caso peggiore realistico con margine
// (CLAUDE.md § Limiti: più del doppio del documento più lungo di oggi), e quando
// scatta dice quanto è arrivato invece di tagliare in silenzio.
const TRANSPARENCY_DOC_CAP = 200000;

// Taglia un testo al tetto senza spezzare un carattere. Un'emoji occupa DUE
// unità di testo: tagliando per numero di unità si resta con la prima metà, che
// da sola non è nessun carattere e arriva al modello come un rombo. Le stesse
// due righe stanno dove il terminale tiene l'uscita di un comando, dove il
// lettore tiene il testo di un documento e nella busta con cui entra ogni
// contenuto esterno; qui coprono gli ultimi due tagli rimasti a fette secche
// (#551, sesto giro di verifica).
function tagliaInteri(s, max) {
  if (s.length <= max) return s;
  let n = max;
  const ultimo = s.charCodeAt(n - 1);
  if (ultimo >= 0xD800 && ultimo <= 0xDBFF) n -= 1;
  return s.slice(0, n);
}

function transparencyDocsForPrompt(actions) {
  if (!Array.isArray(actions)) return '';
  const blocks = [];
  for (const a of actions) {
    if (!a || String(a.type || '').toUpperCase() !== 'LEGGI_TRASPARENZA') continue;
    const out = a._output;
    if (!out || !out.text) continue;
    let body = String(out.text);
    if (body.length > TRANSPARENCY_DOC_CAP) {
      const tenuto = tagliaInteri(body, TRANSPARENCY_DOC_CAP);
      body = `${tenuto}\n…(documento troncato: qui sopra ci sono i primi ${tenuto.length} caratteri su ${body.length}. Dillo all'utente invece di completare a memoria.)`;
    }
    blocks.push(`[Documento di trasparenza di Filo${out.doc ? ` "${out.doc}"` : ''}]\n${body}`);
  }
  return blocks.join('\n\n').trim();
}

// #868 — le pagine del filo per CERCA_CHAT: quelle visitate (titolo e indirizzo, per parole) e le schede chiuse
// anche per contenuto, coi vettori della Cronologia. Una pagina delicata o di casa dice solo il sito (#1004).
const MAX_PAGINE_CHAT = 8;
const SOGLIA_PAGINA = 0.35;

// Le schede chiuse si cercano con una regola sola per CERCA_CHAT e SCHEDE_CHIUSE: stesso testo, stessa soglia, e una
// scheda delicata (#1004), per l'indirizzo o per come l'ha lasciata, non si cerca né si mostra per il suo riassunto.
const chiusaDelicata = (it, fuori) => !!fuori(it.url) || restaQui(it, fuori);
const testoDellaChiusa = (it, fuori) => [it.title, chiusaDelicata(it, fuori) ? '' : it.summary, it.url].filter(Boolean).join(' ');

// Le voci di `voci` vicine per senso a `query`, dalla più vicina, oltre a quelle già `prese` per parole.
async function chiusePerSenso(query, voci, { settings, fuori, prese = new Set() }) {
  let emb = null;
  try { emb = voci.length ? await embedTexts([query], settings) : null; } catch (_) { emb = null; }
  const qv = emb && emb.vectors && emb.vectors[0] && emb.vectors[0].length ? quantizeEmbedding(emb.vectors[0]) : null;
  if (!qv) return [];
  const vicine = [];
  for (const it of voci) {
    if (prese.has(it) || chiusaDelicata(it, fuori) || !conVettoreDi(it, emb.model)) continue;
    const sc = cosineInt(qv, it.embedding);
    if (sc >= SOGLIA_PAGINA) vicine.push({ it, sc });
  }
  return vicine.sort((a, b) => b.sc - a.sc).map((x) => x.it);
}

async function paginePerChat(query) {
  const CA = ChatArchive;
  if (!CA.normalizeForSearch(query).trim()) return [];
  const settings = await getEffectiveSettings();
  const fuori = await filtroDelicate(settings);
  const chiave = (u) => String(u || '').replace(/#.*$/, '');
  // Una pagina rivista dieci volte è un candidato solo, con la visita più recente.
  let visite = [];
  try { visite = await globalThis.SN_IL_FILO.pagine(); } catch (_) {}
  const viste = new Map();
  for (const v of visite) {
    if (!v || !v.url) continue;
    const prima = viste.get(chiave(v.url));
    if (!prima || Date.parse(v.ts || 0) >= Date.parse(prima.ts || 0)) viste.set(chiave(v.url), v);
  }
  const archivio = await ArchivedTabs.list().catch(() => []);
  const candidati = [
    ...[...viste.values()].sort((a, b) => Date.parse(b.ts || 0) - Date.parse(a.ts || 0)).map((v, i) => ({
      id: `v${i}`, testo: `${v.titolo || ''} ${v.url}`,
      pagina: { url: v.url, title: v.titolo || '', date: v.ts, chiusa: false, _voce: v },
    })),
    ...archivio.map((it, i) => ({
      id: `a${i}`, testo: testoDellaChiusa(it, fuori),
      pagina: { url: it.url, title: it.title || '', date: it.closedAt || null, chiusa: true, riassunto: chiusaDelicata(it, fuori) ? '' : (it.summary || ''), _voce: it },
    })),
  ];
  // Per parole, con gli stessi tre passi delle conversazioni: una parola in più nella domanda non fa sparire la pagina.
  const perParole = CA.searchWide(candidati, query, { testo: (c) => c.testo }).results;
  // Le schede chiuse anche per significato, se c'è l'indice.
  const prese = new Set(perParole.filter((c) => c.pagina.chiusa).map((c) => c.pagina._voce));
  const candidatoDi = new Map(archivio.map((it, i) => [it, candidati[viste.size + i]]));
  const perSenso = (await chiusePerSenso(query, archivio, { settings, fuori, prese })).map((it) => candidatoDi.get(it));
  const trovate = new Map();
  for (const { pagina: p } of [...perParole, ...perSenso]) {
    if (trovate.size >= MAX_PAGINE_CHAT && !trovate.has(chiave(p.url))) continue;
    const prima = trovate.get(chiave(p.url));
    if (!prima || (p.chiusa && !prima.chiusa)) trovate.set(chiave(p.url), { ...prima, ...p });
  }
  const out = [];
  for (const p of [...trovate.values()].sort((a, b) => Date.parse(b.date || 0) - Date.parse(a.date || 0))) {
    const delicata = p.chiusa ? chiusaDelicata(p._voce || {}, fuori) : fuori(p.url);
    // Delicata, o tagliata alla misura (#1525) che porterebbe altrove: esce solo il sito, come da SCHEDE_CHIUSE.
    const tagliata = !!(p._voce && p._voce.urlTagliato);
    const solo = CercaChiuse.soloSito(p.url);
    // Una scheda chiusa porta il suo id d'archivio: RIAPRI_SCHEDA la riapre com'era (#884).
    const idChiusa = p.chiusa && p._voce && typeof p._voce.id === 'string' ? { id: p._voce.id } : {};
    out.push(delicata
      ? { url: solo.url, title: solo.sito, date: p.date, chiusa: !!p.chiusa, delicata: true, ...idChiusa }
      : { url: tagliata ? solo.url : p.url, title: p.title, date: p.date, chiusa: !!p.chiusa, ...idChiusa,
        ...(tagliata ? { tagliata: true } : {}), ...(p.riassunto ? { riassunto: String(p.riassunto).slice(0, 400) } : {}) });
  }
  return out.filter((p) => p.url);
}

// #884 — le schede chiuse per SCHEDE_CHIUSE: nel periodo e col motivo chiesti, poi per parole e per senso come
// paginePerChat; senza parole dalla più recente. Al modello le prime fino al tetto, e il numero vero.
async function schedeChiusePerChat(action) {
  const r = CercaChiuse.richiesta(action);
  if (r.errore) return r;
  const settings = await getEffectiveSettings();
  const fuori = await filtroDelicate(settings);
  const archivio = await ArchivedTabs.list().catch(() => []);
  const nelFiltro = CercaChiuse.filtra(archivio, r);
  const delicata = (it) => chiusaDelicata(it, fuori);
  let scelte = nelFiltro;
  if (r.cerca) {
    const candidati = nelFiltro.map((it) => ({ id: it.id, it, testo: testoDellaChiusa(it, fuori) }));
    const perParole = ChatArchive.searchWide(candidati, r.cerca, { testo: (c) => c.testo }).results.map((c) => c.it);
    scelte = [...perParole, ...await chiusePerSenso(r.cerca, nelFiltro, { settings, fuori, prese: new Set(perParole) })];
  }
  return {
    schede: scelte.slice(0, CercaChiuse.TETTO).map((it) => CercaChiuse.perModello(it, { delicata: delicata(it) })),
    trovate: scelte.length,
    totale: archivio.length,
    cercato: r.cerca,
    ...(r.motivo ? { motivo: r.motivo } : {}),
    ...(r.periodo.da || action.a ? { periodo: r.periodo } : {}),
  };
}

// La voce d'archivio di `id`, e come la vede il modello (una pagina delicata solo col sito).
async function voceChiusa(id) {
  const chiave = String(id ?? '').trim();
  let voce = null;
  try { voce = chiave ? (await ArchivedTabs.listMeta()).find((t) => t && t.id === chiave) || null : null; } catch (_) {}
  if (!voce) return {};
  const fuori = await filtroDelicate(await getEffectiveSettings());
  return { voce, perModello: CercaChiuse.perModello(voce, { delicata: chiusaDelicata(voce, fuori) }) };
}

// Gli id delle schede nell'ordine dei numeri letti dal modello, per ogni strumento che prende `scheda`: l'elenco del
// turno o, senza (una conferma arrivata dopo), quello della barra, come lo conta l'utente (#413.2).
async function schedeNumerate(win, schedeViste) {
  if (Array.isArray(schedeViste)) return schedeViste;
  try { return (await FiloState.listTabs({ windowId: win?.id ?? null, barra: true })).map((t) => t.id); } catch (_) { return []; }
}

// La scheda che MOSTRA_SCHEDA porta davanti: col numero, o `verso` dopo/prima di quella davanti come Ctrl+Tab (#2371).
async function schedaDaMostrare(tm, action, schedeViste) {
  const verso = String(action.verso ?? '').trim().toLowerCase();
  if (!(verso === 'dopo' || verso === 'prima') || action.scheda != null) return schedaPerNumero(tm, action, schedeViste);
  const tabs = Array.isArray(tm.tabs) ? tm.tabs : [];
  if (tabs.length < 2) return { errore: 'c\'è una scheda sola: non ce n\'è un\'altra su cui passare' };
  const i = globalThis.SN_TASTI.schedaNelVerso(verso, tabs.findIndex((t) => t.id === tm.activeId), tabs.length);
  return tabs[i] ? { tab: tabs[i] } : null;
}

// La scheda col numero `scheda` di TAB APERTE: { tab }, { errore } o null se il numero non c'è.
async function schedaPerNumero(tm, action, schedeViste) {
  const numero = Number(action.scheda ?? action.numero ?? 0);
  if (!Number.isInteger(numero) || numero <= 0) return null;
  const ids = await schedeNumerate(tm.win, schedeViste);
  const tab = tm.tabs.find((t) => t.id === ids[numero - 1]);
  return tab ? { tab } : { errore: `nell'elenco TAB APERTE non c'è la scheda numero ${numero}` };
}

// Cosa ferma «metti in pausa»: la scheda col suo numero, o tutte quelle che suonano.
async function bersaglioPausa(tm, action, schedeViste) {
  const perNumero = await schedaPerNumero(tm, action, schedeViste);
  if (perNumero) return perNumero.tab ? { tabs: [perNumero.tab] } : perNumero;
  return { tabs: tm.tabs.filter((t) => t.audible || t._mediaInCorso) };
}

// #1397 — la scheda che «rimettimi la musica» fa ripartire: quella col numero detto, o l'ultima che ha suonato e ora
// tace, aperta o chiusa. { tab } | { chiusa } | { giaSuona } | { nessuna } | { errore }.
async function bersaglioAudio(tm, action, schedeViste) {
  const perNumero = await schedaPerNumero(tm, action, schedeViste);
  if (perNumero) return perNumero;
  const ferma = tm.tabs.filter((t) => t.audioAt > 0 && !t.audible).sort((x, y) => y.audioAt - x.audioAt)[0] || null;
  const chiusa = await tm.ultimaChiusaCheSuonava();
  if (ferma && (!chiusa || ferma.audioAt >= chiusa.at)) return { tab: ferma };
  if (chiusa) { const aperta = tm.apertaCon(chiusa.url); return aperta ? { tab: aperta } : { chiusa }; }
  const suona = tm.tabs.find((t) => t.audible);
  return suona ? { giaSuona: suona } : { nessuna: true };
}

// #845 — «Aperti per dopo» per CERCA_SALVATE: per titolo, indirizzo e categoria, coi tre passi della ricerca nel filo.
// Al modello vanno le più recenti fino al tetto, e il numero vero: le altre le dice, non le tace.
const MAX_SALVATE_CHAT = 30;
async function salvatePerChat(query) {
  const CA = ChatArchive;
  const pagine = (await SavedPages.list()).filter((p) => p && p.id && p.url);
  let categorie = [];
  try { categorie = await Categorizer.listCategories(); } catch (_) {}
  const categoria = (p) => (p.categoryId && (categorie.find((c) => c.id === p.categoryId) || {}).name) || p.category || '';
  // «ricetta» deve trovare /ricette/ e «campeggio» i campeggi: le parole che contano si cercano senza la vocale finale.
  const radici = CA.paroleDi(query)
    .map((w) => (w.length >= 5 && CA.terminiCheDistinguono([w]).length ? w.replace(/[aeiou]$/, '') : w)).join(' ');
  const { results, termini, allargata } = CA.searchWide(pagine, radici, {
    testo: (p) => `${p.title || ''} ${p.url} ${categoria(p)}`,
  });
  return {
    cercato: query,
    cercatoCon: termini,
    allargata,
    totale: pagine.length,
    trovate: results.length,
    pagine: results.slice(0, MAX_SALVATE_CHAT).map((p) => ({
      id: p.id, title: p.title || '', url: p.url, categoria: categoria(p), savedAt: p.savedAt || null,
    })),
  };
}

// La pagina salvata che la chat apre (lo strumento o il bottone sotto la risposta) fa quello del clic sulla lista:
// si apre davanti con l'indirizzo che ha in elenco e, salvo `tieni`, esce dalla lista. `porta`: il bottone passa
// dalla porta delle uscite come i collegamenti delle pagine di Filo; lo strumento ci è già passato prima del gate.
async function apriPaginaSalvata(id, { sender = null, tieni = false, porta = true, confermato = false } = {}) {
  const voce = (await SavedPages.list()).find((p) => p && p.id === String(id || '').trim());
  if (!voce || !/^https?:\/\//i.test(String(voce.url || ''))) return { ok: false, trovata: false };
  const win = winOf(sender);
  const tm = win && win._filoTabs;
  if (!tm || typeof tm.openTab !== 'function') return { ok: false, trovata: true, error: 'no_window' };
  let tabId = null;
  // Per il giudizio sui siti la pagina salvata la chiede l'utente, col clic o a parole (#814).
  const origine = { tipo: 'filo', gesto: true };
  if (porta) {
    const r = await apriDaFilo(voce.url, { wc: (sender && sender.wc) || null, avvisa: false, confermato, apri: () => { tabId = tm.openTab(voce.url, { activate: true, origine }); } });
    if (!r.aperto) return { ok: false, trovata: true, ...(r.conferma ? { conferma: r.conferma, parti: r.parti } : {}), ...(r.frase ? { frase: r.frase } : {}) };
  } else {
    tabId = tm.openTab(voce.url, { activate: true, origine });
  }
  if (!tabId) {
    let d = null;
    try { d = require('./siteBlock').shouldBlockNavigation(voce.url); } catch (_) {}
    return { ok: false, trovata: true, blocked: 'site', host: (d && d.host) || '', reason: (d && d.reason) || '', url: voce.url };
  }
  if (!tieni) await SavedPages.consume(voce.id);
  return { ok: true, trovata: true, tolta: !tieni, tabId, id: voce.id, titolo: voce.title || '', url: voce.url };
}

// I cambi di impostazioni, aspetto, sveglie e zoom (#867) che combaciano: si annullano con ANNULLA_CAMBIO e l'id.
async function cambiPerChat(query) {
  const K = globalThis.SN_CAMBI;
  if (!K) return { cambi: [], termini: [], allargata: false };
  const { eventi } = await Registro.ultimi({ max: 1 });
  return K.cercaPerChat(eventi, query, { max: 6 });
}

// La rilettura di una conversazione con CERCA_CHAT e l'id: intera fino a `cap`, oltre testa e coda, e con `da` un pezzo
// che non supera la stessa misura. `intera`: il modello l'ha davanti tutta, e i suoi pezzi non si ripescano (#868.1).
function rilettura(chat, { da = null, cap }) {
  // Per la regola dell'indirizzo scritto (#553) contano solo le parole dell'utente: non quelle di Filo, che le ha scritte
  // il modello, né quelle scritte nell'Aiuto sopra un sito, che le vedeva il sito (#1508).
  const { daFuori, parole: scrittoDallUtente, classeLetta } = globalThis.SN_FILO_CONTESTO.provenienzaDellaChat(chat);
  const transcript = ChatArchive.transcriptForReading(chat.messages, { da, cap, pezzo: Math.min(ChatArchive.PEZZO_RILETTURA, cap) });
  const conDa = da != null && da !== '' && Number.isFinite(Number(da));
  return {
    chatRead: chat.id,
    found: true,
    title: chat.title || ChatArchive.fallbackTitle(chat.messages),
    date: chat.closedAt || chat.updatedAt || chat.startedAt || null,
    // La trascrizione arriva già nella forma "Utente: … / Filo: …", con testa e coda se è lunghissima (mai un taglio muto).
    transcript,
    ...(!conDa && transcript.length <= cap ? { intera: true } : {}),
    linkUtente: PageRead.linkNelTesto(scrittoDallUtente),
    ...(daFuori.length ? { daFuori } : {}),
    ...(classeLetta > 1 ? { classeLetta } : {}),
  };
}

// #525 — re-immissione di quello che CERCA_CHAT ha trovato nell'archivio delle
// conversazioni passate.
//
// L'hanno scritta l'utente e Filo, non un sito — ma è proprio dentro una chat
// che l'utente incolla una pagina web, un PDF, il messaggio di qualcun altro.
// Mesi dopo quel testo rientra QUI, nel canale che il modello legge come voce
// di Filo, davanti all'assistente che apre siti, cambia impostazioni e lancia
// comandi: una cornice fatta di parentesi quadre il testo se la riscrive
// carattere per carattere, e «[Fine della conversazione passata]» è una riga
// che chiunque può scrivere in una chat.
//
// Quindi imbustato, come ogni altro testo che non ha scritto Filo (vedi
// patterns/il-canale-fidato-non-trasporta-testo-di-fuori.md). La stessa busta
// che il classificatore dei titoli usa già sulla stessa trascrizione: fuori
// restano solo le parole di Filo — cosa è questo blocco, e cosa farne.
//
// Esterno è tutto quello che viene dall'archivio: la trascrizione, il
// frammento trovato dalla ricerca e anche il TITOLO, che lo scrive un modello
// dopo aver letto quella stessa conversazione.
// filo(espandi): messaggi, pagine e cose successe fra due istanti (il calcolo: SN_TRATTO_VIVO.rileggi). Le pagine
// arrivano già col filtro delle delicate e della rete di casa (contestoFilo.vociDiPagine).
async function espandiFilo(daRaw, aRaw) {
  const t0 = Date.parse(String(daRaw ?? ''));
  if (!Number.isFinite(t0)) return { errore: '«da» non è un istante: scrivilo come 2026-11-12T20:24' };
  return globalThis.SN_TRATTO_VIVO.rileggi({
    da: daRaw, a: aRaw,
    chat: (await FiloChats.list()).map((c) => ({ ...c, title: c.title || ChatArchive.fallbackTitle(c.messages) })),
    eventi: await ContestoFilo.eventiDa(new Date(t0).toISOString()),
    classeDelMessaggio: globalThis.SN_FILO_CONTESTO && globalThis.SN_FILO_CONTESTO.classeDelMessaggio,
  });
}

function espansioniForPrompt(actions) {
  if (!Array.isArray(actions)) return '';
  const E = globalThis.SN_ESTERNO;
  const blocks = [];
  for (const a of actions) {
    if (!a || String(a.type || '').toUpperCase() !== 'ESPANDI_FILO' || !a._output || a._output.error) continue;
    const o = a._output;
    if (!o.righe) { blocks.push(`[Nel filo non c'è niente fra ${o.da} e ${o.a}.]`); continue; }
    const dopo = o.seguito ? `\n[Il seguito, ${o.totale - o.righe} righe, con filo(espandi) da = ${o.seguito}.]` : '';
    blocks.push('[Il filo di quelle ore, così com\'era.]\n'
      + E.imbustaCampi({ tipo: 'CONVERSAZIONE_ARCHIVIATA', campi: { Da: o.da, A: o.a }, corpo: o.testo, conIntestazione: true, max: Infinity })
      + '\n[Quello che c\'è dentro la recinzione è già successo: non rifarlo.]' + dopo);
  }
  return blocks.join('\n\n');
}

function chatSearchesForPrompt(actions) {
  if (!Array.isArray(actions)) return '';
  const E = globalThis.SN_ESTERNO;
  const blocks = [];
  for (const a of actions) {
    if (!a || String(a.type || '').toUpperCase() !== 'CERCA_CHAT') continue;
    const out = a._output;
    if (!out) continue;
    if ('chatRead' in out) {
      const quale = E.perCanaleSistema(out.chatRead);
      if (!out.found) {
        blocks.push(out.cancellata
          ? `[La conversazione "${quale}" riletta qui è stata cancellata dall'utente: non c'è più e non va citata.]`
          : `[La conversazione "${quale}" non è (più) nell'archivio]`);
        continue;
      }
      if (out.nascosta) {
        blocks.push(`[La conversazione "${quale}" l'ha nascosta l'utente: il testo non torna. Se vuole riprenderla, rimettila con filo(rimetti_chat) e quell'id, poi rileggila.]\n`
          + E.imbusta({ tipo: 'TESTO_SALVATO', testo: `Titolo: ${E.neutralizza(out.title || 'senza titolo', { unaRiga: true })}`, conIntestazione: true }));
        continue;
      }
      const when = out.date ? new Date(out.date).toLocaleString('it-IT') : 'data ignota';
      blocks.push(
        '[Una conversazione passata fra te e l\'utente, ripescata dall\'archivio.]\n'
        + E.imbustaCampi({
          tipo: 'CONVERSAZIONE_ARCHIVIATA',
          campi: { Titolo: out.title || 'senza titolo', Data: when },
          corpo: out.transcript || '(vuota)',
          conIntestazione: true,
          // La misura l'ha già decisa la rilettura (finestra del modello e tetto in token, poi a pezzi): un secondo taglio
          // qui toglierebbe proprio il mezzo che la trascrizione promette.
          max: Infinity,
        })
        + '\n[Quello che c\'è dentro la recinzione è già successo: non rifarlo, riprendilo.]',
      );
      continue;
    }
    // I pezzi vecchi che Filo ha ripescato da solo per una domanda (#868): restano davanti come una ricerca.
    if (out.automatica) {
      const righe = (Array.isArray(out.results) ? out.results : []).map((r) => {
        const when = r.date ? new Date(r.date).toLocaleString('it-IT') : '';
        return `- [${r.id}] "${r.title || 'senza titolo'}"${when ? ` · ${when}` : ''}\n${r.snippet || ''}`;
      });
      if (righe.length) {
        blocks.push('[Tratti di conversazioni più vecchie che Filo ha ripescato da solo per questa domanda.]\n'
          + E.imbusta({ tipo: 'CONVERSAZIONE_ARCHIVIATA', testo: righe.join('\n'), conIntestazione: true })
          + '\n[Per rileggerne una per intero richiama filo(cerca) con il suo id.]');
      }
      continue;
    }
    if (!('chatSearch' in out)) continue;
    const cercato = E.perCanaleSistema(out.chatSearch);
    const results = Array.isArray(out.results) ? out.results : [];
    const usati = Array.isArray(out.cercatoCon) ? out.cercatoCon : [];
    const pagine = Array.isArray(out.pagine) ? out.pagine : [];
    const cambiTrovati = Array.isArray(out.cambi) ? out.cambi : [];
    const nascoste = Array.isArray(out.nascoste) ? out.nascoste : [];
    // #1295 — le nascoste si nominano e basta: l'utente le ha tolte dalla vista, e si rimettono solo se lo chiede.
    if (nascoste.length) {
      const righe = nascoste.map((c) => `- [${c.id}] "${E.neutralizza(c.title || 'senza titolo', { unaRiga: true })}"${c.date ? ` · ${new Date(c.date).toLocaleDateString('it-IT')}` : ''}`);
      blocks.push(`[${out.nascosteTutte ? `Tutte le ${nascoste.length} conversazioni che l'utente ha nascosto` : `Conversazioni che l'utente ha nascosto e che combaciano con "${cercato}"`}: non le leggi. Se è una di queste che cerca, diglielo e chiedigli se vuole rimetterla (filo(rimetti_chat) con l'id).]\n`
        + E.imbusta({ tipo: 'TESTO_SALVATO', testo: righe.join('\n'), conIntestazione: true }));
    }
    // #868 — le pagine visitate: titoli, indirizzi e riassunti li scrivono i siti, quindi in busta.
    if (pagine.length) {
      const righe = pagine.map((pg) => {
        const when = pg.date ? new Date(pg.date).toLocaleString('it-IT') : '';
        const stato = pg.chiusa ? 'scheda chiusa' : 'visitata';
        return `- ${pg.id ? `[${pg.id}] ` : ''}${pg.title || '(senza titolo)'} · ${stato}${when ? ` · ${when}` : ''}${pg.delicata ? ' · pagina delicata: qui solo il sito' : ''}${pg.tagliata ? ' · indirizzo troppo lungo: qui solo il sito' : ''}\n  ${pg.url}${pg.riassunto ? `\n  ${pg.riassunto}` : ''}`;
      });
      blocks.push(`[Le pagine del filo che combaciano con "${cercato}". Una scheda chiusa si riapre com'era con scheda(riapri) e il suo id; una pagina visitata con scheda(apri) e il suo indirizzo.]\n`
        + E.imbusta({ tipo: 'DATI_PAGINA', testo: righe.join('\n'), conIntestazione: true }));
    }
    if (cambiTrovati.length) {
      const righe = cambiTrovati.map((c) => `- [${c.id}] ${c.frase}${c.date ? ` · ${new Date(c.date).toLocaleString('it-IT')}` : ''}`);
      const conMeno = Array.isArray(out.cambiCercatiCon) && out.cambiCercatiCon.length
        ? ` (nessuno con tutte le parole: trovati cercando "${E.perCanaleSistema(out.cambiCercatiCon.join(' '))}", controlla che siano quelli giusti)`
        : '';
      blocks.push(`[I cambi del filo che combaciano con "${cercato}"${conMeno}: si rimettono com'erano con filo(annulla) e l'id.]\n`
        + E.imbusta({ tipo: 'TESTO_SALVATO', testo: righe.join('\n'), conIntestazione: true }));
    }
    // #868.1 — l'utente ha cancellato qualcosa che questa ricerca aveva trovato: non c'è più, e non è «niente trovato».
    const cancellati = Number(out.cancellati) || 0;
    if (cancellati) {
      blocks.push(`[${cancellati === 1 ? 'Un risultato' : `${cancellati} risultati`} della ricerca "${cercato}" ${cancellati === 1 ? 'è stato cancellato' : 'sono stati cancellati'} dall'utente: non ci sono più e non vanno citati.]`);
    }
    if (!results.length && (pagine.length || cambiTrovati.length || nascoste.length || cancellati)) continue;
    if (!results.length) {
      // Zero risultati non vuol dire «quella conversazione non c'è»: vuol dire
      // che nessuna chat contiene tutte quelle parole. Chi legge deve saperlo,
      // altrimenti riferisce all'utente che la discussione non esiste invece di
      // riprovare con la parola che conta.
      blocks.push(
        `[Niente nel filo (conversazioni, pagine visitate, cambi) contiene tutte queste parole: "${cercato}". `
        + 'Non significa che non ci sia: riprova con la parola che identifica '
        + 'l\'argomento (una o due, senza "ieri", "discussione", "di cui abbiamo parlato") '
        + 'prima di dire all\'utente che non l\'hai trovata.]',
      );
      continue;
    }
    // La ricerca si è allargata: il modello deve sapere che i risultati
    // rispondono a MENO di quello che aveva chiesto, o presenterà come esatto
    // un accostamento approssimativo.
    if (out.allargata && usati.length) {
      blocks.push(
        `[Nessuna conversazione conteneva tutte le parole di "${cercato}": `
        + `questi risultati arrivano cercando "${E.perCanaleSistema(usati.join(' '))}". `
        + 'Controlla che siano davvero quello che l\'utente cercava.]',
      );
    }
    // Gli id e le date le scrive Filo, titoli e frammenti no: la riga intera
    // entra comunque nella busta, perché spezzarla in due (metà fuori, metà
    // dentro) è il modo più facile di sbagliare la prossima volta.
    const lines = results.map((r) => {
      const when = r.date ? new Date(r.date).toLocaleDateString('it-IT') : '';
      return `- [${r.id}] "${r.title}"${when ? ` · ${when}` : ''}\n  ${r.snippet || ''}`;
    });
    blocks.push(
      `[Le conversazioni passate che combaciano con "${cercato}".]\n`
      + E.imbusta({
        tipo: 'CONVERSAZIONE_ARCHIVIATA',
        testo: lines.join('\n'),
        conIntestazione: true,
      })
      + '\n[Per rileggerne una per intero richiama filo(cerca) con il suo id.]',
    );
  }
  return blocks.join('\n\n').trim();
}

// Re-immissione del CONTENUTO di un file letto con LEGGI_FILE in un turno
// precedente (#379.5): l'agente risponde col testo completo davanti. Sono dati,
// non istruzioni, e arrivano recintati come testo salvato (#592.4).
function fileReadsForPrompt(actions) {
  if (!Array.isArray(actions)) return '';
  const E = globalThis.SN_ESTERNO;
  const blocks = [];
  for (const a of actions) {
    if (!a || String(a.type || '').toUpperCase() !== 'LEGGI_FILE') continue;
    const out = a._output;
    if (!out || !('fileRead' in out)) continue;
    if (!out.found) {
      blocks.push(`[File "${E.perCanaleSistema(out.fileRead)}" non trovato: non esiste (più) nell'editor]`);
      continue;
    }
    const body = String(out.text || '');
    const taglio = body.length > 8000;
    blocks.push(`[Contenuto completo del file ${E.perCanaleSistema(out.fileRead)}]\n`
      + E.imbustaCampi({
        tipo: 'TESTO_SALVATO',
        campi: { Titolo: out.title || '(senza titolo)' },
        corpo: (taglio ? tagliaInteri(body, 8000) : body) || '(vuoto)',
      })
      + (taglio ? '\n…(contenuto troncato: qui sopra ci sono i primi 8000 caratteri)' : ''));
  }
  return blocks.join('\n\n').trim();
}

// Re-immissione del TESTO di un documento letto dal disco con LEGGI_DOCUMENTO
// in un turno precedente: l'agente ha davanti il contenuto della bolletta o
// dell'estratto conto e può rispondere sui numeri veri.
//
// DIFFERENZA IMPORTANTE dagli altri blocchi qui sopra: il manifesto delle
// capacità e i documenti dell'owner li scrive Filo. Questo no: è un file
// arrivato da fuori (un allegato mail, un PDF scaricato da un sito) e chi
// l'ha scritto può averci messo dentro istruzioni rivolte al modello. Perciò
// entra imbustato, come i risultati di una ricerca: dirlo in una riga non
// bastava, perché quella riga la sapeva scrivere anche il documento.
function documentReadsForPrompt(actions) {
  if (!Array.isArray(actions)) return '';
  // Il tetto lo dichiara il modulo che tronca: una seconda copia qui si sfaserebbe subito.
  let cap = 0;
  try { cap = require('./documentRead').MAX_TEXT_CHARS; } catch (_) {}
  const blocks = [];
  for (const a of actions) {
    if (!a || String(a.type || '').toUpperCase() !== 'LEGGI_DOCUMENTO') continue;
    const out = a._output;
    if (!out || !('documentRead' in out)) continue;
    // Il nome del file e il motivo di un errore finiscono in una riga di Filo:
    // il nome può averlo scelto chi ha mandato il file, e il motivo può venire
    // dal corpo della risposta di un servizio (#593, terzo giro di verifica).
    const E = globalThis.SN_ESTERNO;
    const etichetta = E.perCanaleSistema(out.name || out.documentRead || 'documento');
    // #551 — il percorso chiesto non esisteva, ma nella cartella c'era un solo
    // file col nome uguale a meno di accenti e trattini: è stato aperto quello.
    // Il modello deve sapere QUALE file ha in mano — e dirlo — invece di
    // continuare a usare il nome storpiato che non porta da nessuna parte.
    if (out.ok && out.requested) {
      blocks.push(
        `[Al percorso "${E.perCanaleSistema(out.requested)}" non c'era nessun file. Nella stessa `
        + `cartella ce n'era uno solo col nome uguale a meno di accenti, maiuscole e tipo di `
        + `trattino, ed è quello che hai letto: il nome VERO è "${etichetta}". Usa questo d'ora `
        + `in poi e dillo all'utente in una riga.]`,
      );
    }
    if (!out.ok) {
      const why = E.perCanaleSistema(out.detail || out.error || 'non è stato possibile leggerlo');
      blocks.push(
        `[Documento "${etichetta}" non letto: ${why}. Dillo all'utente così com'è, `
        + `senza inventare il contenuto. Filo legge i PDF, i documenti Word (.docx) e LibreOffice (.odt) e i file di testo (txt, csv, md e simili).]`,
      );
      continue;
    }
    if (out.empty && out.kind === 'office') {
      blocks.push(`[Documento "${etichetta}": dentro non c'è testo. Dillo all'utente e NON inventare cosa contiene.]`);
      continue;
    }
    if (out.empty) {
      blocks.push(
        `[Documento "${etichetta}": nessun testo estraibile. È un PDF fatto di immagini `
        + `(una scansione o una foto di un foglio), non di testo. Filo non sa ancora leggere `
        + `le lettere dentro un'immagine: dillo all'utente con onestà e NON inventare cosa c'è scritto.]`,
      );
      continue;
    }
    const meta = [];
    if (out.kind === 'pdf' && out.pages) meta.push(`${out.pages} ${out.pages === 1 ? 'pagina' : 'pagine'}`);
    // #551, sesto giro. Il file aveva dei byte rotti: al loro posto nel testo
    // c'è un rombo. Il modello deve sapere che quel rombo è un buco del file e
    // non una lettera, così non lo ricopia in un nome o in un comando e può
    // dirlo all'utente invece di rispondere su un testo bucato senza saperlo.
    if (out.bytesPersi > 0) {
      meta.push(`${out.bytesPersi} ${out.bytesPersi === 1 ? 'carattere' : 'caratteri'} del file `
        + 'sono scritti male e nel testo qui sotto compaiono come «�»: '
        + 'non ricopiarli e, se cadono dove serve leggere, dillo all\'utente');
    }
    // #593 (terzo giro di verifica) — LA CORNICE LA SCRIVEVA IL DOCUMENTO.
    // Che il testo venga da fuori era già scritto, ma lo era in una riga fra
    // parentesi quadre come tutte le altre: un PDF che contiene quella stessa
    // riga chiude la propria cornice e prosegue fuori, e da lì in poi quello
    // che aggiunge ha la forma delle cose che dice Filo. Adesso è una busta
    // come per ogni altro contenuto esterno: intestazione che lo dichiara
    // dati, due marcature, e la pulizia che impedisce al documento di
    // scriversele da sé. Il nome del file lo sceglie l'utente ma glielo può
    // aver dato chi gliel'ha mandato: passa dalla rete del canale di sistema.
    blocks.push(
      `[Documento "${etichetta}"${meta.length ? ` (${meta.join(', ')})` : ''}]\n`
      + E.imbusta({ tipo: 'DOCUMENTO_ESTERNO', testo: out.text, conIntestazione: true })
      + (out.truncated ? `\n…(documento troncato${cap ? `: qui sopra ci sono i primi ${cap} caratteri` : ''})` : ''),
    );
  }
  return blocks.join('\n\n').trim();
}

// Cosa fare di una pagina che non si è lasciata leggere: il motivo decide se riprovare, passare dalla scheda o cambiare fonte.
function consiglioPaginaNonLetta(out) {
  const stato = Number(out.stato) || 0;
  switch (out.errore) {
    case 'rete-locale':
      return 'È un indirizzo della rete di casa o dell\'ufficio: Filo non lo scarica. Se l\'utente l\'ha aperto in una scheda, richiamando web(leggi) con lo stesso indirizzo lo leggi da lì.';
    case 'pericoloso':
      return 'Il rilevatore di siti pericolosi di Filo l\'ha segnalato: non leggerlo, non proporlo all\'utente come fonte e cercane un\'altra.';
    case 'schema':
    case 'indirizzo':
      return 'Serve un indirizzo http o https preso dai risultati, dall\'utente o da una pagina letta, oppure il numero di una scheda web in TAB APERTE. Le pagine di Filo non si leggono così.';
    case 'scheda':
      return 'Controlla il numero nell\'elenco TAB APERTE dello STATO.';
    case 'http':
      if (stato === 404 || stato === 410) return 'Prova un altro risultato. Non inventare il contenuto.';
      if (stato === 401 || stato === 403 || stato === 429 || stato === 503) {
        return 'Il sito non si lascia leggere dai programmi: se il dato serve davvero, aprilo con scheda(apri) con background: true e poi rileggilo con web(leggi), che lo legge dalla scheda; altrimenti prova un\'altra fonte. Non inventare il contenuto.';
      }
      return 'Prova un\'altra fonte, o riprova una volta. Non inventare il contenuto.';
    case 'tempo':
    case 'rete':
      return 'Riprova una volta o prova un\'altra fonte. Non inventare il contenuto.';
    default:
      return 'Prova un\'altra fonte. Non inventare il contenuto.';
  }
}

// Una lettura fermata prima della fine della pagina lo dice in ogni pezzo, anche in quello vuoto oltre l'ultimo o in una
// prima parte senza testo: se no il modello crede di avere la pagina intera e risponde che il dato non c'è (#1307.3).
function avvisoLettaInParte(out, { indirizzo = '', oltre = false, vuota = false } = {}) {
  const perche = out.lettaInParte ? 'la scheda aperta è troppo grande per leggerla tutta' : 'la pagina supera i 5 MB';
  const fine = Number(out.totale) || 0;
  const dove = oltre ? `finisce al carattere ${fine} e oltre non c'è altro da leggere, ma la pagina continua`
    : vuota ? 'non contiene testo, ma la pagina continua'
      : (out.troncata ? `finisce al carattere ${fine}` : 'finisce qui sopra');
  return `[Della pagina${indirizzo ? ` "${indirizzo}"` : ''} Filo ha solo la prima parte, perché ${perche}: la parte letta ${dove}. `
    + `Se il dato non c'è${out.troncata && !oltre ? ' nemmeno nei pezzi che seguono' : ''}, dillo all'utente invece di `
    + 'concludere che la pagina non lo contiene.]';
}

// La lettura di LEGGI_PAGINA (#553): dalla scheda se è aperta, se no scaricata.
async function leggiPaginaDa(url, da, sender) {
  let r = null;
  try {
    r = await PageRead.leggiPagina(url, { da, schede: schedeLeggibili(sender), analizza: analizzaPer(sender) });
  } catch (e) {
    console.warn('[Filo] lettura pagina fallita', e?.message || e);
  }
  return r || { pageRead: String(url == null ? '' : url), ok: false, errore: 'rete', dettaglio: 'lettura non riuscita', testo: '' };
}

// Le schede lasciate in una chat (#2085) entrano come letture già fatte: davanti al modello la cornice di LEGGI_PAGINA,
// e per uscite, fonti e segreti letti contano come la lettura che sono. La chat le mette fra le azioni viste del turno;
// l'Aiuto le segna fra le fonti della sua conversazione (lettureDellAiuto). Sentinella: tests/unit/schedeInChat.test.mjs.
async function lettureDeiGettoni(schede, sender) {
  const lista = Array.isArray(schede) ? schede : [];
  return Promise.all(lista.map(async (s) => ({
    type: 'LEGGI_PAGINA', url: s.url, _gettone: true, _executed: true, _output: await leggiPaginaDa(s.url, 0, sender),
  })));
}
async function lettureDellAiuto(schede, sender) {
  const wc = sender && sender.wc;
  const gia = (wc && lettureGettoniAiuto.get(wc)) || new Map();
  if (wc) lettureGettoniAiuto.set(wc, gia);
  const nuove = await lettureDeiGettoni(schede.filter((s) => !gia.has(s.url)), sender);
  for (const l of nuove) gia.set(l.url, l);
  const letture = schede.map((s) => gia.get(s.url)).filter(Boolean);
  for (const l of letture) segnaLetturaAiuto(sender, l);
  return letture;
}
// La cronologia dell'Aiuto con la pagina di ogni scheda accanto al messaggio che l'ha portata.
async function storiaAiutoConLetture(storia, sender) {
  const G = globalThis.SN_SCHEDE_IN_CHAT;
  return Promise.all(storiaAiuto(storia).map(async (m) => {
    if (!m || !('schede' in m)) return m;
    const { schede, ...resto } = m;
    if (resto.role !== 'user' || !G || typeof resto.content !== 'string' || !Array.isArray(schede)) return resto;
    const nota = notaDeiGettoni(await lettureDellAiuto(G.allinea(resto.content, schede).filter(Boolean), sender));
    return nota ? { ...resto, content: `${resto.content}\n\n${nota}` } : resto;
  }));
}
function notaDeiGettoni(letture) {
  const pagine = pageReadsForPrompt(letture);
  if (!pagine) return '';
  return `[Nel messaggio l'utente ha lasciato ${letture.length === 1 ? 'una scheda' : `${letture.length} schede`} `
    + `(i nomi fra ⟦ ⟧): parla di ${letture.length === 1 ? 'questa pagina' : 'queste pagine'}. Eccone il testo.]\n${pagine}`;
}

// Re-immissione del TESTO di una pagina web letta con LEGGI_PAGINA (#553). Lo scrive chi possiede il sito: entra
// imbustato, e nelle righe di Filo il titolo, l'indirizzo e il motivo di un rifiuto passano solo ripuliti.
function pageReadsForPrompt(actions) {
  if (!Array.isArray(actions)) return '';
  const E = globalThis.SN_ESTERNO;
  const blocks = [];
  for (const a of actions) {
    if (!a || String(a.type || '').toUpperCase() !== 'LEGGI_PAGINA') continue;
    const out = a._output;
    if (!out || !('pageRead' in out)) continue;
    const indirizzo = E.perCanaleSistema(tagliaInteri(String(out.url || out.pageRead || ''), 500));
    // Il consiglio di aprirla in una scheda non vale per la scheda che c'era e non ha risposto.
    const schedaMuta = (ripiego) => `[Pagina "${indirizzo}" non letta: la scheda aperta non ha risposto in tempo (forse è `
      + `troppo grande, o è ancora occupata) e ${ripiego}. Puoi riprovare una volta; se non basta dillo all'utente, senza `
      + 'inventare il contenuto e senza concludere che la pagina non ha il dato.]';
    if (!out.ok) {
      const dettaglio = E.perCanaleSistema(out.dettaglio || 'lettura non riuscita');
      blocks.push(out.schedaNonRisponde ? schedaMuta(`scaricarla a parte non è riuscito (${dettaglio})`)
        : `[Pagina "${indirizzo}" non letta: ${dettaglio}. ${consiglioPaginaNonLetta(out)}]`);
      continue;
    }
    const totale = Number(out.totale) || 0;
    const da = Number(out.da) || 0;
    const fino = Number(out.fino) || 0;
    if (!out.testo) {
      const inParte = out.lettaInParte || out.scaricataInParte;
      if (totale > 0 && da >= totale) {
        blocks.push(inParte
          ? avvisoLettaInParte(out, { indirizzo, oltre: true })
          : `[La pagina "${indirizzo}" finisce al carattere ${totale}: non c'è altro da leggere.]`);
      } else if (inParte) {
        blocks.push(avvisoLettaInParte(out, { indirizzo, vuota: true }));
      } else if (out.fonte === 'scheda') {
        blocks.push(`[La scheda aperta su "${indirizzo}" non mostra testo da leggere (un video, un'immagine, un'app): `
          + 'dillo all\'utente e non inventare il contenuto.]');
      } else if (out.schedaNonRisponde) {
        blocks.push(schedaMuta('la copia scaricata a parte è senza testo'));
      } else {
        blocks.push(`[Pagina "${indirizzo}" letta, ma senza testo${out.soloJavaScript ? ': si costruisce in JavaScript' : ''}. `
          + 'Se il dato serve, aprila con scheda(apri) con background: true e poi rileggila con web(leggi), che la legge dalla scheda; '
          + 'altrimenti prova un\'altra fonte. Non inventare il contenuto.]');
      }
      continue;
    }
    // #1596 — `tenuti`: quanto ne è rimasto quando le letture del turno insieme non stavano nella finestra del modello.
    const campi = { Titolo: out.titolo || '', Indirizzo: tagliaInteri(String(out.url || ''), 500) };
    const tenuti = Number.isFinite(out.tenuti) ? Math.max(0, Math.min(out.testo.length, out.tenuti)) : out.testo.length;
    if (tenuti === 0) {
      blocks.push('[Pagina web letta ma lasciata fuori: con le altre letture di questo turno non stava nella memoria del modello. '
        + 'Restano titolo e indirizzo, il testo non lo hai davanti: non inventarlo e rispondi con quello che hai. Non rileggerla in '
        + 'questo turno; sotto la tua risposta Filo dice all\'utente quali pagine ha lasciato fuori, e se lui lo chiede la rileggi con '
        + `web(leggi) e lo stesso url${da > 0 ? `, da: ${da}` : ''}.]\n`
        + E.imbustaCampi({ tipo: 'PAGINA_WEB', campi, conIntestazione: true }));
      continue;
    }
    const parziale = tenuti < out.testo.length;
    const testo = parziale ? tagliaInteri(out.testo, tenuti) : out.testo;
    const finoQui = parziale ? da + testo.length : fino;
    const meta = [out.fonte === 'scheda' ? 'letta dalla scheda aperta' : 'scaricata'];
    if (out.tipo === 'application/pdf') meta.push(out.pagine ? `un PDF di ${out.pagine} ${out.pagine === 1 ? 'pagina' : 'pagine'}` : 'un PDF');
    if (da > 0 || out.troncata || parziale) meta.push(`caratteri da ${da} a ${finoQui} su ${totale}`);
    let blocco = `[Pagina web (${meta.join(', ')})]\n`
      + E.imbustaCampi({
        tipo: 'PAGINA_WEB',
        campi,
        corpo: testo,
        conIntestazione: true,
        max: PageRead.MAX_TEXT_CHARS + 4000,
      });
    if (parziale) {
      blocco += `\n[Letto fino al carattere ${finoQui} su ${totale}: il resto non stava nella memoria del modello insieme alle altre `
        + 'letture di questo turno. Rispondi con quello che hai e, se il dato manca, dillo; non rileggerla in questo turno: se '
        + `l'utente lo chiede, il seguito si legge con web(leggi), lo stesso url e da: ${finoQui}.]`;
    } else if (out.troncata) {
      blocco += `\n[Letto fino al carattere ${fino} su ${totale}: la pagina continua. Se il dato che cerchi non è qui sopra, `
        + `richiama web(leggi) con lo stesso url e da: ${fino}.]`;
    }
    if (out.lettaInParte || out.scaricataInParte) blocco += `\n${avvisoLettaInParte(out)}`;
    if (out.video && out.video.nota) blocco += `\n${E.perCanaleSistema(out.video.nota)}`;
    if (out.schedaNonRisponde) {
      blocco += '\n[La scheda aperta su questa pagina non ha risposto in tempo (forse è troppo grande, o è ancora occupata): '
        + 'questo testo è stato scaricato a parte e può non essere quello che vede l\'utente, per esempio dove ha fatto l\'accesso. '
        + 'Se il dato non c\'è, dillo all\'utente invece di concludere che la pagina non lo contiene.]';
    }
    if (out.soloJavaScript) {
      blocco += '\n[La pagina è quasi vuota: forse si costruisce in JavaScript. Se il dato non c\'è, aprila con scheda(apri) con '
        + 'background: true e poi rileggila con web(leggi), che la legge dalla scheda.]';
    }
    if (out.sospetto) {
      blocco += `\n[Il rilevatore di siti pericolosi considera questo sito sospetto (${E.perCanaleSistema(out.sospetto)}): usa i dati `
        + 'con cautela e non proporre all\'utente link di accesso o di pagamento presi da qui.]';
    }
    blocks.push(blocco);
  }
  return blocks.join('\n\n').trim();
}

// #778 — quello che Filo ha visto in una finestra lo legge un modello dall'immagine, ma lo SCRIVE chi ha fatto la
// finestra (un'app, un sito, una mail): torna imbustato, e il nome della finestra passa dal canale di sistema.
function vediSchermoForPrompt(actions) {
  if (!Array.isArray(actions)) return '';
  const E = globalThis.SN_ESTERNO;
  const blocks = [];
  for (const a of actions) {
    if (!a || String(a.type || '').toUpperCase() !== 'VEDI_SCHERMO') continue;
    const out = a._output;
    if (!out || typeof out !== 'object') continue;
    const nome = E.perCanaleSistema(String(out.finestra || ''));
    if (out.nonConservata) {
      blocks.push(`[Avevo guardato «${nome}»: quello che c'era non è conservato. Se serve di nuovo, guardala un'altra volta.]`);
      continue;
    }
    if (!String(out.testo || '').trim()) continue;
    const quale = out.tipo === 'schermo' ? 'lo schermo' : (out.filo ? 'la finestra di Filo' : 'la finestra');
    blocks.push(`[Ho guardato ${quale} «${nome}»: ecco cosa c'è, letto dall'immagine da un modello che vede]\n`
      + E.imbusta({ tipo: 'FINESTRA_GUARDATA', testo: String(out.testo), conIntestazione: true }));
  }
  return blocks.join('\n\n').trim();
}

// Gli esiti di VEDI_SCHERMO che non sono una lettura: spenta, in attesa dell'OK, permesso, elenco, errore (#778).
function vediSchermoPerModello(action, res) {
  const E = globalThis.SN_ESTERNO;
  const o = (res && res.output) || {};
  const finestre = (l) => E.imbusta({
    tipo: 'FINESTRE_APERTE',
    testo: (Array.isArray(l) ? l : []).map((v) => `- ${E.neutralizza(v && v.nome, { unaRiga: true })}`
      + (v && v.filo ? ' (di Filo)' : (v && v.tipo === 'schermo' ? ' (schermo)' : ''))
      + (v && v.davanti ? ' (in primo piano subito dietro Filo: è «questa finestra» dell\'utente)' : '')).join('\n') || '(nessuna)',
    conIntestazione: true,
  });
  const nota = o.nota ? `\n${E.perCanaleSistema(o.nota)}` : '';
  const nome = E.perCanaleSistema(String(o.finestra || (action && action._finestra && action._finestra.nome) || action.finestra || ''));
  if (o.spenta) {
    return 'Non ho guardato niente: l\'impostazione «Filo può guardare lo schermo» è spenta, e da spenta Filo non cattura nessuna finestra. '
      + 'Proponi all\'utente di accenderla chiamando adesso impostazioni(imposta) con chiave guarda_schermo e valore true: il sistema gli mostra '
      + 'il popup e gli basta un clic. Non riprovare a guardare finché non è accesa.';
  }
  if (res && res.needsConfirm) {
    return `In attesa dell'OK dell'utente per guardare «${nome}»: il popup è davanti a lui. Quando lo dà, la finestra si guarda e la `
      + 'conversazione riprende da sola con quello che c\'è. NON richiamare questa azione e non immaginare cosa c\'è scritto: '
      + 'scrivi solo, in una riga, che aspetti il suo OK.';
  }
  if (o.permesso === 'mac') {
    return `Non ho guardato: ${E.perCanaleSistema(o.frase)}. Sotto la tua risposta c'è «Apri le impostazioni». Dillo all'utente in una riga `
      + 'e non riprovare finché non ha dato il permesso e riaperto Filo.'
      + (Array.isArray(o.elenco) && o.elenco.length ? `\nIntanto si vedono solo queste:\n${finestre(o.elenco)}` : '');
  }
  if (Array.isArray(o.ambigue)) {
    return `Più finestre corrispondono a «${E.perCanaleSistema(o.richiesta)}»:\n${finestre(o.ambigue)}\n`
      + 'Chiedi all\'utente quale intende, elencandogliele: non sceglierne una a caso.';
  }
  if (o.nessuna) {
    return `Nessuna finestra aperta si chiama «${E.perCanaleSistema(o.richiesta)}». Queste sono quelle che si possono guardare:\n${finestre(o.elenco)}${nota}\n`
      + 'Se una è chiaramente quella che intende l\'utente, richiama computer(guarda) col suo nome esatto; se non si capisce, chiediglielo.';
  }
  if (Array.isArray(o.elenco)) {
    return `Finestre che si possono guardare adesso:\n${finestre(o.elenco)}${nota}\n`
      + 'Richiama computer(guarda) con in «finestra» il nome esatto di quella che intende l\'utente. Se dalla richiesta non si capisce quale, '
      + 'chiediglielo elencando le candidate.';
  }
  if (o.errore) return `Non ho potuto guardare «${nome}»: ${E.perCanaleSistema(o.errore)}. Dillo all'utente in una riga, senza inventare cosa c'era.`;
  return '';
}

// #947 — re-immissione di quello che CERCA_DOCUMENTI ha trovato: la compone PROMPTS.documentiTrovati, la stessa
// dell'Aiuto di una scheda.
function documentSearchesForPrompt(actions) {
  if (!Array.isArray(actions)) return '';
  const blocks = [];
  for (const a of actions) {
    if (!a || String(a.type || '').toUpperCase() !== 'CERCA_DOCUMENTI') continue;
    const t = PROMPTS.documentiTrovati(a._output, { per: 'chat' });
    if (t) blocks.push(t);
  }
  return blocks.join('\n\n').trim();
}

// #845 — quello che CERCA_SALVATE ha trovato in «Aperti per dopo»: titoli e indirizzi li hanno scritti i siti, in busta.
function salvateTrovateForPrompt(actions) {
  if (!Array.isArray(actions)) return '';
  const E = globalThis.SN_ESTERNO;
  const blocks = [];
  for (const a of actions) {
    if (!a || String(a.type || '').toUpperCase() !== 'CERCA_SALVATE' || !a._output) continue;
    const o = a._output;
    const cercato = o.cercato ? E.perCanaleSistema(o.cercato) : '';
    const pagine = Array.isArray(o.pagine) ? o.pagine : [];
    if (o.errore) { blocks.push('[La lista «Aperti per dopo» non si è potuta leggere: dillo all\'utente in una riga.]'); continue; }
    if (!o.totale) {
      blocks.push('[«Aperti per dopo» è vuota: l\'utente non ha ancora messo da parte nessuna pagina. Diglielo, e che una pagina si salva dal tasto destro → «Salva per dopo» o chiedendolo all\'Aiuto sopra la pagina.]');
      continue;
    }
    if (!pagine.length) {
      blocks.push(`[Nessuna delle ${o.totale} pagine di «Aperti per dopo» ha "${cercato}" nel titolo, nell'indirizzo o nella categoria. `
        + 'Riprova con la parola che conta (una o due, oppure vuoto per vederle tutte) prima di dire all\'utente che non c\'è.]');
      continue;
    }
    const righe = pagine.map((p) => {
      const quando = p.savedAt ? new Date(p.savedAt).toLocaleDateString('it-IT') : '';
      return `- [${p.id}] ${E.neutralizza(p.title || '(senza titolo)', { unaRiga: true })}${p.categoria ? ` · categoria ${E.neutralizza(p.categoria, { unaRiga: true })}` : ''}${quando ? ` · salvata il ${quando}` : ''}\n  ${p.url}`;
    });
    const quali = cercato ? `che combaciano con "${cercato}"` : 'salvate';
    const oltre = o.trovate > pagine.length
      ? ` Ne combaciano ${o.trovate}: qui le ${pagine.length} più recenti, le altre si vedono in «Aperti per dopo» o cercando parole più precise.` : '';
    const largo = o.allargata && Array.isArray(o.cercatoCon) && o.cercatoCon.length
      ? ` Nessuna conteneva tutte le parole: queste arrivano cercando "${E.perCanaleSistema(o.cercatoCon.join(' '))}", controlla che siano quelle giuste.` : '';
    blocks.push(`[Le pagine di «Aperti per dopo» ${quali} (${o.trovate} su ${o.totale}).${oltre}${largo} `
      + 'Nella risposta nomina quelle giuste col titolo così com\'è: sotto la risposta diventano bottoni che le aprono. '
      + 'Per aprirne una adesso usa scheda(apri_salvata) con l\'id.]\n'
      + E.imbusta({ tipo: 'DATI_PAGINA', testo: righe.join('\n'), conIntestazione: true }));
  }
  return blocks.join('\n\n').trim();
}

// #884 — le schede chiuse trovate, e il riassunto di una riaperta la cui pagina non c'è più. Titoli e riassunti li
// hanno scritti i siti (o un modello leggendoli): imbustati.
const MOTIVI_DETTI = {
  mano: 'chiusa dall\'utente', pagina: 'chiusa dalla pagina stessa', filo: 'chiusa da te su richiesta in chat',
  pulizia: 'archiviata dalla pulizia delle schede', doppione: 'chiusa perché aperta due volte',
};
const GIRI_DETTI = { idle: 'per inattività', reopen: 'alla riapertura di Filo', manual: 'chiesta dall\'utente', chat: 'chiesta in chat' };
function quandoDetto(iso) {
  const t = Date.parse(iso || '');
  return Number.isFinite(t) ? new Date(t).toLocaleString('it-IT', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : 'data ignota';
}
function schedeChiuseForPrompt(actions) {
  if (!Array.isArray(actions)) return '';
  const E = globalThis.SN_ESTERNO;
  const blocks = [];
  for (const a of actions) {
    const type = String((a && a.type) || '').toUpperCase();
    const o = a && a._output;
    if (!o) continue;
    if (type === 'RIAPRI_SCHEDA' && (o.nonRaggiungibile || o.tagliato)) {
      const cosa = o.tagliato ? 'Il suo indirizzo era troppo lungo per essere salvato intero: non l\'ho riaperta.'
        : 'L\'ho riaperta, ma la pagina non c\'è più o non risponde (la scheda resta aperta sull\'errore).';
      const riassunto = String(o.riassunto || '').trim();
      blocks.push(`[Scheda chiusa ${quandoDetto(o.chiusa)}. ${cosa} `
        + (riassunto ? 'Sotto la tua risposta l\'utente vede il riassunto che Filo ne aveva salvato: raccontaglielo da lì, in breve.]\n'
          + E.imbusta({ tipo: 'DATI_PAGINA', testo: `${E.neutralizza(o.titolo || '', { unaRiga: true })}\n${riassunto}`, conIntestazione: true })
          : 'Di questa pagina Filo non aveva salvato un riassunto: dillo all\'utente.]'));
      continue;
    }
    if (type !== 'SCHEDE_CHIUSE' || !Array.isArray(o.schede)) continue;
    const cercato = o.cercato ? E.perCanaleSistema(o.cercato) : '';
    const filtro = [cercato ? `"${cercato}"` : '', o.motivo ? MOTIVI_DETTI[o.motivo] : '',
      o.periodo ? `chiuse fra ${o.periodo.da ? quandoDetto(o.periodo.da) : 'l\'inizio'} e ${quandoDetto(o.periodo.a)}` : ''].filter(Boolean).join(', ');
    if (!o.schede.length) {
      blocks.push(`[Nessuna delle ${o.totale} schede chiuse combacia${filtro ? ` (${filtro})` : ''}. `
        + (cercato ? 'Riprova con la parola che conta, o senza `cerca` guardando le date, prima di dire all\'utente che non c\'è.]' : 'Dillo all\'utente in una riga.]'));
      continue;
    }
    const righe = o.schede.map((p) => {
      const perche = `${MOTIVI_DETTI[p.motivo] || 'chiusa'}${p.motivo === 'pulizia' && GIRI_DETTI[p.giro] ? ` (${GIRI_DETTI[p.giro]})` : ''}`;
      const titolo = E.neutralizza(p.titolo || '(senza titolo)', { unaRiga: true });
      const extra = p.delicata ? ' · pagina delicata: solo il sito' : (p.tagliato ? ' · indirizzo troppo lungo, non si riapre' : '');
      return `- [${p.id}] ${titolo} · ${quandoDetto(p.chiusa)} · ${perche}${extra}\n  ${p.url}${p.riassunto ? `\n  ${E.neutralizza(p.riassunto, { unaRiga: true })}` : ''}`;
    });
    const oltre = o.trovate > o.schede.length ? ` Ne combaciano ${o.trovate}: qui le prime ${o.schede.length}, per le altre restringi con parole, date o motivo.` : '';
    blocks.push(`[Schede chiuse${filtro ? ` (${filtro})` : ''}: ${o.trovate} su ${o.totale}.${oltre} Per riaprirne una usa scheda(riapri) con l'id, non scheda(apri).]\n`
      + E.imbusta({ tipo: 'DATI_PAGINA', testo: righe.join('\n'), conIntestazione: true }));
  }
  return blocks.join('\n\n').trim();
}

// Tutti gli esiti che tornano al modello, per un elenco di azioni eseguite:
// output dei comandi, dettagli delle capacità, risultati di ricerca, file e
// documenti letti, documenti di trasparenza. Mai istruzioni: fuori dalla busta
// resta solo ciò che scrive Filo (capacità, trasparenza); il resto, file
// dell'editor compresi, arriva imbustato (#593, #592.4).
function observationsForPrompt(tutte) {
  // Le pagine delle schede lasciate in un messaggio stanno già con la domanda (notaDeiGettoni): non si ripetono qui.
  const actions = Array.isArray(tutte) ? tutte.filter((a) => !(a && a._gettone)) : tutte;
  return [
    commandOutputsForPrompt(actions), capabilityDetailsForPrompt(actions), impostazioniLetteForPrompt(actions), memoriaLettaForPrompt(actions), webSearchResultsForPrompt(actions),
    pageReadsForPrompt(actions), fileReadsForPrompt(actions), documentReadsForPrompt(actions), documentSearchesForPrompt(actions), salvateTrovateForPrompt(actions),
    schedeChiuseForPrompt(actions), immaginiForPrompt(actions),
    vediSchermoForPrompt(actions),
    transparencyDocsForPrompt(actions),
    chatSearchesForPrompt(actions), espansioniForPrompt(actions), confirmedActionsForPrompt(actions), rifiutateForPrompt(actions), proxyUnavailableForPrompt(actions),
    apertureFermateDopoForPrompt(actions),
    fermateForPrompt(actions), testiDiFuoriForPrompt(actions),
  ].filter(Boolean).join('\n\n');
}

// Una riga che la chat ha scritto nella conversazione venendo da fuori (il nome di un file scaricato, #868): dati, non
// parole di Filo. La regola che la fa lettura sta in src/shared/filoContesto.js.
function testiDiFuoriForPrompt(actions) {
  if (!Array.isArray(actions)) return '';
  const E = globalThis.SN_ESTERNO;
  return actions
    .filter((a) => a && String(a.type || '').toUpperCase() === 'TESTO_DI_FUORI' && a._output && String(a._output.text || '').trim())
    .map((a) => `[Riga scritta nella chat ${E.perCanaleSistema(String(a._output.fonte || 'da fuori'))}]\n`
      + E.imbusta({ tipo: 'TESTO_SALVATO', testo: String(a._output.text), conIntestazione: true }))
    .join('\n\n');
}

// Le azioni fermate perché portavano fuori un segreto (#810): nei turni dopo, e nella chat riaperta, il modello
// non le dà per fatte e non le riprova in un'altra forma.
function fermateForPrompt(actions) {
  if (!Array.isArray(actions)) return '';
  const righe = actions
    .filter((a) => a && ((a._output && a._output.blocked === 'segreto') || String(a.type || '').toUpperCase() === 'FERMATA'))
    .map((a) => `- ${(a._output && a._output.frase) || "un'azione che avrebbe portato fuori un segreto"}`);
  if (!righe.length) return '';
  return `[NON fatte, fermate da Filo: un segreto non esce a nessun livello, nessuna conferma lo sblocca e non va riprovato in un'altra forma.\n${righe.join('\n')}]`;
}

// Da un altro paese senza fornitore (#771): l'esito torna al modello anche nel
// formato vecchio e nei turni dopo, dove il testo scritto con l'azione lo dava per fatto.
function proxyUnavailableForPrompt(actions) {
  if (!Array.isArray(actions) || !actions.some(esitoNonDisponibile)) return '';
  return '[NON fatto: aprire da un altro paese non è ancora disponibile in Filo. Nessuna scheda è stata instradata e nessuna regola salvata. '
    + 'Dillo all\'utente in una frase, senza darlo per fatto e senza promettere che succederà da solo, e non riprovare.]';
}

// Le regole stanno in src/shared/azioniPerModello.js (#592.4, #1396).
const descriviPerModello = (...a) => globalThis.SN_AZIONI_PER_MODELLO.descrivi(...a);
const interruptedActionsForPrompt = (...a) => globalThis.SN_AZIONI_PER_MODELLO.interrotte(...a);
const confirmedActionsForPrompt = (...a) => globalThis.SN_AZIONI_PER_MODELLO.confermate(...a);
const rifiutateForPrompt = (...a) => globalThis.SN_AZIONI_PER_MODELLO.rifiutate(...a);

// Le pagine aperte con NAVIGA che si sono spostate da sé su un sito bloccato quando il turno era
// già finito (la scheda le ha segnate `_output.dopo`): il modello le aveva date per aperte.
function apertureFermateDopoForPrompt(actions) {
  if (!Array.isArray(actions)) return '';
  const righe = [];
  for (const a of actions) {
    const o = a && a._output;
    if (!o || !o.dopo || o.blocked !== 'site') continue;
    const chi = o.reason === 'lists' ? 'fra i siti di pubblicità e tracciamento che Filo blocca' : 'nella lista dei siti bloccati dell\'utente';
    righe.push(`- ${String(a.url || '')}: ha rimandato a ${o.host || 'un sito'}, ${chi}`);
  }
  return righe.length
    ? `[Pagine che avevi aperto e che poi si sono spostate da sole su un sito bloccato: Filo le ha fermate, l'utente è rimasto sulla pagina di passaggio e il sito NON l'ha visto; sotto la tua risposta ha «Apri comunque».\n${righe.join('\n')}]`
    : '';
}

// Spinta per il formato vecchio (JSON nel testo), quando un esito deve
// tornare al modello: prima la mandava la scheda come turno «utente» interno.
const LEGACY_CONTINUE_NUDGE =
  'Prosegui: qui sopra ci sono gli esiti delle azioni appena eseguite. Rispondi all’utente '
  + 'usando questi dati (link ESATTI presi dai risultati, numeri presi dal testo), senza ripetere '
  + 'le stesse azioni. Se il compito è finito, rispondi senza eseguire altro.';

// I nomi delle schede li scrivono i siti: tornano recintati, coi perché di Filo fuori dal recinto.
const PERCHE_RESTA_APERTA = {
  bloccata: 'Lasciate aperte perché l\'utente le ha bloccate',
  testo: 'Lasciate aperte perché hanno del testo scritto e non ancora inviato',
  sempre: 'Lasciate aperte perché sono di siti che l\'utente tiene sempre aperti',
  chiusa: 'Non c\'erano più',
  nuova: 'Lasciate aperte perché si sono aperte dopo l\'elenco che avevi davanti',
};
// Quante restano e perché, per la riga sotto la risposta: l'utente che ha detto «tutte» non ne ha indicata nessuna.
function contoRestano(restano) {
  return require('../../shared/restanoAperte.js').conto((Array.isArray(restano) ? restano : []).map((x) => x.perche));
}
function esitoChiusuraPerModello(action, o) {
  if (o.error) return `Nessuna scheda chiusa: ${o.error}. Correggi e riprova, o chiedi all'utente quali intende.`;
  const E = globalThis.SN_ESTERNO;
  const restano = Array.isArray(action._restano) ? action._restano : [];
  const gruppi = Object.keys(PERCHE_RESTA_APERTA).map((p) => {
    const nomi = restano.filter((x) => x.perche === p).map((x) => `- ${E.neutralizza(String(x.nome || ''), { unaRiga: true })}`);
    return nomi.length ? `${PERCHE_RESTA_APERTA[p]}:\n${E.imbusta({ tipo: 'DATI_PAGINA', testo: nomi.join('\n') })}` : '';
  }).filter(Boolean);
  const insiste = restano.some((x) => x.perche === 'testo' || x.perche === 'sempre' || x.perche === 'bloccata')
    ? '\nSe l\'utente vuole chiudere anche quelle bloccate, col testo o dei siti sempre aperti, chiudile col loro numero.' : '';
  const coda = `${gruppi.length ? `\n${gruppi.join('\n')}${insiste}` : ''}\nDillo all'utente in una riga.`;
  const n = Number(o.chiuse) || 0;
  if (!n) {
    const perche = o.nessuna === 'sito' ? 'nessuna scheda aperta in questa finestra è di quel sito'
      : o.nessuna === 'niente' ? 'oltre a quella di questa conversazione e a quelle da lasciare non ce n\'è nessuna' : 'nessuna di quelle indicate si poteva chiudere';
    return `Nessuna scheda chiusa: ${perche}.${coda}`;
  }
  const dove = action._inIncognito ? 'In incognito non restano nel filo della home.'
    : 'Le pagine restano nel filo della home: se l\'utente vuole riaprirne una, trovala con scheda(chiuse) e riaprila con scheda(riapri).';
  // #2086 — una bloccata chiusa per numero: la risposta lo dice.
  const b = Number(o.bloccate) || 0;
  const bloccate = !b ? '' : n === 1 ? ' Era bloccata: dillo all\'utente.' : ` ${b === 1 ? 'Una era bloccata' : `${b} erano bloccate`}: dillo all'utente.`;
  return `${n === 1 ? 'Chiusa una scheda' : `Chiuse ${n} schede`}.${bloccate} ${dove}${coda}`;
}

// Quello che un pulsante delle Preferenze premuto dalla chat lascia da dire all'utente (#1619).
function dopoPulsante(o) {
  if (o.ripristinate) {
    return ' Di\' in una frase che le impostazioni sono tornate di serie e che si rimettono com\'era con «annulla» sul segno '
      + 'accanto al messaggio dell\'utente, o chiedendolo a te.';
  }
  if (o.ripristinati) {
    return ' Di\' in una frase che colori, caratteri e misure dell\'aspetto sono tornati di serie e che si rimettono com\'era '
      + 'con «annulla» sul segno accanto al messaggio dell\'utente, o chiedendolo a te.';
  }
  if (o.aperta) return ' L\'intervista è in una home nuova, già davanti all\'utente; questa conversazione resta qui.';
  if (o.sistema) return ' La frase la legge adesso la pagina della chat con la voce di riserva del sistema, con velocità e tono salvati.';
  if (o.voce) {
    return ' La frase la legge adesso la pagina della chat; se la voce naturale non è disponibile si sente quella del '
      + 'sistema e un avviso dice perché. Per sceglierla si usa impostazioni(imposta) voce_modello.';
  }
  if (o.muto) return ' Però il volume è a zero e non si è sentito niente: dillo all\'utente e proponigli di alzarlo con impostazioni(imposta).';
  if (o.spento) return ' Il suono degli avvisi però è spento: gli avvisi arrivano muti finché non lo accende (impostazioni(imposta) suono_notifiche).';
  return '';
}

// L'esito di UNA azione, come risposta allo strumento che il modello ha
// chiamato. Chi ha un esito da leggere (ricerca, documento, comando) lo
// riceve per intero; chi non ce l'ha riceve una riga: fatto, in attesa di
// conferma, proposto come bottone, rifiutato. La riga sulla conferma dice
// esplicitamente di NON richiamare l'azione: il popup è già davanti all'utente,
// e un modello che la ritenta lo farebbe comparire due volte.
// Una frase di Filo su una scheda: il titolo l'ha scritto il sito, e va sotto, imbustato.
function conTitolo(frase, titolo) {
  const E = globalThis.SN_ESTERNO;
  const t = E.neutralizza(String(titolo || ''), { unaRiga: true });
  return t ? `${frase}\nIl titolo della scheda:\n${E.imbusta({ tipo: 'DATI_PAGINA', testo: t })}` : frase;
}


function toolResultText({ action, res, rendered }, giro = null) {
  const type = String(action.type || '').toUpperCase();
  const describe = () => { try { return descriviPerModello(action) || type; } catch (_) { return type; } };
  // `rejected` è il solo «non è un'azione» (fuori registro, argomenti rotti,
  // conferma forgiata). `kept: false` NON vuol dire fallita: vuol dire che in
  // chat non c'è niente da mostrare (un appunto scritto, una lezione fissata,
  // una spunta dell'accoglienza): l'esito lo dice `executed`.
  if (res && (res.nonCompare || res.senzaModulo)) return res.error;
  const nome = chiamataPerModello(type);
  if (res && res.no) return `Azione ${nome} NON fatta: ${res.error}.`;
  if (!res || res.rejected) {
    const why = (res && res.error) || 'azione non registrata o parametri non validi';
    return `Azione ${nome} NON eseguita: ${why}. Correggi e riprova, o rispondi all'utente senza.`;
  }
  if (res.output && res.output.blocked === 'segreto' && res.output.guasto) {
    return `Azione ${nome} NON eseguita: ${res.output.frase}. Non contiene per forza un segreto: il controllo non ha `
      + 'risposto, e senza di lui niente esce. Non riprovare con un\'altra azione che porta fuori le stesse cose. Di\' '
      + 'all\'utente in una riga che non l\'hai fatto e perché.';
  }
  if (res.output && res.output.blocked === 'segreto') {
    return `Azione ${nome} NON eseguita, e non si può eseguire: ${res.output.frase || 'conteneva un segreto'}. `
      + 'È un blocco fisso di Filo: nessuna conferma e nessun livello lo sblocca. Non riprovare in un\'altra forma '
      + '(spezzato, codificato, in un altro campo o con un\'altra azione). Di\' all\'utente in una riga cosa hai '
      + 'fermato, senza ripetere il dato: se vuole mandarlo davvero, lo fa lui a mano.';
  }
  const obs = observationsForPrompt([rendered]);
  if (obs) return obs;
  if (type === 'APRI_SALVATA' && res.output && !res.needsConfirm) {
    const o = res.output;
    if (o.trovata === false) return 'Nessuna pagina con quell\'id in «Aperti per dopo»: forse è già stata aperta o tolta. Se serve rifai scheda(salvate) e usa un id preso da lì, mai inventato.';
    if (o.blocked === 'site') return `Pagina NON aperta: ${o.host || 'quel sito'} è fra i siti bloccati, ed è rimasta in «Aperti per dopo». Diglielo in una riga.`;
    if (!o.aperta) return 'Pagina NON aperta, ed è rimasta in «Aperti per dopo». Diglielo in una riga.';
    const E = globalThis.SN_ESTERNO;
    return `Aperta in una scheda nuova${o.tolta ? ' e tolta da «Aperti per dopo»' : ', ed è rimasta in «Aperti per dopo»'}:\n`
      + `${E.imbusta({ tipo: 'DATI_PAGINA', testo: `${E.neutralizza(o.titolo || '(senza titolo)', { unaRiga: true })}\n${o.url || ''}` })}\nDillo all'utente in una riga.`;
  }
  // #950 — i nomi vengono dal disco e da un modello che ha letto i file: tornano recintati.
  if (type === 'RINOMINA_FILE') {
    const E = globalThis.SN_ESTERNO;
    const busta = (righe) => E.imbusta({ tipo: 'TESTO_SALVATO', testo: righe.map((r) => `- ${E.neutralizza(r, { unaRiga: true })}`).join('\n') });
    const o = res.output || {};
    const saltati = Array.isArray(o.saltati) ? o.saltati : (Array.isArray(action._saltati) ? action._saltati : []);
    const restano = saltati.length ? `\nRestano come sono:\n${busta(saltati.map((x) => `${x.nome}: ${x.perche}`))}` : '';
    if (res.needsConfirm) {
      const p = Array.isArray(action._proposte) ? action._proposte : [];
      const oltre = action._oltre > 0 ? `\nNe restano altri ${action._oltre} oltre a questi: si fanno con un'altra richiesta.` : '';
      return `In attesa della conferma dell'utente: il sistema gli mostra i nomi nuovi, che ha preparato leggendo i file:\n${busta(p.map((x) => `${x.prima} → ${x.nome}`))}${restano}${oltre}\n`
        + 'NON richiamare questa azione: la conferma è già in corso. Rispondi in una riga, senza dire di aver già rinominato.';
    }
    if (res.executed) {
      const r = Array.isArray(o.rinominati) ? o.rinominati : [];
      const f = Array.isArray(o.falliti) && o.falliti.length ? `\nNon riusciti:\n${busta(o.falliti.map((x) => `${x.nome}: ${x.perche}`))}` : '';
      return `Rinominati ${r.length} file:\n${busta(r.map((x) => `${x.prima} → ${x.nome}`))}${f}${restano}\nSotto c'è «Annulla» per rimettere i nomi di prima.`;
    }
    return `Nessun file rinominato: ${o.error || 'niente da rinominare'}.${restano}\nDillo all'utente in una riga; non ripetere l'azione uguale.`;
  }
  // #1909 — i nomi vengono dal disco: tornano recintati.
  if (type === 'ELIMINA_FILE') {
    const E = globalThis.SN_ESTERNO;
    const busta = (righe) => E.imbusta({ tipo: 'TESTO_SALVATO', testo: righe.map((r) => `- ${E.neutralizza(r, { unaRiga: true })}`).join('\n') });
    const o = res.output || {};
    const per = action.per_sempre === true;
    const saltati = Array.isArray(o.saltati) ? o.saltati : (Array.isArray(action._saltati) ? action._saltati : []);
    const restano = saltati.length ? `\nRestano dove sono:\n${busta(saltati.map((x) => `${x.nome}: ${x.perche}`))}` : '';
    if (res.needsConfirm) {
      const f = Array.isArray(action._file) ? action._file : [];
      const oltre = action._oltre > 0 ? `\nNe restano altri ${action._oltre} oltre a questi: si fanno con un'altra richiesta.` : '';
      return `In attesa della conferma dell'utente: il sistema gli mostra cosa ${per ? 'sta per cancellare per sempre, senza cestino' : 'sta per spostare nel cestino'}:\n`
        + `${busta(f.map((x) => x.percorso))}${restano}${oltre}\n`
        + 'NON richiamare questa azione: la conferma è già in corso. Rispondi in una riga, senza dire di averlo già fatto.';
    }
    if (res.executed) {
      const fatti = Array.isArray(o.eliminati) ? o.eliminati : [];
      const f = Array.isArray(o.falliti) && o.falliti.length ? `\nNon riusciti:\n${busta(o.falliti.map((x) => `${x.nome}: ${x.perche}`))}` : '';
      return o.perSempre
        ? `Cancellati per sempre, senza cestino:\n${busta(fatti)}${f}${restano}`
        : `Spostati nel cestino del sistema (l'utente li ritrova lì e li rimette da lì; non dire che sono cancellati per sempre):\n${busta(fatti)}${f}${restano}`;
    }
    const f = Array.isArray(o.falliti) && o.falliti.length ? `\nNon riusciti:\n${busta(o.falliti.map((x) => `${x.nome}: ${x.perche}`))}` : '';
    return `Niente cancellato: ${o.error || 'non è riuscito'}.${f}${restano}\nDillo all'utente in una riga; non ripetere l'azione uguale e non usare il terminale per cancellare.`;
  }
  if (type === 'NAVIGA' && res.output && res.output.blocked === 'site') {
    const sito = res.output.host || 'quel sito';
    // Le liste pubbliche non sono la lista dell'utente: se il modello dice «la tua lista», lui lo cerca in Preferenze e non lo trova.
    const chi = res.output.reason === 'lists'
      ? 'è fra i siti di pubblicità e tracciamento che Filo blocca da sé (non è nella lista dell\'utente)'
      : 'è nella lista dei siti bloccati dell\'utente';
    return `Pagina NON aperta: ${sito} ${chi}. Diglielo in una riga: se vuole aprirla lo stesso, sotto la tua risposta c'è «Apri comunque». Non riprovare e non cercare un altro indirizzo per arrivarci.`;
  }
  if (type === 'NAVIGA' && res.output && res.output.blocked === 'scheme') {
    // #482 — un indirizzo fermato non resta muto: è il modello a dirlo, col perché.
    return 'Pagina NON aperta: per sicurezza Filo non apre in una scheda le cartelle di rete e gli indirizzi che non sono pagine web o file di questo computer. Diglielo in una riga. Non riprovare con lo stesso indirizzo.';
  }
  if (type === 'NAVIGA' && res.output && res.output.blocked === 'file') {
    const o = res.output;
    const perche = {
      assente: 'il file non esiste a quel percorso. Controlla maiuscole, cartella e nome; se non lo trovi chiedi all\'utente il percorso giusto',
      cartella: 'è una cartella, non un file: chiedi all\'utente quale file dentro aprire',
      tipo: 'una scheda mostra solo pagine HTML, PDF, immagini, testo, audio e video. Per leggerlo usa file(leggi); per farlo aprire col suo programma, file(mostra)',
      assistente: 'l\'assistente sopra una pagina web non apre i file del computer: l\'utente può chiederlo dalla chat della home',
      rete: 'un percorso su un altro computer della rete non si apre in una scheda',
    }[o.motivo] || 'non si apre in una scheda';
    return `File NON aperto${o.percorso ? ` (${o.percorso})` : ''}: ${perche}. Diglielo in una riga. Non riprovare con lo stesso percorso.`;
  }
  if (type === 'PULISCI_TAB' && res.executed && res.output) {
    const n = Number(res.output.archived) || 0;
    return n > 0
      ? `Schede riordinate: ${n} archiviate, restano nel filo della home (le ritrova col campo «Cerca nel filo»). Dillo all'utente in una riga.`
      : 'Schede riordinate: nessuna da archiviare. Dillo all\'utente in una riga.';
  }
  if (type === 'RIPRENDI_AUDIO' && res.output && !res.needsConfirm) {
    const o = res.output;
    if (o.giaSuona) return conTitolo('Niente da far ripartire: c\'è già una scheda che suona. Chiedi all\'utente se intende un\'altra musica.', o.titolo);
    if (o.nessuna) return 'Niente da far ripartire: nessuna scheda, aperta o chiusa, ha suonato. Chiedi all\'utente cosa vuole ascoltare, o cercalo con scheda(apri) (background: true).';
    if (o.error) return `Musica NON ripartita: ${o.error}.`;
    const dove = o.numero ? ` la scheda ${o.numero}` : ' la scheda';
    if (o.nonPartita) return conTitolo(`${o.riaperta ? 'Ho riaperto' : 'Ho trovato'}${dove}, ma l'audio non è ripartito da solo (la pagina non ha un lettore pronto o l'ha rifiutato). Di' all'utente in una riga di premere play lì.`, o.titolo);
    return conTitolo(`${o.riaperta ? 'Riaperta e ripartita' : 'Ripartita'}${dove}, ${o.davanti ? 'e l\'utente adesso ce l\'ha davanti' : 'dietro a quella che l\'utente ha davanti'}. Dillo in una riga.`, o.titolo);
  }
  if (type === 'PAUSA_AUDIO' && res.output && !res.needsConfirm) {
    const o = res.output;
    if (o.nessuna) return 'Niente messo in pausa: nessuna scheda sta suonando. Dillo all\'utente in una riga.';
    if (o.error) return `Niente messo in pausa: ${o.error}.`;
    return conTitolo('Messa in pausa. Dillo in una riga; «rimettimi la musica» la fa ripartire con scheda(riprendi_audio).', o.titolo);
  }
  if (type === 'MOSTRA_SCHEDA' && res.output && !res.needsConfirm) {
    const o = res.output;
    if (o.error) return `Scheda NON mostrata: ${o.error}.`;
    return conTitolo('L\'utente adesso ha davanti la scheda. Dillo in una riga.', o.titolo);
  }
  if ((type === 'BLOCCA_SCHEDA' || type === 'SBLOCCA_SCHEDA') && res.output && !res.needsConfirm) {
    const o = res.output;
    const blocca = type === 'BLOCCA_SCHEDA';
    if (o.error) return `Scheda NON ${blocca ? 'bloccata' : 'sbloccata'}: ${o.error}.`;
    if (o.gia) return conTitolo(`La scheda ${blocca ? 'era già bloccata' : 'non era bloccata'}. Dillo in una riga.`, o.titolo);
    return conTitolo(blocca
      ? 'Scheda bloccata: le pulizie e le chiusure di tutte o di un sito la lasciano, e per chiuderla a mano l\'utente sceglie «Sblocca e chiudi». Dillo in una riga.'
      : 'Scheda sbloccata: si chiude come le altre. Dillo in una riga.', o.titolo);
  }
  if (type === 'RIAPRI_SCHEDA' && res.output && !res.needsConfirm && !res.output.nonRaggiungibile && !res.output.tagliato) {
    const o = res.output;
    if (o.trovata === false) return 'Scheda NON riaperta: quell\'id non è fra le schede chiuse. Cercala con scheda(chiuse) e usa l\'id che ti torna.';
    if (!o.riaperta) return `Scheda NON riaperta${o.error ? `: ${o.error}` : ''}.`;
    return conTitolo('Scheda riaperta com\'era. Dillo in una riga.', o.titolo);
  }
  if (type === 'SCHEDE_CHIUSE' && res.output && res.output.error) return `Ricerca NON fatta: ${res.output.error}. Correggi e riprova.`;
  // Un riordino non riuscito (#1626) si dice col suo perché, anche quando ha chiuso i doppioni.
  if (type === 'PULISCI_TAB' && !res.executed && !res.needsConfirm && res.output && res.output.error && !res.output.no) {
    return `Riordino NON riuscito: ${String(res.output.error).trim()} Dillo all'utente in una riga, col motivo; non dire che le schede sono state riordinate.`;
  }
  if (type === 'CHIUDI_SCHEDE' && res.output && !res.needsConfirm) return esitoChiusuraPerModello(action, res.output);
  if (type === 'VEDI_SCHERMO') {
    const t = vediSchermoPerModello(action, res);
    if (t) return t;
  }
  if (res.output && res.output.blocked === 'disabled') {
    return 'Comando NON eseguito: la modalità terminale è spenta. Proponi all\'utente di attivarla (impostazioni(imposta) modalita_terminale true) e non riprovare finché non è attiva.';
  }
  if (res.needsConfirm) {
    return `In attesa della conferma dell'utente: il sistema gli sta mostrando cosa stai per fare («${describe()}»). `
      + 'NON richiamare questa azione: la conferma è già in corso. Se hai altro da fare prosegui; altrimenti rispondi in una riga, senza dire di aver già fatto.';
  }
  // Nomi di sveglie e timer e righe della memoria tornano recintati: li può aver
  // scritti un modello mentre leggeva una pagina (#592.4).
  const nomiSalvati = (nomi) => globalThis.SN_ESTERNO.imbusta({
    tipo: 'TESTO_SALVATO',
    testo: nomi.map((n) => `- ${globalThis.SN_ESTERNO.neutralizza(n, { unaRiga: true })}`).join('\n'),
  });
  if (type === 'CANCELLA_SVEGLIA' && res.output && Array.isArray(res.output.removed)) {
    return res.output.removed.length ? `Tolte:\n${nomiSalvati(res.output.removed)}` : 'Nessuna sveglia o timer corrispondeva: niente da togliere. Non ripetere uguale: chiedi all\'utente quale intende.';
  }
  if (type === 'CORREGGI_MEMORIA' && res.output) {
    if (res.output.corretta) return `Corretta (vale dal prossimo messaggio; l'utente la rilegge nel quaderno delle memorie):\n${nomiSalvati([res.output.corretta])}`;
    if (res.output.rifiuto) return `Non corretta: ${res.output.error}`;
    return res.output.trovate > 1
      ? 'Più righe della memoria corrispondono: non ne ho corretta nessuna. Copia la riga com\'è nella memoria, o chiedi all\'utente quale intende.'
      : 'Nella memoria nessuna riga corrispondeva: niente da correggere. Se è una cosa nuova, usa memoria(impara).';
  }
  if ((type === 'TOGLI_CHAT' || type === 'RIMETTI_CHAT') && res.output && !res.needsConfirm) {
    const o = res.output;
    if (o.giaInVista) return 'Quella conversazione non è nascosta: è già nel filo. Niente da rimettere.';
    if (o.trovata === false) return 'Nessuna conversazione con quell\'id. Se serve rifai filo(cerca) e usa un id preso da lì, mai inventato.';
    const titolo = nomiSalvati([action._titolo || 'senza titolo']);
    if (o.cancellata) return `Cancellata per sempre: non c'è più nel filo né sul computer.\n${titolo}`;
    if (o.nascosta) return `Nascosta: esce dalla home e da quello che ricordi, ma resta salvata. L'utente la rimette cercandola nel filo della home o chiedendotelo (filo(rimetti_chat)).${action._corrente ? ' Era la conversazione di adesso: da qui in poi se ne apre una nuova.' : ''}\n${titolo}`;
    if (o.rimessa) return `Rimessa nel filo, al suo posto nel tempo. Ora si rilegge con filo(cerca) e l'id ${action.id}.\n${titolo}`;
    return 'Conversazione NON toccata.';
  }
  if (type === 'DIMENTICA' && res.output && Array.isArray(res.output.dimenticate)) {
    return res.output.dimenticate.length
      ? (res.output.perSempre ? `Cancellate per sempre:\n${nomiSalvati(res.output.dimenticate)}`
        : `Dimenticate (escono dalle conversazioni; l'utente le ritrova nascoste nel quaderno delle memorie, da dove può rimetterle):\n${nomiSalvati(res.output.dimenticate)}`)
      : 'Nella memoria nessuna riga corrispondeva: niente da togliere. Non ripetere uguale: copia la riga com\'è nella memoria, o chiedi all\'utente quale intende.';
  }
  if (type === 'TOGLI_PERMESSO_SITO' && res.executed && res.output && Array.isArray(res.output.tolte)) {
    return `Tolte le risposte ricordate (il sito tornerà a chiedere):\n${nomiSalvati(res.output.tolte)}\n`
      + 'Nella risposta di\' in una frase cosa hai tolto e che per ridarlo basta rispondere «Consenti» quando il sito lo richiede.';
  }
  if (type === 'MODIFICA_SVEGLIA' && res.output && Array.isArray(res.output.updated)) {
    return res.output.updated.length ? `Spostate:\n${nomiSalvati(res.output.updated)}` : 'Nessuna sveglia o timer corrispondeva: niente da spostare. Non ripetere uguale: chiedi all\'utente quale intende.';
  }
  if ((type === 'VOLUME' || type === 'BLUETOOTH' || type === 'WIFI') && res.output) return esitoSistemaPerModello(res.output);
  if (type === 'ORDINA_DESKTOP' && res.output) return require('./iconeDesktop').esitoPerModello(res.output);
  if (type === 'RIMEDIO_CREDITI' && res.output) {
    const o = res.output;
    if (o.operazione === 'elenca') return o.testo ? `Situazione dei crediti e rimedi:\n${o.testo}` : 'Adesso non c\'è niente da proporre per i crediti: dillo in una riga.';
    const det = Array.isArray(o.dettagli) && o.dettagli.length ? `\n${o.dettagli.join('\n')}` : '';
    return `${o.frase || (res.executed ? 'Fatto.' : 'Non riuscito.')}${det}\nDillo all'utente in una riga, con parole tue; non ripetere l'azione.`;
  }
  if ((type === 'INSTALLA_AGGIORNAMENTO' || type === 'ACCOUNT') && res.output && res.output.frase) {
    return `${res.output.frase}\nDillo all'utente in una riga, con parole tue; non ripetere l'azione.`;
  }
  // #686 — lo zoom lo riferisce il numero VERO, non quello chiesto: un «al
  // 900%» finisce al massimo, e l'utente deve sentirselo dire.
  if (type === 'ZOOM_PAGINA' && res.executed && res.output) {
    const o = res.output;
    if (o.zoom === 'propria') return 'Zoom della pagina cambiato. Questa pagina scala il proprio contenuto: la percentuale esatta non la so, non inventarla.';
    if (typeof o.percentuale === 'number') {
      // I limiti li ha solo chi zooma la finestra: una pagina che scala il
      // proprio contenuto ha i suoi, e non li dichiara.
      const limiti = (typeof o.min === 'number' && typeof o.max === 'number') ? ` (${o.min}–${o.max}%)` : '';
      const tagliato = o.limitato
        ? ` Il ${o.richiesto}% chiesto non era raggiungibile${limiti}: si è fermato qui. Dillo all'utente.`
        : '';
      return `Zoom della pagina ora ${global.SN_SISTEMA.alPercento(o.percentuale)}.${tagliato}`;
    }
  }
  if (type === 'ZOOM_PAGINA' && !res.executed && res.output && res.output.zoom === 'no-tab') {
    return 'Zoom non cambiato: non c\'è nessuna scheda davanti su cui agire. Dillo all\'utente.';
  }
  if (type === 'ZOOM_PAGINA' && !res.executed && res.output && res.output.zoom === 'muto') {
    return 'Zoom non cambiato: la pagina davanti non risponde ai comandi di zoom (può essere una pagina di sistema, o non aver finito di caricare). Dillo all\'utente, e non ripetere l\'azione uguale.';
  }
  // #504 — «già tradotta» o «già com'era» non sono un fatto da annunciare: i testi stanno con le risposte della pagina.
  if (type === 'TRADUCI_PAGINA' && res.output && typeof res.output.traduzione === 'string') {
    const S = globalThis.SN_TRADUZIONE_PAGINA;
    const dove = res.output.dietro ? '\nLa pagina è l\'ultima scheda web che l\'utente ha usato, non quella che ha davanti: diglielo.' : '';
    return `${S.STATI[S.stato(res.output.traduzione)].modello(res.output)}${dove}`;
  }
  if (type === 'ANNULLA_CAMBIO' && res.output) {
    const o = res.output;
    if (!res.executed) {
      return `Niente annullato: ${o.error || 'cambio non trovato'}. Rileggi i CAMBI RECENTI nello STATO e, se non è chiaro quale intende, chiediglielo.`;
    }
    const saltati = Array.isArray(o.saltati) && o.saltati.length
      ? `\nNon rimessi, ${o.saltatiPerche || 'perché nel frattempo sarebbero già scaduti'}:\n${nomiSalvati(o.saltati)}` : '';
    return `Annullato il cambio ${o.annullato}: è tornato com'era prima di questo:\n${nomiSalvati([o.frase || ''])}${saltati}`;
  }
  // La home chiesta da chi è già nella home: non è stato ricaricato niente, e il modello non deve dire di averlo portato
  // da qualche parte né promettere che il bottone svuoti la home (chiude la conversazione, lo scambio resta: #869).
  if (type === 'COMANDO_FINESTRA' && res.output && res.output.already) {
    return 'La home È la pagina da cui l\'utente ti sta scrivendo: non ho ricaricato niente, perché ricaricarla '
      + 'interromperebbe questa risposta. Diglielo in una riga. Sotto la tua risposta l\'utente ha il bottone «Chiudi la '
      + 'conversazione»: lo scambio resta nella home e il suo messaggio dopo ne comincia una nuova. Non promettergli che la '
      + 'home si svuota o si ricarica.';
  }
  if (type === 'ONBOARDING' && res.executed && res.output && res.output.sceltaContatori) {
    return `Sotto la tua risposta l'utente vede Sì e No dei contatori anonimi (adesso sono ${res.output.attivi ? 'accesi' : 'spenti'}) `
      + `e sceglie lui con un clic: la scelta ti arriva come suo messaggio. Non dire di averli cambiati tu.${doveStaIlTesto(giro)}`;
  }
  if (type === 'ONBOARDING' && res.executed && res.output && (res.output.sceltaAutonomia || res.output.sceltaPrivacy)) {
    const righe = [];
    if (res.output.sceltaAutonomia) {
      const A = globalThis.SN_AUTONOMIA;
      const ora = A ? A.infoLivello(res.output.livello).nome : '';
      righe.push(`Sotto la tua risposta l'utente vede i livelli di autonomia${ora ? ` (adesso è ${ora})` : ''} e sceglie lui con un clic: `
        + 'la scelta ti arriva come suo messaggio. Non dire di averlo cambiato tu.');
    }
    if (res.output.sceltaPrivacy) {
      const L = globalThis.SN_LIVELLI_PRIVACY;
      const ora = L ? L.nomeLivello(res.output.livelloPrivacy) : '';
      righe.push(`Sotto la tua risposta l'utente vede i livelli di privacy${ora ? ` (adesso è ${ora})` : ''} e sceglie lui con un clic: `
        + 'la scelta ti arriva come suo messaggio.');
    }
    return `${righe.join(' ')}${doveStaIlTesto(giro)}`;
  }
  if (type === 'APRI_FILE' && res.executed) return `Bottone del file mostrato all'utente, sotto la tua risposta.${doveStaIlTesto(giro)}`;
  if (type === 'APRI_FILE' && res.output && res.output.rete) {
    return 'Bottone NON mostrato: il file sta su un altro computer della rete, e Filo mostra e apre solo i file di questo '
      + 'computer. Dillo all\'utente in una riga; non riprovare con un altro percorso di rete.';
  }
  if (soloBottone(type) && res.kept && !res.needsConfirm) {
    return `Proposta all'utente come bottone in chat, sotto la tua risposta: ${describe()}.${doveStaIlTesto(giro)}`;
  }
  // Una mossa che ha lasciato la barra dei siti com'era: la frase viene dall'esito (solo i suoi segni), non dalla richiesta.
  if (type === 'BARRA_SITI' && res.executed && res.output && res.output.invariata) {
    let gia = '';
    try { gia = descriviPerModello({ ...action, _output: { gia: !!res.output.gia, invariata: true } }, { fatto: true }); } catch (_) {}
    return `Non cambiato niente: ${String(gia || 'la barra dei siti era già così').replace(/\.+\s*$/, '')}. Dillo all'utente in una riga, senza dire di averlo fatto.`;
  }
  if (res.executed) {
    // La descrizione «a cosa fatta», non quella del popup: un «vuole» dopo «Eseguita» faceva
    // credere al modello che fosse ancora da fare.
    let done = '';
    try { done = descriviPerModello(action, { fatto: true }); } catch (_) {}
    done = String(done || describe()).replace(/\.+\s*$/, '');
    // #949 — un cambio fatto da Filo dice cosa ha cambiato e come si torna indietro.
    if (type === 'IMPOSTA_PREFERENZA' || type === 'IMPOSTA_ESTETICA') {
      const costo = res.output && typeof res.output.costoModello === 'string' && res.output.costoModello
        ? ` Nella stessa risposta riporta il costo, con le stesse cifre: «${res.output.costoModello}»` : '';
      const avviso = res.output && typeof res.output.avviso === 'string' && res.output.avviso
        ? ` Attenzione: ${res.output.avviso}. Dillo all'utente e proponigli di riaccenderlo; non riaccenderlo da te.` : '';
      return `Eseguita: ${done}. Nella risposta di' in una frase cosa hai cambiato e che si rimette com'era con «annulla» `
        + `sul segno accanto al messaggio dell'utente, o chiedendolo a te.${costo}${avviso}`;
    }
    if (type === 'PULSANTE_PREFERENZE') return `Eseguita: ${done}.${dopoPulsante(res.output || {})}`;
    return `Eseguita: ${done}.`;
  }
  if (res.output && res.output.invariato && res.output.error) {
    return `Niente da cambiare: ${res.output.error}. Dillo all'utente in una riga; non ripetere l'azione uguale.`;
  }
  if (res.output && res.output.rifiuto && res.output.error) {
    if (type === 'SALVA_LEZIONE') {
      return `Lezione NON salvata: ${res.output.error}. Non è stato salvato niente, nemmeno accorciato: `
        + 'dillo all\'utente e, se vuole, riprova con un testo che stia nel limite.';
    }
    const come = res.output.perModello || 'Dillo all\'utente e, se vuole, riprova con un valore ammesso.';
    if (type === 'IMPOSTA_PREFERENZA') return `Impostazione NON applicata: ${res.output.error}. Non è stato salvato niente, nemmeno in parte. ${come}`;
    return `Azione ${nome} NON eseguita: ${res.output.error}. Non è cambiato niente: dillo all'utente in una riga.`;
  }
  // Tenuta ma non eseguita dal main: è un bottone in chat (evento, file,
  // pulizia schede, cancellazione archivio) che l'utente aziona da sé.
  if (res.kept) return `Proposta all'utente come bottone in chat: ${describe()}. Non serve altro da parte tua.`;
  // Non eseguita e senza niente da mostrare: mancava qualcosa (nessuna scheda
  // web attiva, un riferimento che non trova niente, un dato vuoto).
  // Il dettaglio è quello che serve a riprovare (l'elenco delle carte con le chiavi): tetto largo, e un taglio si dice.
  const TETTO_DETTAGLIO = 8000;
  const json = res.output ? JSON.stringify(res.output) : '';
  const detail = json ? ` (${json.length > TETTO_DETTAGLIO ? `${json.slice(0, TETTO_DETTAGLIO)}… [tagliato: ${json.length} caratteri in tutto]` : json})` : '';
  // Le azioni sulla scheda web (proxy, stile della pagina) falliscono quasi
  // sempre per lo stesso motivo: non c'è una scheda web attiva.
  const PAGE_ACTIONS = ['PROXY_TAB', 'RIMUOVI_PROXY', 'RIMUOVI_PROXY_TUTTE', 'REGOLA_PROXY_DOMINIO', 'RIMUOVI_REGOLA_PROXY', 'STILE_PAGINA', 'RIPRISTINA_STILE_PAGINA'];
  if (PAGE_ACTIONS.includes(type) && res.output && res.output.restyle === 'no-page') {
    return `Azione ${nome} non riuscita: non c'è una scheda web attiva su cui agire. Dillo all'utente: deve aprire (o mettere davanti) la pagina.`;
  }
  if (PAGE_ACTIONS.includes(type) && !res.output) {
    return `Azione ${nome} non riuscita: ${describe()}. Probabilmente non c'è una scheda web attiva: dillo all'utente.`;
  }
  // Un'icona che non riconosco: l'elenco è la strada per riprovare, non un motivo per fermarsi.
  if (type === 'SPOSTA_ICONA' && res.output && res.output.icone) {
    return `Icona NON spostata: «${globalThis.SN_ESTERNO.perCanaleSistema(String(res.output.id || ''))}» non è un'icona che conosco. Riprova adesso con l'id di quella che `
      + `intende l'utente, da questo elenco (id e nome): ${res.output.icone}. Se nessuna gli somiglia, chiediglielo.`;
  }
  return `Azione ${nome} non riuscita: ${describe()}${detail}. Non ripeterla uguale: se manca un dato chiedilo all'utente, altrimenti diglielo.`;
}

// #360 — Filo propone LUI la segnalazione quando ammette una mancanza.
// Prima toccava all'utente accorgersene e chiedere ("mandane una segnalazione"):
// se non lo faceva, il buco non arrivava a nessuno. Ora, quando la risposta dice
// "non posso / non ho accesso a…" e Filo NON ha già emesso una segnalazione di
// suo, gliela mettiamo in bocca noi: l'azione arriva in chat come segnalazione
// già scritta col tasto di conferma (livello 2 → niente parte senza l'OK).
//
// Deterministico di proposito: il prompt chiede al modello di farlo da sé, ma un
// invariante come questo non può dipendere dall'umore di un LLM.
function maybeProposeFeedbackAction({ textReply, rawActions, userMessage, threadHistory, citaRisposta = true }) {
  try {
    const AF = globalThis.SN_AUTO_FEEDBACK;
    if (!AF || typeof AF.composeProposal !== 'function') return null;
    const isFeedbackAction = (a) => a && String(a.type || '').toUpperCase() === 'INVIA_FEEDBACK';
    // Un turno in cui Filo AGISCE non è un turno in cui ammette una mancanza: la proposta va
    // solo sulle risposte a mani vuote, e non interrompe le sequenze automatiche.
    if (Array.isArray(rawActions) && rawActions.length) return null;
    // Una proposta per conversazione: insistere trasformerebbe la chat in un modulo di reclami.
    const prior = Array.isArray(threadHistory) ? threadHistory : [];
    if (prior.some((m) => Array.isArray(m && m.actions) && m.actions.some(isFeedbackAction))) return null;
    // L'utente ha appena chiesto lui una segnalazione: la gestisce già il turno normale.
    if (/feedback|segnala/i.test(String(userMessage || ''))) return null;

    const Caps = globalThis.SN_CAPABILITIES;
    const analysis = AF.analyzeReply(textReply, rawActions, userMessage, Caps ? Caps.all(cancelliAperti()) : []);
    if (!analysis || !analysis.kind) return null;
    const proposta = AF.composeProposal(analysis, { userMessage, textReply: citaRisposta ? textReply : '' });
    // Il segno torna con la conferma: i contatori del servizio (#1472) la distinguono da una che il modello ha scritto.
    // `_unaVolta`: la funzione per nome si segnala una volta per versione (#2371), col conto dell'invio anonimo: proposta
    // (confermata o no) e invio sono la stessa segnalazione. Senza nome ogni richiesta è diversa.
    return proposta ? { ...proposta, _proposta: true, ...(analysis.capabilityId ? { _unaVolta: AF.chiaveInvio(analysis) } : {}) } : null;
  } catch (e) {
    console.warn('[#360] proposta di segnalazione non composta:', e?.message || e);
    return null;
  }
}

// F4 — invia un feedback autonomo in background se la risposta segnala un gap
// di capacità o una lamentela. Non blocca mai il flusso della chat.
// Privacy: invia solo una descrizione GENERICA (nessun URL, nessun testo utente).
// Parte quando si chiude il suo avviso: «Annulla» la ferma prima (autoFeedbackAttesa.js, #784.6).
//
// `proposed`: in questo turno Filo ha già messo in chat una segnalazione da
// confermare (#360). In quel caso NON mandiamo anche quella anonima: sarebbero
// due segnalazioni per lo stesso buco, e quella che l'utente autorizza è più
// utile (dice cosa aveva chiesto) di quella generica.
async function maybeAutoFeedback({ textReply, rawActions, userMessage, sender, proposed = false, chatId = '' }) {
  try {
    const AF = globalThis.SN_AUTO_FEEDBACK;
    const FB = globalThis.SN_FEEDBACK;
    if (!AF || !FB || typeof FB.submit !== 'function') return;
    const Caps = globalThis.SN_CAPABILITIES;
    const capabilities = Caps ? Caps.all(cancelliAperti()) : [];
    const analysis = AF.analyzeReply(textReply, rawActions, userMessage, capabilities);
    if (!analysis || !analysis.kind) return;
    // I contatori del servizio (#1472): il tipo, la capacità e come finisce, con l'incognito della chat da cui nasce.
    let incognito = null;
    try { incognito = require('../shim/storage').inIncognito(); } catch (_) { incognito = null; }
    const esito = (e) => ContatoriServizio.misura('f4', analysis.kind, analysis.capabilityId, e, { incognito });
    if (proposed || (Array.isArray(rawActions)
      && rawActions.some((a) => a && String(a.type || '').toUpperCase() === 'INVIA_FEEDBACK'))) { esito('sostituita'); return; }

    // Setting autoFeedback, default ON se non impostato dall'utente.
    const settings = await getEffectiveSettings().catch(() => ({}));
    const autoEnabled = (settings && settings.security && settings.security.autoFeedback) === undefined
      ? true
      : !!(settings && settings.security && settings.security.autoFeedback);
    if (!autoEnabled) { esito('spenta'); return; }

    const payload = AF.compose(analysis);
    if (!payload) return;

    let versione = '';
    try { versione = require('electron').app.getVersion(); } catch (_) {}
    // Una per voce e per versione (#2371): la stessa mancanza la seconda volta non aggiunge niente.
    if (!(await require('./autoFeedbackInviati').prenota(versione, AF.chiaveInvio(analysis)))) return;
    const userAgent = versione ? `Filo desktop ${versione} auto` : 'Filo desktop auto';

    // #953: dalla copia dell'owner parte con la sua prova, che dice da dove viene senza farla sua (non l'ha letta né
    // confermata: il nome resta `auto:`). Senza un accesso valido aspetta in coda il suo rientro, come quella della chat:
    // da anonima sembrerebbe di un estraneo, e buttata si perderebbe.
    const Mittente = require('./feedbackMittente');
    const voce = {
      text: payload.text,
      name: payload.name,
      clientId: payload.clientId,
      userAgent,
      capabilityGapId: payload.capabilityGapId || undefined,
    };
    // Partita davvero (non annullata dall'avviso), entra nel filo come quella chiesta alla chat (#1561).
    const nelFilo = (r) => {
      const ok = !!r && r.ok !== false && !r.error;
      const esito = ok ? { eseguita: true } : { eseguita: false, errore: (r && (r.error || r.errore)) || 'non partita' };
      try { require('./accaduti').azioneDalPunto('INVIA_FEEDBACK', { titolo: voce.name, testo: voce.text }, esito, { daSola: 'automazione', via: 'segnalazione', chat: chatId }); } catch (_) {}
      return r;
    };
    const spedisci = () => Promise.resolve(Mittente.dallOwner() ? Mittente.spedisciDallOwner(voce) : FB.submit(voce))
      .then(nelFilo, (e) => { nelFilo({ ok: false, error: e?.message || String(e) }); throw e; });
    const Attesa = require('./autoFeedbackAttesa');
    const win = winOf(sender);
    const biglietto = Attesa.trattieni(spedisci, win, { esito });
    // Filo segnala da sé (#1473): «Annulla» sull'avviso la disfa (handlers/filo.js).
    require('./contatoriHomePagina').misura('fatto', 'segnalazione_automatica', { incognito: !!(win && win._filoIncognito) });
    try {
      win.webContents.send('shell:toast', {
        text: 'L\'ho segnalato a chi sviluppa Filo',
        // La shell traduce `cancelAutoFeedback`: Annulla la ferma, la chiusura dell'avviso la fa partire.
        opts: { durationSec: 8, tipo: 'segnalazione_automatica', actions: [{ label: 'Annulla', cancelAutoFeedback: biglietto }] },
      });
    } catch (_) {
      // Nessun avviso a schermo: nessuno può dire no.
      Attesa.parti(biglietto);
    }
  } catch (e) {
    console.warn('[F4] maybeAutoFeedback errore:', e?.message || e);
  }
}

// Riassunti dei file dell'editor come blocco pronto per il prompt (#379.5).
// Best-effort: se manca qualcosa il prompt mostra «(nessuno)».
async function editorFileSummariesList() {
  try {
    const EF = require('./editorFiles');
    return await EF.listFileSummaries();
  } catch (_) { return []; }
}
async function editorFileSummaries() {
  try {
    const Summary = globalThis.SN_EDITOR_SUMMARY;
    if (!Summary) return '';
    const list = await editorFileSummariesList();
    return Summary.renderForPrompt(list);
  } catch (_) { return ''; }
}

module.exports = {
  proxyNonDisponibile,
  esitoNonDisponibile,
  RISPOSTA_PROXY_NON_DISPONIBILE,
  SOLLECITO_DOPO_RIFIUTO,
  giroDiSoliBottoni,
  RISPOSTA_FRA_LE_NOTE,
  unisciTesti,
  ARGOMENTI_TAGLIATI,
  soloLetture,
  fraseSenzaRisposta,
  paginePerChat,
  schedeChiusePerChat,
  voceChiusa,
  schedeNumerate,
  schedaPerNumero,
  schedaDaMostrare,
  bersaglioPausa,
  bersaglioAudio,
  salvatePerChat,
  apriPaginaSalvata,
  cambiPerChat,
  rilettura,
  espandiFilo,
  leggiPaginaDa,
  lettureDeiGettoni,
  lettureDellAiuto,
  storiaAiutoConLetture,
  notaDeiGettoni,
  observationsForPrompt,
  interruptedActionsForPrompt,
  LEGACY_CONTINUE_NUDGE,
  contoRestano,
  toolResultText,
  maybeProposeFeedbackAction,
  maybeAutoFeedback,
  editorFileSummariesList,
};

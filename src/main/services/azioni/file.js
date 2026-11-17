// Le azioni di Filo sui file e sui documenti dell'utente (leggere, cercare, aprire, eliminare, rinominare).
// Ogni file esporta la tabella tipo -> funzione che eseguiAzioneFilo (handlers.js) consulta dopo il preambolo.

const PageRead = require('../pageRead');
const {
  getAssistantCwd, cartellaDelComando, bersagliMostrati, perimetroLettura, LOTTO_ELIMINA, motivoEliminazione,
  motivoNonEliminato, LOTTO_RINOMINA,
} = require('../porteUscita');
const { fileScaricato, ricercaSuAltroComputer } = require('../autonomiaFonti');

async function azioneLeggiFile(action) {
  // Filo vede solo i riassunti e chiede il file intero quando vale la pena. Sola lettura.
  const fileId = action.fileId ?? action.id ?? action.file ?? action.percorso ?? action.path;
  let r = { ok: false };
  try {
    const EF = require('../editorFiles');
    r = await EF.readFile(fileId);
  } catch (e) {
    console.warn('[Filo] lettura file editor fallita', e?.message || e);
  }
  return {
    executed: !!(r && r.ok),
    kept: true,
    output: { fileRead: String(fileId == null ? '' : fileId), found: !!(r && r.ok), title: (r && r.title) || '', text: (r && r.text) || '' },
  };
}

async function azioneLeggiDocumento(action, { confirmed, sender, decisione }) {
  // Lettura di un documento dal disco (PDF o testo): senza, «quant'è la giacenza media?»
  // resta senza risposta possibile, perché un PDF è binario. Sola lettura.
  const percorso = action.percorso ?? action.path ?? action.file ?? action.documento ?? action.nome;
  let r = null;
  try {
    const DR = require('../documentRead');
    // La cartella in cui Filo sta guardando col terminale. Un elenco
    // stampa i NOMI, non i percorsi: se quel nome arrivasse qui senza
    // cartella verrebbe cercato dove sta il programma Filo, che con la
    // domanda dell'utente non c'entra niente (#551, terzo giro).
    // Se quella cartella è sparita, un nome senza percorso si cerca da
    // dove il terminale riparte — la home — non in un posto che non
    // esiste (#551, quarto giro).
    r = await DR.readDocument(percorso, { cwd: cartellaDelComando(getAssistantCwd(sender)) });
  } catch (e) {
    console.warn('[Filo] lettura documento fallita', e?.message || e);
  }
  if (!r) {
    return {
      executed: false,
      kept: true,
      output: { documentRead: String(percorso == null ? '' : percorso), ok: false, error: 'unreadable', detail: 'lettura non disponibile' },
    };
  }
  // Il nome quasi giusto (#551) può aver portato a un file diverso da
  // quello valutato dal gate: se è fuori dal perimetro e nessuno ha
  // confermato, il testo non esce di qui.
  const C = globalThis.SN_CMD_CLASSIFY;
  const fuori = r.path && !confirmed && (!C || C.fuoriPerimetro(r.path, action._perimetro))
    && decisione.conCosto(2) !== 'si';
  if (fuori) {
    return {
      executed: false,
      kept: true,
      output: {
        documentRead: String(percorso == null ? '' : percorso),
        ok: false,
        error: 'fuori_perimetro',
        detail: 'il file trovato sta fuori dalla cartella personale: richiedilo col percorso esatto e l\'utente confermerà',
      },
    };
  }
  if (r.ok) PageRead.ricordaLetturaRiservata(r.text);
  return {
    executed: !!r.ok,
    kept: true,
    output: {
      documentRead: String(percorso == null ? '' : percorso),
      ok: !!r.ok,
      scaricato: fileScaricato(r.path),
      // Il percorso chiesto, quando NON è quello aperto davvero: il nome
      // era quasi giusto (accenti, trattino lungo) e il file è stato
      // ritrovato lo stesso. Va detto, non taciuto (#551).
      requested: r.requested || '',
      name: r.name || '',
      kind: r.kind || '',
      pages: r.pages || 0,
      empty: !!r.empty,
      truncated: !!r.truncated,
      // Con quale tabella il testo è stato letto e quanti byte il file
      // aveva rotti: un documento bucato non deve arrivare al modello
      // come se fosse intero (#551, sesto giro).
      codifica: r.codifica || '',
      bytesPersi: r.bytesPersi || 0,
      text: r.text || '',
      error: r.error || null,
      detail: r.detail || '',
    },
  };
}

async function azioneCercaDocumenti(action, { confirmed, avanzamento, segnale, decisione }) {
  // #947 — la richiesta a parole («la bolletta della luce di marzo») contro l'indice dei documenti che Filo tiene
  // sul computer. Al modello vanno solo i pochi candidati, con un pezzo di testo: sceglie lui e li mostra con
  // APRI_FILE. Mentre l'indice legge i file nuovi l'attesa dice quale e quanti mancano; il quadrato la ferma.
  const cosa = String(action.cosa ?? action.query ?? action.testo ?? action.q ?? '').trim();
  const cartella = String(action.cartella ?? '').trim();
  const Indice = require('../documentiIndice');
  // Come LEGGI_DOCUMENTO: la cartella risolta si rimisura prima di toccarla, e se il gate ne ha misurata un'altra
  // senza OK non si legge (#1499).
  const C = globalThis.SN_CMD_CLASSIFY;
  const fuori = (p) => (confirmed || decisione.conCosto(2) === 'si' ? ''
    : (!C ? 'non si sa dove legge' : C.fuoriPerimetro(p, action._perimetro)));
  let r;
  try {
    r = await Indice.cerca(cosa, {
      cartella,
      fuori,
      segnale,
      avanzamento: avanzamento ? (st) => {
        if (!st || st.fase !== 'lettura') return;
        // Il numero è quello del documento che sta leggendo adesso: «1 di 60», non «0 di 60».
        try { avanzamento(Math.min(st.fatti + 1, st.totali), st.totali, st.nome); } catch (_) {}
      } : null,
    });
  } catch (e) {
    console.warn('[Filo] ricerca nei documenti fallita', e?.message || e);
    return { executed: false, kept: true, output: { cercato: cosa, risultati: [], errore: 'la ricerca non è riuscita' } };
  }
  if (r.cartellaDiRete) return { executed: false, kept: true, output: ricercaSuAltroComputer(action) };
  if (r.cartellaFuori) {
    return {
      executed: false,
      kept: true,
      output: {
        cercato: cosa, cartella, risultati: [], errore: 'fuori_perimetro',
        detail: 'la cartella sta fuori dalla cartella personale: richiedila col percorso esatto e l\'utente confermerà',
      },
    };
  }
  const risultati = r.risultati.map((x) => ({ ...x, scaricato: fileScaricato(x.percorso) }));
  return {
    executed: !r.cartellaMancante,
    kept: true,
    output: {
      cercato: cosa,
      cartella,
      risultati,
      scaricato: risultati.some((x) => x.scaricato),
      indice: r.indice,
      fermata: !!r.fermata,
      cartellaMancante: r.cartellaMancante || '',
    },
  };
}

async function azioneApriFile(action) {
  // Un file su un altro computer non diventa un bottone: al clic Windows si presenterebbe a quel computer con
  // l'identità dell'utente, e il nome lo sceglie il modello (#1499). Ogni campo dove il bottone può trovarlo.
  const DR = require('../documentRead');
  const percorsi = [action.percorso, action.path].map((v) => DR.percorsoDelFile(v));
  if (percorsi.some((v) => v === null)) {
    return { executed: false, kept: false, output: { rete: true, error: 'il file sta su un altro computer della rete' } };
  }
  // Il bottone porta il percorso che si aprirà, pulito come lo pulisce il disco: fra virgolette la chat non lo
  // riconosceva come file e ne faceva un collegamento morto.
  const pulito = percorsi.find(Boolean);
  if (pulito) { action.percorso = pulito; if (action.path) action.path = pulito; }
  // Il bottone dice dove sta il file con i nomi delle cartelle di Filo, non con quelli del disco (#947).
  const p = String(action.percorso ?? action.path ?? '').trim();
  let dove = '';
  if (/^(~([\\/]|$)|[\\/]|[a-z]:[\\/])/i.test(p)) {
    try { dove = await require('../documentiIndice').doveSta(DR.normalizePath(p)); } catch (_) {}
  }
  return { executed: true, kept: true, ...(dove ? { output: { dove } } : {}) };
}

async function azioneEliminaFile(action, { confirmed, sender }) {
  const visti = confirmed ? bersagliMostrati(sender, action) : { file: action._file };
  const lista = (visti && Array.isArray(visti.file) ? visti.file : []).slice(0, LOTTO_ELIMINA);
  const nodePath = require('node:path');
  const perimetro = perimetroLettura(sender);
  const per = action.per_sempre === true;
  const eliminati = [];
  const falliti = [];
  for (const f of lista) {
    const p = f && typeof f.percorso === 'string' ? f.percorso : '';
    if (!p || !nodePath.isAbsolute(p)) continue;
    const nome = nodePath.basename(p);
    const m = motivoEliminazione(p, perimetro);
    if (m) { falliti.push({ nome, perche: m }); continue; }
    // Il cestino del sistema rifiuta un file sparito senza dire perché: si guarda prima, o l'utente legge «non permesso».
    try { await require('node:fs/promises').lstat(p); } catch (_) { falliti.push({ nome, perche: motivoNonEliminato({ code: 'ENOENT' }) }); continue; }
    try {
      if (per) await require('node:fs/promises').rm(p, { recursive: true });
      else await require('electron').shell.trashItem(p);
      eliminati.push(nome);
    } catch (e) { falliti.push({ nome, perche: motivoNonEliminato(e) }); }
  }
  return { executed: eliminati.length > 0, kept: false, output: { eliminati, falliti, perSempre: per } };
}

async function azioneRinominaFile(action, { sender }) {
  const visti = bersagliMostrati(sender, action);
  const proposte = (visti && Array.isArray(visti.proposte) ? visti.proposte : []).slice(0, LOTTO_RINOMINA);
  const Nomi = require('../nomiFile');
  const nodePath = require('node:path');
  const rinominati = [];
  const falliti = [];
  for (const p of proposte) {
    if (!p || typeof p.da !== 'string' || !nodePath.isAbsolute(p.da) || typeof p.nome !== 'string') continue;
    const r = await Nomi.rinomina(p.da, p.nome);
    if (r.ok && !r.invariato) rinominati.push({ da: r.da, a: r.a, prima: r.prima, nome: r.nome });
    else if (!r.ok) falliti.push({ nome: nodePath.basename(p.da), perche: r.frase });
  }
  return {
    executed: rinominati.length > 0,
    kept: true,
    output: {
      rinominati, falliti, saltati: Array.isArray(action._saltati) ? action._saltati : [],
      ...(rinominati.some((r) => fileScaricato(r.da)) ? { scaricati: true } : {}),
    },
  };
}

module.exports = {
  LEGGI_FILE: azioneLeggiFile,
  LEGGI_DOCUMENTO: azioneLeggiDocumento,
  CERCA_DOCUMENTI: azioneCercaDocumenti,
  APRI_FILE: azioneApriFile,
  ELIMINA_FILE: azioneEliminaFile,
  RINOMINA_FILE: azioneRinominaFile,
};

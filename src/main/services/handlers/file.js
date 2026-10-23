// Handler di dominio: nome sensato ai file dell'utente (#950). Tutti chiusi ai siti visitati (toccano il disco e
// rispondono con percorsi assoluti); la logica sta in services/nomiFile.js.

const path = require('node:path');
const { soloFilo } = require('./origine');
const NomiFile = require('../nomiFile');

// Il nome si scrive nella lingua di chi usa il computer: quella del sistema.
function lingua() {
  let loc = '';
  try { loc = require('electron').app.getLocale() || ''; } catch (_) {}
  const codice = (String(loc).split('-')[0] || 'it').toLowerCase();
  try {
    const nome = new Intl.DisplayNames([codice], { type: 'language' }).of(codice);
    if (nome && nome.toLowerCase() !== codice) return nome;
  } catch (_) {}
  return 'italiano';
}

module.exports = function register(on, ctx) {
  const { MSG } = ctx;
  const A = globalThis.SN_CONST.ACTIONS;
  const DL = () => require('../downloads');

  NomiFile.collega({
    chiamaModello: (messages) => ctx.modelGate.text({ action: A.FILE_NAME, messages }),
    lingua,
    dopoRinomina: (da, a) => { try { DL().rinominato(da, a); } catch (_) {} },
  });

  // La voce «Dai un nome sensato» compare solo se può funzionare: c'è un modello per farlo.
  async function disponibile() {
    try {
      const s = await ctx.getEffectiveSettings();
      ctx.buildAttemptChain(s, ctx.modelForAction(s, A.FILE_NAME), A.FILE_NAME);
      return true;
    } catch (_) { return false; }
  }

  const ambito = (sender) => DL().scopeOfWindow(sender && sender.win);
  // Un percorso relativo non ha una cartella a cui riferirsi: si accetta intero, o con ~ per la cartella personale.
  // null: porta a un altro computer, e il disco non si tocca (#1499).
  function percorsoDi(msg, sender) {
    if (msg && msg.downloadId) return DL().percorsoDi(msg.downloadId, ambito(sender));
    return require('../documentRead').percorsoDelFile(msg && msg.percorso);
  }
  const nonTrovato = () => ({ ok: false, errore: 'non_trovato', frase: 'Il file non c’è più: forse è stato spostato o cancellato' });
  const senza = (p) => (p === null
    ? { ok: false, errore: 'rete', frase: 'Il file sta su un altro computer della rete: Filo apre solo i file di questo computer' }
    : nonTrovato());

  on(MSG.FILE_NOME_STATO, soloFilo(async () => ({ ok: true, disponibile: await disponibile() })));
  on(MSG.FILE_NOME_PROPONI, soloFilo(async (msg, sender) => {
    const p = percorsoDi(msg, sender);
    return p ? NomiFile.proponi(p) : senza(p);
  }));
  on(MSG.FILE_RINOMINA, soloFilo(async (msg, sender) => {
    const p = percorsoDi(msg, sender);
    return p ? NomiFile.rinomina(p, msg.nome) : senza(p);
  }));
  on(MSG.FILE_RIMETTI_NOMI, soloFilo(async (msg) => {
    const coppie = (Array.isArray(msg.coppie) ? msg.coppie : [])
      .filter((c) => c && typeof c.attuale === 'string' && path.isAbsolute(c.attuale) && typeof c.prima === 'string');
    const esiti = await NomiFile.rimetti(coppie);
    return { ok: esiti.length > 0 && esiti.every((e) => e.ok), esiti };
  }));
  on(MSG.DOWNLOAD_RIMETTI_NOME, soloFilo(async (msg, sender) => DL().rimettiNome(msg.id, ambito(sender))));

  // #947 — il bottone di un file trovato in chat. Il percorso può averlo scritto un modello che ha letto un documento
  // ostile: si apre solo un documento o un'immagine, mai un programma.
  const electron = () => require('electron');
  const fs = require('node:fs');
  const Testo = require('../documentiTesto');
  const IMMAGINI = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.heic', '.tif', '.tiff']);
  const apribile = (p) => !!Testo.tipoDi(p) || IMMAGINI.has(path.extname(p).toLowerCase());
  const esiste = (p) => { try { return fs.statSync(p).isFile(); } catch (_) { return false; } };
  on(MSG.FILE_APRI, soloFilo(async (msg) => {
    const p = percorsoDi(msg);
    if (!p) return senza(p);
    // Il tipo si guarda sul nome, prima di chiedere niente al disco.
    if (!apribile(p)) {
      return { ok: false, errore: 'tipo', frase: 'Da qui Filo apre solo documenti e immagini: questo file aprilo dalla sua cartella' };
    }
    if (!esiste(p)) return nonTrovato();
    try {
      const errore = await electron().shell.openPath(p);
      return errore ? { ok: false, errore: 'sistema', frase: 'Il computer non ha un programma per aprire questo file' } : { ok: true };
    } catch (_) {
      return { ok: false, errore: 'sistema', frase: 'Il computer non ha un programma per aprire questo file' };
    }
  }));
  on(MSG.FILE_MOSTRA_CARTELLA, soloFilo(async (msg) => {
    const p = percorsoDi(msg);
    if (!p) return senza(p);
    if (esiste(p)) { try { electron().shell.showItemInFolder(p); return { ok: true }; } catch (_) {} }
    // Il file non c'è più ma la cartella sì: la si mostra, non la si apre. Su Mac aprire una cartella .app lancia il
    // programma, e il percorso può averlo scritto un modello.
    const dir = path.dirname(p);
    try {
      if (fs.statSync(dir).isDirectory()) { electron().shell.showItemInFolder(dir); return { ok: true, mancaIlFile: true }; }
    } catch (_) {}
    return { ok: false, errore: 'non_trovato', frase: 'Né il file né la sua cartella ci sono più' };
  }));

  const Indice = require('../documentiIndice');
  on(MSG.DOCUMENTI_STATO, soloFilo(async () => ({ ok: true, ...(await Indice.stato()) })));
  on(MSG.DOCUMENTI_DIMENTICA, soloFilo(async (msg) => {
    const p = msg && typeof msg.percorso === 'string' ? msg.percorso : '';
    return { ok: true, ...(await Indice.dimentica(p)) };
  }));

  // #947.3 — l'Aiuto di una scheda: aperti ai siti, perché l'Aiuto vive nella pagina. Il sì e le chiavi li tiene
  // aiutoDocumenti; qui solo la porta: una scheda, e dal suo documento principale (un riquadro è un altro sito).
  const AiutoDoc = require('../aiutoDocumenti');
  const daScheda = (fn) => async (msg, sender) => {
    const wc = sender && sender.wc;
    const frame = sender && sender.frame;
    let principale = false;
    try { principale = !!wc && !wc.isDestroyed() && (!frame || !frame.parent); } catch (_) { principale = false; }
    if (!principale) return { ok: false, code: 'forbidden', error: 'forbidden' };
    return fn(msg || {}, sender, wc);
  };
  on(MSG.AIUTO_CERCA_DOCUMENTI, daScheda(async (msg, sender, wc) => {
    const origine = String(sender.tab?.url || sender.url || '');
    const r = await AiutoDoc.cerca(wc, {
      cosa: msg.cosa,
      cartella: msg.cartella,
      origine,
      avanzamento: (fatti, totali) => {
        // Dall'Aiuto nello strato sopra il sito (#1509.3) l'avanzamento va a lui, non alla pagina.
        try { (sender.strato || sender.frame || wc).send('filo:broadcast', { type: MSG.AIUTO_DOCUMENTI_AVANZAMENTO, fatti, totali }); } catch (_) {}
      },
    });
    if (r.ok) {
      // Quello che il modello vede dei documenti sporca il compito come un documento letto in chat (#530).
      const scaricato = r.candidati.some((c) => ctx.fileScaricato(AiutoDoc.percorsoDi(wc, c.chiave)));
      try { ctx.segnaLetturaAiuto(sender, { type: 'CERCA_DOCUMENTI', cosa: r.cercato, _output: { cercato: r.cercato, risultati: r.candidati, scaricato } }); } catch (_) {}
    }
    return r;
  }));
  on(MSG.AIUTO_DOCUMENTI_FERMA, daScheda(async (_msg, _sender, wc) => ({ ok: AiutoDoc.ferma(wc) })));
  on(MSG.AIUTO_APRI_FILE, daScheda(async (msg, _sender, wc) => AiutoDoc.apri(wc, msg.chiave)));
  on(MSG.AIUTO_MOSTRA_FILE, daScheda(async (msg, _sender, wc) => AiutoDoc.mostra(wc, msg.chiave)));
  // Il trascinamento parte dove l'utente ha preso il bottone: lo strato, se l'Aiuto sta lì.
  on(MSG.AIUTO_TRASCINA_FILE, daScheda(async (msg, sender, wc) => AiutoDoc.trascina(wc, msg.chiave, sender.strato || wc)));
  on(MSG.DOCUMENTI_SCEGLI_CARTELLA, soloFilo(async (msg, sender) => {
    const { dialog, BrowserWindow } = electron();
    const win = (sender && sender.win) || BrowserWindow.getFocusedWindow() || undefined;
    try {
      const r = await dialog.showOpenDialog(win, { title: 'Cartella da aggiungere ai documenti', properties: ['openDirectory'] });
      if (!r || r.canceled || !Array.isArray(r.filePaths) || !r.filePaths[0]) return { ok: false };
      return { ok: true, percorso: r.filePaths[0] };
    } catch (_) { return { ok: false }; }
  }));
  Indice.avviaInSottofondo();
  // Le prove lo raggiungono dal processo principale (app.evaluate), come gli altri servizi su globalThis.
  globalThis.SN_DOCUMENTI_INDICE = Indice;
};

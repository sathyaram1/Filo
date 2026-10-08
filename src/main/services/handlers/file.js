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
  function percorsoDi(msg, sender) {
    if (msg && msg.downloadId) return DL().percorsoDi(msg.downloadId, ambito(sender));
    const p = msg && typeof msg.percorso === 'string' ? msg.percorso.trim() : '';
    if (!p || (!path.isAbsolute(p) && !/^~([\\/]|$)/.test(p))) return '';
    return require('../documentRead').normalizePath(p);
  }
  const nonTrovato = () => ({ ok: false, errore: 'non_trovato', frase: 'Il file non c’è più: forse è stato spostato o cancellato' });

  on(MSG.FILE_NOME_STATO, soloFilo(async () => ({ ok: true, disponibile: await disponibile() })));
  on(MSG.FILE_NOME_PROPONI, soloFilo(async (msg, sender) => {
    const p = percorsoDi(msg, sender);
    return p ? NomiFile.proponi(p) : nonTrovato();
  }));
  on(MSG.FILE_RINOMINA, soloFilo(async (msg, sender) => {
    const p = percorsoDi(msg, sender);
    return p ? NomiFile.rinomina(p, msg.nome) : nonTrovato();
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
    if (!p || !esiste(p)) return nonTrovato();
    if (!apribile(p)) {
      return { ok: false, errore: 'tipo', frase: 'Da qui Filo apre solo documenti e immagini: questo file aprilo dalla sua cartella' };
    }
    try {
      const errore = await electron().shell.openPath(p);
      return errore ? { ok: false, errore: 'sistema', frase: 'Il computer non ha un programma per aprire questo file' } : { ok: true };
    } catch (_) {
      return { ok: false, errore: 'sistema', frase: 'Il computer non ha un programma per aprire questo file' };
    }
  }));
  on(MSG.FILE_MOSTRA_CARTELLA, soloFilo(async (msg) => {
    const p = percorsoDi(msg);
    if (!p) return nonTrovato();
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

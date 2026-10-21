// I dizionari del correttore nativo (Hunspell): quelli in assets/dizionari si copiano dove Chromium li cerca, e il
// suo scaricamento da Google punta a un indirizzo file:// che il motore non scarica (#1084). Non sceglie le lingue
// (spellLanguages.js). Regole: tests/unit/dizionari.test.mjs e tests/unit/contattiImpliciti.test.mjs.

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const CARTELLA = path.join(__dirname, '..', '..', '..', 'assets', 'dizionari');

const visti = { inizializzati: new Set(), chiesti: new Set() };

function inclusi(cartella = CARTELLA) {
  try { return fs.readdirSync(cartella).filter((f) => f.endsWith('.bdic')).sort(); } catch (_) { return []; }
}

// «it-IT-3-0.bdic» → «it-IT»: il numero è la versione del formato, che Chromium mette nel nome.
function lingue(cartella = CARTELLA) {
  return inclusi(cartella).map((f) => f.replace(/-\d+-\d+\.bdic$/, ''));
}

// Uno che Chromium trova rovinato lo cancella e prova a scaricarlo: all'avvio dopo torna da qui.
function copia(destinazione, cartella = CARTELLA) {
  const copiati = [];
  try { fs.mkdirSync(destinazione, { recursive: true }); } catch (_) { return copiati; }
  for (const f of inclusi(cartella)) {
    const da = path.join(cartella, f);
    const a = path.join(destinazione, f);
    try {
      let presente = -1;
      try { presente = fs.statSync(a).size; } catch (_) {}
      if (presente === fs.statSync(da).size) continue;
      fs.writeFileSync(a, fs.readFileSync(da));
      copiati.push(f);
    } catch (_) {}
  }
  return copiati;
}

function indirizzo(cartella = CARTELLA) {
  return pathToFileURL(cartella + path.sep).href;
}

function aggancia(ses, url) {
  if (!ses || ses.__filoDizionari) return;
  ses.__filoDizionari = true;
  try { ses.setSpellCheckerDictionaryDownloadURL(url); } catch (_) {}
  try {
    ses.on('spellcheck-dictionary-initialized', (_e, lingua) => visti.inizializzati.add(lingua));
    ses.on('spellcheck-dictionary-download-begin', (_e, lingua) => visti.chiesti.add(lingua));
  } catch (_) {}
}

// Va chiamata prima che nasca la prima sessione: la sessione avvia subito il caricamento delle sue lingue.
function prepara(app, { piattaforma = process.platform, cartella = CARTELLA } = {}) {
  // Su Mac il correttore è quello del sistema: niente Hunspell da scaricare, e l'indirizzo lì è ignorato.
  if (piattaforma === 'darwin') return false;
  try { copia(path.join(app.getPath('sessionData'), 'Dictionaries'), cartella); } catch (_) {}
  const url = indirizzo(cartella);
  app.on('session-created', (ses) => aggancia(ses, url));
  return true;
}

function stato() {
  return { inizializzati: [...visti.inizializzati].sort(), chiesti: [...visti.chiesti].sort() };
}

module.exports = { prepara, lingue, inclusi, copia, indirizzo, stato, CARTELLA };

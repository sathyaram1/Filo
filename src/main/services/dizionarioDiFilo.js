// Il dizionario con cui il correttore sa quali parole non conosce (#1585): Hunspell in WebAssembly, sulle stesse sorgenti
// in Windows, Mac e Linux. Non sceglie le lingue (spellLanguages.js) e non disegna segni. Perché non quello del browser:
// patterns/il-dizionario-del-correttore-e-di-filo.md; regole: tests/unit/dizionarioDiFilo.test.mjs.

'use strict';

const fs = require('node:fs');
const path = require('node:path');

const SORGENTI = path.join(__dirname, '..', '..', '..', 'assets', 'dizionari', 'sorgenti');

// I limiti di Chromium (hunspell_engine.cc, spellcheck_common.h), in byte UTF-8: oltre, la parola è giusta e senza proposte.
const PAROLA_MAX_BYTE = 64;
const PROPOSTE_PAROLA_MAX_BYTE = 24;
const PROPOSTE_MAX = 5;
// Il correttore ricorda al più tante parole per pagina (spellcheck.js): una richiesta più grossa non viene da lui.
const RICHIESTA_MAX = 20000;

const dalPacchetto = (nome) => {
  const dir = path.dirname(require.resolve(nome));
  return { aff: path.join(dir, 'index.aff'), dic: path.join(dir, 'index.dic') };
};

// In ordine alfabetico, come la lista del browser: per «en-AU» vince «en-GB».
const SORGENTI_DI = Object.freeze({
  'en-GB': () => dalPacchetto('dictionary-en-gb'),
  'en-US': () => dalPacchetto('dictionary-en'),
  'it-IT': () => ({
    aff: path.join(SORGENTI, 'it_IT.aff'),
    dic: path.join(SORGENTI, 'it_IT.dic'),
    delta: path.join(SORGENTI, 'it_IT.dic_delta'),
  }),
});
const LINGUE = Object.freeze(Object.keys(SORGENTI_DI));

// ISO-8859-15 è il Latin-1 con otto caratteri cambiati; i file italiani sono così, e restano com'erano (GPL).
const LATIN9 = { 0xa4: '€', 0xa6: 'Š', 0xa8: 'š', 0xb4: 'Ž', 0xb8: 'ž', 0xbc: 'Œ', 0xbd: 'œ', 0xbe: 'Ÿ' };
function decodifica(buf, codifica) {
  const c = String(codifica || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  let s;
  if (c === 'UTF8') s = buf.toString('utf8');
  else if (c === 'ISO88591' || c === 'ISO885915') {
    s = buf.toString('latin1');
    if (c === 'ISO885915') s = s.replace(/[\xa4\xa6\xa8\xb4\xb8\xbc\xbd\xbe]/g, (x) => LATIN9[x.charCodeAt(0)]);
  } else throw new Error(`codifica del dizionario non gestita: ${codifica}`);
  return s.replace(/^﻿/, '').replace(/\r\n?/g, '\n');
}

// Il motore parla UTF-8: affissi e parole si convertono, e la riga SET lo dice. Il delta sono le parole che Chromium
// aggiunge al suo .bdic (una per riga, senza affissi).
function testiDi(lingua) {
  const f = SORGENTI_DI[lingua]();
  const affGrezzo = fs.readFileSync(f.aff);
  const codifica = (/^SET[ \t]+(\S+)/m.exec(affGrezzo.toString('latin1')) || [])[1] || 'ISO8859-1';
  const aff = decodifica(affGrezzo, codifica).replace(/^SET[ \t]+\S+/m, 'SET UTF-8');
  let dic = decodifica(fs.readFileSync(f.dic), codifica);
  if (f.delta) {
    const parole = decodifica(fs.readFileSync(f.delta), 'UTF-8').split('\n').map((r) => r.trim()).filter(Boolean);
    dic = `${dic.replace(/\n*$/, '\n')}${parole.join('\n')}\n`;
  }
  return { aff, dic };
}

function scegli(locale) {
  if (!globalThis.SN_SPELL_LANG) require('../../shared/spellLanguages.js');
  return globalThis.SN_SPELL_LANG.select(LINGUE, locale, LINGUE);
}

const stato = { fase: 'spento', lingue: [], errori: [] };
let motori = [];
let promessa = null;
let programmato = null;

// `dopoMs`: all'avvio si carica quando la finestra c'è già (sono un'ottantina di millisecondi del processo principale);
// una domanda arrivata prima lo fa partire subito.
function prepara({ locale = '', dopoMs = 0 } = {}) {
  if (promessa) return promessa;
  if (dopoMs > 0) {
    if (!programmato) {
      programmato = { locale, timer: setTimeout(() => prepara({ locale }), dopoMs) };
      programmato.timer.unref?.();
    }
    return null;
  }
  if (programmato) { clearTimeout(programmato.timer); programmato = null; }
  stato.fase = 'in caricamento';
  promessa = (async () => {
    let crea;
    try {
      ({ createHunspellFromStrings: crea } = await import('hunspell-wasm'));
    } catch (e) {
      stato.errori.push(`motore: ${e?.message || e}`);
    }
    const pronti = [];
    if (crea) {
      for (const lingua of scegli(locale)) {
        try {
          const { aff, dic } = testiDi(lingua);
          pronti.push({ lingua, h: await crea(aff, dic) });
        } catch (e) {
          stato.errori.push(`${lingua}: ${e?.message || e}`);
        }
      }
    }
    motori = pronti;
    stato.lingue = pronti.map((m) => m.lingua);
    stato.fase = pronti.length ? 'pronto' : 'guasto';
    if (stato.errori.length) console.warn('[Filo] dizionario del correttore:', stato.errori.join('; '));
    return stato.fase === 'pronto';
  })();
  return promessa;
}

function avviaSeAtteso() {
  if (!promessa && programmato) prepara({ locale: programmato.locale });
}

const byte = (s) => Buffer.byteLength(s, 'utf8');

// Come Chromium con più lingue: sbagliata solo se nessuna la conosce.
function sbagliataGia(parola) {
  const p = typeof parola === 'string' ? parola : '';
  if (!p.trim() || byte(p) > PAROLA_MAX_BYTE) return false;
  try { return motori.every(({ h }) => !h.testSpelling(p)); } catch (_) { return false; }
}

/** Per ogni parola, se nessuna lingua la conosce; `null` finché il dizionario non è pronto (o non si è caricato). */
function sbagliate(parole) {
  if (!Array.isArray(parole) || parole.length > RICHIESTA_MAX) return null;
  if (!motori.length) { avviaSeAtteso(); return null; }
  return parole.map(sbagliataGia);
}

/** Le correzioni, alternate fra le lingue come fa Chromium; `null` finché il dizionario non è pronto. */
function proposte(parola) {
  if (!motori.length) { avviaSeAtteso(); return null; }
  const p = typeof parola === 'string' ? parola : '';
  if (!p.trim() || byte(p) > PROPOSTE_PAROLA_MAX_BYTE) return [];
  const liste = [];
  try {
    for (const { h } of motori) {
      if (h.testSpelling(p)) return [];
      liste.push(h.getSpellingSuggestions(p).slice(0, PROPOSTE_MAX));
    }
  } catch (_) { return []; }
  const out = [];
  const lunga = Math.max(0, ...liste.map((l) => l.length));
  for (let i = 0; i < lunga && out.length < PROPOSTE_MAX; i++) {
    for (const l of liste) {
      if (i < l.length && !out.includes(l[i])) out.push(l[i]);
      if (out.length >= PROPOSTE_MAX) break;
    }
  }
  return out;
}

function descrivi() {
  return { fase: stato.fase, lingue: stato.lingue.slice(), errori: stato.errori.slice() };
}

module.exports = { prepara, sbagliate, proposte, stato: descrivi, scegli, testiDi, decodifica, LINGUE };

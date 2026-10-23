// Il motore del dizionario del correttore (#1585): Hunspell in WebAssembly, sulle stesse sorgenti in Windows, Mac e Linux.
// Gira nel thread di dizionarioDiFilo.js (nel processo principale solo se il thread non parte): non sceglie le lingue e
// non parla con le pagine. Regole: tests/unit/dizionarioDiFilo.test.mjs.

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

const byte = (s) => Buffer.byteLength(s, 'utf8');

// I file italiani conoscono solo l'apostrofo dritto; quello tipografico è la stessa parola.
const normale = (parola) => (typeof parola === 'string' ? parola.replace(/’/g, "'") : '');
const VOCALI_ELISE = ['a', 'e', 'i', 'o'];

/** Carica le lingue chieste; una che non si carica finisce negli errori, e le altre rispondono lo stesso. */
async function carica(lingue) {
  const errori = [];
  let crea = null;
  try {
    ({ createHunspellFromStrings: crea } = await import('hunspell-wasm'));
  } catch (e) {
    errori.push(`motore: ${e?.message || e}`);
  }
  const motori = [];
  for (const lingua of crea ? lingue : []) {
    try {
      const { aff, dic } = testiDi(lingua);
      motori.push({ lingua, h: await crea(aff, dic) });
    } catch (e) {
      errori.push(`${lingua}: ${e?.message || e}`);
    }
  }

  const conosciuta = (p) => motori.some(({ h }) => h.testSpelling(p));
  // Come Chromium con più lingue: sbagliata solo se nessuna la conosce. Con l'apostrofo in fondo è giusta se lo è senza
  // («va'», «be'», «dell'») o se è un'elisione, cioè la parola intera meno la vocale finale («sant'», «quell'»).
  function sbagliataGia(parola) {
    const p = normale(parola);
    if (!p.trim() || byte(p) > PAROLA_MAX_BYTE) return false;
    try {
      if (conosciuta(p)) return false;
      const radice = /^(.*\p{L})'$/u.exec(p)?.[1];
      return !radice || !(conosciuta(radice) || VOCALI_ELISE.some((v) => conosciuta(radice + v)));
    } catch (_) { return false; }
  }

  return {
    lingue: motori.map((m) => m.lingua),
    errori,
    sbagliate(parole) {
      if (!motori.length || !Array.isArray(parole) || parole.length > RICHIESTA_MAX) return null;
      return parole.map(sbagliataGia);
    },
    // Le correzioni, alternate fra le lingue come fa Chromium.
    proposte(parola) {
      if (!motori.length) return null;
      const p = normale(parola);
      if (!p.trim() || byte(p) > PROPOSTE_PAROLA_MAX_BYTE || !sbagliataGia(p)) return [];
      const liste = [];
      try {
        for (const { h } of motori) liste.push(h.getSpellingSuggestions(p).slice(0, PROPOSTE_MAX));
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
    },
  };
}

module.exports = { carica, testiDi, decodifica, LINGUE, RICHIESTA_MAX };

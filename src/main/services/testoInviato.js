'use strict';

// Il testo che una richiesta porta al sito, nelle forme in cui i siti lo scrivono (indirizzo,
// modulo, JSON, HTML), senza spazi: il content script ci cerca le righe dell'utente (#824).
// Logica pura; chi la usa è src/main/tabs.js. Sentinella: tests/unit/testoInviato.test.mjs.

// Oltre si legge l'inizio: una riga trovata lì è partita davvero, una persa resta protetta.
const LIMITE_CORPO = 4 * 1024 * 1024;
const SEPARATORE = '\u0001';

const pulito = (s) => String(s).replace(/[\s​-‍⁠﻿]+/g, '');

function decodificaPercento(s) {
  return String(s).replace(/\+/g, ' ').replace(/(?:%[0-9a-fA-F]{2})+/g, (m) => {
    try { return decodeURIComponent(m); } catch (_) { return m; }
  });
}

const ESCAPE_JSON = { n: '\n', r: '\r', t: '\t', b: '\b', f: '\f', '"': '"', '\\': '\\', '/': '/' };
function sciogliJson(s) {
  return String(s).replace(/\\(u[0-9a-fA-F]{4}|["\\/bfnrt])/g, (_, e) => (
    e.length === 5 ? String.fromCharCode(parseInt(e.slice(1), 16)) : ESCAPE_JSON[e]));
}

const ENTITA = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
function soloTesto(s) {
  return String(s).replace(/<[^<>]*>/g, ' ').replace(/&(#x[0-9a-fA-F]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] !== '#') return ENTITA[e.toLowerCase()] ?? m;
    const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
    try { return String.fromCodePoint(n); } catch (_) { return m; }
  });
}

function corpo(uploadData) {
  const pezzi = [];
  let n = 0;
  for (const parte of Array.isArray(uploadData) ? uploadData : []) {
    const b = parte && parte.bytes;
    if (!b || !b.length || n >= LIMITE_CORPO) continue;
    const quanto = Math.min(b.length, LIMITE_CORPO - n);
    pezzi.push((Buffer.isBuffer(b) ? b : Buffer.from(b)).subarray(0, quanto).toString('utf8'));
    n += quanto;
  }
  return pezzi.join('');
}

// '' se la richiesta non porta testo.
function testoDellaRichiesta({ url = '', uploadData } = {}) {
  let indirizzo = '';
  try { const u = new URL(url); indirizzo = u.pathname + u.search; } catch (_) {}
  const grezzo = `${indirizzo}\n${corpo(uploadData)}`;
  if (!pulito(grezzo)) return '';
  const decodificato = decodificaPercento(grezzo);
  const forme = new Set([
    grezzo,
    sciogliJson(grezzo),
    sciogliJson(decodificato),
    soloTesto(sciogliJson(grezzo)),
    soloTesto(sciogliJson(decodificato)),
  ].map(pulito));
  return [...forme].join(SEPARATORE);
}

module.exports = { testoDellaRichiesta, LIMITE_CORPO };

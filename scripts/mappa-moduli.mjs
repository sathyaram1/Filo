// Mappa dei .js di src dalle intestazioni: una riga per file (percorso, KB, prima frase), o per cartella senza argomenti.
// Non scrive niente su disco: si rifà a ogni lancio e non invecchia. Prove: tests/unit/mappaModuli.test.mjs; che ogni
// .js abbia l'intestazione lo tiene tests/unit/commentiRegola.test.mjs.

import { readFileSync, readdirSync, realpathSync, statSync } from 'node:fs';
import path, { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const RADICE = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const TETTO_DESCRIZIONE = 120;
export const SENZA_INTESTAZIONE = '(nessun commento d’intestazione in cima)';
const USO = 'uso: node scripts/mappa-moduli.mjs [cartella…] [--tutto]';

// Un commento di soli marcatori o una direttiva per gli strumenti (/* global chrome */) non dice cos'è il file.
const DIRETTIVA = /^(eslint\b|eslint-|global\s|globals\s|jshint\b|jslint\b|@ts-|istanbul\s|c8\s|prettier-)/;
const USE_STRICT = /^(['"])use strict\1;?$/;

// Le righe di testo del primo commento in cima (la riga vuota fra paragrafi resta ''), o null se in cima c'è codice.
export function intestazione(testo) {
  const righe = String(testo).replace(/^\uFEFF/, '').split(/\r?\n/);
  let i = 0;
  if (righe[0]?.startsWith('#!')) i = 1;
  while (i < righe.length) {
    const t = righe[i].trim();
    if (!t || USE_STRICT.test(t)) { i++; continue; }
    let blocco;
    if (t.startsWith('//')) {
      blocco = [];
      while (i < righe.length && righe[i].trim().startsWith('//')) blocco.push(righe[i++].trim().replace(/^\/\/+\s?/, ''));
    } else if (t.startsWith('/*')) {
      blocco = [];
      for (let r = t.slice(2).replace(/^!/, ''); ; r = righe[i].trim()) {
        const chiude = r.indexOf('*/');
        blocco.push((chiude === -1 ? r : r.slice(0, chiude)).replace(/^\*+\s?/, '').trim());
        i++;
        if (chiude !== -1 || i >= righe.length) break;
      }
    } else return null;
    const pieno = blocco.filter((r) => r.trim());
    if (pieno.length && !DIRETTIVA.test(pieno[0].trim())) return blocco;
  }
  return null;
}

// La prima frase del primo paragrafo (un elenco puntato ne apre un altro); un punto seguito da minuscola («es. il») non
// chiude la frase.
const VOCE_DI_ELENCO = /^([-*•]|\d+[.)])\s/;
export function primaFrase(righe) {
  if (!righe) return SENZA_INTESTAZIONE;
  const dall = righe.findIndex((r) => r.trim());
  const paragrafo = [];
  for (let i = dall; i >= 0 && i < righe.length && righe[i].trim(); i++) {
    if (i > dall && VOCE_DI_ELENCO.test(righe[i].trim())) break;
    paragrafo.push(righe[i].trim());
  }
  // I caratteri di controllo e di direzione non arrivano al terminale: un commento non deve poter riscrivere le altre righe.
  const testo = paragrafo.join(' ').replace(/[\u0000-\u001f\u007f-\u009f\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, ' ')
    .replace(/\s+/g, ' ').trim();
  const fine = /[.!?]["'»)\]]*(?=\s+[\p{Lu}\p{N}«"'(`[])/u.exec(testo);
  return taglia(fine ? testo.slice(0, fine.index + fine[0].length) : testo) || SENZA_INTESTAZIONE;
}

export function taglia(testo, tetto = TETTO_DESCRIZIONE) {
  if (testo.length <= tetto) return testo;
  const corto = testo.slice(0, tetto - 1);
  const spazio = corto.lastIndexOf(' ');
  return `${(spazio >= tetto / 2 ? corto.slice(0, spazio) : corto).trimEnd()}…`;
}

export function kb(byte) {
  const v = byte / 1024;
  return `${byte > 0 && v < 0.05 ? '0.1' : v.toFixed(1)} KB`;
}

// Barre normali su ogni sistema: `sistema` è path.win32 nelle prove che girano altrove.
export function percorsoMostrato(base, p, sistema = path) {
  const r = sistema.relative(base, p);
  const fuori = r === '..' || r.startsWith(`..${sistema.sep}`) || sistema.isAbsolute(r);
  return (fuori ? p : r || '.').split(sistema.sep).join('/');
}

// Ogni .js sotto `dir`, con le cartelle collegate seguite una volta sola: un collegamento circolare non gira per sempre.
// Dentro non si scende in node_modules né nelle cartelle col punto: un «.» dalla radice darebbe migliaia di righe altrui.
const NON_NOSTRA = (nome) => nome === 'node_modules' || nome.startsWith('.');
export function fileJs(dir, acc = [], visti = new Set()) {
  let vero;
  try { vero = realpathSync(dir); } catch (_) { vero = dir; }
  if (visti.has(vero)) return acc;
  visti.add(vero);
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (NON_NOSTRA(e.name)) continue;
    const p = join(dir, e.name);
    let tipo = e;
    if (e.isSymbolicLink()) { try { tipo = statSync(p); } catch (_) { tipo = null; } }
    if (tipo?.isDirectory()) fileJs(p, acc, visti);
    else if (e.name.endsWith('.js') && (tipo ? tipo.isFile() : e.isSymbolicLink())) acc.push(p);
  }
  return acc;
}

function scheda(p) {
  try {
    return { byte: statSync(p).size, descrizione: primaFrase(intestazione(readFileSync(p, 'utf8'))) };
  } catch (e) {
    return { byte: 0, descrizione: `(illeggibile: ${e.code || e.message})` };
  }
}

const perPercorso = (a, b) => (a.mostrato < b.mostrato ? -1 : a.mostrato > b.mostrato ? 1 : 0);

export function righeDeiFile(percorsi, radice) {
  const voci = [...new Set(percorsi)].map((p) => ({ p, mostrato: percorsoMostrato(radice, p) })).sort(perPercorso);
  return voci.map(({ p, mostrato }) => {
    const { byte, descrizione } = scheda(p);
    return `${mostrato}  ${kb(byte)}  ${descrizione}`;
  });
}

// Il numero di una cartella è quanti file stamperebbe passandola: comprende le sottocartelle.
export function righeDelleCartelle(base, radice) {
  const conti = new Map();
  for (const p of fileJs(base)) {
    const byte = (() => { try { return statSync(p).size; } catch (_) { return 0; } })();
    for (let d = dirname(p); ; d = dirname(d)) {
      const c = conti.get(d) || { file: 0, byte: 0 };
      c.file++; c.byte += byte;
      conti.set(d, c);
      if (d === base || dirname(d) === d) break;
    }
  }
  return [...conti].map(([d, c]) => ({ mostrato: percorsoMostrato(radice, d), ...c })).sort(perPercorso)
    .map((c) => `${c.mostrato}  ${c.file} file  ${kb(c.byte)}`);
}

// Una cartella scritta a mano si cerca da dove si è, poi dalla radice del repo, poi dentro src.
function trova(arg, { radice, cwd }) {
  const scritto = arg.replace(/\\/g, '/');
  for (const p of [resolve(cwd, scritto), resolve(radice, scritto), resolve(radice, 'src', scritto)]) {
    try { return { p, stat: statSync(p) }; } catch (_) { /* il prossimo */ }
  }
  return null;
}

export function mappa(argv, { radice = RADICE, cwd = process.cwd() } = {}) {
  const errori = [], avvisi = [], cartelle = [];
  let tutto = false;
  for (const a of argv) {
    if (a === '--tutto') tutto = true;
    else if (a === '-h' || a === '--help' || a === '--aiuto') return { codice: 0, uscita: [USO], errori: [] };
    else if (a.startsWith('-')) errori.push(`opzione sconosciuta: ${a}`);
    else if (a.trim()) cartelle.push(a.trim());
  }
  if (errori.length) return { codice: 2, uscita: [], errori: [...errori, USO] };
  const src = join(radice, 'src');
  if (!cartelle.length) {
    if (tutto) return { codice: 0, uscita: righeDeiFile(fileJs(src), radice), errori: [] };
    return {
      codice: 0,
      uscita: [...righeDelleCartelle(src, radice), 'Passa una cartella per i suoi file (es. src/main/services), --tutto per tutti.'],
      errori: [],
    };
  }
  const percorsi = [];
  for (const a of cartelle) {
    const t = trova(a, { radice, cwd });
    if (!t) errori.push(`cartella inesistente: ${a}`);
    else if (t.stat.isDirectory()) {
      const qui = fileJs(t.p);
      if (!qui.length) avvisi.push(`nessun file .js in ${percorsoMostrato(radice, t.p)}`);
      percorsi.push(...qui);
    } else if (t.p.endsWith('.js')) percorsi.push(t.p);
    else errori.push(`non è una cartella né un file .js: ${a}`);
  }
  if (errori.length) return { codice: 1, uscita: [], errori };
  return { codice: 0, uscita: [...righeDeiFile(percorsi, radice), ...avvisi], errori: [] };
}

const lanciato = (() => { try { return realpathSync(process.argv[1]); } catch (_) { return resolve(process.argv[1] || ''); } })();
if (lanciato === realpathSync(fileURLToPath(import.meta.url))) {
  // Con `| head` lo stdout si chiude a metà: non è un guasto della mappa.
  process.stdout.on('error', (e) => { if (e.code === 'EPIPE') process.exit(0); throw e; });
  const { codice, uscita, errori } = mappa(process.argv.slice(2));
  if (uscita.length) process.stdout.write(`${uscita.join('\n')}\n`);
  if (errori.length) process.stderr.write(`${errori.join('\n')}\n`);
  process.exitCode = codice;
}

// #1617 giro 3 — sul Mac, se il Finder non dà in blocco dimensioni o classi (come quando sulla Scrivania c'è una
// cartella), «per dimensione» e «cartelle prima» non possono finire in ordine per nome con l'esito «fatto».
import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';
import { join } from 'node:path';

const require = createRequire(import.meta.url);
const ROOT = join(process.cwd());
const S = join(ROOT, 'src', 'main', 'services');
const pr = require.resolve(join(S, 'registroCambi.js'));
require.cache[pr] = { id: pr, filename: pr, loaded: true, exports: { registra: (e) => ({ id: 'c1', ...e }) } };
require(join(ROOT, 'src', 'shared', 'cambi.js'));
const D = require(join(S, 'iconeDesktop.js'));
const C = require(join(S, 'comandiSistema.js'));

// Il Finder in blocco si rompe sul campo chiesto (una cartella sulla Scrivania); voce per voce risponde.
function finder(voci, rotto) {
  const stato = { arrangement: 'not arranged', voci: voci.map((v) => ({ ...v })) };
  const blocco = (c) => () => {
    if (c === rotto) throw new Error('una cartella non ha dimensione');
    return stato.voci.map((v) => v[c]);
  };
  const items = {
    url: blocco('url'), displayedName: blocco('nome'), name: blocco('nome'), desktopPosition: () => stato.voci.map((v) => v.pos.slice()),
    class: blocco('class'), nameExtension: blocco('nameExtension'), modificationDate: blocco('modificationDate'), size: blocco('size'),
  };
  stato.voci.forEach((v, i) => Object.defineProperty(items, i, {
    get: () => {
      const o = {};
      for (const k of ['url', 'displayedName', 'name', 'class', 'nameExtension', 'modificationDate', 'size']) {
        o[k] = () => {
          if (k === 'size' && v.class === 'folder') throw new Error('una cartella non ha dimensione');
          return v[k === 'displayedName' || k === 'name' ? 'nome' : k];
        };
      }
      Object.defineProperty(o, 'desktopPosition', { get: () => () => v.pos.slice(), set: (p) => { v.pos = p.slice(); } });
      return o;
    },
  }));
  const opz = { iconSize: () => 64 };
  Object.defineProperty(opz, 'arrangement', { get: () => () => stato.arrangement, set: (x) => { stato.arrangement = x; } });
  return { stato, Application: () => ({ desktop: { items, containerWindow: { iconViewOptions: opz } } }) };
}

function jxa(f, env) {
  const nil = { isNil: () => true };
  const $ = {
    NSProcessInfo: { processInfo: { environment: { objectForKey: (k) => (k in env ? { isNil: () => false, v: env[k] } : nil) } } },
    NSScreen: { screens: { objectAtIndex: () => ({ frame: { origin: { x: 0, y: 0 }, size: { width: 1440, height: 900 } }, visibleFrame: { origin: { x: 0, y: 70 }, size: { width: 1440, height: 805 } } }) } },
  };
  return new Function('ObjC', '$', 'Application', 'delay', `${D.JXA_DESKTOP}\nreturn run();`)({ import() {}, unwrap: (o) => o.v }, $, f.Application, () => {});
}

const SCRIVANIA = [
  { url: 'file:///Users/josh/Desktop/appunti.txt', nome: 'appunti.txt', pos: [1380, 60], class: 'documentFile', nameExtension: 'txt', size: 10, modificationDate: new Date(1) },
  { url: 'file:///Users/josh/Desktop/film.mov', nome: 'film.mov', pos: [1380, 160], class: 'documentFile', nameExtension: 'mov', size: 9000000, modificationDate: new Date(2) },
  { url: 'file:///Users/josh/Desktop/contratto.pdf', nome: 'contratto.pdf', pos: [1380, 260], class: 'documentFile', nameExtension: 'pdf', size: 5000, modificationDate: new Date(3) },
  { url: 'file:///Users/josh/Desktop/Zeta/', nome: 'Zeta', pos: [1380, 360], class: 'folder', nameExtension: '', size: null, modificationDate: new Date(4) },
];

async function ordina(rotto, richiesta) {
  const f = finder(SCRIVANIA, rotto);
  D._perProve.usaComputer({
    piattaforma: 'darwin',
    async leggi() { return D.interpretaLettura(C.leggiUscita(jxa(f, D.costruisci('desktop-leggi', {}, 'darwin').env))); },
    async disponi(posizioni, o) { return D.interpretaLettura(C.leggiUscita(jxa(f, D.costruisci('desktop-disponi', { posizioni, ...o }, 'darwin').env))); },
  });
  try {
    const r = await D.ordinaIcone(richiesta);
    const fila = f.stato.voci.slice().sort((a, b) => a.pos[1] - b.pos[1] || a.pos[0] - b.pos[0]).map((v) => v.nome);
    return { r, fila };
  } finally { D._perProve.usaComputer(null); }
}

test('r1 «per dimensione» con una cartella sulla Scrivania: o in ordine di dimensione, o non è «fatto»', async () => {
  const { r, fila } = await ordina('size', { ordine: 'dimensione', verso: 'righe' });
  if (r.ok) expect(fila, D.esitoPerModello(r)).toEqual(['film.mov', 'contratto.pdf', 'appunti.txt', 'Zeta']);
});

test('r1 «cartelle prima» quando il Finder non dice in blocco cosa è una cartella: o la cartella è prima, o non è «fatto»', async () => {
  const { r, fila } = await ordina('class', { ordine: 'nome', verso: 'righe', cartelle_prima: true });
  if (r.ok) expect(fila[0], D.esitoPerModello(r)).toBe('Zeta');
});

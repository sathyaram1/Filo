// Verifica di #1572, secondo giro. Le prove su un albero il cui lock è più avanti della cartella principale (la prova
// sulla fusione con main di `npm run finish`, un worktree riallineato a origin/main) prendono node_modules dalla
// principale: la libreria nuova del lock deve arrivare prima delle prove, non restare «da installare a mano».
// npm è finto e fa quello che fa il vero: installa nella cartella dove gira ciò che chiede il lock di quella cartella.
import { test, expect } from '@playwright/test';
import { existsSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { cartellaTemporanea, togliCartella } from '../../helpers/percorsi.mjs';
import { allineaPacchetti, allineaPerLeProve } from '../../../scripts/lib/pacchetti.mjs';

const lock = (pacchetti) => ({
  name: 'filo', version: '1.0.0', lockfileVersion: 3, requires: true,
  packages: { '': { name: 'filo', version: '1.0.0' }, ...pacchetti },
});
const VECCHIO = { 'node_modules/archiver': { version: '7.0.1' } };
const NUOVO = { ...VECCHIO, 'node_modules/hash-wasm': { version: '4.12.0' } };

function npmFinto(dir) {
  const l = JSON.parse(readFileSync(join(dir, 'package-lock.json'), 'utf8'));
  for (const [p, v] of Object.entries(l.packages)) {
    if (!p) continue;
    mkdirSync(join(dir, p), { recursive: true });
    writeFileSync(join(dir, p, 'package.json'), JSON.stringify({ name: p.slice('node_modules/'.length), version: v.version }));
  }
  return { codice: 0, errore: '' };
}

test('r1 la prova sulla fusione con main trova la libreria che main ha appena aggiunto', () => {
  const tmp = cartellaTemporanea('filo-1572-');
  try {
    // La cartella principale, ferma a prima della libreria nuova (Filo acceso da allora: nessun npm start).
    const principale = join(tmp, 'Filo');
    mkdirSync(principale, { recursive: true });
    writeFileSync(join(principale, 'package-lock.json'), JSON.stringify(lock(VECCHIO)));
    npmFinto(principale);
    // L'albero della prova: il codice di main di adesso, node_modules collegato alla principale.
    const base = join(tmp, 'prova');
    const albero = join(base, 'albero');
    mkdirSync(albero, { recursive: true });
    writeFileSync(join(albero, 'package-lock.json'), JSON.stringify(lock(NUOVO)));
    symlinkSync(join(principale, 'node_modules'), join(base, 'node_modules'), 'junction');

    const righe = [];
    allineaPerLeProve(albero, {
      log: (s) => righe.push(s),
      allinea: (dir, o) => allineaPacchetti(dir, { ...o, installa: npmFinto, cartellaBlocchi: tmp }),
    });

    expect(existsSync(join(base, 'node_modules', 'hash-wasm', 'package.json')), righe.join('\n')).toBe(true);
  } finally {
    togliCartella(tmp);
  }
});

// Prova del giro 2: la stessa regola non vive in due testi di ruolo. Il giro 1
// aveva già trovato una porta di questa famiglia (un'avvertenza copiata parola
// per parola in due ruoli) e l'aveva chiusa con un pezzo condiviso; la rete
// lasciata dietro guarda solo le frasi lunghe almeno ottanta caratteri, e una
// regola più corta ci passa sotto.
//
// Qui si guarda per finestre di parole, che non si fermano alla punteggiatura.

import { test, expect } from '@playwright/test';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const FINESTRA = 12;

test('nessuna regola scritta parola per parola in due testi di ruolo', () => {
  const dir = join(ROOT, 'routines', 'roles');
  const visto = new Map();
  const doppie = new Set();
  for (const f of readdirSync(dir).filter((n) => n.endsWith('.md'))) {
    const testo = readFileSync(join(dir, f), 'utf8').replace(/\r/g, '');
    const parole = testo.replace(/[`*]/g, '').replace(/\s+/g, ' ').trim().toLowerCase().split(' ');
    for (let i = 0; i + FINESTRA <= parole.length; i++) {
      const k = parole.slice(i, i + FINESTRA).join(' ');
      if (visto.has(k) && visto.get(k) !== f) doppie.add(`${visto.get(k)} + ${f}: ${k}`);
      else if (!visto.has(k)) visto.set(k, f);
    }
  }
  expect([...doppie], 'stesse parole in due ruoli diversi: una regola sta in un posto solo, o le due copie divergono da sole').toEqual([]);
});

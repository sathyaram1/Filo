// Prova del giro 1: i criteri con cui si giudica un lavoro devono stare in un
// posto solo, e valere sia per chi lo fa sia per chi lo verifica.
//
// Nelle routine è così. In un giro LOCALE no: il compito che riceve chi
// verifica porta con sé l'elenco condiviso (nove voci), mentre chi fa il primo
// lavoro legge il documento comune del progetto, dove la stessa cosa è scritta
// una seconda volta e più corta (mancano sicurezza di ciò che si aggiunge,
// pattern, miglioramenti, e la regola di cercare tutte le strade che portano
// allo stesso difetto). Due elenchi della stessa cosa divergono: è esattamente
// il motivo per cui i pezzi condivisi dei ruoli vivono in un file solo.

import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

test('in locale chi fa il primo lavoro usa gli stessi criteri di chi verifica', () => {
  test.fail(true, 'rilievo aperto: il documento comune del progetto tiene un secondo elenco, più corto, dei criteri di consegna');
  const comune = readFileSync(join(ROOT, 'CLAUDE.md'), 'utf8');
  const condivisi = readFileSync(join(ROOT, 'routines', 'roles', '_criteri-verifica.md'), 'utf8');

  // O il documento comune rimanda alla fonte unica…
  const rimanda = comune.includes('_criteri-verifica.md');
  // …oppure ne contiene le voci che oggi gli mancano.
  const voci = ['Sicurezza funzionale', 'Pattern.', 'Miglioramenti.', 'Una causa, tutte le porte'];
  const complete = voci.every((v) => comune.includes(v));

  expect(condivisi).toContain('Una causa, tutte le porte');
  expect(rimanda || complete,
    'il documento comune del progetto non rimanda ai criteri condivisi e ne ripete una versione più corta').toBe(true);
});

test('nessuna regola scritta due volte in due testi di ruolo', () => {
  test.fail(true, 'rilievo aperto: l\'avvertenza sul testo scritto da altri è copiata in due testi di ruolo');
  const dir = join(ROOT, 'routines', 'roles');
  const doppie = [];
  const visto = new Map();
  for (const f of readdirSync(dir).filter((n) => n.endsWith('.md'))) {
    const t = readFileSync(join(dir, f), 'utf8').replace(/\r/g, '');
    for (const frase of t.split(/(?<=[.:;])\s+/)) {
      const n = frase.replace(/\s+/g, ' ').trim();
      if (n.length < 80 || n.startsWith('```')) continue;
      if (visto.has(n) && visto.get(n) !== f) doppie.push(`${visto.get(n)} + ${f}: ${n.slice(0, 70)}…`);
      else visto.set(n, f);
    }
  }
  expect(doppie, 'stesse frasi in file di ruolo diversi: un pezzo condiviso si scrive una volta sola').toEqual([]);
});

// Verifica #510, giro 2 — il risparmio si vede, e la memoria dei giri si ritrova.
//
// Togliere le prove usa-e-getta dalla suite serve a due persone: chi lancia la
// suite (deve vedere quanto costa davvero) e chi verifica il giro dopo (deve
// ritrovare le prove del giro prima nominando il numero della segnalazione).
// Qui si prova che nessuna delle due informazioni è rimasta indietro.

import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

test('quanto costa la suite, scritto per chi lavora, è quanto costa davvero', () => {
  const guida = readFileSync(resolve(ROOT, 'CLAUDE.md'), 'utf8');
  const dichiarato = guida.match(/~\s*([\d.]+)\s+spec/);
  expect(dichiarato, 'la guida deve dire quanto è grande la suite: è il numero su cui tutti decidono').not.toBeNull();
  const atteso = Number(dichiarato[1].replace(/\./g, ''));

  const elenco = execFileSync('npx', ['playwright', 'test', '--list', '--reporter=list'], {
    cwd: ROOT, encoding: 'utf8', maxBuffer: 1 << 26,
  });
  const conto = elenco.match(/Total:\s*\d+\s+tests\s+in\s+(\d+)\s+files/);
  expect(conto, 'il collettore deve dire quanti file raccoglie').not.toBeNull();
  const vero = Number(conto[1]);

  const scarto = Math.abs(vero - atteso) / vero;
  expect(scarto < 0.05,
    `la guida dice ${atteso} file di prove, la suite ne raccoglie ${vero}: chi legge la guida non vede`
    + ' il tempo che questa pulizia ha restituito, e il prossimo che deve decidere se vale la pena'
    + ' ripulire ancora parte da un numero vecchio')
    .toBe(true);
});

test('le prove di ogni giro si ritrovano dal numero della segnalazione', () => {
  const cartelle = readdirSync(resolve(ROOT, 'tests', 'verifica'), { withFileTypes: true })
    .filter((v) => v.isDirectory()).map((v) => v.name);
  expect(cartelle.length, 'senza cartelle non c\'è niente da ritrovare').toBeGreaterThan(0);
  // Un numero (le segnalazioni) o un nome di lavoro locale, che il compito ricevuto dice per esteso.
  const irraggiungibili = cartelle.filter((c) => !/^\d+$/.test(c) && !c.startsWith('locale-'));
  expect(irraggiungibili,
    'le prove chiuse qui dentro non le riapre nessuno: chi verifica il giro dopo nomina il numero della'
    + ' segnalazione, non trova niente e rifà da capo le porte già chiuse una volta')
    .toEqual([]);
});

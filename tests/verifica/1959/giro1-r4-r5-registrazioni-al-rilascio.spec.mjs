// Verifica #1959 giro 1: la riga d'errore di uno strumento fallito deve dire l'errore, non l'intestazione del comando;
// l'elenco dei falliti non deve perdere quasi tutto quando una sessione ne ha molti (il server ne accetta 200).
import { test, expect } from '@playwright/test';
import { rigaErrore, dentroBudget } from '../../../scripts/session-report.mjs';

test('r4 un npm fallito registra l\'errore, non la riga dello script', () => {
  const r = rigaErrore('Exit code 1\n\n> filo@0.2.254 test:unit\n> node --test tests/unit\n\nnot ok 3 - il taccuino\nError: atteso 2, ricevuto 1');
  expect(r).not.toMatch(/> filo@/);
});

test('r4 un push respinto registra il rifiuto, non la riga del remoto', () => {
  const r = rigaErrore('Exit code 128\nTo github.com:x/y.git\n ! [rejected]        ramo -> ramo (non-fast-forward)\nerror: failed to push some refs');
  expect(r).not.toMatch(/^exit 128: To github/);
});

test('r5 quaranta strumenti falliti restano tutti nell\'elenco', () => {
  const voci = Array.from({ length: 40 }, (_, i) => ({
    nome: 'Bash',
    errore: `exit 1: Error: expect(locator).toBeVisible() failed nello spec numero ${i}`,
    poi: 'riprovato diverso: npx playwright test tests/manage-recap.spec.mjs',
  }));
  expect(dentroBudget(voci).length).toBe(40);
});

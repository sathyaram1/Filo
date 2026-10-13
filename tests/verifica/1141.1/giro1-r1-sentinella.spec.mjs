// Verifica #1141.1 giro 1: la regola che main ha messo nel frattempo (#1071.6) vale anche per la prova nuova del
// ramo; senza, dopo il riallineamento la sentinella di main diventa rossa.
import { test, expect } from '@playwright/test';
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const UNIT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', 'unit');
const MISURANO = /routine-channel\.mjs|session-report\.mjs|consumo-progressivo\.mjs/;
const IMPORTA = /^import '\.\.\/helpers\/senzaSessione\.mjs';$/m;

test('r1 chi prova i moduli che misurano la sessione passa dall\'unico isolamento di main', () => {
  const testo = (f) => readFileSync(join(UNIT, f), 'utf8');
  // Solo le prove di questo ramo: le altre le ha già sistemate main, e arrivano col riallineamento.
  const delRamo = (f) => f === 'sessioneIsolata.test.mjs' || /helpers\/sessioneIsolata\.mjs/.test(testo(f));
  const toccano = readdirSync(UNIT).filter((f) => f.endsWith('.test.mjs') && delRamo(f) && MISURANO.test(testo(f)));
  expect(toccano.filter((f) => !IMPORTA.test(testo(f)))).toEqual([]);
});

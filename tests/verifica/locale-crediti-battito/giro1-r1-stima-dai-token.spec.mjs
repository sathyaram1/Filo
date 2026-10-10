// Giro 1, rilievo 1: senza lettura vera la percentuale si stima dai token con la taratura (100% ≈ 2.150 $ a
// settimana per account), e ogni lettura vera la corregge. Si passa dalle porte vere del server (numeri
// dell'owner, battito, lettura della barra) su un Firestore in memoria, e si chiede la decisione della riserva.

import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
// Il server dello stesso ramo: prima il worktree omonimo di filo-security, poi il checkout accanto.
const SERVER = [
  process.env.FILO_SECURITY_DIR || '',
  resolve(ROOT, '..', '..', '..', '..', 'filo-security', '.claude', 'worktrees', basename(ROOT)),
  resolve(ROOT, '..', 'filo-security'),
  resolve(ROOT, '..', '..', '..', '..', 'filo-security'),
].filter(Boolean).map((d) => resolve(d, 'functions')).find((d) => existsSync(resolve(d, 'src', 'routine', 'crediti.js'))) || '';

const require = createRequire(import.meta.url);
let current = null;
let crediti = null;
if (SERVER) {
  const fsMod = require(resolve(SERVER, 'src', 'data', 'firestore.js'));
  fsMod.db = () => current;
  crediti = require(resolve(SERVER, 'src', 'routine', 'crediti.js'));
}
const { memFirestore } = SERVER ? require(resolve(SERVER, 'test', 'fixtures', 'firestore-mem.js')) : {};

// Venerdì 09/10/2026, 14:00 di Roma: A rinnovato martedì 06/10 alle 19:00, B mercoledì 07/10 alle 09:00.
const NOW = Date.parse('2026-10-09T12:00:00Z');
const MIN = 60 * 1000;

function consumo(sessionId, costUsd) {
  return { sessionId, tokens: { input: 10, cacheRead: 1000, cacheWrite: 200, output: 50 }, costUsd, turni: 10, modelli: ['claude-opus-5-5'] };
}

test.describe('la stima dai token quando manca la lettura vera', () => {
  test.skip(!SERVER, 'filo-security non è accanto a questo repo: la metà server non si prova qui');

  test('r1 senza lettura vera B si stima con la taratura di 2.150 $: a 2.000 $ nella settimana e tetto 80 non accende', async () => {
    current = memFirestore();
    await crediti.owner({ op: 'imposta', tettoB: 80 }, NOW);
    await crediti.depositaBattito({ consumo: consumo('sess-b', 2000), account: 'B', slug: 'routine-b', nowMs: NOW });
    const fc = crediti.fermiPerCrediti(await crediti.leggiCrediti(), NOW);
    // 2.000 / 2.150 ≈ 93%, oltre il tetto dell'owner.
    expect(fc.dettaglio.B && fc.dettaglio.B.pct, JSON.stringify(fc)).not.toBeNull();
    expect(fc.fermi.B, JSON.stringify(fc)).toBe(true);
  });

  test('r1 una lettura vera fresca corregge la stima: A al 60% vero, con riserva 10, accende ancora', async () => {
    current = memFirestore();
    await crediti.owner({ op: 'imposta', riservaA: 10, usdPer100: 2150 }, NOW);
    // Le routine su A hanno speso 2.050 $: con la taratura scritta la stima direbbe 95%.
    await crediti.depositaBattito({ consumo: consumo('sess-a', 2050), account: 'A', slug: 'routine-a', nowMs: NOW - 10 * MIN });
    const resetA = crediti.rinnovi(NOW, 'A').successiva;
    await crediti.owner({ op: 'lettura', pct7d: 60, reset7dAtS: resetA / 1000, letturaAtMs: NOW - MIN }, NOW);
    const fc = crediti.fermiPerCrediti(await crediti.leggiCrediti(), NOW);
    // La lettura di un minuto fa dice 60%: la taratura era sbagliata, e A non è oltre la soglia dell'owner.
    expect(fc.fermi.A, JSON.stringify(fc)).toBeFalsy();
  });

  test('r1 lo strumento delle parole d ordine sa dare a ogni routine il suo account', () => {
    const uso = execFileSync(process.execPath, [resolve(ROOT, 'scripts', 'routine-keys.mjs'), '--help'], { encoding: 'utf8' });
    expect(uso).toMatch(/account/i);
  });
});

// #1351, giro 2, rilievo 1: dopo «Lascia stare» il nuovo «Accedi con Google» riapre la pagina dell'accesso di prima,
// che scade col tetto di quello: tornati verso la fine dei dieci minuti, l'accesso cade mentre si sceglie l'account.
// Il main con l'orologio finto gira in un processo a parte, così il finto non tocca i tempi di Playwright.
import { test, expect } from '@playwright/test';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const radice = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

const SCRIPT = `
import { mock } from 'node:test';
import { createRequire } from 'node:module';
const require = createRequire(process.argv[1] + '/package.json');
const aperture = [];
const pe = require.resolve('electron');
require.cache[pe] = { id: pe, filename: pe, loaded: true, exports: {
  shell: { openExternal: async (u) => { aperture.push(String(u)); } },
  net: { isOnline: () => true },
  BrowserWindow: { getFocusedWindow: () => null, getAllWindows: () => [] },
} };
const auth = require(process.argv[1] + '/src/main/auth/google-auth.js');
const giro = () => new Promise((r) => setImmediate(r));
mock.timers.enable({ apis: ['setTimeout', 'Date'], now: Date.parse('2026-11-04T10:00:00Z') });
auth.signIn().catch(() => {});
for (let i = 0; i < 200 && aperture.length < 1; i++) await giro();
mock.timers.tick(2000);
auth.lasciaStare();
mock.timers.tick(9 * 60 * 1000 + 50 * 1000);
let esito = 'in attesa';
auth.signIn().then(() => { esito = 'ok'; }, (e) => { esito = (e && e.code) || 'errore'; });
for (let i = 0; i < 200 && aperture.length < 2; i++) await giro();
mock.timers.tick(30 * 1000);
for (let i = 0; i < 100; i++) await giro();
console.log(JSON.stringify({ aperture: aperture.length, esito }));
mock.timers.tick(60 * 60 * 1000);
process.exit(0);
`;

test('r1 dopo «Lascia stare» un nuovo «Accedi con Google» ha il suo tempo: trenta secondi sulla pagina di Google non lo fanno scadere', () => {
  const r = spawnSync(process.execPath, ['--no-warnings', '--input-type=module', '-e', SCRIPT, radice], { encoding: 'utf8', timeout: 60_000 });
  const riga = String(r.stdout || '').trim().split('\n').pop();
  expect(riga, r.stderr).toBeTruthy();
  const { aperture, esito } = JSON.parse(riga);
  expect(aperture, 'la pagina d\'accesso si è riaperta').toBe(2);
  expect(esito, 'il tentativo nuovo è scaduto col tetto dell\'accesso lasciato stare').toBe('in attesa');
});

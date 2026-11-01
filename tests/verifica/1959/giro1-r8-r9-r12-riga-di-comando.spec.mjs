// Verifica #1959 giro 1: la riga di comando del manutentore, col server finto (niente rete). Un taccuino vuoto da stdin
// non deve cancellare quello che c'è; il biglietto non deve finire nel testo scritto; un'attesa già messa si dice bene.
import { test, expect } from '@playwright/test';
import { spawnSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const MODULO = pathToFileURL(join(REPO, 'scripts', 'manutentore.mjs')).href;

function lancia(argv, risposta = { ok: true, versione: 4 }) {
  const root = mkdtempSync(join(tmpdir(), 'filo-1959-'));
  const codice = `
    const M = await import(${JSON.stringify(MODULO)});
    globalThis.fetch = async (_u, init) => { const b = JSON.parse(init.body); console.log('INVIATO ' + JSON.stringify({ op: b.op, dati: b.dati })); return { status: 200, ok: true, text: async () => JSON.stringify(${JSON.stringify(risposta)}) }; };
    process.exitCode = await M.main(${JSON.stringify(argv)}, { env: { FILO_MANUTENTORE_KEY: 'k' }, root: ${JSON.stringify(root)} });`;
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', codice], { input: '', encoding: 'utf8', cwd: root });
  const inviati = r.stdout.split('\n').filter((l) => l.startsWith('INVIATO ')).map((l) => JSON.parse(l.slice(8)));
  return { status: r.status, out: r.stdout + r.stderr, inviati };
}

test('r8 il taccuino riscritto con stdin vuoto non si manda al server', () => {
  const r = lancia(['taccuino', 'scrivi', '-', '--versione', '3']);
  expect(r.inviati.filter((x) => x.op === 'taccuino.scrivi'), r.out).toEqual([]);
  expect(r.status).not.toBe(0);
});

test('r9 il biglietto passato con --ticket non finisce nell\'indicazione', () => {
  const r = lancia(['indicazione', 'priorità alla grafica', '--ticket', 'SEGRETO123']);
  expect(r.inviati.some((x) => /^(taccuino\.scrivi|indicazione)$/.test(x.op)), r.out).toBe(true);
  expect(JSON.stringify(r.inviati)).not.toMatch(/SEGRETO123/);
});

test('r9 il biglietto passato con --ticket non finisce nella nota di sblocco', () => {
  const r = lancia(['sblocca', '812', '--ticket', 'SEGRETO456']);
  expect(JSON.stringify(r.inviati), r.out).not.toMatch(/"testo":"[^"]*SEGRETO456/);
});

test('r12 un\'attesa già messa dice i numeri', () => {
  const r = lancia(['attesa', '812', '815'], { ok: true, gia: true });
  expect(r.out).not.toMatch(/undefined/);
  expect(r.out).toMatch(/812/);
});

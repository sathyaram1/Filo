// VERIFICA LOCALE, giro 2 — lo script dell'owner e il segno a pratica chiusa.
//
// Il giro 1 aveva trovato che «<id> done --preapprova» metteva il segno su una
// pratica che stava chiudendo nello stesso comando. Qui si ri-prova quella
// porta, e le sue gemelle: ogni stato che chiude la pratica deve rifiutare il
// segno, PRIMA di toccare la rete (così vale anche senza credenziali), mentre
// «--chiedi-prima» a pratica che chiude resta legittimo (toglierlo non fa male).
//
// Non apre Filo: qui non c'è una schermata, c'è la riga di comando.

import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const SCRIPT = resolve(ROOT, 'scripts', 'owner-feedback.mjs');

/** Lancia lo script SENZA credenziali: se arriva alla rete, fallisce per quello. */
function lancia(args) {
  try {
    const out = execFileSync(process.execPath, [SCRIPT, ...args], {
      cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
      env: Object.assign({}, process.env, { FILO_ADMIN_REFRESH_TOKEN: '', FILO_FEEDBACK_PRIVKEY: '' }),
      timeout: 60_000,
    });
    return { code: 0, out, err: '' };
  } catch (e) {
    return { code: e.status, out: String(e.stdout || ''), err: String(e.stderr || '') };
  }
}

for (const stato of ['done', 'archived']) {
  test(`«<id> ${stato} --preapprova» viene rifiutato: il segno non si mette su una pratica che chiude`, async () => {
    const r = lancia(['fb-inesistente', stato, 'nota', '--preapprova', '--dry-run']);
    expect(r.code).toBe(3);
    expect(r.err).toMatch(/RIFIUTATO/);
    expect(r.err).toMatch(/chiude la pratica/);
    // Il rifiuto arriva prima della rete: nessun errore di credenziali.
    expect(r.err).not.toMatch(/credenzial|token|refresh/i);
  });
}

test('«--preapprova» insieme a uno stato che TIENE APERTA la pratica non viene rifiutato per chiusura', async () => {
  // Senza credenziali la rete non si raggiunge: il messaggio deve essere
  // quello, non «chiude la pratica».
  const r = lancia(['fb-inesistente', 'todo', 'nota', '--preapprova', '--dry-run']);
  expect(r.err).not.toMatch(/chiude la pratica/);
  expect(r.code).not.toBe(0);
});

test('«<id> done --chiedi-prima» non viene rifiutato per chiusura: togliere il segno chiudendo è legittimo', async () => {
  const r = lancia(['fb-inesistente', 'done', 'nota', '--chiedi-prima', '--dry-run']);
  expect(r.err).not.toMatch(/chiude la pratica/);
});

test('«--preapprova» e «--chiedi-prima» insieme non passano', async () => {
  const r = lancia(['fb-inesistente', '--preapprova', '--chiedi-prima', '--dry-run']);
  expect(r.code).not.toBe(0);
  expect(r.err).not.toMatch(/credenzial|token|refresh/i);
});

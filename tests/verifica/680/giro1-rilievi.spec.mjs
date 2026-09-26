// Verifica del lavoro «#680», primo giro — le prove dei rilievi.
//
// Rosse finché i rilievi sono aperti: ognuna asserisce il comportamento che
// manca, non l'assenza di un errore. Si cancellano quando il rilievo è chiuso
// (o quando il server lo lascia fuori dal giro).
import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { writeFileSync, rmSync, statSync, symlinkSync, readFileSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { cartellaTemporanea } from '../../helpers/percorsi.mjs';

const ROOT = resolve(process.cwd());

// ── Rilievo: il freno che dovrebbe fermare il prossimo script ha un buco ────
test('il freno si accorge anche di chi scarica tutto con l\'altro nome della stessa lettura', () => {
  const finto = join(ROOT, 'scripts', 'zz-prova-680-rilievo.mjs');
  const SCANSIONE = `// prova del giro di verifica #680: si cancella da sé
const FB = globalThis.SN_FEEDBACK;
export async function tutte() { return FB.listAll({ idToken: 't' }); }
export async function tutteLeSchede() { return FB.listAllPublicPaged({}); }
`;
  writeFileSync(finto, SCANSIONE, 'utf8');
  let esito = '';
  try {
    esito = execFileSync(process.execPath, ['--test', 'tests/unit/letturePerCampi.test.mjs'],
      { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (e) { esito = `${e.stdout || ''}${e.stderr || ''}`; } finally {
    rmSync(finto, { force: true });
  }
  expect(esito, 'uno script che scarica la collezione intera con `listAll` o `listAllPublicPaged` passa il freno senza una parola')
    .toContain('zz-prova-680-rilievo.mjs');
});

// ── Rilievo: la copia su file sta in un posto che chiunque può preparare ───
test('la cartella delle copie è solo di chi la crea', () => {
  const dir = join(cartellaTemporanea('verifica-680-permessi-'), 'copie');
  const { cartellaCopie } = requireCopia();
  cartellaCopie(dir);
  expect(statSync(dir).mode & 0o077, 'gli altri utenti della macchina possono entrarci e prepararci dentro un file')
    .toBe(0);
});

test('una copia preparata da qualcun altro non fa scrivere lo strumento dove dice lei', () => {
  const base = cartellaTemporanea('verifica-680-symlink-');
  const dir = join(base, 'copie');
  mkdirSync(dir, { recursive: true });
  const vittima = join(base, 'file-di-qualcun-altro.txt');
  writeFileSync(vittima, 'originale', 'utf8');
  const { percorsoCopia, scriviCopia } = requireCopia();
  symlinkSync(vittima, percorsoCopia('migrate-status/segnalazioni', dir));
  scriviCopia('migrate-status/segnalazioni', [{ _id: 'x' }], { dir });
  expect(readFileSync(vittima, 'utf8'), 'lo strumento ha seguito il collegamento e ha riscritto il file puntato')
    .toBe('originale');
});

// ── Rilievo: la configurazione delle routine è ricordata due volte ─────────
test('la configurazione delle routine la si ricorda una volta sola per tutti', () => {
  const dir = cartellaTemporanea('verifica-680-config-');
  const { campiDaCopia, salvaCampiInCopia } = requireConfig();
  const url = 'https://firestore.example/config/routines?key=k';
  const t0 = 1_700_000_000_000;
  // Il primo strumento la legge (senza token, com'è in produzione)…
  salvaCampiInCopia(url, { enabled: { booleanValue: true } }, { now: t0, dir, conToken: false });
  // …e il secondo, che la legge col token dell'owner, dovrebbe trovarla già lì.
  expect(campiDaCopia(url, { now: t0 + 1_000, dir, conToken: true }),
    'lo stesso documento resta letto due volte nello stesso minuto').not.toBeNull();
});

function requireCopia() { return cache.copia; }
function requireConfig() { return cache.config; }
const cache = {};
test.beforeAll(async () => {
  cache.copia = await import(`file://${join(ROOT, 'scripts', 'lib', 'copia-su-file.mjs')}`);
  cache.config = await import(`file://${join(ROOT, 'scripts', 'lib', 'config-routine-copia.mjs')}`);
});

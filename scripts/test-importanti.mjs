// test-importanti.mjs: lancia le prove importanti (tests/importanti.spec.mjs) e ne misura la durata, rossa sopra il
// tetto anche a prove verdi (#2501): la cache del contesto di una sessione dura cinque minuti, e chi aspetta oltre la ripaga.
// Prove: tests/unit/testImportanti.test.mjs.

import { spawn } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const SPEC = 'tests/importanti.spec.mjs';
/** Il tetto nel contenitore delle routine, in secondi. */
export const TETTO_S = 240;

/** Le opzioni: `--tetto <secondi>` (per provare il controllo), il resto passa a Playwright. PURA. */
export function leggiArgomenti(argv) {
  const out = { tettoS: TETTO_S, resto: [] };
  const a = Array.isArray(argv) ? argv.map(String) : [];
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] === '--tetto') {
      const n = Number(a[i + 1]);
      if (!(Number.isFinite(n) && n > 0)) return { errore: '--tetto vuole i secondi, un numero sopra zero' };
      out.tettoS = n;
      i += 1;
    } else out.resto.push(a[i]);
  }
  return out;
}

/** L'esito: rosso se Playwright è rosso o se la corsa ha passato il tetto. PURA. */
export function verdettoImportanti({ codice, durataMs, tettoS = TETTO_S }) {
  const secondi = Math.round(durataMs / 100) / 10;
  const sopra = durataMs > tettoS * 1000;
  const righe = [`Prove importanti: ${codice === 0 ? 'verdi' : 'ROSSE'} in ${secondi} s (tetto ${tettoS} s).`];
  if (sopra) {
    righe.push(`DURATA SOPRA IL TETTO: ${secondi} s contro ${tettoS} s. Accorcia un cammino o togline uno: il tetto non si alza.`);
  }
  return { codice: codice === 0 && !sopra ? 0 : 1, sopra, testo: righe.join('\n') };
}

async function main() {
  const opt = leggiArgomenti(process.argv.slice(2));
  if (opt.errore) {
    console.error(opt.errore);
    process.exit(2);
  }
  const inizio = Date.now();
  const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
  const figlio = spawn(npx, ['playwright', 'test', SPEC, ...opt.resto], { cwd: ROOT, stdio: 'inherit', shell: process.platform === 'win32' });
  const codice = await new Promise((ok) => {
    figlio.on('exit', (c) => ok(c ?? 1));
    figlio.on('error', (e) => { console.error(String(e.message || e)); ok(1); });
  });
  const v = verdettoImportanti({ codice, durataMs: Date.now() - inizio, tettoS: opt.tettoS });
  console.log(v.testo);
  if (process.env.GITHUB_STEP_SUMMARY) {
    const { appendFileSync } = await import('node:fs');
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${v.testo}\n`);
  }
  if (v.sopra && process.env.GITHUB_ACTIONS) console.log(`::error::${v.testo.split('\n')[1]}`);
  process.exit(v.codice);
}

const eseguitoDirettamente = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (eseguitoDirettamente) await main();

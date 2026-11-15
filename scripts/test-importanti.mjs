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
/** La catena intera degli aggiornamenti: non sta nel tetto, gira a parte prima della pubblicazione (importanti.yml). */
export const CATENA_AGGIORNAMENTI = Object.freeze([
  'tests/aggiornamenti-da-soli.spec.mjs', 'tests/aggiornamento.spec.mjs', 'tests/update-recap.spec.mjs',
]);
/**
 * L'elenco dei cammini, coi titoli dello spec. Lo cambiano solo l'owner e il manutentore: sta qui perché il server
 * ferma anche un lavoro fidato che tocca questo file, mentre le asserzioni dello spec restano di chi lavora.
 */
export const CAMMINI = Object.freeze([
  'Filo si avvia e mostra la home',
  'il controllo degli aggiornamenti trova una versione nuova',
  'la chat di Filo risponde',
  'una pagina web si apre in una scheda',
  'il tasto destro apre il suo menu',
  'i dati salvati da una versione precedente si leggono dopo l\'aggiornamento',
  'un\'impostazione cambiata resta dopo il riavvio',
]);

/** Lo spec contro l'elenco: gli stessi cammini, e nessuno saltato, isolato o dato rosso in partenza. PURA. */
export function controllaElenco(sorgente, cammini = CAMMINI) {
  const s = String(sorgente || '');
  const titoli = [...s.matchAll(/^\s*test\(\s*(['"`])((?:\\.|(?!\1)[^\\])*)\1/gm)].map((m) => m[2].replace(/\\(.)/g, '$1'));
  const problemi = [];
  const mancano = cammini.filter((t) => !titoli.includes(t));
  const inPiu = titoli.filter((t) => !cammini.includes(t));
  if (mancano.length) problemi.push(`mancano: ${mancano.map((t) => `«${t}»`).join(', ')}`);
  if (inPiu.length) problemi.push(`in più: ${inPiu.map((t) => `«${t}»`).join(', ')}`);
  if (/\btest(\.describe)?\.(skip|fixme|only|fail)\s*\(/.test(s)) problemi.push('un cammino saltato, isolato o segnato rosso atteso');
  return {
    ok: !problemi.length,
    testo: problemi.length
      ? `ELENCO DEI CAMMINI CAMBIATO (${problemi.join('; ')}). L'elenco lo cambiano solo l'owner e il manutentore, in ${SPEC} e in CAMMINI di scripts/test-importanti.mjs insieme.`
      : '',
  };
}

/**
 * Le opzioni: `--tetto <secondi>` (per provare il controllo), `--catena` (la catena degli aggiornamenti, senza tetto),
 * `--chiavi <file>` (le chiavi dell'allarme di un rosso); il resto passa a Playwright. PURA.
 */
export function leggiArgomenti(argv) {
  const out = { tettoS: TETTO_S, catena: false, chiavi: '', resto: [] };
  const a = Array.isArray(argv) ? argv.map(String) : [];
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] === '--tetto') {
      const n = Number(a[i + 1]);
      if (!(Number.isFinite(n) && n > 0)) return { errore: '--tetto vuole i secondi, un numero sopra zero' };
      out.tettoS = n;
      i += 1;
    } else if (a[i] === '--catena') out.catena = true;
    else if (a[i] === '--chiavi') {
      const f = a[i + 1];
      if (!f || f.startsWith('--')) return { errore: '--chiavi vuole un percorso' };
      out.chiavi = f;
      i += 1;
    } else out.resto.push(a[i]);
  }
  return out;
}

/** L'esito: rosso se Playwright è rosso o se la corsa ha passato il tetto (la catena non ne ha). PURA. */
export function verdettoImportanti({ codice, durataMs, tettoS = TETTO_S, catena = false }) {
  const secondi = Math.round(durataMs / 100) / 10;
  const sopra = !catena && durataMs > tettoS * 1000;
  const nome = catena ? 'Catena degli aggiornamenti' : 'Prove importanti';
  const righe = [`${nome}: ${codice === 0 ? 'verdi' : 'ROSSE'} in ${secondi} s${catena ? '' : ` (tetto ${tettoS} s)`}.`];
  if (sopra) {
    righe.push(`DURATA SOPRA IL TETTO: ${secondi} s contro ${tettoS} s. Accorcia un cammino o togline uno: il tetto non si alza.`);
  }
  const chiavi = catena
    ? (codice === 0 ? [] : ['importanti:catena-aggiornamenti'])
    : [...(codice === 0 ? [] : ['importanti:rosse']), ...(sopra ? ['importanti:durata'] : [])];
  return { codice: codice === 0 && !sopra ? 0 : 1, sopra, chiavi, testo: righe.join('\n') };
}

async function main() {
  const opt = leggiArgomenti(process.argv.slice(2));
  if (opt.errore) {
    console.error(opt.errore);
    process.exit(2);
  }
  const { appendFileSync, writeFileSync, readFileSync } = await import('node:fs');
  if (!opt.catena) {
    const elenco = controllaElenco(readFileSync(resolve(ROOT, SPEC), 'utf8'));
    if (!elenco.ok) {
      console.error(elenco.testo);
      if (opt.chiavi) writeFileSync(resolve(opt.chiavi), 'importanti:elenco\n', 'utf8');
      if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${elenco.testo}\n`);
      process.exit(1);
    }
  }
  const inizio = Date.now();
  const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
  const specs = opt.catena ? CATENA_AGGIORNAMENTI : [SPEC];
  const figlio = spawn(npx, ['playwright', 'test', ...specs, ...opt.resto], { cwd: ROOT, stdio: 'inherit', shell: process.platform === 'win32' });
  const codice = await new Promise((ok) => {
    figlio.on('exit', (c) => ok(c ?? 1));
    figlio.on('error', (e) => { console.error(String(e.message || e)); ok(1); });
  });
  const v = verdettoImportanti({ codice, durataMs: Date.now() - inizio, tettoS: opt.tettoS, catena: opt.catena });
  console.log(v.testo);
  const { appendFileSync, writeFileSync } = await import('node:fs');
  if (opt.chiavi) writeFileSync(resolve(opt.chiavi), v.chiavi.length ? `${v.chiavi.join('\n')}\n` : '', 'utf8');
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${v.testo}\n`);
  if (v.sopra && process.env.GITHUB_ACTIONS) console.log(`::error::${v.testo.split('\n')[1]}`);
  process.exit(v.codice);
}

const eseguitoDirettamente = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (eseguitoDirettamente) await main();

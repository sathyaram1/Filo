// rossi-della-suite.mjs: l'elenco del lavoro settimanale (#2501), ogni prova rossa della suite su main con la fusione
// che l'ha rotta e, a parte, le instabili. Legge i registri del lavoro verdetto con `gh api`, che dalla cloud passa.
// Uso: node scripts/rossi-della-suite.mjs [--giorni N] [--json]. Logica: scripts/lib/rossiSuite.mjs.

import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { leggiRegistro, rossiDaCorse, testoElenco } from './lib/rossiSuite.mjs';

const GIORNI = 8;
const TETTO_BYTE = 64 * 1024 * 1024;

/** Le opzioni. PURA. */
export function leggiArgomenti(argv) {
  const out = { giorni: GIORNI, json: false };
  const a = Array.isArray(argv) ? argv.map(String) : [];
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] === '--json') out.json = true;
    else if (a[i] === '--giorni') {
      const n = Number(a[i + 1]);
      if (!(Number.isInteger(n) && n > 0)) return { errore: '--giorni vuole un numero intero sopra zero' };
      out.giorni = n;
      i += 1;
    } else return { errore: `Opzione non capita: ${a[i]}. Opzioni: --giorni N, --json` };
  }
  return out;
}

/** «proprietario/nome» dall'indirizzo del remoto. PURA. */
export function repoDaRemoto(url) {
  const m = String(url || '').trim().match(/github\.com[/:]([^/]+)\/([^/]+?)(?:\.git)?\/?$/);
  return m ? `${m[1]}/${m[2]}` : '';
}

/** Le corse in ordine di main (primo genitore), la più vecchia per prima; quelle fuori da main in coda di data. PURA. */
export function ordinaCorse(corse, primoGenitore) {
  const pos = new Map((Array.isArray(primoGenitore) ? primoGenitore : []).map((s, i) => [s, i]));
  return [...(Array.isArray(corse) ? corse : [])].sort((a, b) => {
    const pa = pos.has(a.sha) ? pos.get(a.sha) : -1;
    const pb = pos.has(b.sha) ? pos.get(b.sha) : -1;
    // rev-list dà il più nuovo per primo: indice più alto, commit più vecchio.
    if (pa !== pb && pa >= 0 && pb >= 0) return pb - pa;
    return String(a.quando).localeCompare(String(b.quando));
  });
}

const sh = (cmd, args) => execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: TETTO_BYTE });
const forse = (f) => { try { return f(); } catch { return ''; } };

async function main() {
  const opt = leggiArgomenti(process.argv.slice(2));
  if (opt.errore) { console.error(opt.errore); process.exit(2); }
  const repo = process.env.GITHUB_REPOSITORY || repoDaRemoto(forse(() => sh('git', ['remote', 'get-url', 'origin'])));
  if (!repo) { console.error('Non so quale repo leggere: manca GITHUB_REPOSITORY e il remoto origin non è su GitHub.'); process.exit(2); }
  const dal = new Date(Date.now() - opt.giorni * 864e5).toISOString().slice(0, 10);
  let elenco;
  try {
    elenco = JSON.parse(sh('gh', ['api', '--paginate', `repos/${repo}/actions/workflows/suite.yml/runs?branch=main&status=completed&per_page=100&created=>=${dal}`,
      '--jq', '[.workflow_runs[] | {id, head_sha, html_url, created_at, event}]']).replace(/\]\s*\[/g, ','));
  } catch (e) {
    console.error(`Le corse della suite non si leggono: ${String(e.stderr || e.message || e).trim().split('\n')[0]}`);
    process.exit(3);
  }
  const corse = [];
  for (const r of elenco.filter((x) => x.event === 'push' || x.event === 'workflow_dispatch')) {
    let registro = null;
    const lavori = forse(() => JSON.parse(sh('gh', ['api', `repos/${repo}/actions/runs/${r.id}/jobs?per_page=100`, '--jq', '[.jobs[] | {id, name}]'])));
    const verdetto = Array.isArray(lavori) ? lavori.find((j) => j.name === 'verdetto') : null;
    if (verdetto) registro = leggiRegistro(forse(() => sh('gh', ['api', `repos/${repo}/actions/jobs/${verdetto.id}/logs`])));
    // Una corsa chiesta per una versione prova un commit più vecchio della punta su cui parte: vale quello del registro.
    corse.push({ sha: registro?.commit || r.head_sha, url: r.html_url, quando: r.created_at, registro });
  }
  forse(() => sh('git', ['fetch', '--quiet', 'origin', 'main']));
  const primoGenitore = forse(() => sh('git', ['rev-list', '--first-parent', '--max-count=3000', 'origin/main'])).split('\n').filter(Boolean);
  const esito = rossiDaCorse(ordinaCorse(corse, primoGenitore));
  if (opt.json) {
    console.log(JSON.stringify(esito, null, 2));
    return;
  }
  const fusioni = (da, a) => forse(() => sh('git', ['log', '--first-parent', '--format=%h %s', `${da}..${a}`])).split('\n').filter(Boolean);
  console.log(testoElenco(esito, { fusioni }));
}

const eseguitoDirettamente = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (eseguitoDirettamente) await main();

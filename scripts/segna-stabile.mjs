// segna-stabile.mjs: a suite completa verde su un commit, la versione costruita da quel commit si segna «stabile» (#2501),
// con un riquadro in cima alla sua pagina. Solo un segno: nessun canale separato. Non pubblica e non crea tag.
// Uso: node scripts/segna-stabile.mjs --commit <sha> [--corsa <url>] [--se-suite-verde]. Prove: tests/unit/segnaStabile.test.mjs.

import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const INIZIO = '<!-- filo-stabile:inizio -->';
export const FINE = '<!-- filo-stabile:fine -->';

/** Il corpo della pagina col segno in cima; uno già segnato si riscrive, mai doppio. PURA. */
export function corpoStabile(corpo, { commit, corsa = '' }) {
  const prima = String(corpo || '');
  const i = prima.indexOf(INIZIO);
  const j = prima.indexOf(FINE);
  const senza = i >= 0 && j > i ? (prima.slice(0, i) + prima.slice(j + FINE.length)).replace(/^\s+/, '') : prima;
  const dove = corsa ? ` ([corsa](${corsa}))` : '';
  const segno = `${INIZIO}\n**Versione stabile**: la suite completa è verde sul commit \`${commit}\` da cui è costruita${dove}.\n${FINE}`;
  return senza ? `${segno}\n\n${senza}` : segno;
}

/** Le opzioni. PURA. */
export function leggiArgomenti(argv) {
  const out = { commit: '', corsa: '', seSuiteVerde: false };
  const a = Array.isArray(argv) ? argv.map(String) : [];
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] === '--se-suite-verde') out.seSuiteVerde = true;
    else if (a[i] === '--commit' || a[i] === '--corsa') {
      const v = a[i + 1];
      if (!v || v.startsWith('--')) return { errore: `${a[i]} vuole un valore` };
      out[a[i].slice(2)] = v;
      i += 1;
    } else return { errore: `Opzione non capita: ${a[i]}. Opzioni: --commit <sha>, --corsa <url>, --se-suite-verde` };
  }
  if (!/^[0-9a-f]{40}$/.test(out.commit)) return { errore: 'serve --commit con lo sha intero' };
  return out;
}

/** La corsa riuscita della suite su quel commit, fra quelle date, o null. PURA. */
export function corsaVerdeDi(runs, commit) {
  return (Array.isArray(runs) ? runs : []).find((r) => r && r.head_sha === commit && r.conclusion === 'success'
    && (!r.status || r.status === 'completed')) || null;
}

const sh = (cmd, args) => execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024 }).trim();

async function main() {
  const opt = leggiArgomenti(process.argv.slice(2));
  if (opt.errore) { console.error(opt.errore); process.exit(2); }
  const repo = process.env.GITHUB_REPOSITORY;
  if (!repo) { console.error('manca GITHUB_REPOSITORY'); process.exit(2); }
  let corsa = opt.corsa;
  if (opt.seSuiteVerde) {
    const runs = JSON.parse(sh('gh', ['api', `repos/${repo}/actions/workflows/suite.yml/runs?head_sha=${opt.commit}&status=success&per_page=20`,
      '--jq', '[.workflow_runs[] | {head_sha, conclusion, status, html_url}]']));
    const verde = corsaVerdeDi(runs, opt.commit);
    if (!verde) { console.log(`La suite completa non è (ancora) verde su ${opt.commit.slice(0, 10)}: la versione si segna quando lo diventa.`); return; }
    corsa ||= verde.html_url || '';
  }
  const tag = sh('git', ['tag', '--points-at', opt.commit, '--list', 'v*']).split('\n').filter(Boolean);
  if (!tag.length) { console.log(`Nessuna versione costruita da ${opt.commit.slice(0, 10)}: niente da segnare.`); return; }
  const cartella = mkdtempSync(join(tmpdir(), 'filo-stabile-'));
  try {
    for (const t of tag) {
      const corpo = sh('gh', ['release', 'view', t, '--repo', repo, '--json', 'body', '--jq', '.body']);
      const file = join(cartella, `${t}.md`);
      writeFileSync(file, corpoStabile(corpo, { commit: opt.commit, corsa }), 'utf8');
      sh('gh', ['release', 'edit', t, '--repo', repo, '--notes-file', file]);
      console.log(`${t} segnata stabile (suite verde su ${opt.commit.slice(0, 10)}).`);
      if (process.env.GITHUB_STEP_SUMMARY) writeFileSync(process.env.GITHUB_STEP_SUMMARY, `- ${t} segnata **stabile**.\n`, { flag: 'a' });
    }
  } finally {
    rmSync(cartella, { recursive: true, force: true });
  }
}

const eseguitoDirettamente = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (eseguitoDirettamente) await main();

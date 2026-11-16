// La parte «spec» della corsa Unit sulla fusione (.github/workflows/unit-fusione.yml): gli spec delle aree toccate che il
// PC dell'owner non gira più (#1737 giro 1, D-185), sulla fusione del ramo con main. Gira dagli strumenti di main; il
// verdetto sui rossi noti del contenitore è quello della suite. Sentinella: tests/unit/specFusioneAzione.test.mjs.

import { appendFileSync, existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MARCA_PARTE } from './unit-fusione-azione.mjs';
import { TETTO_ROSSI } from './lib/unit-sulla-fusione.mjs';
import { verdetto } from './suite-verdict.mjs';

const SHA = /^[0-9a-f]{40}$/;
const NOME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,150}$/;
// Con tutto src toccato gli spec scelti erano 245: il tetto sta ben sopra, e oltre si rifiuta col numero.
export const TETTO_SPEC = 2000;
const IDENTITA = ['-c', 'user.name=filo-spec', '-c', 'user.email=filo-spec@localhost', '-c', 'commit.gpgsign=false'];
const primaRiga = (s) => String(s || '').split(/\r?\n/).find((r) => r.trim()) || '';

/** --root --ramo --main --spec <a,b,…>. PURA. */
export function leggiArgomenti(argv) {
  const out = { root: '', ramo: '', main: '', spec: [], errori: [] };
  const a = Array.isArray(argv) ? argv : [];
  for (let i = 0; i < a.length; i++) {
    const k = String(a[i]);
    if (!['--root', '--ramo', '--main', '--spec'].includes(k)) { out.errori.push(`argomento sconosciuto: ${k.slice(0, 60)}`); continue; }
    const v = String(a[i + 1] ?? '');
    i++;
    if (k === '--spec') out.spec = v.split(',').map((s) => s.trim()).filter(Boolean);
    else out[k.slice(2)] = v;
  }
  if (!out.root) out.errori.push('manca --root');
  for (const k of ['ramo', 'main']) {
    out[k] = out[k].toLowerCase();
    if (!SHA.test(out[k])) out.errori.push(`--${k} dev'essere uno sha intero`);
  }
  if (out.spec.length > TETTO_SPEC) out.errori.push(`troppi spec: ${out.spec.length}, il tetto è ${TETTO_SPEC}`);
  const storti = out.spec.filter((s) => !NOME.test(s));
  if (storti.length) out.errori.push(`nomi di spec non validi (${storti.length}): ${storti.slice(0, 3).map((s) => s.slice(0, 40)).join(', ')}`);
  return out;
}

/** Il campo della parte dal verdetto della suite. PURA. */
export function campoDaVerdetto({ ramo, main, v, chiesti, provati }) {
  const conta = { specChiesti: chiesti, specProvati: provati };
  if (!v.nuovi.length) return { ramo, main, esito: 'verde', mainSha: main, ...conta };
  const rossi = v.nuovi.map((c) => (c.spec && !c.spec.startsWith('(') ? `tests/${c.spec}.spec.mjs › ${c.titolo}` : String(c.titolo || '')).slice(0, 280));
  const out = { ramo, main, esito: 'rosso_sulla_fusione', mainSha: main, rossi: rossi.slice(0, TETTO_ROSSI), ...conta };
  if (rossi.length > TETTO_ROSSI) out.altriRossi = rossi.length - TETTO_ROSSI;
  return out;
}

function gitIn(dir) {
  return (args) => {
    const r = spawnSync('git', args, { cwd: dir, encoding: 'utf8' });
    return { ok: r.status === 0, out: `${r.stdout || ''}${r.stderr || ''}` };
  };
}

/** Fonde main nel checkout del ramo (usa e getta) e prova lì gli spec. → il campo della parte. */
export function provaSpec({ root, ramo, main, spec, noti = [], lancia = lanciaPlaywright, scrivi = (s) => console.log(s) }) {
  const git = gitIn(root);
  const base = { ramo, main };
  if (!git(['merge-base', '--is-ancestor', main, ramo]).ok) {
    const fusa = git([...IDENTITA, 'merge', '--no-ff', '--no-edit', '--quiet', main]);
    if (!fusa.ok) {
      const u = git(['diff', '--name-only', '--diff-filter=U']);
      const file = u.ok ? u.out.split(/\r?\n/).filter(Boolean) : [];
      if (file.length) return { ...base, esito: 'conflitto', mainSha: main, file, specChiesti: spec.length };
      return { ...base, esito: 'non_provata', motivo: `fusione di prova non riuscita (${primaRiga(fusa.out)})` };
    }
  }
  // Uno spec che main ha tolto non c'è più sulla fusione: non si prova, e si conta fra i chiesti.
  const file = spec.map((s) => `tests/${s}.spec.mjs`).filter((f) => existsSync(join(root, f)));
  scrivi(`▸ Spec sulla fusione con main ${main.slice(0, 8)}: ${file.length} di ${spec.length} chiesti`);
  if (!file.length) return { ...base, esito: 'verde', mainSha: main, specChiesti: spec.length, specProvati: 0 };
  const l = lancia(root, file);
  if (l.errore) return { ...base, esito: 'non_provata', motivo: l.errore };
  return campoDaVerdetto({ ramo, main, v: verdetto(l.json, noti), chiesti: spec.length, provati: file.length });
}

function lanciaPlaywright(root, file) {
  const out = join(mkdtempSync(join(tmpdir(), 'filo-spec-')), 'esito.json');
  const cli = join(root, 'node_modules', '@playwright', 'test', 'cli.js');
  if (!existsSync(cli)) return { errore: 'Playwright non è installato nel ramo' };
  const r = spawnSync(process.execPath, [cli, 'test', '--reporter=list,json', ...file], {
    cwd: root, stdio: ['ignore', 'inherit', 'inherit'], timeout: 150 * 60 * 1000,
    env: { ...process.env, PLAYWRIGHT_JSON_OUTPUT_NAME: out, ELECTRON_DISABLE_SANDBOX: '1' },
  });
  if (r.error) return { errore: `Playwright non è partito (${r.error.message})` };
  try { return { json: JSON.parse(readFileSync(out, 'utf8')) }; } catch (_) {
    return { errore: `Playwright è uscito con ${r.status} senza l'esito in JSON` };
  }
}

function leggiNoti(strumenti) {
  try {
    const j = JSON.parse(readFileSync(join(strumenti, 'tests', 'rossi-noti.json'), 'utf8'));
    return Array.isArray(j?.contenitore?.specs) ? j.contenitore.specs : [];
  } catch (_) { return []; }
}

function main() {
  const a = leggiArgomenti(process.argv.slice(2));
  const campo = a.errori.length
    ? { ramo: a.ramo, main: a.main, esito: 'non_provata', motivo: a.errori.join('; ').slice(0, 300) }
    : provaSpec({ root: resolve(a.root), ramo: a.ramo, main: a.main, spec: a.spec, noti: leggiNoti(resolve(fileURLToPath(import.meta.url), '..', '..')) });
  const json = JSON.stringify(campo);
  console.log(`${MARCA_PARTE} spec ${json}`);
  if (process.env.GITHUB_OUTPUT) {
    try { appendFileSync(process.env.GITHUB_OUTPUT, `campo=${json}\n`, 'utf8'); } catch (e) {
      console.error(`spec-fusione-azione: non riesco a scrivere l'esito della parte (${e.message})`);
      process.exit(2);
    }
  }
  process.exit(0);
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) main();

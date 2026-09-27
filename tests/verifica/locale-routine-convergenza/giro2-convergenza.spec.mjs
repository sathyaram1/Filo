// Prove del giro 2 (verifica locale) sul lavoro «routine che convergono»: porte nuove, tutte chiuse.
// Non aprono Filo: si usano gli strumenti del giro come li usa l'owner (verifica locale in un repo di prova,
// risposta di dispatch, rapporto di sessione).

import { test, expect } from '@playwright/test';
import { execFile, execFileSync } from 'node:child_process';
import http from 'node:http';
import { createRequire } from 'node:module';
import { writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { cartellaTemporanea } from '../../helpers/percorsi.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const require = createRequire(import.meta.url);
require(resolve(ROOT, 'src', 'shared', 'verifierRound.js'));
const R = globalThis.SN_VERIFIER_ROUND;
const CAPS = { cap3: 5, cap2: 4, cap1: 2, cap0: 0 };
const RIASSUNTO = 'Provato tutto nel repo di prova: il cammino principale funziona, e anche il resto delle cose.';
const REPORT = 'Ho corretto il rilievo interno lieve indicato nella critica, lasciando stare gli altri messi da parte o esterni.';

const git = (args, cwd) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

async function serverBilanci(caps) {
  const fields = {};
  for (const [k, v] of Object.entries(caps)) fields[k] = { integerValue: String(v) };
  const srv = http.createServer((_q, r) => { r.setHeader('content-type', 'application/json'); r.end(JSON.stringify({ fields })); });
  await new Promise((ok) => srv.listen(0, '127.0.0.1', ok));
  return srv;
}

function repoDiProva() {
  const dir = cartellaTemporanea('verifica-convergenza-2-');
  git(['init', '-q', '-b', 'main'], dir);
  git(['config', 'user.email', 'prova@example.com'], dir);
  git(['config', 'user.name', 'prova'], dir);
  writeFileSync(join(dir, '.gitignore'), '.claude/verify-local.json\n');
  writeFileSync(join(dir, 'a.txt'), 'a\n');
  git(['add', '-A'], dir);
  git(['commit', '-qm', 'init'], dir);
  git(['checkout', '-qb', 'claude/prova'], dir);
  writeFileSync(join(dir, 'b.txt'), 'b\n');
  git(['add', '-A'], dir);
  git(['commit', '-qm', 'lavoro'], dir);
  return dir;
}

// Asincrono: il server finto dei bilanci gira in questo stesso processo.
function verifyLocal(dir, port, args) {
  return new Promise((ok) => {
    execFile(process.execPath, [resolve(ROOT, 'scripts', 'verify-local.mjs'), ...args], {
      cwd: dir,
      encoding: 'utf8',
      env: { ...process.env, FILO_REPO_ROOT: dir, FILO_ADMIN_ID_TOKEN: 'finto', FILO_ROUTINE_CONFIG_URL: `http://127.0.0.1:${port}/config` },
    }, (err, stdout, stderr) => ok({ code: err ? err.code : 0, out: `${stdout}\n${stderr}` }));
  });
}

test('un vicino che chiede una decisione esce da solo, i rimasti del giro insieme', () => {
  const d = R.decideRound({
    findings: R.parseFindings(`${RIASSUNTO}\n[3v?] vicino da decidere\n[1i] lieve a bilancio finito\n[2v] vicino di due`).findings,
    caps: CAPS,
    counts: { count1: 2 },
  });
  expect(d.stop).toBe(false);
  expect(d.fix).toEqual([]);
  expect(R.derivedGroups(d).map((g) => [g.tipo, g.priority, g.findings.map(R.findingTag)])).toEqual([
    ['decisione', 3, ['[3v?]']], ['rimasti', 2, ['[1i]', '[2v]']],
  ]);
});

test('più giri: il pass elenca esterni e domande dei giri prima, e un solo feedback dei rimasti', async () => {
  // Cinque chiamate alla verifica locale, e ognuna ne lancia altre a git: il tetto di serie non basta.
  test.setTimeout(300_000);
  const srv = await serverBilanci(CAPS);
  try {
    const dir = repoDiProva();
    const port = srv.address().port;
    expect((await verifyLocal(dir, port, ['start', 'richiesta di prova per il repo di prova'])).code).toBe(0);
    const r1 = await verifyLocal(dir, port, ['critica', `${RIASSUNTO}\n[1i] interno lieve\n[1i?] scelta di gusto\n[3e] esterno grave`]);
    expect(r1.code).toBe(0);
    writeFileSync(join(dir, 'c.txt'), 'c\n');
    git(['add', '-A'], dir);
    git(['commit', '-qm', 'correzione'], dir);
    expect((await verifyLocal(dir, port, ['corretto', REPORT])).code).toBe(0);
    expect((await verifyLocal(dir, port, ['start'])).code).toBe(0);
    const r2 = await verifyLocal(dir, port, ['critica', `${RIASSUNTO}\n[0i] cosmetico raro\n[2v] vicino di due`]);
    expect(r2.code).toBe(0);
    expect(r2.out).toContain('verifica superata');
    expect(r2.out).toContain('feedback a parte, priorità 3 (esterno)');
    expect(r2.out).toContain('feedback a parte, priorità 1 (interno, da decidere)');
    expect(r2.out).toContain('un solo feedback per questi 2 rilievi, priorità 2');
  } finally {
    srv.close();
  }
});

test('la risposta di dispatch rimette insieme per numero anche un vicino e un interno', async () => {
  const D = await import(pathToFileURL(resolve(ROOT, 'scripts', 'dispatch.mjs')).href);
  const voci = D.derivatiAperti([
    { num: '#700.1', level: 3, sede: 'e', text: 'esterno grave', priority: 3 },
    { num: '#700.2', level: 1, sede: 'i', text: 'lieve', priority: 1 },
    { num: '#700.2', level: 3, sede: 'v', text: 'vicino grave', priority: 3 },
  ]);
  expect(voci.map((v) => [v.num, v.tipo, v.priority, v.rilievi.length])).toEqual([
    ['#700.1', 'esterno', 3, 1], ['#700.2', 'rimasti', 3, 2],
  ]);
});

test('il rapporto di sessione conta lo sforzo solo dal momento del biglietto', async () => {
  const { generaRapporto } = await import(pathToFileURL(resolve(ROOT, 'scripts', 'session-report.mjs')).href);
  const file = join(cartellaTemporanea('rapporto-sforzo-2-'), 'sessione.jsonl');
  const riga = (id, effort, ts) => JSON.stringify({
    type: 'assistant', timestamp: ts, effort,
    message: { id, model: 'claude-opus-5-5', usage: { input_tokens: 10, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, output_tokens: 5 }, content: [] },
  });
  writeFileSync(file, [riga('a', 'high', '2026-09-27T09:00:00Z'), riga('b', 'xhigh', '2026-09-27T11:00:00Z'), riga('c', 'xhigh', '2026-09-27T11:05:00Z')].join('\n') + '\n');
  const rep = await generaRapporto({ transcript: file, role: 'resolver', since: '2026-09-27T10:00:00Z' });
  expect(rep.effort).toEqual({ xhigh: 2 });
});

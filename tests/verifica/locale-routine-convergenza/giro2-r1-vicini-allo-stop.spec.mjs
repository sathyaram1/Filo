// Giro 2, rilievo 1: a lavoro fermo un vicino è presentato come vicino, non fra i «rilievi interni».
// Si usa la verifica locale in un repo di prova, con un server finto dei bilanci.

import { test, expect } from '@playwright/test';
import { execFile, execFileSync } from 'node:child_process';
import http from 'node:http';
import { createRequire } from 'node:module';
import { writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cartellaTemporanea } from '../../helpers/percorsi.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const require = createRequire(import.meta.url);
require(resolve(ROOT, 'src', 'shared', 'verifierRound.js'));
const R = globalThis.SN_VERIFIER_ROUND;
const CAPS = { cap3: 5, cap2: 4, cap1: 2, cap0: 0 };
const RIASSUNTO = 'Provato tutto nel repo di prova: il cammino principale funziona, e anche il resto delle cose.';
const CRITICA = `${RIASSUNTO}\n[3i?] scelta grave da decidere\n[2v] vicino di due nel file`;

const git = (args, cwd) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

// La riga d'intestazione sopra la riga del rilievo (l'ultima che non è una voce d'elenco).
function intestazioneSopra(testo, voce) {
  const righe = testo.split('\n');
  const i = righe.findIndex((l) => l.includes(voce));
  expect(i, `manca «${voce}» in:\n${testo}`).toBeGreaterThan(0);
  for (let k = i - 1; k >= 0; k -= 1) if (!/^\s*-\s/.test(righe[k])) return righe[k];
  return '';
}

test('nella nota del feedback, a lavoro fermo, il vicino non è contato fra gli interni', () => {
  const findings = R.parseFindings(CRITICA).findings;
  const d = R.decideRound({ findings, caps: CAPS, counts: {} });
  expect(d.stop).toBe(true);
  expect(R.roundNote({ summary: RIASSUNTO, findings, decision: d })).not.toMatch(/altro rilievo interno resta/i);
});

test('nella verifica locale, a lavoro fermo, il vicino non sta sotto «rilievi interni»', async () => {
  const fields = {};
  for (const [k, v] of Object.entries(CAPS)) fields[k] = { integerValue: String(v) };
  const srv = http.createServer((_q, r) => { r.setHeader('content-type', 'application/json'); r.end(JSON.stringify({ fields })); });
  await new Promise((ok) => srv.listen(0, '127.0.0.1', ok));
  try {
    const dir = cartellaTemporanea('verifica-vicini-stop-');
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
    const port = srv.address().port;
    const vl = (args) => new Promise((ok) => {
      execFile(process.execPath, [resolve(ROOT, 'scripts', 'verify-local.mjs'), ...args], {
        cwd: dir,
        encoding: 'utf8',
        env: { ...process.env, FILO_REPO_ROOT: dir, FILO_ADMIN_ID_TOKEN: 'finto', FILO_ROUTINE_CONFIG_URL: `http://127.0.0.1:${port}/config` },
      }, (err, stdout, stderr) => ok({ code: err ? err.code : 0, out: `${stdout}\n${stderr}` }));
    });
    expect((await vl(['start', 'richiesta di prova per il repo di prova'])).code).toBe(0);
    const r = await vl(['critica', CRITICA]);
    expect(r.out).toContain('il lavoro si ferma');
    expect(intestazioneSopra(r.out, '[2v] vicino di due nel file')).not.toMatch(/interni/i);
  } finally {
    srv.close();
  }
});

// Prove del giro 1 (verifica locale) sul lavoro «routine che convergono».
// Non aprono Filo: il lavoro sta negli strumenti del giro, e qui si usano come li usa l'owner
// (verifica locale in un repo di prova, rapporto di sessione su un trascritto, test del collegamento).

import { test, expect } from '@playwright/test';
import { execFileSync, spawnSync } from 'node:child_process';
import http from 'node:http';
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cartellaTemporanea } from '../../helpers/percorsi.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const require = createRequire(import.meta.url);
require(resolve(ROOT, 'src', 'shared', 'verifierRound.js'));
const R = globalThis.SN_VERIFIER_ROUND;
const CAPS = { cap3: 5, cap2: 4, cap1: 2, cap0: 0 };

function giro(testo, { counts = {}, caps = CAPS } = {}) {
  const d = R.decideRound({ findings: R.parseFindings(testo).findings, caps, counts });
  return { d, gruppi: R.derivedGroups(d) };
}

const RIASSUNTO = 'Provato tutto nel repo di prova: il cammino principale funziona, e anche il resto delle cose.';

function git(args, cwd) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

async function serverBilanci(caps) {
  const fields = {};
  for (const [k, v] of Object.entries(caps)) fields[k] = { integerValue: String(v) };
  const srv = http.createServer((_q, r) => { r.setHeader('content-type', 'application/json'); r.end(JSON.stringify({ fields })); });
  await new Promise((ok) => srv.listen(0, '127.0.0.1', ok));
  return srv;
}

function repoDiProva(ramo) {
  const dir = cartellaTemporanea('verifica-convergenza-');
  git(['init', '-q', '-b', 'main'], dir);
  git(['config', 'user.email', 'prova@example.com'], dir);
  git(['config', 'user.name', 'prova'], dir);
  writeFileSync(join(dir, '.gitignore'), '.claude/verify-local.json\n');
  writeFileSync(join(dir, 'a.txt'), 'a\n');
  git(['add', '-A'], dir);
  git(['commit', '-qm', 'init'], dir);
  git(['checkout', '-qb', ramo], dir);
  writeFileSync(join(dir, 'b.txt'), 'b\n');
  git(['add', '-A'], dir);
  git(['commit', '-qm', 'lavoro'], dir);
  return dir;
}

// Asincrono: il server finto dei bilanci gira in questo stesso processo, e una chiamata sincrona lo bloccherebbe.
function verifyLocal(dir, port, args) {
  return new Promise((ok) => {
    execFile(process.execPath, [resolve(ROOT, 'scripts', 'verify-local.mjs'), ...args], {
      cwd: dir,
      encoding: 'utf8',
      env: { ...process.env, FILO_REPO_ROOT: dir, FILO_ADMIN_ID_TOKEN: 'finto', FILO_ROUTINE_CONFIG_URL: `http://127.0.0.1:${port}/config` },
    }, (err, stdout, stderr) => ok({ code: err ? err.code : 0, out: `${stdout}\n${stderr}` }));
  });
}

test.describe('vicini come livello 0', () => {
  test('un vicino grave entra nella correzione che parte per un interno lieve', () => {
    const { d } = giro(`${RIASSUNTO}\n[1i] interno lieve\n[3v] vicino grave`);
    expect(d.stop).toBe(false);
    expect(d.fix.map(R.findingTag)).toEqual(['[1i]', '[3v]']);
    expect(d.consume).toBe('cap1');
  });

  test('da solo un vicino grave non fa partire un giro e non ferma: esce a priorità 3', () => {
    const { d, gruppi } = giro(`${RIASSUNTO}\n[3v] vicino grave`);
    expect(d.stop).toBe(false);
    expect(d.fix).toEqual([]);
    expect(gruppi.map((g) => [g.tipo, g.priority])).toEqual([['rimasti', 3]]);
  });

  test('da solo un vicino fa partire un giro solo col bilancio dei livelli 0', () => {
    const { d } = giro(`${RIASSUNTO}\n[3v] vicino grave`, { caps: { ...CAPS, cap0: 1 } });
    expect(d.fix.map(R.findingTag)).toEqual(['[3v]']);
    expect(d.consume).toBe('cap0');
  });

  test('un vicino accanto a un interno di livello 3 a bilancio finito non ferma di suo', () => {
    const { d } = giro(`${RIASSUNTO}\n[3v] vicino grave`, { counts: { count3: 5 } });
    expect(d.stop).toBe(false);
  });
});

test.describe('accorpamento minimo', () => {
  test('rimasti in un feedback solo, esterni e domande uno per rilievo', () => {
    const { gruppi } = giro(`${RIASSUNTO}\n[1i?] scelta\n[0i] cosmetico\n[2e] esterno\n[3v] vicino\n[2i] due a bilancio finito`, { counts: { count2: 4 } });
    expect(gruppi.map((g) => [g.tipo, g.priority, g.findings.length])).toEqual([
      ['esterno', 2, 1], ['decisione', 1, 1], ['rimasti', 3, 3],
    ]);
  });

  test('dalla verifica locale: il pass elenca un feedback dei rimasti e gli altri a parte', async () => {
    const srv = await serverBilanci(CAPS);
    try {
      const dir = repoDiProva('claude/prova-pass');
      const port = srv.address().port;
      expect(verifyLocal(dir, port, ['start', 'richiesta di prova per il repo di prova']).code).toBe(0);
      const r = verifyLocal(dir, port, ['critica', `${RIASSUNTO}\n[1v] vicino lieve\n[0i] cosmetico raro\n[3e] esterno grave\n[1i?] scelta di gusto\n[2v] vicino di livello due`]);
      expect(r.code).toBe(0);
      expect(r.out).toContain('verifica superata');
      expect(r.out).toContain('un solo feedback per questi 3 rilievi, priorità 2');
      expect(r.out).toContain('feedback a parte, priorità 3 (esterno)');
      expect(r.out).toContain('feedback a parte, priorità 1 (interno, da decidere)');
    } finally {
      srv.close();
    }
  });

  test('il pass dopo una correzione non fatta elenca anche esterni e domande messi da parte prima', async () => {
    const srv = await serverBilanci(CAPS);
    try {
      const dir = repoDiProva('claude/prova-corretto');
      const port = srv.address().port;
      expect(verifyLocal(dir, port, ['start', 'richiesta di prova per il repo di prova']).code).toBe(0);
      const c = verifyLocal(dir, port, ['critica', `${RIASSUNTO}\n[1i] interno lieve da correggere\n[1i?] scelta da fare\n[3e] esterno grave`]);
      expect(c.out).toContain('c\'è da correggere');
      const r = verifyLocal(dir, port, ['corretto', 'Nessuna correzione in questo giro: provo cosa succede senza un commit nuovo dopo la critica.']);
      expect(r.out).toContain('Verifica superata');
      const lista = r.out.slice(r.out.indexOf('Rilievi non corretti'));
      expect(lista).toContain('esterno grave');
      expect(lista).toContain('scelta da fare');
    } finally {
      srv.close();
    }
  });
});

test.describe('sforzo dei lavoratori', () => {
  test('i due lavoratori delle routine dichiarano sforzo xhigh', () => {
    for (const nome of ['routine-worker', 'routine-secaudit']) {
      const testa = readFileSync(resolve(ROOT, '.claude', 'agents', `${nome}.md`), 'utf8').split('---')[1];
      expect(testa).toMatch(/^effort:\s*xhigh\s*$/m);
      expect(testa).toMatch(/^model:\s*opus\s*$/m);
    }
  });

  test('il rapporto di sessione conta lo sforzo dei turni', () => {
    const dir = cartellaTemporanea('rapporto-sforzo-');
    const file = join(dir, 'sessione.jsonl');
    const riga = (id, effort) => JSON.stringify({
      type: 'assistant', timestamp: '2026-09-27T10:00:00.000Z', effort,
      message: { id, model: 'claude-opus-5-5', usage: { input_tokens: 10, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, output_tokens: 5 }, content: [] },
    });
    writeFileSync(file, [riga('m1', 'xhigh'), riga('m1', 'xhigh'), riga('m2', 'xhigh'), riga('m3', 'high')].join('\n') + '\n');
    const out = execFileSync(process.execPath, [resolve(ROOT, 'scripts', 'session-report.mjs'), '--transcript', file, '--role', 'verifier'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    const rep = JSON.parse(out);
    expect(rep.effort).toEqual({ xhigh: 2, high: 1 });
  });
});

test('il test del collegamento simbolico non fa diventare rossa la chiusura', () => {
  const r = spawnSync(process.execPath, ['--test', resolve(ROOT, 'tests', 'unit', 'releasePlatformAlarm.test.mjs')], { encoding: 'utf8' });
  expect(r.status, r.stdout.slice(-2000)).toBe(0);
});

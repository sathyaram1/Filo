// Giro 4, rilievo 1: un fermo della pubblicazione dopo una versione uscita apre un feedback suo, anche se quello
// del fermo precedente è rimasto aperto. Passi veri del lavoro di scelta, main finto con date, GitHub finto.
import { test, expect } from '@playwright/test';
import { execFileSync, spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { cartellaTemporanea } from '../../helpers/percorsi.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const SCELTA = join(ROOT, 'scripts', 'ultima-suite-verde.mjs');
const ORA = Date.now();
const faOre = (ore) => new Date(ORA - ore * 3600e3).toISOString();

// Il server degli allarmi come dice il contratto: un feedback aperto copre le chiavi del suo alarmKeys.
function serverAllarmi() {
  const aperti = [];
  const server = createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      const b = JSON.parse(raw || '{}');
      const keys = Array.isArray(b.keys) ? b.keys : [];
      const coperte = new Set(aperti.flatMap((f) => f.alarmKeys));
      const nuove = keys.filter((k) => !coperte.has(k));
      res.setHeader('Content-Type', 'application/json');
      if (!nuove.length && aperti.length) {
        res.end(JSON.stringify({ ok: true, duplicate: true, num: aperti[0].num, nuove: [], coperte: [] }));
        return;
      }
      const f = { num: `#${900 + aperti.length}`, name: b.name, alarmKeys: nuove };
      aperti.push(f);
      res.end(JSON.stringify({ ok: true, duplicate: false, num: f.num, nuove, coperte: [] }));
    });
  });
  return { server, aperti };
}

const GH_FINTO = `import cp from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { readFileSync } from 'node:fs';
const orig = cp.execFileSync;
cp.execFileSync = function (cmd, args) {
  if (cmd !== 'gh') return orig.apply(this, arguments);
  const percorso = String(args[1] || '');
  for (const r of JSON.parse(readFileSync(process.env.GH_FINTO, 'utf8'))) if (percorso.includes(r.dove)) return JSON.stringify(r.body);
  throw new Error('gh finto: niente per ' + percorso);
};
syncBuiltinESMExports();
`;

function scelta(cartella, regole, api) {
  const fileRegole = join(cartella, 'gh.json');
  writeFileSync(fileRegole, JSON.stringify(regole));
  return new Promise((ok) => {
    const p = spawn(process.execPath, [SCELTA], {
      cwd: join(cartella, 'main'),
      env: {
        ...process.env,
        NODE_OPTIONS: `--import=${pathToFileURL(join(cartella, 'gh-finto.mjs')).href}`,
        GH_FINTO: fileRegole,
        GITHUB_REPOSITORY: 'sathyaram1/Filo',
        GITHUB_OUTPUT: join(cartella, 'output.txt'),
        FILO_ROUTINE_API: api,
        FILO_BUILD_PASSPHRASE: 'prova',
      },
    });
    let out = '';
    p.stdout.on('data', (c) => { out += c; });
    p.stderr.on('data', (c) => { out += c; });
    p.on('close', () => ok(out));
  });
}

const corsa = (sha, ore, conclusion) => ({
  head_sha: sha, conclusion, status: 'completed', event: 'push', head_branch: 'main',
  created_at: faOre(ore + 1), updated_at: faOre(ore), html_url: `https://example.invalid/${sha.slice(0, 7)}`,
});

test('il secondo fermo, dopo una versione uscita, apre un feedback anche col feedback del primo ancora aperto', async () => {
  const cartella = cartellaTemporanea('rilasci-fermi-');
  writeFileSync(join(cartella, 'gh-finto.mjs'), GH_FINTO);
  const main = join(cartella, 'main');
  const git = (...a) => execFileSync('git', ['-C', main, ...a], { encoding: 'utf8' }).trim();
  execFileSync('git', ['init', '-q', '-b', 'main', main]);
  const commit = (ore, msg) => {
    writeFileSync(join(main, 'f.txt'), `${msg}\n`, { flag: 'a' });
    git('add', 'f.txt');
    const quando = `@${Math.round((ORA - ore * 3600e3) / 1000)}`;
    execFileSync('git', ['-C', main, '-c', 'user.name=p', '-c', 'user.email=p@p', 'commit', '-q', '-m', msg], {
      env: { ...process.env, GIT_AUTHOR_DATE: quando, GIT_COMMITTER_DATE: quando },
    });
    return git('rev-parse', 'HEAD');
  };
  commit(260, 'base');
  const v300 = commit(250, 'finish: a via server');
  git('tag', 'v0.2.300', v300);
  const rosso1 = commit(200, 'finish: b via server');
  const v301 = commit(120, 'finish: c via server');
  commit(118, 'release: v0.2.301 [skip ci]');
  const rosso2 = commit(90, 'finish: d via server');
  const testa = commit(60, 'finish: e via server');

  const { server, aperti } = serverAllarmi();
  await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
  const api = `http://127.0.0.1:${server.address().port}`;
  try {
    // Primo fermo: v0.2.300 di 250 ore fa, main alla fusione dopo, rossa.
    git('checkout', '-q', rosso1);
    const primo = await scelta(cartella, [
      { dove: 'suite.yml/runs?branch=main&status=success', body: { workflow_runs: [corsa(v300, 251, 'success')] } },
      { dove: 'suite.yml/runs?branch=main&per_page', body: { workflow_runs: [corsa(rosso1, 199, 'failure')] } },
      { dove: 'releases/tags/v0.2.300', body: { tag_name: 'v0.2.300', published_at: faOre(249) } },
    ], api);
    expect(primo).toContain('Pubblicazione ferma');
    expect(aperti).toHaveLength(1);

    // Il fermo finisce: v0.2.301 esce dal verde di 120 ore fa. Il feedback del primo fermo resta aperto
    // (parcheggiato in attesa dell'owner, come #569). Poi la pubblicazione si ferma di nuovo, per 117 ore.
    git('checkout', '-q', testa);
    git('tag', 'v0.2.301', v301);
    const secondo = await scelta(cartella, [
      { dove: 'suite.yml/runs?branch=main&status=success', body: { workflow_runs: [corsa(v301, 121, 'success')] } },
      { dove: 'suite.yml/runs?branch=main&per_page', body: { workflow_runs: [corsa(testa, 59, 'failure'), corsa(rosso2, 89, 'failure')] } },
      { dove: 'releases/tags/v0.2.301', body: { tag_name: 'v0.2.301', published_at: faOre(117) } },
    ], api);
    expect(secondo).toContain('Pubblicazione ferma');
    // L'owner deve vedere un feedback per questo fermo: quello vecchio parla di un'altra versione, già uscita.
    expect(aperti, `feedback aperti: ${JSON.stringify(aperti.map((f) => f.name))}\n${secondo}`).toHaveLength(2);
  } finally {
    server.close();
  }
});

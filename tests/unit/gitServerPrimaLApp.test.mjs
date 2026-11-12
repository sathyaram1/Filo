// git-server push spedisce prima il ramo dell'app (#1914): la suite del server prova il ramo di Filo con lo stesso nome
// com'è al momento della spinta, e un salvataggio mancato (gancio non partito, file nato da shell) la faceva fallire.

import '../helpers/senzaSessione.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { cartellaTemporanea, togliCartella } from '../helpers/percorsi.mjs';
import { URL_SERVER } from '../../scripts/lib/git-server.mjs';
import { eseguiGitServer, spedisciAppPrimaDelServer } from '../../scripts/routine-channel.mjs';
import { segnaBigliettoFinito, writeTicket } from '../../scripts/lib/routine-ticket.mjs';

const RAMO = 'worker/1914';
const g = (cwd, args) => execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', '-c', 'core.autocrlf=false', ...args],
  { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const suOrigin = (origin, ramo) => {
  try { return g(origin, ['rev-parse', '--verify', '-q', `refs/heads/${ramo}`]); } catch (_) { return ''; }
};

/** Il checkout dell'app sul ramo del lavoro col biglietto B1, un commit mai spedito e un file nato da shell; il clone del server finto. */
function scena() {
  const casa = cartellaTemporanea('filo-git-server-app-');
  const origin = join(casa, 'Filo.git');
  const app = join(casa, 'Filo');
  const server = join(casa, 'filo-security');
  mkdirSync(origin); mkdirSync(app); mkdirSync(join(server, '.git'), { recursive: true });
  g(origin, ['init', '--bare', '-q', '--initial-branch=main']);
  g(app, ['init', '-q', '--initial-branch=main']);
  g(app, ['remote', 'add', 'origin', origin]);
  writeFileSync(join(app, '.gitignore'), '.claude/\n');
  g(app, ['add', '-A']);
  g(app, ['commit', '-q', '-m', 'base']);
  g(app, ['push', '-q', 'origin', 'main']);
  g(app, ['remote', 'set-head', 'origin', 'main']);
  g(app, ['checkout', '-q', '-b', RAMO]);
  writeFileSync(join(app, 'regola.js'), 'export const x = 1;\n');
  g(app, ['add', '-A']);
  g(app, ['commit', '-q', '-m', 'lavoro mai spedito']);
  writeFileSync(join(app, 'generati.json'), '{"x":1}\n');
  writeTicket(app, 'B1');
  return { casa, origin, app, server };
}

const okToken = async () => ({ outcome: 'ok', token: 'ghs_finto' });

test('la spinta del server parte con il ramo dell’app già su origin, file nati da shell compresi', async () => {
  const s = scena();
  try {
    const righe = [];
    let allaSpinta = null;
    const lancia = (argv) => {
      if (argv.includes('get-url')) return { status: 0, stdout: `${URL_SERVER}\n` };
      allaSpinta = { argv, app: suOrigin(s.origin, RAMO) };
      return { status: 0, stdout: '', stderr: '' };
    };
    const exit = await eseguiGitServer({
      azione: 'push', cartella: s.server, ramo: RAMO, biglietto: 'B1', root: s.app, env: {},
      lancia, token: okToken, scrivi: (r) => righe.push(r), eco: () => {},
    });
    assert.equal(exit, 0, righe.join('\n'));
    assert.ok(allaSpinta, 'il ramo del server è partito');
    assert.deepEqual(allaSpinta.argv, ['-C', s.server, 'push', 'origin', `refs/heads/${RAMO}:refs/heads/${RAMO}`]);
    assert.equal(allaSpinta.app, g(s.app, ['rev-parse', 'HEAD']), 'quando parte il server, su origin il ramo dell’app è alla punta della cartella');
    assert.equal(g(s.origin, ['show', `${RAMO}:generati.json`]), '{"x":1}', 'il file nato da shell è nel ramo che la suite del server prova');
    assert.equal(g(s.app, ['status', '--porcelain']), '', 'niente resta fuori dai commit');
    assert.equal(g(s.app, ['log', '-1', '--format=%s']), 'auto: spinta del server — generati.json');
    assert.match(righe.join('\n'), /committate 1 modifiche rimaste fuori dai commit: generati\.json/);
    assert.match(righe.join('\n'), /ramo dell'app 'worker\/1914' su origin, prima di quello del server/);
  } finally {
    togliCartella(s.casa);
  }
});

test('se il ramo dell’app non arriva su origin il ramo del server non parte, e si dice perché', async () => {
  const s = scena();
  try {
    g(s.app, ['remote', 'set-url', 'origin', join(s.casa, 'non-c-e.git')]);
    const righe = [];
    const spinte = [];
    const lancia = (argv) => {
      if (argv.includes('get-url')) return { status: 0, stdout: `${URL_SERVER}\n` };
      spinte.push(argv);
      return { status: 0 };
    };
    const exit = await eseguiGitServer({
      azione: 'push', cartella: s.server, ramo: RAMO, biglietto: 'B1', root: s.app, env: {},
      lancia, token: okToken, scrivi: (r) => righe.push(r), eco: () => {},
    });
    assert.equal(exit, 1);
    assert.deepEqual(spinte, [], 'nessun git verso il server dopo le letture dell’origin');
    assert.match(righe.join('\n'), /il ramo dell'app 'worker\/1914' NON è arrivato su origin[^]*quello del server non parte/);
    assert.match(righe.join('\n'), /Non spingere a mano/);
  } finally {
    togliCartella(s.casa);
  }
});

test('il ramo dell’app si spedisce solo per una spinta, e solo dopo il sì del server', async () => {
  const casa = cartellaTemporanea('filo-git-server-app-');
  const clone = join(casa, 'filo-security');
  mkdirSync(join(clone, '.git'), { recursive: true });
  try {
    const chiamate = [];
    const app = (dove, b) => { chiamate.push([dove, b]); return { ok: true, skipped: true, reason: 'prova', righe: [] }; };
    const lancia = (argv) => (argv.includes('get-url') ? { status: 0, stdout: URL_SERVER } : { status: 0 });
    const base = { cartella: clone, biglietto: 'B1', root: join(casa, 'Filo'), env: {}, lancia, app, scrivi: () => {}, eco: () => {} };
    assert.equal(await eseguiGitServer({ ...base, azione: 'push', ramo: RAMO, token: async () => ({ outcome: 'refused', reason: 'biglietto_chiuso' }) }), 4);
    assert.equal(await eseguiGitServer({ ...base, azione: 'push', ramo: RAMO, token: async () => ({ outcome: 'fault', reason: 'http_503' }) }), 3);
    for (const azione of ['fetch', 'ls-remote', 'clone']) assert.equal(await eseguiGitServer({ ...base, azione, token: okToken }), 0, azione);
    assert.deepEqual(chiamate, [], 'col no del server, o senza spinta, il ramo dell’app non si tocca');
    assert.equal(await eseguiGitServer({ ...base, azione: 'push', ramo: RAMO, token: okToken }), 0);
    assert.deepEqual(chiamate, [[join(casa, 'Filo'), 'B1']]);
  } finally {
    togliCartella(casa);
  }
});

test('la cartella di un altro biglietto, o di uno finito, non si committa e non si spedisce', () => {
  const s = scena();
  try {
    const altro = spedisciAppPrimaDelServer(s.app, 'B2', { env: {} });
    assert.equal(altro.ok, true);
    assert.equal(altro.skipped, true);
    assert.match(altro.reason, /la cartella è del biglietto B1/);
    assert.ok(segnaBigliettoFinito(s.app, 'B1', 'rilasciato'));
    const finito = spedisciAppPrimaDelServer(s.app, 'B1', { env: {} });
    assert.equal(finito.skipped, true);
    assert.match(finito.reason, /già finito/);
    assert.equal(suOrigin(s.origin, RAMO), '', 'il ramo non è partito');
    assert.match(g(s.app, ['status', '--porcelain']), /generati\.json/, 'il file nato da shell resta dov’era');
  } finally {
    togliCartella(s.casa);
  }
});

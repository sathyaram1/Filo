// Una cartella riusata con lo stato di un giro passato (D-207): i giri dopo hanno consegnato da altre cartelle, e il
// punto fermo locale è un antenato della punta pubblicata. Si parte dalla punta, lo stato vecchio si scarta, e la
// critica si confronta con la punta consegnata a questo biglietto. Il giro vero (dispatch) contro un server finto.

import '../helpers/senzaSessione.mjs';
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn, execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, readFileSync, cpSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cartellaTemporanea, togliCartella } from '../helpers/percorsi.mjs';
import { prepareBranch, lastCheckpoint } from '../../scripts/lib/branch-integrity.mjs';
import { codiceCambiatoDallAvvio } from '../../scripts/lib/codice-fermo.mjs';
import { avvioDellaCritica } from '../../scripts/dispatch.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const ID = 'fid-d207';
const RAMO = 'worker/fid-d207-x';
const CRITICA_OK = 'Provato: aperto, salvato con titolo vuoto e con diecimila caratteri, trascinato e riaperto. Regge, nessun rilievo.';

const git = (cwd, ...a) => execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', ...a],
  { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
function commit(cwd, file, body) {
  writeFileSync(resolve(cwd, file), body, 'utf8');
  git(cwd, 'add', '-A');
  git(cwd, 'commit', '-qm', `add ${file}`);
  return git(cwd, 'rev-parse', 'HEAD');
}
const puntaSuOrigin = (cwd) => git(cwd, 'ls-remote', 'origin', `refs/heads/${RAMO}`).split(/\s+/)[0];

function fintoServer(lavoro) {
  const ricevuti = [];
  const srv = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      let j = {};
      try { j = body ? JSON.parse(body) : {}; } catch (_) {}
      ricevuti.push({ url: req.url, body: j });
      res.setHeader('Content-Type', 'application/json');
      if (req.url.endsWith('/routineWork')) res.end(JSON.stringify(lavoro));
      else if (req.url.includes('config')) res.end(JSON.stringify({ fields: { enabled: { booleanValue: true } } }));
      else if (req.url.includes('routineDeliver') && j.intent === 'verdict') res.end(JSON.stringify({ ok: true, reply: { outcome: 'pass' } }));
      else res.end(JSON.stringify({ ok: true }));
    });
  });
  return new Promise((r) => srv.listen(0, '127.0.0.1', () => r({ srv, ricevuti, port: srv.address().port })));
}

/**
 * Il giro 2 ha lavorato in `casa` (punti fermi A e B) e la cartella è tornata sulla linea principale; con
 * `altroveAvanti` il giro 3 ha corretto il codice da un'altra cartella e spinto C sopra B.
 */
function scena(base, { altroveAvanti = true, stato = {} } = {}) {
  const origin = resolve(base, 'origin.git');
  const casa = resolve(base, 'casa');
  const altrove = resolve(base, 'altrove');
  const dirStato = resolve(base, 'stato');
  for (const d of [casa, altrove, dirStato]) mkdirSync(d, { recursive: true });
  git(base, 'init', '-q', '--bare', '-b', 'main', origin);
  git(casa, 'init', '-q', '-b', 'main');
  // Il default di Git for Windows anche qui, e la regola del repo vero che lo batte: senza, il checkout di dispatch
  // scrive CRLF e il contenuto confrontato sotto è rosso solo su Windows.
  git(casa, 'config', 'core.autocrlf', 'true');
  writeFileSync(resolve(casa, '.gitattributes'), '* text=auto eol=lf\n', 'utf8');
  cpSync(resolve(REPO, 'routines', 'roles'), resolve(casa, 'routines', 'roles'), { recursive: true });
  writeFileSync(resolve(casa, '.gitignore'), '.claude/\n', 'utf8');
  commit(casa, 'segnaposto.txt', 'x\n');
  git(casa, 'remote', 'add', 'origin', origin);
  git(casa, 'push', '-q', '-u', 'origin', 'main');
  git(casa, 'checkout', '-q', '-b', RAMO);
  const A = commit(casa, 'lavoro.js', 'giro 1\n');
  git(casa, 'push', '-q', 'origin', RAMO);
  const B = commit(casa, 'lavoro.js', 'giro 2\n');
  git(casa, 'push', '-q', 'origin', RAMO);
  writeFileSync(resolve(dirStato, `${ID}.json`), JSON.stringify({
    id: ID, branch: RAMO,
    checkpoints: [
      { sha: A, by: 'fixer:checkout', at: '2026-10-29T08:00:00.000Z' },
      { sha: B, by: 'deliver:status', at: '2026-10-29T09:00:00.000Z' },
    ],
    verifierVerdict: 'pass', verifierSha: A,
    ...stato,
  }), 'utf8');
  git(casa, 'checkout', '-q', 'main');

  let C = B;
  if (altroveAvanti) {
    git(altrove, 'clone', '-q', origin, '.');
    git(altrove, 'checkout', '-q', '-b', RAMO, `origin/${RAMO}`);
    C = commit(altrove, 'lavoro.js', 'giro 3: le correzioni\n');
    git(altrove, 'push', '-q', 'origin', RAMO);
  }
  return { casa, dirStato, A, B, C };
}

function esegui(casa, dirStato, port, argv) {
  return new Promise((risolvi) => {
    const p = spawn(process.execPath, [resolve(REPO, 'scripts', 'dispatch.mjs'), ...argv], {
      cwd: casa,
      env: {
        ...process.env,
        FILO_ROUTINE_API: `http://127.0.0.1:${port}`,
        FILO_ROUTINE_CONFIG_URL: `http://127.0.0.1:${port}/config`,
        // Senza queste due il giro lavora sul deposito vero.
        FILO_REPO_ROOT: casa,
        FILO_DISPATCH_STATE_DIR: dirStato,
        FILO_ROUTINES_ENABLED: '1',
        FILO_ROUTINE_TICKET: 'biglietto-di-prova',
        FILO_FEEDBACK_PRIVKEY: '',
        FILO_NO_BEAT: '1',
      },
    });
    let so = ''; let se = '';
    p.stdout.on('data', (c) => { so += c; });
    p.stderr.on('data', (c) => { se += c; });
    p.on('close', (code) => risolvi({ code, so, se }));
  });
}

const LAVORO = {
  ok: true, role: 'verifier', id: ID, num: '#1433', branch: RAMO,
  payload: { role: 'verifier', feedback: { name: 'Editor senza griglia', text: 'La griglia non si toglie.', num: '#1433' } },
};

describe('D-207 — la cartella riusata non riporta il ramo a un giro passato', () => {
  test('punto fermo locale più vecchio della punta: si verifica la punta, lo stato vecchio se ne va, la critica si registra', async () => {
    const base = cartellaTemporanea('filo-giro-passato-');
    const { srv, ricevuti, port } = await fintoServer(LAVORO);
    try {
      const { casa, dirStato, B, C } = scena(base);
      const r = await esegui(casa, dirStato, port, ['--ticket', 'biglietto-di-prova']);
      const json = JSON.parse(r.so.slice(r.so.indexOf('{'), r.so.lastIndexOf('}') + 1) || 'null');
      assert.equal(json && json.role, 'verifier', `il giro doveva consegnare la verifica (uscita ${r.code}): ${r.se}`);
      assert.equal(git(casa, 'rev-parse', 'HEAD'), C, 'chi verifica riceve le correzioni del giro 3, non il punto fermo del giro 2');
      assert.equal(readFileSync(resolve(casa, 'lavoro.js'), 'utf8'), 'giro 3: le correzioni\n');
      assert.equal(puntaSuOrigin(casa), C, 'origin resta sull’ultima consegna');
      assert.equal(git(casa, 'ls-remote', 'origin', 'refs/heads/discarded/*'), '', 'una cartella rimasta indietro non ha niente da parcheggiare');
      assert.match(r.se, /giro passato/, 'il log dice che lo stato locale era di un giro passato');
      assert.ok(r.se.includes(B.slice(0, 12)), 'e quale punto fermo è stato lasciato');

      const st = JSON.parse(readFileSync(resolve(dirStato, `${ID}.json`), 'utf8'));
      assert.deepEqual(st.checkpoints.map((c) => c.sha), [C], 'i punti fermi del giro passato se ne vanno');
      assert.equal(st.verifierSha, '', 'anche l’esito del giro passato');
      assert.equal(st.verifierVerdict, null);
      assert.equal(st.avvio && st.avvio.sha, C, 'l’avvio di questo biglietto è la punta consegnata');
      assert.equal(avvioDellaCritica(st), C);
      assert.deepEqual(codiceCambiatoDallAvvio(avvioDellaCritica(st), casa).cambiati, []);

      const v = await esegui(casa, dirStato, port, ['--record-verifier', ID, CRITICA_OK]);
      assert.equal(v.code, 0, `la critica sulla punta verificata si registra senza riportare indietro il codice: ${v.se}${v.so}`);
      const verdetto = ricevuti.find((x) => x.url.includes('routineDeliver') && x.body.intent === 'verdict');
      assert.ok(verdetto, 'la critica arriva al server');
      assert.equal((verdetto.body.data || {}).sha, C, 'e vale per il commit verificato');
    } finally {
      srv.close();
      togliCartella(base);
    }
  });

  test('punto fermo uguale alla punta: come prima, lo stato resta (la pulizia dopo un «pass» lo consulta)', async () => {
    const base = cartellaTemporanea('filo-giro-passato-');
    const { srv, port } = await fintoServer(LAVORO);
    try {
      const { casa, dirStato, A, B } = scena(base, { altroveAvanti: false, stato: { identityRejects: 1 } });
      const r = await esegui(casa, dirStato, port, ['--ticket', 'biglietto-di-prova']);
      assert.equal(r.code, 0, r.se);
      assert.equal(git(casa, 'rev-parse', 'HEAD'), B);
      assert.doesNotMatch(r.se, /giro passato/);
      const st = JSON.parse(readFileSync(resolve(dirStato, `${ID}.json`), 'utf8'));
      assert.deepEqual(st.checkpoints.map((c) => c.sha), [A, B], 'i punti fermi restano, e il checkout identico non si duplica');
      assert.equal(st.verifierVerdict, 'pass');
      assert.equal(st.verifierSha, A);
      assert.equal(st.identityRejects, 1);
      assert.equal(lastCheckpoint(st), B);
      // Una critica data da un biglietto di prima non toglie il controllo a questo.
      assert.equal(avvioDellaCritica(st), B);
    } finally {
      srv.close();
      togliCartella(base);
    }
  });
});

describe('D-207 — prepareBranch: la punta pubblicata è l’ultima consegna', () => {
  function repo() {
    const base = cartellaTemporanea('filo-giro-passato-pb-');
    const origin = resolve(base, 'origin.git');
    const work = resolve(base, 'work');
    mkdirSync(work, { recursive: true });
    git(base, 'init', '-q', '--bare', '-b', 'main', origin);
    git(work, 'init', '-q', '-b', 'main');
    git(work, 'remote', 'add', 'origin', origin);
    commit(work, 'README.md', 'base\n');
    git(work, 'push', '-q', 'origin', 'main');
    git(work, 'checkout', '-q', '-b', RAMO);
    const vecchio = commit(work, 'lavoro.js', 'giro 2\n');
    git(work, 'push', '-q', 'origin', RAMO);
    return { base, origin, work, vecchio };
  }
  function avantiAltrove(base, origin) {
    const altrove = resolve(base, 'altrove');
    mkdirSync(altrove);
    git(altrove, 'clone', '-q', origin, '.');
    git(altrove, 'checkout', '-q', '-b', RAMO, `origin/${RAMO}`);
    const nuovo = commit(altrove, 'lavoro.js', 'giro 3\n');
    git(altrove, 'push', '-q', 'origin', RAMO);
    return nuovo;
  }

  test('punto fermo più vecchio, cartella ferma lì: avanza alla punta senza parcheggiare niente', () => {
    const { base, origin, work, vecchio } = repo();
    try {
      const nuovo = avantiAltrove(base, origin);
      const r = prepareBranch({ root: work, branch: RAMO, checkpoint: vecchio });
      assert.equal(r.ok, true, r.message);
      assert.equal(r.head, nuovo);
      assert.equal(r.superato, vecchio);
      assert.equal(r.rewritten, null);
      assert.equal(r.discarded, null);
    } finally { togliCartella(base); }
  });

  test('punto fermo più vecchio con commit locali mai spediti sopra: si parte dalla punta e quei commit restano di lato', () => {
    const { base, origin, work, vecchio } = repo();
    try {
      const nuovo = avantiAltrove(base, origin);
      const monco = commit(work, 'meta.txt', 'a metà\n');
      const r = prepareBranch({ root: work, branch: RAMO, checkpoint: vecchio });
      assert.equal(r.ok, true, r.message);
      assert.equal(r.head, nuovo);
      assert.equal(r.superato, vecchio);
      assert.ok(r.discarded);
      assert.equal(git(work, 'rev-parse', r.discarded), monco);
      assert.equal(puntaSuOrigin(work), nuovo, 'origin non si tocca');
    } finally { togliCartella(base); }
  });

  test('punto fermo uguale alla punta: come prima, e il moncone non spedito va di lato', () => {
    const { base, work, vecchio } = repo();
    try {
      const monco = commit(work, 'meta.txt', 'a metà\n');
      const r = prepareBranch({ root: work, branch: RAMO, checkpoint: vecchio });
      assert.equal(r.ok, true, r.message);
      assert.equal(r.head, vecchio);
      assert.equal(r.superato, null);
      assert.equal(git(work, 'rev-parse', r.discarded), monco);
    } finally { togliCartella(base); }
  });
});

describe('D-207 — avvioDellaCritica', () => {
  const punti = [{ sha: 'a'.repeat(40), by: 'fixer:checkout' }, { sha: 'b'.repeat(40), by: 'deliver:status' }];
  test('la punta consegnata a questo biglietto, finché qui non si è data una critica', () => {
    const avvio = { sha: 'c'.repeat(40), ruolo: 'verifier', at: '2026-10-29T15:00:00.000Z' };
    assert.equal(avvioDellaCritica({ checkpoints: punti, avvio }), 'c'.repeat(40), 'non l’ultimo punto fermo locale');
    assert.equal(avvioDellaCritica({ checkpoints: punti, avvio, verifierSha: 'a'.repeat(40) }), 'c'.repeat(40),
      'una critica di un altro biglietto non spegne il controllo');
    assert.equal(avvioDellaCritica({ checkpoints: punti, avvio, verifierSha: 'c'.repeat(40), criticaNelGiro: true }), '');
  });
  test('uno stato senza avvio segue la regola di prima', () => {
    assert.equal(avvioDellaCritica({ checkpoints: punti }), 'b'.repeat(40));
    assert.equal(avvioDellaCritica({ checkpoints: punti, verifierSha: 'b'.repeat(40) }), '');
    assert.equal(avvioDellaCritica(null), '');
  });
});

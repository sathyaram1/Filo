// Un esito vale per la VERSIONE esaminata, non per il nome del ramo (#485).
//
// Il caso: la verifica automatica approva un lavoro, e l'approvazione resta
// valida anche se subito dopo quel lavoro cambia. Il sistema dice «questo
// l'ho controllato» riferendosi a un'etichetta — il ramo — e non a un
// contenuto: è firmare «il documento nella cartella X» invece di «questa
// esatta versione», e basta sostituire il foglio perché la firma resti lì,
// buona, su un contenuto che nessuno ha guardato. Non è teorico: chi lavora
// ha per costruzione il permesso di spingere sul proprio ramo.
//
// Lo stesso difetto era nel cancello di fusione (chiuso il 2026-08-21: si
// fissa la punta una volta sola e si fonde quella) e nella critica della
// verifica funzionale (che porta lo sha dal 2026-09-13). Restava scoperto il
// verdetto del controllo di sicurezza: qui si prova che adesso
//   - parte con lo sha del commit CONTROLLATO, da tutte e due le strade
//     (dispatch --record-secaudit e il canale), senza che nessuno se lo debba
//     ricordare;
//   - non si registra se nella directory c'è qualcosa fuori dai commit (il
//     salvataggio automatico lo committerebbe dopo, spostando la punta);
//   - resta scritto accanto all'esito nello specchio locale, e una correzione
//     se lo porta via insieme all'esito.
//
// Senza il fix: il payload del verdetto non ha nessun campo `sha`, e gli
// assert che lo cercano sono rossi.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { execFile, execFileSync } from 'node:child_process';
import { rmSync, writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cartellaTemporanea } from '../helpers/percorsi.mjs';

const {
  applySecaudit,
  applyVerifierVerdict,
  applyFixed,
  defaultState,
} = await import('../../scripts/dispatch.mjs');

const { esitiDecaduti } = await import('../../scripts/merge-gate.mjs');

const DISPATCH = fileURLToPath(new URL('../../scripts/dispatch.mjs', import.meta.url));
const CANALE = fileURLToPath(new URL('../../scripts/routine-channel.mjs', import.meta.url));
const GATE = fileURLToPath(new URL('../../scripts/merge-gate.mjs', import.meta.url));

// ─── Lo specchio locale: l'esito e il commit che ha esaminato ────────────────

test('lo specchio locale tiene il commit di ogni esito, e una correzione se li porta via', () => {
  const dopoVerifica = applyVerifierVerdict(defaultState('A', 'worker/A'), 'pass', '', 'aaaa1111');
  assert.equal(dopoVerifica.verifierSha, 'aaaa1111', 'la critica vale per il commit provato');

  const dopoAudit = applySecaudit(dopoVerifica, 'pass', 'aaaa1111');
  assert.equal(dopoAudit.secauditVerdict, 'pass');
  assert.equal(dopoAudit.secauditSha, 'aaaa1111', 'il verdetto vale per il commit controllato');

  // Una correzione è contenuto nuovo: gli esiti cadono, e con loro i commit a
  // cui si riferivano. Tenerli vorrebbe dire lasciare in giro la firma di un
  // controllo fatto su un'altra versione.
  const dopoCorrezione = applyFixed(dopoAudit);
  assert.equal(dopoCorrezione.verifierSha, '');
  assert.equal(dopoCorrezione.secauditSha, '');
  assert.equal(dopoCorrezione.secauditVerdict, null);
});

// ─── Le due strade che registrano il verdetto ────────────────────────────────

function fintoServer() {
  const ricevuti = [];
  const srv = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      let j = {};
      try { j = body ? JSON.parse(body) : {}; } catch (_) { /* il test lo scopre dagli assert */ }
      ricevuti.push({ url: req.url, body: j });
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ ok: true, id: 'ID1', num: '#485' }));
    });
  });
  return new Promise((r) => srv.listen(0, '127.0.0.1', () => r({ srv, ricevuti, port: srv.address().port })));
}

/** Un deposito usa-e-getta con un commit e un ramo di lavoro. */
function deposito(prefisso) {
  const dir = cartellaTemporanea(prefisso);
  const g = (args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  g(['init', '-q', '--initial-branch=main']);
  g(['config', 'user.email', 't@t']); g(['config', 'user.name', 't']);
  writeFileSync(resolve(dir, 'a.txt'), 'base\n', 'utf8');
  g(['add', '-A']); g(['commit', '-qm', 'base']); g(['checkout', '-qb', 'worker/485']);
  const punta = () => g(['rev-parse', 'HEAD']).trim();
  return { dir, g, punta };
}

test('dispatch --record-secaudit: il verdetto parte con lo sha del commit controllato, e lo lascia scritto accanto all\'esito', async () => {
  const { srv, ricevuti, port } = await fintoServer();
  const { dir, punta } = deposito('filo-485-dispatch-');
  const fuori = cartellaTemporanea('filo-485-fuori-');
  const statoDir = resolve(fuori, 'stato');
  const NOTA = resolve(fuori, 'nota.md');
  try {
    writeFileSync(NOTA, 'Letto il diff riga per riga: solo un test e un commento. Niente comandi di sistema, niente chiavi, niente regole del database.', 'utf8');
    const env = {
      ...process.env,
      FILO_REPO_ROOT: dir,
      FILO_TOOLS_ROOT: dir,
      FILO_DISPATCH_STATE_DIR: statoDir,
      FILO_NO_BEAT: '1',
      FILO_ROUTINE_TICKET: 'biglietto-finto',
      FILO_ROUTINE_API: `http://127.0.0.1:${port}`,
    };
    // Asincrono: il server finto vive in questo processo, e una spawn
    // bloccante gli toglierebbe il ciclo degli eventi.
    const lancia = (args) => new Promise((r) => execFile(process.execPath, [DISPATCH, ...args], { env, cwd: dir },
      (err, so, se) => r({ status: err ? (err.code ?? 1) : 0, stdout: String(so || ''), stderr: String(se || '') })));

    const atteso = punta();
    const r = await lancia(['--record-secaudit', 'ID1', 'pass', '--nota', NOTA]);
    assert.equal(r.status, 0, `il verdetto doveva partire: ${r.stderr}`);

    const consegna = ricevuti.find((x) => x.url.includes('routineDeliver'));
    assert.ok(consegna, 'il verdetto deve arrivare al server');
    assert.equal(consegna.body.intent, 'secaudit');
    const d = consegna.body.data || {};
    assert.equal(d.verdict, 'pass');
    assert.equal(d.sha, atteso, 'il verdetto porta il commit controllato, non solo il nome del ramo');
    assert.notEqual(d.sha, '', 'un verdetto senza commit torna a essere una firma su una cartella');

    const stato = JSON.parse(readFileSync(resolve(statoDir, 'ID1.json'), 'utf8'));
    assert.equal(stato.secauditSha, atteso, 'lo specchio locale ricorda su cosa è stato dato');
  } finally {
    srv.close();
    rmSync(dir, { recursive: true, force: true });
    rmSync(fuori, { recursive: true, force: true });
  }
});

test('canale deliver secaudit: lo sha lo timbra lo strumento, e resta quello dichiarato se c\'è', async () => {
  const { srv, ricevuti, port } = await fintoServer();
  const { dir, punta } = deposito('filo-485-canale-');
  try {
    const env = { ...process.env, FILO_REPO_ROOT: dir, FILO_TOOLS_ROOT: dir, FILO_NO_BEAT: '1', FILO_ROUTINE_API: `http://127.0.0.1:${port}` };
    const lancia = (args) => new Promise((r) => execFile(process.execPath, [CANALE, ...args], { env, cwd: dir },
      (err, so, se) => r({ status: err ? (err.code ?? 1) : 0, stdout: String(so || ''), stderr: String(se || '') })));

    const atteso = punta();
    const r = await lancia(['deliver', 'biglietto-finto', 'secaudit', '--verdict', 'pass']);
    assert.equal(r.status, 0, `la consegna doveva partire: ${r.stderr}`);
    const primo = ricevuti.find((x) => x.url.includes('routineDeliver'));
    assert.equal((primo.body.data || {}).sha, atteso,
      'la strada del canale timbra lo stesso commit di quella di dispatch: due strade equivalenti, stesso comportamento');

    // Dichiararne uno diverso NON lo sostituisce: può solo confermare la punta
    // vera, come il nome del ramo può solo confermare quello del biglietto.
    // Altrimenti la difesa si spegne scrivendo un argomento in più, e l'esito
    // nasce intestato a un contenuto che qui non c'è (verifica del giro 1).
    const quanti = ricevuti.length;
    const dichiarato = await lancia(['deliver', 'biglietto-finto', 'secaudit', '--verdict', 'fail', '--sha', 'f'.repeat(40)]);
    assert.equal(dichiarato.status, 1, 'un\'impronta dettata deve fermare la consegna');
    assert.match(dichiarato.stderr, /non registrato/);
    assert.equal(ricevuti.length, quanti, 'e il server non deve nemmeno essere chiamato');

    // Dichiarare quello VERO va bene: è una conferma, non una sostituzione.
    const confermato = await lancia(['deliver', 'biglietto-finto', 'secaudit', '--verdict', 'pass', '--sha', atteso]);
    assert.equal(confermato.status, 0, confermato.stderr);
    assert.equal((ricevuti[ricevuti.length - 1].body.data || {}).sha, atteso);
  } finally {
    srv.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

// ─── L'ultimo passo: la richiesta di fusione ────────────────────────────────
//
// Timbrare l'impronta sugli esiti non chiude niente se poi la fusione si
// chiede per NOME del ramo. Il cammino locale (`npm run finish`) da sempre fa
// due cose: si ferma se il contenuto si è mosso dopo il via libera, e dichiara
// a chi fonde su cosa giravano i controlli. Il cammino delle routine non ne
// faceva nessuna delle due (verifica del giro 1 su #485).

test('esitiDecaduti: un via libera dato su un altro commit non vale per questo contenuto', () => {
  const A = 'a'.repeat(40);
  const B = 'b'.repeat(40);
  assert.deepEqual(esitiDecaduti({ verifierSha: A, secauditSha: A }, A), [], 'ramo fermo: niente decade');
  assert.equal(esitiDecaduti({ verifierSha: A, secauditSha: A }, B).length, 2, 'ramo mosso: decadono tutti e due');
  assert.equal(esitiDecaduti({ verifierSha: '', secauditSha: A }, B).length, 1,
    'un esito senza commit scritto accanto non decade: viene da uno strumento vecchio, e a giudicarlo resta il server');
  assert.deepEqual(esitiDecaduti(null, B), [], 'nessuno stato locale: non si inventa un decadimento');
  assert.deepEqual(esitiDecaduti({ secauditSha: A }, ''), [], 'punta sconosciuta: il confronto non si fa qui');
});

test('la fusione: parte dichiarando il commit esaminato, e non parte se il ramo si è mosso dopo', async () => {
  const buste = [];
  const { srv, port } = await (async () => {
    const s = await fintoServer();
    return s;
  })();
  const { dir, g, punta } = deposito('filo-485-fusione-');
  const fuori = cartellaTemporanea('filo-485-fusione-fuori-');
  const statoDir = resolve(fuori, 'stato');
  try {
    // Lo stato del lavoro come lo lascia il dispatcher: il ramo, e il via
    // libera del controllo di sicurezza su un commit preciso.
    const esaminato = punta();
    execFileSync('mkdir', ['-p', statoDir]);
    writeFileSync(resolve(statoDir, 'ID1.json'),
      JSON.stringify({ id: 'ID1', branch: 'worker/485', secauditDone: true, secauditVerdict: 'pass', secauditSha: esaminato }), 'utf8');
    const env = {
      ...process.env,
      FILO_REPO_ROOT: dir,
      FILO_TOOLS_ROOT: dir,
      FILO_DISPATCH_STATE_DIR: statoDir,
      FILO_NO_BEAT: '1',
      FILO_ROUTINE_TICKET: 'biglietto-finto',
      FILO_ROUTINE_API: `http://127.0.0.1:${port}`,
    };
    const lancia = () => new Promise((r) => execFile(process.execPath, [GATE, 'worker/485'], { env, cwd: dir },
      (err, so, se) => r({ status: err ? (err.code ?? 1) : 0, stdout: String(so || ''), stderr: String(se || '') })));

    const primo = await lancia();
    assert.equal(primo.status, 0, `la fusione doveva partire: ${primo.stderr}`);
    const richiesta = buste.find((x) => x.url.includes('routineMerge'));
    assert.ok(richiesta, 'la richiesta deve arrivare al server');
    assert.equal(richiesta.body.sha, esaminato, 'la richiesta dice su quale contenuto giravano i controlli');

    // Il foglio sostituito: chi lavora può spingere sul proprio ramo, e da qui
    // in poi il via libera parla di un contenuto che non c'è più.
    g(['commit', '-q', '--allow-empty', '-m', 'sostituito dopo il via libera']);
    const quante = buste.length;
    const secondo = await lancia();
    assert.equal(secondo.status, 1, 'il ramo si è mosso: la fusione non si chiede');
    assert.match(secondo.stderr, /si è mosso dopo i via libera/);
    assert.equal(buste.length, quante, 'e il server non viene nemmeno chiamato');
  } finally {
    srv.close();
    rmSync(dir, { recursive: true, force: true });
    rmSync(fuori, { recursive: true, force: true });
  }

  async function fintoServer() {
    const s = createServer((req, res) => {
      let body = '';
      req.on('data', (c) => { body += c; });
      req.on('end', () => {
        let j = {};
        try { j = body ? JSON.parse(body) : {}; } catch (_) { /* lo scoprono gli assert */ }
        buste.push({ url: String(req.url || ''), body: j });
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ ok: true, result: 'merged', sha: 'z'.repeat(40) }));
      });
    });
    return new Promise((r) => s.listen(0, '127.0.0.1', () => r({ srv: s, port: s.address().port })));
  }
});

test('la fusione non si chiede con roba fuori dai commit: il salvataggio automatico sposterebbe la punta subito dopo', async () => {
  const buste = [];
  const s = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      buste.push({ url: String(req.url || '') });
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ ok: true, result: 'merged', sha: 'z'.repeat(40) }));
    });
  });
  const port = await new Promise((r) => s.listen(0, '127.0.0.1', () => r(s.address().port)));
  const { dir, punta } = deposito('filo-485-fusione-sporca-');
  const fuori = cartellaTemporanea('filo-485-fusione-sporca-fuori-');
  const statoDir = resolve(fuori, 'stato');
  try {
    execFileSync('mkdir', ['-p', statoDir]);
    writeFileSync(resolve(statoDir, 'ID1.json'),
      JSON.stringify({ id: 'ID1', branch: 'worker/485', secauditDone: true, secauditVerdict: 'pass', secauditSha: punta() }), 'utf8');
    writeFileSync(resolve(dir, 'aggiunto-dopo.js'), 'module.exports = 1;\n', 'utf8');
    const env = {
      ...process.env,
      FILO_REPO_ROOT: dir,
      FILO_TOOLS_ROOT: dir,
      FILO_DISPATCH_STATE_DIR: statoDir,
      FILO_NO_BEAT: '1',
      FILO_ROUTINE_TICKET: 'biglietto-finto',
      FILO_ROUTINE_API: `http://127.0.0.1:${port}`,
    };
    const r = await new Promise((res2) => execFile(process.execPath, [GATE, 'worker/485'], { env, cwd: dir },
      (err, so, se) => res2({ status: err ? (err.code ?? 1) : 0, stderr: String(se || '') })));
    assert.equal(r.status, 1, `doveva fermarsi: ${r.stderr}`);
    assert.match(r.stderr, /fusione non chiesta/);
    assert.equal(buste.length, 0, 'il server non deve nemmeno essere chiamato');
  } finally {
    s.close();
    rmSync(dir, { recursive: true, force: true });
    rmSync(fuori, { recursive: true, force: true });
  }
});

test('lo stato della directory non si può leggere: il verdetto non si registra (il silenzio non vale «pulita»)', async () => {
  const { srv, ricevuti, port } = await fintoServer();
  // Nessun deposito git: git non risponde, e senza quella risposta non si sa
  // per quale commit varrebbe il verdetto.
  const dir = cartellaTemporanea('filo-485-nogit-');
  const statoDir = resolve(dir, 'stato');
  const NOTA = resolve(dir, 'nota.md');
  try {
    writeFileSync(NOTA, 'Letto il diff: niente di sospetto, nessun pattern critico.', 'utf8');
    const env = {
      ...process.env,
      FILO_REPO_ROOT: dir,
      FILO_TOOLS_ROOT: dir,
      FILO_DISPATCH_STATE_DIR: statoDir,
      FILO_NO_BEAT: '1',
      FILO_ROUTINE_TICKET: 'biglietto-finto',
      FILO_ROUTINE_API: `http://127.0.0.1:${port}`,
    };
    const r = await new Promise((res) => execFile(process.execPath, [DISPATCH, '--record-secaudit', 'ID1', 'pass', '--nota', NOTA], { env, cwd: dir },
      (err, so, se) => res({ status: err ? (err.code ?? 1) : 0, stderr: String(se || '') })));
    assert.equal(r.status, 1, `doveva fermarsi: ${r.stderr}`);
    assert.match(r.stderr, /verdetto non registrato/);
    assert.equal(ricevuti.length, 0, 'il server non deve nemmeno essere chiamato');
    assert.equal(existsSync(resolve(statoDir, 'ID1.json')), false, 'e non deve restare niente scritto');
  } finally {
    srv.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

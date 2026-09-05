// Il verificatore che corregge, dal lato dello strumento (feedback #561).
//
// COSA INCHIODA
//   Lanciando il CLI VERO contro un server finto: la critica coi livelli parte
//   STRUTTURATA (findings), con il riassunto, il testo intero e il commit
//   provato; la risposta del server con la fase 2 viene STAMPATA intera (è
//   l'unico posto da cui il verificatore riceve le istruzioni della
//   correzione); lo specchio locale dice "sta correggendo". Poi la consegna
//   `fixed` dallo stesso verificatore parte col report e viene sigillata come
//   sua. Un controllo sulle sole funzioni non vedrebbe un campo scartato dalla
//   riga di comando, che è già successo una volta.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { execFile, execFileSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** Server finto: risponde alla consegna della critica con la fase 2. */
function fintoServer(replyFor) {
  const ricevuti = [];
  const srv = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      let j = {};
      try { j = body ? JSON.parse(body) : {}; } catch (_) {}
      ricevuti.push({ url: req.url, body: j });
      res.setHeader('Content-Type', 'application/json');
      const reply = req.url.includes('routineDeliver') ? replyFor(j) : {};
      res.end(JSON.stringify(Object.assign({ ok: true }, reply)));
    });
  });
  return new Promise((r) => srv.listen(0, '127.0.0.1', () => r({ srv, ricevuti, port: srv.address().port })));
}

function esegui(argv, env) {
  return new Promise((r) => {
    execFile(process.execPath, [resolve(REPO, 'scripts', 'dispatch.mjs'), ...argv], { env: { ...process.env, ...env } },
      (err, so, se) => r({ code: err ? (err.code ?? 1) : 0, so: String(so || ''), se: String(se || '') }));
  });
}

/** Un deposito git posizionato sul ramo del lavoro, con lo stato locale del giro. */
function casaSulRamo() {
  const casa = mkdtempSync(resolve(tmpdir(), 'filo-verif-corregge-'));
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: casa });
  execFileSync('git', ['config', 'user.email', 't@t'], { cwd: casa });
  execFileSync('git', ['config', 'user.name', 't'], { cwd: casa });
  writeFileSync(resolve(casa, 'segnaposto.txt'), 'x', 'utf8');
  execFileSync('git', ['add', '-A'], { cwd: casa });
  execFileSync('git', ['commit', '-qm', 'init'], { cwd: casa });
  execFileSync('git', ['checkout', '-q', '-b', 'worker/901'], { cwd: casa });
  mkdirSync(resolve(casa, 'stato'), { recursive: true });
  writeFileSync(resolve(casa, 'stato', 'fid-901.json'), JSON.stringify({ id: 'fid-901', branch: 'worker/901', verifierVerdict: null }), 'utf8');
  const sha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: casa, encoding: 'utf8' }).trim();
  return { casa, sha };
}

const ENV = (casa, port) => ({
  FILO_ROUTINE_API: `http://127.0.0.1:${port}`,
  FILO_REPO_ROOT: casa,
  FILO_DISPATCH_STATE_DIR: resolve(casa, 'stato'),
  FILO_ROUTINES_ENABLED: '1',
  FILO_ROUTINE_TICKET: 'biglietto-di-prova',
  FILO_ROUTINE_ROLE: 'verifier',
  FILO_NO_BEAT: '1',
});

test('la critica parte strutturata e la fase 2 del server viene stampata; poi la consegna del verificatore', async () => {
  const { casa, sha } = casaSulRamo();
  const { srv, ricevuti, port } = await fintoServer((j) => (j.intent === 'verdict'
    ? { reply: { outcome: 'fix', phase2: {
      findings: [{ level: 2, text: 'il pulsante non salva', decision: false }],
      derived: [{ level: 0, text: 'caso raro', decision: false }],
      budgets: { cap2: { cap: 5, used: 1, left: 4 } },
      instructions: 'FASE 2 — SEGRETO DEL SERVER: correggi solo questo.',
    } } }
    : {}));
  try {
    const r = await esegui([
      '--record-verifier', 'fid-901',
      'Provato: incolla, trascina. Funziona.\n[2] il pulsante non salva\n    Passi: titolo vuoto, Salva.\n[0] caso raro',
    ], ENV(casa, port));
    assert.equal(r.code, 0, `la critica doveva essere accettata (stderr: ${r.se})`);

    const consegna = ricevuti.find((x) => x.url.includes('routineDeliver'));
    assert.ok(consegna, 'la critica deve arrivare al server');
    assert.equal(consegna.body.intent, 'verdict');
    const d = consegna.body.data || {};
    assert.deepEqual(d.findings.map((f) => [f.level, f.decision]), [[2, false], [0, false]], 'i rilievi arrivano STRUTTURATI, coi livelli');
    assert.match(d.findings[0].text, /Passi: titolo vuoto/, 'la continuazione resta attaccata al suo rilievo');
    assert.match(String(d.summary), /Provato: incolla/, 'il riassunto viaggia a parte');
    assert.match(String(d.critique), /\[2\] il pulsante non salva/, 'la critica intera, com\'è stata scritta');
    assert.equal(d.sha, sha, 'il commit provato: il pass vale per quello');
    assert.equal(d.verdict, undefined, 'nessun verdetto a tre valori: l\'esito lo decide il server');

    // La fase 2 arriva a schermo intera: è l'unico posto in cui esiste.
    assert.match(r.so, /esito=fix/);
    assert.match(r.so, /SEGRETO DEL SERVER/, 'le istruzioni della fase 2 vengono stampate come arrivano');
    assert.match(r.so, /\[2\] il pulsante non salva/);
    assert.match(r.so, /\[0\] caso raro/);
    assert.match(r.so, /cap2: 4 giri residui su 5/);

    // Lo specchio locale dice che il verificatore sta correggendo.
    const stato = JSON.parse(readFileSync(resolve(casa, 'stato', 'fid-901.json'), 'utf8'));
    assert.equal(stato.verifierVerdict, 'fix-pending');

    // Poi la correzione (un commit nuovo) e la consegna, dallo STESSO verificatore.
    writeFileSync(resolve(casa, 'segnaposto.txt'), 'corretto', 'utf8');
    execFileSync('git', ['commit', '-qam', 'correzione'], { cwd: casa });
    const c = await esegui(['--record-fixed', 'fid-901', 'Corretto: il pulsante ora salva anche col titolo vuoto.'], ENV(casa, port));
    assert.equal(c.code, 0, `la consegna doveva riuscire (stderr: ${c.se})`);
    const fixed = ricevuti.filter((x) => x.url.includes('routineDeliver')).at(-1);
    assert.equal(fixed.body.intent, 'fixed');
    assert.match(String(fixed.body.data.report), /ora salva anche col titolo vuoto/);
    const dopo = JSON.parse(readFileSync(resolve(casa, 'stato', 'fid-901.json'), 'utf8'));
    assert.equal(dopo.verifierVerdict, null, 'torna in verifica sul commit nuovo');
    assert.match(JSON.stringify(dopo), /verifier:consegna/, 'sigillata come consegna del verificatore, non del correttore');
  } finally { srv.close(); rmSync(casa, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); }
});

test('la parola del vecchio verdetto è ignorata; senza rilievi la risposta "pass" si stampa e lo stato dice verificato', async () => {
  const { casa } = casaSulRamo();
  const { srv, ricevuti, port } = await fintoServer((j) => (j.intent === 'verdict' ? { reply: { outcome: 'pass', derived: null } } : {}));
  try {
    const r = await esegui(['--record-verifier', 'fid-901', 'pass', 'Provato tutto: regge.'], ENV(casa, port));
    assert.equal(r.code, 0, r.se);
    const d = ricevuti.find((x) => x.url.includes('routineDeliver')).body.data;
    assert.deepEqual(d.findings, [], 'nessun rilievo');
    assert.match(String(d.summary), /Provato tutto/);
    assert.match(r.so, /verifica superata/);
    const stato = JSON.parse(readFileSync(resolve(casa, 'stato', 'fid-901.json'), 'utf8'));
    assert.equal(stato.verifierVerdict, 'pass');
  } finally { srv.close(); rmSync(casa, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); }
});

test('#561 giro 4: una critica scritta male è respinta col messaggio del formato, non con quello della guardia d\'identità; il motivo del server arriva a schermo', async () => {
  const { casa } = casaSulRamo();
  const { srv, ricevuti, port } = await fintoServer(() => ({ __status: 403 }));
  // Il server finto risponde 403 con la frase del rifiuto, come fa quello vero.
  srv.removeAllListeners('request');
  srv.on('request', (req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      ricevuti.push({ url: req.url, body: body ? JSON.parse(body) : {} });
      res.setHeader('Content-Type', 'application/json');
      if (req.url.includes('routineDeliver')) { res.statusCode = 403; res.end(JSON.stringify({ ok: false, reason: 'malformed', detail: 'critica vuota: un pass senza riassunto non è una verifica' })); return; }
      res.end(JSON.stringify({ ok: true }));
    });
  });
  try {
    const male = await esegui(['--record-verifier', 'fid-901', 'Provato.\n[4] gravissimo'], ENV(casa, port));
    assert.equal(male.code, 1, 'si sistema la riga e si rilancia: errore d\'uso');
    assert.match(male.se, /\[4\] gravissimo/);
    assert.doesNotMatch(male.se, /identit|directory non corrisponde/, 'non è un guasto d\'identità');
    assert.equal(ricevuti.filter((x) => x.url.includes('routineDeliver')).length, 0, 'il server non viene chiamato');

    const vuota = await esegui(['--record-verifier', 'fid-901', ''], ENV(casa, port));
    assert.equal(vuota.code, 4);
    assert.match(vuota.se, /malformed: critica vuota/, 'la frase del server arriva a chi ha consegnato');
  } finally { srv.close(); rmSync(casa, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); }
});

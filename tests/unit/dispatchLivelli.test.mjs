// I livelli L3 e L4 nella consegna di dispatch (contratto del 2026-09-13).
//
// Il caso che li ha fatti nascere: in dashboard l'owner vede una fila di forme
// per feedback, e due di quelle (il rombo della segnalazione di chi ha
// lavorato, il pentagono del controllo di sicurezza) restavano grigie perché
// nessuna consegna portava il testo. Qui si prova:
//   - il parsing di `--nota <file>` (puro), e `--segnala` che dal #1790 si rifiuta
//     dicendo di scrivere la domanda in JSON: il server non compone più domande;
//   - la lettura del file: assente, vuoto, oltre il tetto (mai un taglio);
//   - la forma del payload che parte verso il server;
//   - il pass del controllo di sicurezza senza nota, che si ferma PRIMA di
//     consegnare, con cosa scrivere;
//   - `saltato` (l'owner ha saltato L4) che vale come pass nella copia locale.
// Senza il fix tutti questi assert sono rossi: le opzioni non esistevano, e
// `--record-secaudit` con un argomento in più usciva con «argomento non capito».

import '../helpers/senzaSessione.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync, execFile } from 'node:child_process';
import { createServer } from 'node:http';
import { rmSync, existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cartellaTemporanea, togliCartella } from '../helpers/percorsi.mjs';

const TMP = cartellaTemporanea('filo-livelli-');
process.env.FILO_DISPATCH_STATE_DIR = TMP;
process.env.FILO_REPO_ROOT = TMP;
process.env.FILO_TOOLS_ROOT = TMP;

const {
  applySecaudit,
  defaultState,
  secauditPassato,
  leggiOpzioniRegistrazione,
  leggiTestoLivello,
  fixedPayload,
  secauditPayload,
  secauditSenzaNota,
  usageText,
  MAX_LIVELLO_BYTES,
} = await import('../../scripts/dispatch.mjs');

// ─── Parsing delle opzioni ────────────────────────────────────────────────────

test('leggiOpzioniRegistrazione: --segnala non c\'è più, e si dice di scrivere la domanda (#1790)', () => {
  for (const argv of [['--record-fixed', 'ID1', 'il report', '--segnala', 'seg.md', '--frase', 'ciao'], ['--record-verifier', 'ID1', 'critica', '--segnala=seg.md']]) {
    const r = leggiOpzioniRegistrazione(argv);
    assert.match(r.error, /--segnala non c'è più: il server non compone domande/);
    assert.match(r.error, /--domanda <file\.json>/);
  }
  const ok = leggiOpzioniRegistrazione(['--record-fixed', 'ID1', 'il report', '--domanda', 'd.json', '--frase', 'ciao']);
  assert.equal(ok.error, '');
  assert.deepEqual(ok.args, ['--record-fixed', 'ID1', 'il report']);
});

test('leggiOpzioniRegistrazione: senza l\'opzione non cambia niente', () => {
  const r = leggiOpzioniRegistrazione(['--record-secaudit', 'ID1', 'pass']);
  assert.equal(r.error, '');
  assert.deepEqual(r.valori, {});
  assert.deepEqual(r.args, ['--record-secaudit', 'ID1', 'pass']);
});

test('leggiOpzioniRegistrazione: l\'opzione in fondo senza file, o con un flag al posto del file, è un errore', () => {
  assert.match(leggiOpzioniRegistrazione(['--record-fixed', 'ID1', 'rep', '--domanda']).error, /--domanda vuole il percorso/);
  assert.match(leggiOpzioniRegistrazione(['--record-fixed', 'ID1', 'rep', '--domanda', '--frase', 'x']).error, /--domanda vuole il percorso/);
  assert.match(leggiOpzioniRegistrazione(['--record-fixed', 'ID1', 'rep', '--segnala']).error, /--segnala non c'è più/);
  assert.match(leggiOpzioniRegistrazione(['--record-secaudit', 'ID1', 'pass', '--nota', '-h']).error, /--nota vuole il percorso/);
});

test('leggiOpzioniRegistrazione: l\'opzione ripetuta è un errore, non «vince l\'ultima»', () => {
  const r = leggiOpzioniRegistrazione(['--record-fixed', 'ID1', 'rep', '--domanda', 'a.json', '--domanda', 'b.json']);
  assert.match(r.error, /una volta sola/);
});

// ─── Lettura del file ─────────────────────────────────────────────────────────

test('leggiTestoLivello: file assente = errore chiaro col percorso cercato', () => {
  const r = leggiTestoLivello(resolve(TMP, 'non-esiste.md'), 'segnala');
  assert.equal(r.ok, false);
  assert.match(r.message, /non esiste/);
  assert.match(r.message, /non-esiste\.md/);
  assert.match(r.message, /non ho consegnato niente/);
});

test('leggiTestoLivello: il file si legge intero, con gli a capo normalizzati', () => {
  mkdirSync(TMP, { recursive: true });
  const f = resolve(TMP, 'seg.md');
  writeFileSync(f, '## Problema\r\nDue strade.\r\n\r\n## Scelte\r\n- A: veloce ma costa.\r\n- B: lenta, gratis.\r\n', 'utf8');
  const r = leggiTestoLivello(f, 'segnala');
  assert.equal(r.ok, true);
  assert.equal(r.testo, '## Problema\nDue strade.\n\n## Scelte\n- A: veloce ma costa.\n- B: lenta, gratis.');
});

test('leggiTestoLivello: file vuoto (o soli spazi) = errore, non una segnalazione vuota', () => {
  const f = resolve(TMP, 'vuoto.md');
  writeFileSync(f, '   \n\n', 'utf8');
  const r = leggiTestoLivello(f, 'nota');
  assert.equal(r.ok, false);
  assert.match(r.message, /vuoto/);
});

test('leggiTestoLivello: oltre il tetto del server si rifiuta col numero, mai un taglio', () => {
  const f = resolve(TMP, 'lungo.md');
  writeFileSync(f, 'x'.repeat(MAX_LIVELLO_BYTES + 1), 'utf8');
  const r = leggiTestoLivello(f, 'segnala');
  assert.equal(r.ok, false);
  assert.match(r.message, new RegExp(`${MAX_LIVELLO_BYTES + 1} byte`));
  assert.match(r.message, new RegExp(`massimo è ${MAX_LIVELLO_BYTES}`));
  // Al limite esatto passa: il tetto è lo stesso del server (12.000).
  writeFileSync(f, 'x'.repeat(MAX_LIVELLO_BYTES), 'utf8');
  assert.equal(leggiTestoLivello(f, 'segnala').ok, true);
  assert.equal(MAX_LIVELLO_BYTES, 12000);
});

test('leggiTestoLivello: il tetto conta i byte, così una segnalazione in cirillico non sfora il campo cifrato', () => {
  // 7.000 lettere cirilliche sono 14.000 byte: a caratteri passavano, e cifrate
  // superavano i 20.000 che le regole ammettono per il testo di un livello.
  const f = resolve(TMP, 'cirillico.md');
  writeFileSync(f, 'я'.repeat(7000), 'utf8');
  const r = leggiTestoLivello(f, 'nota');
  assert.equal(r.ok, false);
  assert.match(r.message, /14000 byte/);
  writeFileSync(f, 'я'.repeat(MAX_LIVELLO_BYTES / 2), 'utf8');
  assert.equal(leggiTestoLivello(f, 'nota').ok, true);
});

// ─── Forma del payload ────────────────────────────────────────────────────────

test('fixedPayload: senza segnalazione il payload è quello di sempre (nessun campo in più)', () => {
  const p = fixedPayload({ report: 'R', frase: 'F', branch: 'worker/x' });
  assert.deepEqual(p, { report: 'R', userNote: 'F', branch: 'worker/x' });
  assert.equal('segnalazione' in fixedPayload({ report: 'R', segnalazione: '   ' }), false);
});

test('fixedPayload: la segnalazione in markdown non parte più, la domanda sì (#1790)', () => {
  const p = fixedPayload({ report: 'R', frase: '', branch: 'b', segnalazione: '## Problema\nX\n' });
  assert.deepEqual(p, { report: 'R', userNote: '', branch: 'b' });
  const d = { titolo: 'Quale strada?', priorita: 'importante' };
  assert.deepEqual(fixedPayload({ report: 'R', frase: '', branch: 'b', domanda: d }), { report: 'R', userNote: '', branch: 'b', domanda: d });
});

test('secauditPayload: `testo` c\'è solo se la nota c\'è; lo `sha` del commit controllato c\'è sempre', () => {
  assert.deepEqual(secauditPayload({ verdict: 'fail', branch: 'b' }), { verdict: 'fail', branch: 'b', sha: '' });
  assert.deepEqual(secauditPayload({ verdict: 'pass', branch: 'b', sha: 'c0ffee', testo: 'Letto tutto il diff.\n' }),
    { verdict: 'pass', branch: 'b', sha: 'c0ffee', testo: 'Letto tutto il diff.' });
});

// ─── Pass senza nota ──────────────────────────────────────────────────────────

test('secauditSenzaNota: un pass senza nota si ferma e dice cosa scrivere; fail senza nota passa (il server mette la frase standard)', () => {
  const ferma = secauditSenzaNota('pass', '');
  assert.match(ferma, /pass» senza nota/);
  assert.match(ferma, /cosa hai controllato/);
  assert.match(ferma, /--nota <file\.md>/);
  assert.equal(secauditSenzaNota('pass', 'Letto il diff, niente di sospetto.'), '');
  assert.equal(secauditSenzaNota('fail', ''), '');
});

// ─── saltato ──────────────────────────────────────────────────────────────────

test('applySecaudit: `saltato` (l\'owner ha saltato L4) si conserva com\'è e vale come pass', () => {
  const s = applySecaudit(defaultState('A', 'worker/A'), 'saltato');
  assert.equal(s.secauditDone, true);
  assert.equal(s.secauditVerdict, 'saltato', 'non si traveste da pass: è una decisione dell\'owner');
  assert.equal(secauditPassato(s.secauditVerdict), true);
  assert.equal(secauditPassato('pass'), true);
  assert.equal(secauditPassato('fail'), false);
  assert.equal(applySecaudit(defaultState('A', 'x'), 'boh').secauditVerdict, 'fail', 'una parola ignota resta un fail');
});

test('usageText: nomina --domanda e --nota, non più --segnala', () => {
  const u = usageText();
  assert.ok(!u.includes('--segnala'));
  assert.ok(u.includes('--domanda <file.json>'));
  assert.ok(u.includes('--nota <file.md>'));
});

// ─── Riga di comando, per davvero ─────────────────────────────────────────────

test('CLI: pass senza --nota si ferma prima del server; --segnala si rifiuta; con la nota il pass parte', () => {
  const DISPATCH = fileURLToPath(new URL('../../scripts/dispatch.mjs', import.meta.url));
  const sandbox = cartellaTemporanea('filo-livelli-cli-');
  // Stato e nota stanno FUORI dal deposito, come dice la ricetta del ruolo: un
  // file scritto dentro lo sporcherebbe, e il verdetto vale per un commit.
  const fuori = cartellaTemporanea('filo-livelli-fuori-');
  const statoDir = resolve(fuori, 'stato');
  const NOTA = resolve(fuori, 'nota.md');
  try {
    // Un deposito git vero, con un commit: il verdetto del controllo di
    // sicurezza vale per il commit letto, e senza deposito lo strumento
    // rifiuta (non tratta il silenzio di git come «directory pulita»).
    const g = (args) => spawnSync('git', args, { cwd: sandbox, encoding: 'utf8' });
    g(['init', '-q', '--initial-branch=main']);
    g(['config', 'user.email', 't@t']); g(['config', 'user.name', 't']);
    writeFileSync(resolve(sandbox, 'base.txt'), 'base\n', 'utf8');
    g(['add', '-A']); g(['commit', '-qm', 'base']);
    const env = {
      ...process.env,
      FILO_REPO_ROOT: sandbox,
      FILO_TOOLS_ROOT: sandbox,
      FILO_DISPATCH_STATE_DIR: statoDir,
      FILO_NO_BEAT: '1',
      FILO_ROUTINE_TICKET: 'biglietto-finto',
    };
    const lancia = (args) => spawnSync(process.execPath, [DISPATCH, ...args], { env, encoding: 'utf8', cwd: sandbox });
    const nienteScritto = (che) => assert.ok(!existsSync(resolve(statoDir, 'ID1.json')), `${che}: non deve restare niente registrato`);

    // pass nudo: era «argomento non capito»? No: era accettato e partiva senza
    // testo. Adesso si ferma con cosa scrivere.
    const nudo = lancia(['--record-secaudit', 'ID1', 'pass']);
    assert.equal(nudo.status, 1, `pass senza nota deve fermare: ${nudo.stderr}`);
    assert.match(String(nudo.stderr), /pass» senza nota/);
    assert.match(String(nudo.stderr), /--nota <file\.md>/);
    nienteScritto('pass senza nota');

    // --nota su un file che non c'è.
    const assente = lancia(['--record-secaudit', 'ID1', 'pass', '--nota', 'manca.md']);
    assert.equal(assente.status, 1);
    assert.match(String(assente.stderr), /manca\.md non esiste/);
    nienteScritto('nota assente');

    // --nota senza file dopo.
    const monco = lancia(['--record-secaudit', 'ID1', 'fail', '--nota']);
    assert.equal(monco.status, 1);
    assert.match(String(monco.stderr), /--nota vuole il percorso/);

    // Un argomento in più resta un errore (#565), anche con la nota.
    writeFileSync(NOTA, 'Letto il diff riga per riga: solo CSS e un test. Niente di sospetto.', 'utf8');
    const avanzo = lancia(['--record-secaudit', 'ID1', 'pass', 'extra', '--nota', NOTA]);
    assert.equal(avanzo.status, 1);
    assert.match(String(avanzo.stderr), /Argomento non capito: extra/);

    // Con la nota il pass supera i controlli locali e va verso il server (che
    // qui non c'è): l'esito non è più 1.
    const buono = lancia(['--record-secaudit', 'ID1', 'pass', '--nota', NOTA]);
    assert.notEqual(buono.status, 1, `pass con la nota non è un errore d'uso: ${buono.stderr}`);

    // Con qualcosa fuori dai commit il verdetto NON si registra: il
    // salvataggio automatico lo committerebbe dopo, spostando la punta, e
    // nella fusione finirebbero righe mai controllate (feedback #485).
    writeFileSync(resolve(sandbox, 'avanzo.txt'), 'roba di un test\n', 'utf8');
    const sporco = lancia(['--record-secaudit', 'ID1', 'pass', '--nota', NOTA]);
    assert.equal(sporco.status, 1, `col deposito sporco il verdetto deve fermarsi: ${sporco.stderr}`);
    assert.match(String(sporco.stderr), /verdetto non registrato/);
    assert.match(String(sporco.stderr), /\n  avanzo\.txt/, 'elenca cosa c\'è fuori dai commit');
    nienteScritto('verdetto con la directory sporca');
    rmSync(resolve(sandbox, 'avanzo.txt'), { force: true });

    // --segnala non c'è più (#1790): la consegna della correzione si ferma prima di
    // qualunque altra cosa, e dice di scrivere la domanda.
    writeFileSync(resolve(fuori, 'seg.md'), '## Problema\nDue strade.\n', 'utf8');
    const segFixed = lancia(['--record-fixed', 'ID1',
      'Corretto il salvataggio col titolo vuoto: ora il file compare nella lista e resta dopo la riapertura.',
      '--segnala', resolve(fuori, 'seg.md')]);
    assert.equal(segFixed.status, 1);
    assert.match(String(segFixed.stderr), /--segnala non c'è più/);
    nienteScritto('segnalazione');

    // E anche dalla critica.
    const segVer = lancia(['--record-verifier', 'ID1',
      'Provato ad aprire la pagina e a salvare con il titolo vuoto: funziona tutto, non ho trovato niente da segnalare.',
      '--segnala', resolve(fuori, 'seg.md')]);
    assert.equal(segVer.status, 1);
    assert.match(String(segVer.stderr), /--segnala non c'è più/);
  } finally {
    togliCartella(sandbox);
    togliCartella(fuori);
  }
});

// ─── Il canale: deliver status --segnala ──────────────────────────────────────
// Il primo passaggio di chi risolve passa da `routine-channel.mjs deliver
// status`, non da dispatch: senza questa strada il rombo non si accendeva mai
// al primo passaggio. Server finto come in dueTesti.test.mjs: si guarda cosa
// arriva davvero nel corpo della richiesta.

function fintoServer() {
  const ricevuti = [];
  const srv = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      let j = {};
      try { j = body ? JSON.parse(body) : {}; } catch (_) {}
      ricevuti.push({ url: req.url, body: j });
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ ok: true }));
    });
  });
  return new Promise((r) => srv.listen(0, '127.0.0.1', () => r({ srv, ricevuti, port: srv.address().port })));
}

test('canale: deliver --segnala si rifiuta, con o senza file, e non parte niente (#1790)', async () => {
  const CANALE = fileURLToPath(new URL('../../scripts/routine-channel.mjs', import.meta.url));
  const { srv, ricevuti, port } = await fintoServer();
  const casa = cartellaTemporanea('filo-livelli-canale-');
  try {
    const seg = resolve(casa, 'segnala.md');
    writeFileSync(seg, '## Problema\r\nDue strade.\r\n', 'utf8');
    const env = { ...process.env, FILO_ROUTINE_API: `http://127.0.0.1:${port}` };
    // Asincrono, non spawnSync: il server finto vive in QUESTO processo, e
    // una spawn bloccante gli toglie il ciclo degli eventi.
    const lancia = (args) => new Promise((r) => execFile(process.execPath, [CANALE, ...args], { env, cwd: casa },
      (err, so, se) => r({ status: err ? (err.code ?? 1) : 0, stdout: String(so || ''), stderr: String(se || '') })));
    for (const coda of [['--segnala', seg], ['--segnala', 'manca.md'], ['--segnala']]) {
      const r = await lancia(['deliver', 'biglietto-di-prova', 'status', '--status', 'working', '--notes', 'Preso in carico.', ...coda]);
      assert.equal(r.status, 1, coda.join(' '));
      assert.match(r.stderr, /--segnala non c'è più: il server non compone domande/, coda.join(' '));
    }
    assert.equal(ricevuti.length, 0, 'niente deve partire');
  } finally {
    srv.close();
    togliCartella(casa);
  }
});

test('cleanup', () => {
  togliCartella(TMP);
  assert.ok(!existsSync(TMP));
});

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
//     se lo porta via insieme all'esito;
//   - non si detta: dichiararne uno diverso dalla punta vera ferma la
//     consegna, come già succede a chi nomina un ramo diverso da quello del
//     biglietto.
//
// E l'ULTIMO passo del giro, che è quello che conta: la richiesta di fusione
// dichiara il commit esaminato e non parte se il ramo si è mosso dopo i via
// libera, o se nella directory è rimasto qualcosa fuori dai commit. Timbrare
// l'impronta sugli esiti non chiude niente finché la fusione si chiede per
// nome del ramo (verifica del giro 1).
//
// Senza il fix: il payload del verdetto non ha nessun campo `sha`, la
// richiesta di fusione porta solo il nome del ramo, e gli assert che cercano
// il commit sono rossi.

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

const {
  esitiDecaduti,
  testoEsitiDecaduti,
  esitiSenzaCommit,
  testoEsitiSenzaCommit,
  statoPubblicazione,
  testoNonPubblicato,
} = await import('../../scripts/merge-gate.mjs');

const { ricordaEsitoSuCommit, CAMPI_ESITO } = await import('../../scripts/lib/branch-integrity.mjs');
const { absolutizeRecipe } = await import('../../scripts/lib/tools-pin.mjs');

const {
  confermaImpronta,
  testoImprontaDiversa,
  MIN_IMPRONTA_CHARS,
} = await import('../../scripts/routine-channel.mjs');

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

function fintoServer(risposta = { ok: true, id: 'ID1', num: '#485' }) {
  const ricevuti = [];
  const srv = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      let j = {};
      try { j = body ? JSON.parse(body) : {}; } catch (_) { /* il test lo scopre dagli assert */ }
      ricevuti.push({ url: String(req.url || ''), body: j });
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(risposta));
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

test('canale deliver secaudit: lo sha lo timbra lo strumento, e uno dichiarato può solo confermarlo', async () => {
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
  const { srv, ricevuti: buste, port } = await fintoServer({ ok: true, result: 'merged', sha: 'z'.repeat(40) });
  const { dir, g, punta } = deposito('filo-485-fusione-');
  const fuori = cartellaTemporanea('filo-485-fusione-fuori-');
  const statoDir = resolve(fuori, 'stato');
  try {
    // Lo stato del lavoro come lo lascia il dispatcher: il ramo, e il via
    // libera del controllo di sicurezza su un commit preciso.
    const esaminato = punta();
    mkdirSync(statoDir, { recursive: true });
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
});

test('la fusione non si chiede con roba fuori dai commit: il salvataggio automatico sposterebbe la punta subito dopo', async () => {
  const { srv, ricevuti: buste, port } = await fintoServer({ ok: true, result: 'merged', sha: 'z'.repeat(40) });
  const { dir, punta } = deposito('filo-485-fusione-sporca-');
  const fuori = cartellaTemporanea('filo-485-fusione-sporca-fuori-');
  const statoDir = resolve(fuori, 'stato');
  try {
    mkdirSync(statoDir, { recursive: true });
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
    srv.close();
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

// ─── Confermare l'impronta, non ricopiarla ──────────────────────────────────
//
// L'impronta la timbra lo strumento, e una dichiarata può solo confermarla.
// Confermare però vuol dire riconoscere la stessa VERSIONE: gli strumenti
// stampano le impronte accorciate a dodici lettere dappertutto, e git tratta
// la forma corta come il commit intero. Rifiutare chi conferma con quello che
// ha appena letto a schermo era attrito, e il rifiuto si contraddiceva da solo
// («hai dichiarato 1774f56387b9, ma la directory è su 1774f56387b9»: le stesse
// dodici lettere due volte, con dentro scritto che sono diverse). Verifica del
// giro 2 su #485.

test('l\'impronta dichiarata conferma: forma corta e maiuscole sono lo stesso commit, un pezzo troppo corto no', () => {
  const vera = '1774f56387b900993b3fb8101e7b61627f24c331';
  assert.equal(confermaImpronta('', vera).ok, true, 'nessuna impronta dichiarata: non c\'è niente da confermare');
  assert.equal(confermaImpronta(vera, vera).ok, true);
  assert.equal(confermaImpronta(vera.toUpperCase(), vera).ok, true, 'sono lettere esadecimali: la forma non cambia il commit');
  assert.equal(confermaImpronta(vera.slice(0, 12), vera).ok, true, 'la forma corta che gli strumenti stampano è lo stesso commit');
  assert.equal(confermaImpronta(`  ${vera.slice(0, 12)}  `, vera).ok, true, 'spazi da copia-incolla');
  assert.equal(confermaImpronta(vera.slice(0, MIN_IMPRONTA_CHARS), vera).ok, true);

  const corta = confermaImpronta(vera.slice(0, MIN_IMPRONTA_CHARS - 1), vera);
  assert.equal(corta.ok, false, 'sotto il minimo un pezzo combacia anche con commit diversi: non conferma niente');
  assert.equal(corta.motivo, 'troppo_corta');

  const altro = confermaImpronta('f'.repeat(40), vera);
  assert.equal(altro.ok, false, 'un\'altra impronta non si sostituisce a quella vera');
  assert.equal(altro.motivo, 'altro_commit');
  assert.equal(confermaImpronta(vera, '').motivo, 'punta_sconosciuta');
});

test('il rifiuto dell\'impronta non mostra due volte le stesse dodici lettere dicendo che sono diverse', () => {
  const vera = '1774f56387b900993b3fb8101e7b61627f24c331';
  // Due commit diversi che iniziano uguale: accorciare direbbe due volte la
  // stessa cosa e manderebbe chi legge a cercare una differenza che non vede.
  const gemello = `${vera.slice(0, 12)}${'e'.repeat(28)}`;
  const testo = testoImprontaDiversa('verdetto non registrato', gemello, vera, 'altro_commit');
  assert.ok(testo.includes(gemello) && testo.includes(vera), 'quando le forme corte coincidono, le impronte si stampano per intero');

  // Quando invece si distinguono a colpo d'occhio restano accorciate, come
  // ovunque negli strumenti.
  const diverso = testoImprontaDiversa('verdetto non registrato', 'f'.repeat(40), vera, 'altro_commit');
  assert.ok(!diverso.includes(vera), 'impronte che si distinguono restano accorciate');
  assert.match(diverso, /la timbra lo strumento/, 'e il rimedio resta scritto');

  const troppoCorta = testoImprontaDiversa('verdetto non registrato', 'abc', vera, 'troppo_corta');
  assert.match(troppoCorta, /più corto/, 'il motivo vero, non un generico «non combacia»');
  assert.match(troppoCorta, /abc/);
});

// ─── Il rifiuto della fusione dice cosa REGISTRARE ──────────────────────────
//
// Fermare la fusione e basta lascia la notizia su una macchina sola: sul
// canale i due via libera continuano a risultare buoni per quel ramo, che è la
// segnalazione #485 spostata di un passo. Il rifiuto deve nominare il passo che
// la registra, il rientro in verifica, invece di nominare una persona che non
// c'è («chi ha cambiato il ramo lo rimette in verifica»: chi ha cambiato il
// ramo è una sessione ormai chiusa). Verifica del giro 2 su #485.

test('la fusione fermata dal decadimento dice quale passo registrare, col ramo dentro', () => {
  const A = 'a'.repeat(40);
  const B = 'b'.repeat(40);
  const decaduti = esitiDecaduti({ verifierSha: A, secauditSha: A }, B);
  const testo = testoEsitiDecaduti(decaduti, B, 'worker/485-xyz');

  assert.match(testo, /la verifica ha dato l'ok su a{12}/);
  assert.match(testo, /il controllo di sicurezza ha dato l'ok su a{12}/);
  assert.match(testo, /la directory adesso è su b{12}/);
  assert.match(testo, /revision_capability/, 'il passo che registra la decadenza, per nome');
  assert.ok(testo.includes('worker/485-xyz'), 'col ramo dentro: il comando si copia, non si ricostruisce');
  assert.match(testo, /--guasto/, 'e la via d\'uscita se il server rifiuta quel passaggio');
  assert.ok(!/chi ha cambiato il ramo lo rimette in verifica/.test(testo),
    'non si nomina una persona che non esiste al posto di un passo da registrare');
});

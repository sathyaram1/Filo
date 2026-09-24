// #485 giro 2 — l'impronta del contenuto su TUTTE le strade che registrano un
// esito, e la fusione che ne parla fino all'ultimo passo.
//
// Il giro 1 aveva lasciato tre porte aperte: la richiesta di fusione partiva
// per nome del ramo, l'impronta si poteva dettare invece di lasciarla
// timbrare, e l'ultimo passo non guardava se nella directory era rimasto
// qualcosa fuori dai commit. Quelle tre le riprova `giro1-esito-decade`.
//
// Qui si prova quello che il giro 1 non aveva provato:
//   1. il cammino ONESTO deve ancora arrivare in fondo (una difesa che ferma
//      anche chi non ha fatto niente di storto è peggio del buco);
//   2. la VERIFICA FUNZIONALE — l'altro dei due esiti ragionati — porta
//      l'impronta con l'esito; se il contenuto cambia dopo, la mossa la
//      giudica il server (regola del 24/09/2026: il rifiuto locale dettava un
//      rientro in verifica che il server nega a chi chiede la fusione);
//   3. l'impronta non si detta nemmeno sulla strada della verifica funzionale
//      (il giro 1 aveva chiuso solo quella del controllo di sicurezza);
//   4. quando da questa macchina non risulta su quale contenuto è stato dato
//      l'ok, la fusione lo DICE invece di tacerlo.
//
// Il canale vero non si tocca: al suo posto c'è un server finto che registra
// le buste. È esattamente ciò che si vuole guardare — cosa parte da qui.

import { test, expect } from '@playwright/test';
import { createServer } from 'node:http';
import { execFile, execFileSync } from 'node:child_process';
import { rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cartellaTemporanea } from '../../helpers/percorsi.mjs';

const DISPATCH = fileURLToPath(new URL('../../../scripts/dispatch.mjs', import.meta.url));
const CANALE = fileURLToPath(new URL('../../../scripts/routine-channel.mjs', import.meta.url));
const GATE = fileURLToPath(new URL('../../../scripts/merge-gate.mjs', import.meta.url));

/** Un server finto che registra le buste e risponde quello che gli si dice. */
function fintoServer(rispondi) {
  const ricevuti = [];
  const srv = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      let j = {};
      try { j = body ? JSON.parse(body) : {}; } catch (_) { /* lo scoprono gli assert */ }
      ricevuti.push({ url: String(req.url || ''), body: j });
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(rispondi ? rispondi(String(req.url || ''), j) : { ok: true }));
    });
  });
  return new Promise((r) => srv.listen(0, '127.0.0.1', () => r({ srv, ricevuti, port: srv.address().port })));
}

/** Le risposte del giro: consegne accettate, fusione fatta. */
const RISPOSTE = (url) => (url.includes('routineMerge')
  ? { ok: true, result: 'merged', sha: 'x'.repeat(40) }
  : { ok: true, id: 'ID485', num: '#485', reply: { outcome: 'pass' } });

/** Un deposito usa-e-getta con un ramo di lavoro e un commit. */
function deposito(prefisso) {
  const dir = cartellaTemporanea(prefisso);
  const g = (args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  g(['init', '-q', '--initial-branch=main']);
  g(['config', 'user.email', 't@t']);
  g(['config', 'user.name', 't']);
  writeFileSync(resolve(dir, 'a.txt'), 'contenuto esaminato\n', 'utf8');
  g(['add', '-A']);
  g(['commit', '-qm', 'base']);
  g(['checkout', '-qb', 'worker/485']);
  return { dir, g, punta: () => g(['rev-parse', 'HEAD']).trim() };
}

/** Lo stato locale del lavoro, come lo lascia il dispatcher quando assegna. */
function seminaStato(statoDir, id, branch) {
  mkdirSync(statoDir, { recursive: true });
  writeFileSync(resolve(statoDir, `${id}.json`), JSON.stringify({ id, branch }, null, 2) + '\n', 'utf8');
}

function lancia(script, args, env, cwd) {
  return new Promise((r) => execFile(process.execPath, [script, ...args], { env, cwd },
    (err, so, se) => r({ status: err ? (err.code ?? 1) : 0, stdout: String(so || ''), stderr: String(se || '') })));
}

/** L'ambiente di un giro finto, col deposito e la cartella di servizio fuori. */
function ambiente(dir, fuori, port) {
  return {
    ...process.env,
    FILO_REPO_ROOT: dir,
    FILO_TOOLS_ROOT: dir,
    FILO_DISPATCH_STATE_DIR: resolve(fuori, 'stato'),
    FILO_NO_BEAT: '1',
    FILO_ROUTINE_TICKET: 'biglietto-finto',
    FILO_ROUTINE_API: `http://127.0.0.1:${port}`,
  };
}

// Una critica vera: riassunto, un rilievo col livello a inizio riga, e i passi.
const CRITICA = [
  'Provato il giro come lo vive chi consegna: esito registrato su un contenuto, contenuto cambiato, fusione chiesta.',
  '[1] Il bordo del riquadro resta grigio freddo.',
  '    Passi: apri la scheda, guarda il bordo in tema chiaro.',
].join('\n');

test('il cammino onesto arriva in fondo: niente si è mosso, la fusione parte e dichiara il contenuto', async () => {
  const { srv, ricevuti, port } = await fintoServer(RISPOSTE);
  const { dir, punta } = deposito('filo-485-onesto-');
  const fuori = cartellaTemporanea('filo-485-onesto-fuori-');
  try {
    const NOTA = resolve(fuori, 'nota.md');
    writeFileSync(NOTA, 'Letto il diff riga per riga: nessun comando di sistema, nessuna chiave, nessuna regola del database toccata.', 'utf8');
    seminaStato(resolve(fuori, 'stato'), 'ID485', 'worker/485');
    const env = ambiente(dir, fuori, port);

    const esaminato = punta();
    const verdetto = await lancia(DISPATCH, ['--record-secaudit', 'ID485', 'pass', '--nota', NOTA], env, dir);
    expect(verdetto.status, verdetto.stderr).toBe(0);

    // Niente è cambiato: la fusione deve partire. Una difesa che ferma anche
    // chi non ha fatto niente di storto blocca ogni giro, ed è un danno più
    // grande del buco che chiude.
    const gate = await lancia(GATE, ['worker/485'], env, dir);
    expect(gate.status, `${gate.stdout}\n${gate.stderr}`).toBe(0);
    const richiesta = ricevuti.find((x) => x.url.includes('routineMerge'));
    expect(richiesta, 'la fusione non è nemmeno stata chiesta').toBeTruthy();
    expect(String(richiesta?.body?.sha || ''),
      'la richiesta di fusione non dichiara il commit').toBe(esaminato);
  } finally {
    srv.close();
    rmSync(dir, { recursive: true, force: true });
    rmSync(fuori, { recursive: true, force: true });
  }
});

test('anche la verifica funzionale vale per il contenuto: registrata su uno, la fusione si ferma se il ramo si è mosso', async () => {
  const { srv, ricevuti, port } = await fintoServer(RISPOSTE);
  const { dir, g, punta } = deposito('filo-485-verifica-');
  const fuori = cartellaTemporanea('filo-485-verifica-fuori-');
  try {
    seminaStato(resolve(fuori, 'stato'), 'ID485', 'worker/485');
    const env = ambiente(dir, fuori, port);

    const provato = punta();
    const critica = await lancia(DISPATCH, ['--record-verifier', 'ID485', CRITICA], env, dir);
    expect(critica.status, critica.stderr).toBe(0);

    // L'esito della verifica funzionale parte con l'impronta del contenuto
    // provato, come quello del controllo di sicurezza.
    const consegna = ricevuti.find((x) => x.url.includes('routineDeliver'));
    expect(String(consegna?.body?.data?.sha || ''),
      'la critica è partita senza dire su quale contenuto è stata fatta').toBe(provato);

    // Il foglio viene sostituito dopo il via libera.
    writeFileSync(resolve(dir, 'a.txt'), 'contenuto MAI guardato da nessuno\n', 'utf8');
    g(['add', '-A']);
    g(['commit', '-qm', 'sostituito dopo la verifica']);
    expect(punta()).not.toBe(provato);

    const gate = await lancia(GATE, ['worker/485'], env, dir);
    const richiesta = ricevuti.find((x) => x.url.includes('routineMerge'));
    expect(!richiesta && gate.status !== 0,
      `la fusione è partita col solo esito della verifica funzionale dato su ${provato.slice(0, 8)} (busta: ${JSON.stringify(richiesta?.body || null)})`).toBe(true);
    expect(`${gate.stdout}\n${gate.stderr}`).toContain('la verifica');
  } finally {
    srv.close();
    rmSync(dir, { recursive: true, force: true });
    rmSync(fuori, { recursive: true, force: true });
  }
});

test('l\'impronta della critica non si detta: o combacia con la directory, o la consegna si ferma', async () => {
  const { srv, ricevuti, port } = await fintoServer(RISPOSTE);
  const { dir, punta } = deposito('filo-485-critica-dettata-');
  try {
    const env = {
      ...process.env,
      FILO_REPO_ROOT: dir,
      FILO_TOOLS_ROOT: dir,
      FILO_NO_BEAT: '1',
      FILO_ROUTINE_API: `http://127.0.0.1:${port}`,
    };
    const vero = punta();
    const r = await lancia(CANALE,
      ['deliver', 'biglietto-finto', 'verdict', '--critique', CRITICA, '--sha', 'f'.repeat(40)], env, dir);
    const busta = ricevuti[ricevuti.length - 1];
    const dichiarato = String(busta?.body?.data?.sha || '');

    // Il nome del RAMO, su questo stesso canale, può solo confermare quello del
    // biglietto. L'impronta del contenuto merita la stessa regola: la timbra lo
    // strumento, e una dichiarata o combacia o ferma la consegna.
    expect(dichiarato === vero || r.status !== 0,
      `la critica è partita per il commit ${dichiarato.slice(0, 12)}, che non è quello della directory (${vero.slice(0, 12)})`).toBe(true);
  } finally {
    srv.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('se da questa macchina non risulta su quale contenuto è stato dato l\'ok, la fusione lo dice invece di tacerlo', async () => {
  const { srv, port } = await fintoServer(RISPOSTE);
  const { dir } = deposito('filo-485-astensione-');
  const fuori = cartellaTemporanea('filo-485-astensione-fuori-');
  try {
    // Nessuno stato locale: è il caso di chi chiede la fusione da un'altra
    // copia del deposito. Il confronto qui non si può fare — e allora va
    // DETTO, perché chi legge il registro non creda che sia stato fatto.
    mkdirSync(resolve(fuori, 'stato'), { recursive: true });
    const env = ambiente(dir, fuori, port);
    const gate = await lancia(GATE, ['worker/485'], env, dir);
    expect(`${gate.stdout}\n${gate.stderr}`,
      'la fusione è partita senza dire che il confronto non l\'ha potuto fare').toMatch(/non ho potuto controllare|non risulta su quale commit/);
  } finally {
    srv.close();
    rmSync(dir, { recursive: true, force: true });
    rmSync(fuori, { recursive: true, force: true });
  }
});

// I due rilievi del giro 2, corretti nello stesso giro: qui restano come
// memoria, così il giro dopo li ritrova provati invece di ripagarli.

test('confermare la versione con la forma corta che gli strumenti stampano non viene respinto', async () => {
  const { srv, ricevuti, port } = await fintoServer(RISPOSTE);
  const { dir, punta } = deposito('filo-485-forma-corta-');
  try {
    const env = {
      ...process.env,
      FILO_REPO_ROOT: dir,
      FILO_TOOLS_ROOT: dir,
      FILO_NO_BEAT: '1',
      FILO_ROUTINE_API: `http://127.0.0.1:${port}`,
    };
    const vero = punta();
    const corto = await lancia(CANALE,
      ['deliver', 'biglietto-finto', 'secaudit', '--verdict', 'pass', '--sha', vero.slice(0, 12)], env, dir);
    expect(corto.status, `una conferma nella forma corta si è vista rispondere:\n${corto.stderr}`).toBe(0);
    expect(String(ricevuti[ricevuti.length - 1]?.body?.data?.sha || ''),
      'e al server arriva comunque l\'impronta intera, timbrata dallo strumento').toBe(vero);

    // Un'altra versione resta un rifiuto: confermare non è sostituire.
    const quanti = ricevuti.length;
    const altra = await lancia(CANALE,
      ['deliver', 'biglietto-finto', 'secaudit', '--verdict', 'pass', '--sha', 'f'.repeat(40)], env, dir);
    expect(altra.status).not.toBe(0);
    expect(ricevuti.length).toBe(quanti);
  } finally {
    srv.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('la fusione fermata perché il ramo si è mosso dice quale passo registrare, non chi chiamare', async () => {
  const { srv, port } = await fintoServer(RISPOSTE);
  const { dir, g, punta } = deposito('filo-485-registrare-');
  const fuori = cartellaTemporanea('filo-485-registrare-fuori-');
  try {
    const NOTA = resolve(fuori, 'nota.md');
    writeFileSync(NOTA, 'Letto il diff: nessun comando di sistema, nessuna chiave, nessuna regola del database toccata.', 'utf8');
    seminaStato(resolve(fuori, 'stato'), 'ID485', 'worker/485');
    const env = ambiente(dir, fuori, port);

    const verdetto = await lancia(DISPATCH, ['--record-secaudit', 'ID485', 'pass', '--nota', NOTA], env, dir);
    expect(verdetto.status, verdetto.stderr).toBe(0);
    writeFileSync(resolve(dir, 'a.txt'), 'contenuto MAI guardato da nessuno\n', 'utf8');
    g(['add', '-A']);
    g(['commit', '-qm', 'sostituito dopo il via libera']);

    const gate = await lancia(GATE, ['worker/485'], env, dir);
    const detto = `${gate.stdout}\n${gate.stderr}`;
    expect(gate.status).not.toBe(0);
    // Fermarsi e basta lascia la notizia su questa macchina: sul canale i due
    // via libera continuano a risultare buoni per questo ramo.
    expect(detto, 'il rifiuto non dice quale passo registra la decadenza').toContain('revision_capability');
    expect(detto, 'il comando deve nominare il ramo, per copiarlo invece di ricostruirlo').toContain('worker/485');
    expect(detto).toContain('--guasto');
    expect(detto, 'nominare una persona che non c\'è non è un passo da registrare')
      .not.toContain('chi ha cambiato il ramo lo rimette in verifica');
    expect(punta()).toBeTruthy();
  } finally {
    srv.close();
    rmSync(dir, { recursive: true, force: true });
    rmSync(fuori, { recursive: true, force: true });
  }
});

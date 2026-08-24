// GLI STRUMENTI DEL GIRO NON VENGONO DAL RAMO SU CUI SI LAVORA.
//
// PERCHÉ QUESTO FILE ESISTE
//   Un giro di routine scarica la versione aggiornata, poi apre il ramo del
//   feedback su cui deve lavorare. Da quel momento ogni file del progetto è
//   quello del ramo: strumenti del giro e ricette dei ruoli compresi.
//
//   Il 24 agosto è costato un'ora di lavoro. Il battito automatico, aggiunto il
//   giorno prima, non esisteva sul ramo del 22: il lavoratore ha eseguito lo
//   strumento vecchio, che quel battito non lo avvia. Nessun errore e nessuna
//   traccia — quel codice semplicemente non fa quella cosa. Quaranta minuti di
//   silenzio, il server ha dato il giro per morto e ne ha acceso un altro
//   sopra, e la consegna è stata rifiutata. Con la correzione già in
//   produzione da un giorno.
//
//   Il controllo che conta è l'ultimo: si costruisce un progetto finto con uno
//   strumento "nuovo" e un ramo che ne contiene uno "vecchio", si apre il ramo,
//   e si guarda quale dei due viene eseguito. Senza la copia fissata esce il
//   vecchio, ed è rosso.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Un percorso alla unix, su Windows, viene ancorato al disco corrente. L'atteso
// si costruisce con la stessa normalizzazione dello strumento, o il controllo
// fallirebbe per il sistema operativo invece che per il codice.
const comeScritto = (p) => resolve(p).split('\\').join('/');

import {
  PINNED_PATHS, TOOLS_ROOT, pinTools, pinnedRepoRoot, absolutizeRecipe,
} from '../../scripts/lib/tools-pin.mjs';

function progettoFinto() {
  const casa = mkdtempSync(resolve(tmpdir(), 'filo-strumenti-'));
  // Tutto quello che la copia deve contenere: se qui ne manca un pezzo, il
  // banco di prova diverge dalla produzione e nasconde proprio il guasto che
  // ha bocciato la prima versione (copia incompleta, giro che si ferma).
  for (const p of PINNED_PATHS) {
    if (p.endsWith('.js')) { mkdirSync(dirname(resolve(casa, p)), { recursive: true }); writeFileSync(resolve(casa, p), '', 'utf8'); }
    else mkdirSync(resolve(casa, p), { recursive: true });
  }
  mkdirSync(resolve(casa, 'scripts', 'lib'), { recursive: true });
  mkdirSync(resolve(casa, 'routines', 'roles'), { recursive: true });
  return casa;
}

// ── La copia ───────────────────────────────────────────────────────────────

test('la copia degli strumenti finisce FUORI dal progetto', () => {
  const casa = progettoFinto();
  const dove = resolve(tmpdir(), `filo-strumenti-prova-${process.pid}`);
  try {
    writeFileSync(resolve(casa, 'scripts', 'x.mjs'), 'export const v = "nuovo";\n', 'utf8');
    writeFileSync(resolve(casa, 'routines', 'roles', 'r.md'), 'ricetta\n', 'utf8');
    const r = pinTools(casa, { dest: dove });
    assert.equal(r.ok, true, r.why);
    assert.ok(!resolve(r.dir).startsWith(resolve(casa)),
      'dentro il progetto sarebbe di nuovo soggetta al cambio di ramo');
    for (const p of PINNED_PATHS) assert.ok(existsSync(resolve(r.dir, p)), `manca ${p}`);
  } finally {
    rmSync(dove, { recursive: true, force: true });
    rmSync(casa, { recursive: true, force: true, maxRetries: 5 });
  }
});

test('la copia si ricorda da sola dove sta il progetto', () => {
  // Nessuno deve passarselo di mano in mano: è la stessa scelta del marcatore
  // del biglietto, e per lo stesso motivo.
  const casa = progettoFinto();
  const dove = resolve(tmpdir(), `filo-strumenti-prova2-${process.pid}`);
  try {
    writeFileSync(resolve(casa, 'scripts', 'x.mjs'), 'x\n', 'utf8');
    const r = pinTools(casa, { dest: dove });
    assert.equal(pinnedRepoRoot(r.dir), resolve(casa));
  } finally {
    rmSync(dove, { recursive: true, force: true });
    rmSync(casa, { recursive: true, force: true, maxRetries: 5 });
  }
});

test('strumenti non fissati: nessun progetto da ricordare', () => {
  const casa = progettoFinto();
  try {
    assert.equal(pinnedRepoRoot(casa), '');
  } finally {
    rmSync(casa, { recursive: true, force: true, maxRetries: 5 });
  }
});

test('non si fissa sopra la copia che sta girando', () => {
  // A metà giro il progetto è aperto sul ramo di lavoro: ricopiare da lì
  // sovrascriverebbe gli strumenti buoni con quelli del ramo, cioè il guasto
  // eseguito dalle nostre mani.
  const casa = progettoFinto();
  try {
    const r = pinTools(casa, { dest: TOOLS_ROOT });
    assert.equal(r.ok, true);
    assert.equal(r.why, 'già fissati');
    assert.equal(r.dir, TOOLS_ROOT);
  } finally {
    rmSync(casa, { recursive: true, force: true, maxRetries: 5 });
  }
});

test('una copia vecchia non sopravvive alla nuova', () => {
  // Una copia rimasta lì dal giro prima sarebbe lo stesso difetto con un'altra
  // faccia: strumenti vecchi eseguiti da un giro nuovo.
  const casa = progettoFinto();
  const dove = resolve(tmpdir(), `filo-strumenti-prova3-${process.pid}`);
  try {
    writeFileSync(resolve(casa, 'scripts', 'vecchio.mjs'), 'v\n', 'utf8');
    pinTools(casa, { dest: dove });
    rmSync(resolve(casa, 'scripts', 'vecchio.mjs'));
    writeFileSync(resolve(casa, 'scripts', 'nuovo.mjs'), 'n\n', 'utf8');
    const r = pinTools(casa, { dest: dove });
    assert.ok(existsSync(resolve(r.dir, 'scripts', 'nuovo.mjs')));
    assert.ok(!existsSync(resolve(r.dir, 'scripts', 'vecchio.mjs')),
      'il residuo del giro prima non deve restare in giro');
  } finally {
    rmSync(dove, { recursive: true, force: true });
    rmSync(casa, { recursive: true, force: true, maxRetries: 5 });
  }
});

// ── La regola, non l'elenco ────────────────────────────────────────────────

test('nessuno strumento importa roba che la copia non contiene', async () => {
  // L'elenco di cosa copiare si legge e sembra sempre giusto: è così che è
  // passata la prima versione, senza la configurazione degli accessi. Questo
  // controllo guarda gli IMPORT veri e chiede se ognuno cade dentro la copia.
  // Chi domani aggiunge un import fuori dal recinto lo scopre qui, non in cloud
  // con un giro che si ferma dicendo che è colpa della rete.
  const { readdirSync, statSync } = await import('node:fs');
  const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

  const file = [];
  const cammina = (dir) => {
    for (const n of readdirSync(dir)) {
      const p = resolve(dir, n);
      if (statSync(p).isDirectory()) cammina(p);
      else if (p.endsWith('.mjs') || p.endsWith('.js')) file.push(p);
    }
  };
  cammina(resolve(REPO, 'scripts'));

  const dentro = (p) => PINNED_PATHS.some((q) => {
    const base = resolve(REPO, q);
    return p === base || p.startsWith(base + '\\') || p.startsWith(base + '/');
  });

  const fuori = [];
  for (const f of file) {
    const testo = readFileSync(f, 'utf8');
    // Import e require con percorso relativo che RISALE fuori da scripts/.
    for (const m of testo.matchAll(/(?:from|import|require)\s*\(?\s*['"](\.\.[^'"]*)['"]/g)) {
      const bersaglio = resolve(dirname(f), m[1]);
      if (!dentro(bersaglio)) {
        fuori.push(`${f.slice(REPO.length + 1)} → ${m[1]}`);
      }
    }
  }

  assert.deepEqual(fuori, [],
    `questi strumenti importano roba fuori dalla copia: o si aggiunge il percorso a quelli fissati, o l'import va tolto:\n${fuori.join('\n')}`);
});

test('dalla copia, git continua a parlare col PROGETTO', async () => {
  // La copia non è un deposito git. Uno strumento che dalla copia interroga git
  // per ritrovare le credenziali dell'owner non troverebbe niente, e direbbe
  // "nessuna credenziale" invece di "sto guardando nel posto sbagliato".
  const { spawn } = await import('node:child_process');
  const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
  const finto = mkdtempSync(resolve(tmpdir(), 'filo-progetto-'));
  const dove = resolve(tmpdir(), `filo-strumenti-git-${process.pid}`);

  try {
    execFileSync('git', ['init', '-q'], { cwd: finto, stdio: 'ignore' });
    mkdirSync(resolve(finto, 'tests', 'agent'), { recursive: true });
    writeFileSync(resolve(finto, 'tests', 'agent', '.env'),
      'FILO_ADMIN_REFRESH_TOKEN=segno-del-progetto\n', 'utf8');

    const pin = pinTools(REPO, { dest: dove });
    assert.equal(pin.ok, true, pin.why);
    // La copia punta al progetto finto, come farebbe in cloud.
    writeFileSync(resolve(dove, '.filo-repo-root'), `${finto}\n`, 'utf8');

    const out = await new Promise((fine) => {
      const p = spawn(process.execPath, [
        '--input-type=module', '-e',
        `import { findAdminRefreshToken } from ${JSON.stringify(`file:///${resolve(dove, 'scripts', 'lib', 'firestore-auth.mjs').split('\\').join('/')}`)};
         console.log(String(findAdminRefreshToken()));`,
      ], {
        cwd: dove,
        env: { ...process.env, FILO_ADMIN_REFRESH_TOKEN: '', FILO_SA_KEY: '', GOOGLE_APPLICATION_CREDENTIALS: '' },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let so = ''; let se = '';
      p.stdout.on('data', (c) => { so += c; });
      p.stderr.on('data', (c) => { se += c; });
      p.on('close', () => fine({ so, se }));
    });

    assert.match(out.so, /segno-del-progetto/,
      `dalla copia non ha ritrovato il progetto: ${out.so.trim()} ${out.se.slice(-200)}`);
  } finally {
    rmSync(dove, { recursive: true, force: true, maxRetries: 5 });
    rmSync(finto, { recursive: true, force: true, maxRetries: 5 });
  }
});

// ── Le ricette ─────────────────────────────────────────────────────────────

test('le ricette puntano agli strumenti fissati, non a quelli del ramo', () => {
  // Le ricette dicono `node scripts/…`, che dalla cartella di lavoro porta
  // dritto agli strumenti del ramo: il difetto rientrerebbe dalla porta delle
  // istruzioni anche con la copia in piedi.
  const testo = 'Rilascia con `node scripts/routine-channel.mjs release <biglietto>`.';
  const fuori = absolutizeRecipe(testo, '/tmp/strumenti', '/progetto');
  assert.ok(fuori.includes(`node "${comeScritto('/tmp/strumenti')}/scripts/routine-channel.mjs"`),
    `percorso non riscritto: ${fuori}`);
  assert.ok(!/node scripts\//.test(fuori), 'non deve restare nessun percorso relativo');
});

test('a strumenti NON fissati la ricetta resta quella scritta', () => {
  // In locale gli strumenti sono quelli del progetto: riscrivere i percorsi
  // sarebbe rumore, e renderebbe le ricette illeggibili per chi le mantiene.
  const testo = 'Lancia `node scripts/dispatch.mjs --ticket <b>`.';
  assert.equal(absolutizeRecipe(testo, '/progetto', '/progetto'), testo);
});

test('più comandi nella stessa ricetta vengono riscritti tutti', () => {
  const testo = 'node scripts/a.mjs poi node scripts/lib/b.mjs infine node scripts/c.mjs --x';
  const fuori = absolutizeRecipe(testo, '/t', '/p');
  const base = comeScritto('/t');
  assert.equal(fuori.split(`node "${base}/scripts/`).length - 1, 3);
  assert.ok(fuori.includes(`node "${base}/scripts/lib/b.mjs"`), fuori);
});

// ── Il controllo che conta ─────────────────────────────────────────────────

test('il preflight FISSA gli strumenti e consegna istruzioni che puntano lì', async () => {
  // La giuntura vera: non la funzione che copia, ma il momento del giro in cui
  // viene chiamata. Il preflight è l'unico punto in cui la cartella è ancora
  // sulla versione aggiornata; se la copia non parte da lì non serve a niente.
  const { createServer } = await import('node:http');
  const { spawn } = await import('node:child_process');
  const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

  const srv = createServer((req, res) => {
    let b = ''; req.on('data', (c) => { b += c; });
    req.on('end', () => {
      res.setHeader('Content-Type', 'application/json');
      if (req.url.includes('config')) res.end(JSON.stringify({ fields: { enabled: { booleanValue: true } } }));
      else res.end(JSON.stringify({ ok: true }));
    });
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const port = srv.address().port;
  const dove = resolve(tmpdir(), `filo-strumenti-preflight-${process.pid}`);

  try {
    const out = await new Promise((fine) => {
      const p = spawn(process.execPath, [resolve(REPO, 'scripts', 'dispatch.mjs'), '--preflight'], {
        cwd: REPO,
        env: {
          ...process.env,
          FILO_ROUTINE_API: `http://127.0.0.1:${port}`,
          FILO_ROUTINE_CONFIG_URL: `http://127.0.0.1:${port}/config`,
          FILO_ROUTINES_ENABLED: '1',
          FILO_PREFLIGHT_ANY_BRANCH: '1',
          FILO_TOOLS_DIR: dove,
          FILO_NO_BEAT: '1',
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let so = ''; let se = '';
      p.stdout.on('data', (c) => { so += c; });
      p.stderr.on('data', (c) => { se += c; });
      p.on('close', (code) => fine({ so, se, code }));
    });

    assert.equal(out.code, 0, `il preflight doveva dire che si lavora: ${out.se.slice(-300)}`);
    assert.ok(existsSync(resolve(dove, 'scripts', 'dispatch.mjs')),
      'gli strumenti non sono stati copiati fuori dal progetto');
    assert.ok(existsSync(resolve(dove, 'routines', 'roles', 'orchestrator.md')),
      'anche le ricette dei ruoli devono seguire gli strumenti');
    assert.equal(pinnedRepoRoot(dove), resolve(REPO), 'la copia deve ricordare il progetto');
    // E le istruzioni consegnate devono puntare alla copia, non al progetto.
    assert.ok(!/node scripts\//.test(out.so),
      `le istruzioni rimandano ancora agli strumenti del ramo:\n${out.so.slice(0, 400)}`);
    assert.ok(out.so.includes(`${resolve(dove).split('\\').join('/')}/scripts/`),
      'le istruzioni devono nominare la copia');
  } finally {
    srv.close();
    rmSync(dove, { recursive: true, force: true, maxRetries: 5 });
  }
});

test('al lavoratore arrivano le ricette FISSATE, non quelle del ramo', async () => {
  // Il caso di produzione: dispatch gira dalla copia, il progetto è aperto su un
  // ramo vecchio, e le ricette del ramo dicono un'altra cosa. Sono le istruzioni
  // che portano il lavoratore a usare gli strumenti giusti: se tornano indietro
  // loro, torna indietro tutto il resto dietro di loro.
  const { createServer } = await import('node:http');
  const { spawn } = await import('node:child_process');
  const { cpSync } = await import('node:fs');
  const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

  const srv = createServer((req, res) => {
    let b = ''; req.on('data', (c) => { b += c; });
    req.on('end', () => {
      res.setHeader('Content-Type', 'application/json');
      if (req.url.endsWith('/routineWork')) {
        res.end(JSON.stringify({ ok: true, role: 'prober', id: '', num: '', branch: '', payload: { role: 'prober' } }));
      } else if (req.url.includes('config')) {
        res.end(JSON.stringify({ fields: { enabled: { booleanValue: true } } }));
      } else res.end(JSON.stringify({ ok: true }));
    });
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const port = srv.address().port;

  const casa = progettoFinto();
  const dove = resolve(tmpdir(), `filo-strumenti-ricette-${process.pid}`);
  try {
    // Il progetto: strumenti veri (servono a farlo girare) e ricetta AGGIORNATA.
    cpSync(resolve(REPO, 'scripts'), resolve(casa, 'scripts'), { recursive: true });
    writeFileSync(resolve(casa, 'routines', 'roles', 'prober.md'),
      'RICETTA AGGIORNATA\nRilascia con node scripts/routine-channel.mjs release <biglietto>\n', 'utf8');

    // Il giro fissa gli strumenti finché la cartella è ancora aggiornata.
    const pin = pinTools(casa, { dest: dove });
    assert.equal(pin.ok, true, pin.why);

    // Poi si apre il ramo vecchio: da qui il progetto dice un'altra cosa.
    writeFileSync(resolve(casa, 'routines', 'roles', 'prober.md'), 'RICETTA DI DUE GIORNI FA\n', 'utf8');

    const out = await new Promise((fine) => {
      const p = spawn(process.execPath, [resolve(dove, 'scripts', 'dispatch.mjs'), '--ticket', 'b-prova'], {
        cwd: casa,
        env: {
          ...process.env,
          FILO_ROUTINE_API: `http://127.0.0.1:${port}`,
          FILO_ROUTINE_CONFIG_URL: `http://127.0.0.1:${port}/config`,
          FILO_REPO_ROOT: casa,
          FILO_DISPATCH_STATE_DIR: resolve(casa, 'stato'),
          FILO_ROUTINES_ENABLED: '1',
          FILO_NO_BEAT: '1',
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let so = ''; let se = '';
      p.stdout.on('data', (c) => { so += c; });
      p.stderr.on('data', (c) => { se += c; });
      p.on('close', () => fine({ so, se }));
    });

    assert.match(out.so, /RICETTA AGGIORNATA/,
      `al lavoratore è arrivata la ricetta del ramo:\n${out.so.slice(0, 400)}\n${out.se.slice(-200)}`);
    assert.ok(!out.so.includes('DI DUE GIORNI FA'), 'la ricetta del ramo non deve arrivare mai');
    // E i comandi dentro la ricetta devono portare agli strumenti fissati: un
    // percorso relativo, eseguito dalla cartella di lavoro, tornerebbe dritto
    // agli strumenti del ramo vecchio.
    assert.ok(!out.so.includes('node scripts/'),
      `nella ricetta consegnata resta un percorso relativo: ${out.so.slice(0, 500)}`);
    // Sul nome della cartella e non sul percorso intero: fra forma breve e
    // forma lunga dei percorsi di sistema il confronto fallirebbe per il
    // sistema operativo invece che per il codice.
    assert.ok(out.so.includes(`${basename(dove)}/scripts/routine-channel.mjs`),
      `il comando deve nominare gli strumenti fissati: ${out.so.slice(0, 500)}`);
  } finally {
    srv.close();
    rmSync(dove, { recursive: true, force: true, maxRetries: 5 });
    rmSync(casa, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  }
});

test('la copia SA GIRARE da sola: il preflight lanciato da lì non si guasta', async () => {
  // Il rilievo che ha bocciato la prima versione: la copia conteneva gli
  // strumenti ma non i moduli che quegli strumenti importano. Il preflight
  // lanciato dalla copia usciva con "guasto", accusando l'interruttore o la
  // rete invece della copia incompleta — e "guasto" per l'orchestratore vuol
  // dire chiudere il giro senza ritentare.
  //
  // Questo controllo esegue la copia. È l'unico modo di sapere se è completa:
  // un elenco di cartelle si legge e sembra sempre giusto.
  const { createServer } = await import('node:http');
  const { spawn } = await import('node:child_process');
  const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

  const srv = createServer((req, res) => {
    let b = ''; req.on('data', (c) => { b += c; });
    req.on('end', () => {
      res.setHeader('Content-Type', 'application/json');
      if (req.url.includes('config')) res.end(JSON.stringify({ fields: { enabled: { booleanValue: true } } }));
      else res.end(JSON.stringify({ ok: true }));
    });
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const port = srv.address().port;
  const dove = resolve(tmpdir(), `filo-strumenti-autosuff-${process.pid}`);

  try {
    const pin = pinTools(REPO, { dest: dove });
    assert.equal(pin.ok, true, pin.why);

    const out = await new Promise((fine) => {
      // Lanciato DALLA COPIA, e senza dire dove sta il progetto: deve
      // ritrovarselo da sé col promemoria che si è scritto.
      const p = spawn(process.execPath, [resolve(dove, 'scripts', 'dispatch.mjs'), '--preflight'], {
        cwd: dove,
        env: {
          ...process.env,
          FILO_ROUTINE_API: `http://127.0.0.1:${port}`,
          FILO_ROUTINE_CONFIG_URL: `http://127.0.0.1:${port}/config`,
          FILO_ROUTINES_ENABLED: '1',
          FILO_PREFLIGHT_ANY_BRANCH: '1',
          FILO_TOOLS_DIR: dove,
          FILO_REPO_ROOT: '',
          FILO_NO_BEAT: '1',
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let so = ''; let se = '';
      p.stdout.on('data', (c) => { so += c; });
      p.stderr.on('data', (c) => { se += c; });
      p.on('close', (code) => fine({ so, se, code }));
    });

    assert.equal(out.code, 0,
      `il preflight dalla copia si è guastato: ${out.se.slice(-400) || out.so.slice(-400)}`);
    assert.ok(!/Cannot find module/i.test(out.se), `alla copia manca un pezzo: ${out.se.slice(-300)}`);
  } finally {
    srv.close();
    rmSync(dove, { recursive: true, force: true, maxRetries: 5 });
  }
});

test('se la copia non riesce, il giro si FERMA invece di usare gli strumenti del ramo', async () => {
  // Proseguire vorrebbe dire eseguire gli strumenti del ramo, cioè il guasto
  // che tutto questo viene a togliere — e quel guasto non si vede finché non
  // costa un'ora di lavoro. Meglio un giro saltato.
  const { createServer } = await import('node:http');
  const { spawn } = await import('node:child_process');
  const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

  const srv = createServer((req, res) => {
    let b = ''; req.on('data', (c) => { b += c; });
    req.on('end', () => {
      res.setHeader('Content-Type', 'application/json');
      if (req.url.includes('config')) res.end(JSON.stringify({ fields: { enabled: { booleanValue: true } } }));
      else res.end(JSON.stringify({ ok: true }));
    });
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const port = srv.address().port;
  // Una destinazione che NON si può creare: un file al posto della cartella.
  const dove = resolve(tmpdir(), `filo-strumenti-bloccata-${process.pid}`);
  rmSync(dove, { recursive: true, force: true });
  mkdirSync(dirname(dove), { recursive: true });

  try {
    const out = await new Promise((fine) => {
      const p = spawn(process.execPath, [resolve(REPO, 'scripts', 'dispatch.mjs'), '--preflight'], {
        cwd: REPO,
        env: {
          ...process.env,
          FILO_ROUTINE_API: `http://127.0.0.1:${port}`,
          FILO_ROUTINE_CONFIG_URL: `http://127.0.0.1:${port}/config`,
          FILO_ROUTINES_ENABLED: '1',
          FILO_PREFLIGHT_ANY_BRANCH: '1',
          // Dentro una cartella che non esiste e non è creabile come tale.
          FILO_TOOLS_DIR: resolve(REPO, 'package.json', 'sotto'),
          FILO_NO_BEAT: '1',
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let so = ''; let se = '';
      p.stdout.on('data', (c) => { so += c; });
      p.stderr.on('data', (c) => { se += c; });
      p.on('close', (code) => fine({ so, se, code }));
    });

    assert.equal(out.code, 3, `doveva fermarsi come guasto, invece: ${out.code} ${out.so.slice(0, 200)}`);
    assert.match(out.se, /strumenti non fissati/, 'e il motivo deve dire QUALE cosa non è riuscita');
  } finally {
    srv.close();
  }
});

test('dalla copia, i marcatori del giro finiscono nel PROGETTO', async () => {
  // Il collegamento copia→progetto letto da dispatch: in cloud nessuno gli dice
  // dove sta il progetto, se lo ritrova col promemoria che la copia si è
  // scritta. Senza, biglietto e battito finirebbero accanto alla copia, dove
  // chi consegna non li cerca — e git parlerebbe con una cartella che non è un
  // deposito.
  const { createServer } = await import('node:http');
  const { spawn } = await import('node:child_process');
  const { cpSync } = await import('node:fs');
  const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

  const srv = createServer((req, res) => {
    let b = ''; req.on('data', (c) => { b += c; });
    req.on('end', () => {
      res.setHeader('Content-Type', 'application/json');
      if (req.url.endsWith('/routineWork')) {
        res.end(JSON.stringify({ ok: true, role: 'prober', id: '', num: '', branch: '', payload: { role: 'prober' } }));
      } else if (req.url.includes('config')) {
        res.end(JSON.stringify({ fields: { enabled: { booleanValue: true } } }));
      } else res.end(JSON.stringify({ ok: true }));
    });
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const port = srv.address().port;

  const casa = progettoFinto();
  const dove = resolve(tmpdir(), `filo-strumenti-marcatori-${process.pid}`);
  try {
    cpSync(resolve(REPO, 'scripts'), resolve(casa, 'scripts'), { recursive: true });
    cpSync(resolve(REPO, 'src', 'main', 'auth'), resolve(casa, 'src', 'main', 'auth'), { recursive: true });
    writeFileSync(resolve(casa, 'routines', 'roles', 'prober.md'), 'ricetta\n', 'utf8');
    const pin = pinTools(casa, { dest: dove });
    assert.equal(pin.ok, true, pin.why);

    await new Promise((fine) => {
      // NIENTE `FILO_REPO_ROOT`: è la condizione vera in cloud.
      const p = spawn(process.execPath, [resolve(dove, 'scripts', 'dispatch.mjs'), '--ticket', 'b-prova'], {
        cwd: dove,
        env: {
          ...process.env,
          FILO_ROUTINE_API: `http://127.0.0.1:${port}`,
          FILO_ROUTINE_CONFIG_URL: `http://127.0.0.1:${port}/config`,
          FILO_REPO_ROOT: '',
          FILO_DISPATCH_STATE_DIR: resolve(casa, 'stato'),
          FILO_ROUTINES_ENABLED: '1',
          FILO_NO_BEAT: '1',
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      p.on('close', fine);
    });

    assert.ok(existsSync(resolve(casa, '.claude', 'routine-ticket.json')),
      'il biglietto deve stare nel progetto: è lì che lo cerca chi consegna');
    assert.ok(!existsSync(resolve(dove, '.claude', 'routine-ticket.json')),
      'accanto alla copia non lo troverebbe nessuno');
  } finally {
    srv.close();
    rmSync(dove, { recursive: true, force: true, maxRetries: 5 });
    rmSync(casa, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  }
});

test('una routine che parte dal ramo sbagliato si ferma invece di fissare strumenti vecchi', async () => {
  // La copia vale quanto il momento in cui viene presa. Se il giro parte da un
  // checkout non aggiornato fissa strumenti vecchi, e il difetto torna con
  // un'altra causa — con l'aggravante che stavolta sembra tutto a posto.
  const { createServer } = await import('node:http');
  const { spawn } = await import('node:child_process');
  const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

  const srv = createServer((req, res) => {
    let b = ''; req.on('data', (c) => { b += c; });
    req.on('end', () => {
      res.setHeader('Content-Type', 'application/json');
      if (req.url.includes('config')) res.end(JSON.stringify({ fields: { enabled: { booleanValue: true } } }));
      else res.end(JSON.stringify({ ok: true }));
    });
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const port = srv.address().port;
  const dove = resolve(tmpdir(), `filo-strumenti-ramo-${process.pid}`);

  try {
    const out = await new Promise((fine) => {
      const p = spawn(process.execPath, [resolve(REPO, 'scripts', 'dispatch.mjs'), '--preflight'], {
        cwd: REPO,
        env: {
          ...process.env,
          // Questo worktree NON è sulla linea principale, ed è il punto.
          // NIENTE via di fuga, e NIENTE `FILO_ROUTINE`: la guardia non deve
          // dipendere da una variabile che viene esportata dopo di lei.
          FILO_ROUTINE_API: `http://127.0.0.1:${port}`,
          FILO_ROUTINE_CONFIG_URL: `http://127.0.0.1:${port}/config`,
          FILO_ROUTINES_ENABLED: '1',
          FILO_TOOLS_DIR: dove,
          FILO_NO_BEAT: '1',
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let so = ''; let se = '';
      p.stdout.on('data', (c) => { so += c; });
      p.stderr.on('data', (c) => { se += c; });
      p.on('close', (code) => fine({ so, se, code }));
    });

    assert.equal(out.code, 3, `doveva fermarsi: ${out.code} ${out.so.slice(0, 200)}`);
    assert.match(out.se, /invece che da/, 'e deve dire da dove è partito');
    assert.ok(!existsSync(dove), 'e non deve aver fissato niente');
  } finally {
    srv.close();
    rmSync(dove, { recursive: true, force: true, maxRetries: 5 });
  }
});

test('la guardia sul ramo NON dipende da come il giro si dichiara', () => {
  // Appesa a una variabile che l'orchestratore esporta seguendo le istruzioni
  // che riceve DAL preflight, la guardia avrebbe avuto i test verdi e non
  // sarebbe scattata mai in produzione: la variabile arriva dopo di lei. È la
  // stessa forma di guasto che questo lavoro viene a chiudere, e il controllo
  // qui sopra la prova SENZA dichiararsi routine in nessun modo.
  const testo = readFileSync(
    resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', 'scripts', 'dispatch.mjs'), 'utf8');
  const i = testo.indexOf('function checkoutNonAdatto');
  assert.ok(i > 0);
  const corpo = testo.slice(i, i + 600);
  assert.ok(!corpo.includes('FILO_ROUTINE '), 'la guardia non deve leggere come il giro si dichiara');
  assert.ok(!/process.env.FILO_ROUTINE/.test(corpo),
    'la guardia non deve appendersi a una variabile che arriva dopo di lei');
});

// ── La guardia sul checkout di partenza ────────────────────────────────────
//
// Banco di prova: un progetto con un suo "altrove" da cui aggiornarsi, così i
// casi si costruiscono davvero invece di simularli.
async function laboratorioGit() {
  const casa = mkdtempSync(resolve(tmpdir(), 'filo-guardia-'));
  const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
  const { cpSync } = await import('node:fs');
  const g = (args, cwd = casa) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();

  const altrove = resolve(casa, 'altrove.git');
  execFileSync('git', ['init', '-q', '--bare', altrove], { stdio: 'ignore' });
  g(['init', '-q', '-b', 'main']);
  g(['config', 'user.email', 't@t']);
  g(['config', 'user.name', 't']);
  // Gli strumenti veri: la guardia gira dentro dispatch, non da sola.
  cpSync(resolve(REPO, 'scripts'), resolve(casa, 'scripts'), { recursive: true });
  cpSync(resolve(REPO, 'src', 'main', 'auth'), resolve(casa, 'src', 'main', 'auth'), { recursive: true });
  cpSync(resolve(REPO, 'src', 'shared'), resolve(casa, 'src', 'shared'), { recursive: true });
  mkdirSync(resolve(casa, 'routines', 'roles'), { recursive: true });
  writeFileSync(resolve(casa, 'routines', 'roles', 'orchestrator.md'), 'ricetta\n', 'utf8');
  g(['add', '-A']); g(['commit', '-qm', 'primo']);
  g(['remote', 'add', 'origin', altrove]);
  g(['push', '-q', '-u', 'origin', 'main']);
  return { casa, g };
}

async function preflightIn(casa, extra = {}) {
  const { createServer } = await import('node:http');
  const { spawn } = await import('node:child_process');
  const srv = createServer((req, res) => {
    let b = ''; req.on('data', (c) => { b += c; });
    req.on('end', () => {
      res.setHeader('Content-Type', 'application/json');
      if (req.url.includes('config')) res.end(JSON.stringify({ fields: { enabled: { booleanValue: true } } }));
      else res.end(JSON.stringify({ ok: true }));
    });
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const port = srv.address().port;
  const dove = resolve(tmpdir(), `filo-strumenti-lab-${process.pid}`);
  try {
    return await new Promise((fine) => {
      const p = spawn(process.execPath, [resolve(casa, 'scripts', 'dispatch.mjs'), '--preflight'], {
        cwd: casa,
        env: {
          ...process.env,
          FILO_ROUTINE_API: `http://127.0.0.1:${port}`,
          FILO_ROUTINE_CONFIG_URL: `http://127.0.0.1:${port}/config`,
          FILO_ROUTINES_ENABLED: '1',
          FILO_REPO_ROOT: casa,
          FILO_TOOLS_DIR: dove,
          FILO_PREFLIGHT_ANY_BRANCH: '',
          FILO_NO_BEAT: '1',
          ...extra,
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let so = ''; let se = '';
      p.stdout.on('data', (c) => { so += c; });
      p.stderr.on('data', (c) => { se += c; });
      p.on('close', (code) => fine({ so, se, code }));
    });
  } finally {
    srv.close();
    rmSync(dove, { recursive: true, force: true, maxRetries: 5 });
  }
}

test('testa staccata sulla PUNTA della linea principale: si passa', async () => {
  // Il contenuto è esattamente quello giusto. Rifiutarla guardando il nome del
  // ramo sarebbe anche una bugia: il messaggio direbbe "sei su un altro ramo"
  // mentre i file sono identici.
  const { casa, g } = await laboratorioGit();
  try {
    g(['checkout', '-q', '--detach', 'HEAD']);
    const out = await preflightIn(casa);
    assert.equal(out.code, 0, `doveva passare: ${out.se.slice(-300)}`);
  } finally {
    rmSync(casa, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  }
});

test('checkout indietro: si allinea da solo invece di morire', async () => {
  // Morire qui vorrebbe dire fermare il giro PRIMA del passo in cui la sua
  // stessa ricetta gli dice di aggiornarsi, con un esito che significa "chiudi
  // e non ritentare". L'aggiornamento si fa adesso, che è il momento giusto.
  const { casa, g } = await laboratorioGit();
  try {
    // Un commit nuovo sull'altrove, e il progetto resta indietro.
    writeFileSync(resolve(casa, 'nuovo.txt'), 'x', 'utf8');
    g(['add', '-A']); g(['commit', '-qm', 'secondo']); g(['push', '-q', 'origin', 'main']);
    const punta = g(['rev-parse', 'HEAD']);
    g(['reset', '--hard', '-q', 'HEAD~1']);
    assert.notEqual(g(['rev-parse', 'HEAD']), punta);

    const out = await preflightIn(casa);
    assert.equal(out.code, 0, `doveva allinearsi e proseguire: ${out.se.slice(-300)}`);
    assert.equal(g(['rev-parse', 'HEAD']), punta, 'e il checkout deve essere aggiornato davvero');
  } finally {
    rmSync(casa, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  }
});

test('ramo di lavoro: si ferma, e dice come si fa apposta', async () => {
  const { casa, g } = await laboratorioGit();
  try {
    g(['checkout', '-q', '-b', 'claude/qualcosa']);
    writeFileSync(resolve(casa, 'suo.txt'), 'x', 'utf8');
    g(['add', '-A']); g(['commit', '-qm', 'lavoro']);

    const out = await preflightIn(casa);
    assert.equal(out.code, 3, `doveva fermarsi: ${out.so.slice(0, 200)}`);
    assert.match(out.se, /claude\/qualcosa/, 'e dire da dove è partito');
    assert.match(out.se, /FILO_PREFLIGHT_ANY_BRANCH/,
      'e nominare la via di fuga: un rifiuto che non dice come si fa apposta è un muro');
  } finally {
    rmSync(casa, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  }
});

test('senza remoto la guardia lascia passare', async () => {
  // Fallire aperti: questo controllo esiste per accorgersi di una deriva, non
  // per essere il punto in cui un giro muore perché la rete non c'è.
  const { casa, g } = await laboratorioGit();
  try {
    g(['remote', 'remove', 'origin']);
    const out = await preflightIn(casa);
    assert.equal(out.code, 0, `doveva passare: ${out.se.slice(-300)}`);
  } finally {
    rmSync(casa, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  }
});

test('anche i DATI che governano il giro vengono dalla copia', async () => {
  // Non solo il codice: il numero di bocciature che si tollerano prima di
  // chiamare l'owner è un dato, e preso dal ramo di lavoro sarebbe quello di
  // giorni fa. Qui il ramo dice una cosa e la copia un'altra: vince la copia.
  const { spawn } = await import('node:child_process');
  const { cpSync } = await import('node:fs');
  const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
  const casa = progettoFinto();
  const dove = resolve(tmpdir(), `filo-strumenti-dati-${process.pid}`);

  const tabella = (fail) => `(function (global) {
  'use strict';
  global.SN_FB_TRANSITIONS = { VERIFIER_CAPS: { improvableCap: 3, failCap: ${fail} } };
})(typeof globalThis !== 'undefined' ? globalThis : self);
`;

  try {
    cpSync(resolve(REPO, 'scripts'), resolve(casa, 'scripts'), { recursive: true });
    cpSync(resolve(REPO, 'src', 'main', 'auth'), resolve(casa, 'src', 'main', 'auth'), { recursive: true });
    // La copia si prende quando il progetto dice 7.
    writeFileSync(resolve(casa, 'src', 'shared', 'feedbackTransitions.js'), tabella(7), 'utf8');
    const pin = pinTools(casa, { dest: dove });
    assert.equal(pin.ok, true, pin.why);
    // Poi si apre il ramo, che dice 2.
    writeFileSync(resolve(casa, 'src', 'shared', 'feedbackTransitions.js'), tabella(2), 'utf8');

    const out = await new Promise((fine) => {
      const p = spawn(process.execPath, [
        '--input-type=module', '-e',
        `import { VERIFIER_CAPS } from ${JSON.stringify(`file:///${resolve(dove, 'scripts', 'dispatch.mjs').split('\\').join('/')}`)};
         console.log('failCap=' + VERIFIER_CAPS.failCap);`,
      ], {
        cwd: casa,
        env: { ...process.env, FILO_REPO_ROOT: casa, FILO_DISPATCH_STATE_DIR: resolve(casa, 'stato'), FILO_NO_BEAT: '1' },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let so = ''; let se = '';
      p.stdout.on('data', (c) => { so += c; });
      p.stderr.on('data', (c) => { se += c; });
      p.on('close', () => fine({ so, se }));
    });

    assert.match(out.so, /failCap=7/,
      `ha letto il dato dal ramo invece che dalla copia: ${out.so.trim()} ${out.se.slice(-200)}`);
  } finally {
    rmSync(dove, { recursive: true, force: true, maxRetries: 5 });
    rmSync(casa, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  }
});

test('aprire un ramo VECCHIO non riporta indietro gli strumenti del giro', () => {
  // Il guasto del 24 agosto, riprodotto: un progetto con lo strumento nuovo, un
  // ramo che ne contiene uno vecchio, e il ramo che viene aperto a metà giro.
  const casa = progettoFinto();
  const dove = resolve(tmpdir(), `filo-strumenti-prova4-${process.pid}`);
  const g = (args) => execFileSync('git', args, { cwd: casa, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  try {
    g(['init', '-q', '-b', 'main']);
    g(['config', 'user.email', 't@t']);
    g(['config', 'user.name', 't']);

    // Il ramo vecchio: lo strumento non sa fare la cosa nuova.
    writeFileSync(resolve(casa, 'scripts', 'attrezzo.mjs'), 'export const versione = "vecchia";\n', 'utf8');
    g(['add', '-A']); g(['commit', '-qm', 'vecchio']);
    g(['branch', 'lavoro-del-22']);

    // Sulla linea principale lo strumento è stato corretto.
    writeFileSync(resolve(casa, 'scripts', 'attrezzo.mjs'), 'export const versione = "nuova";\n', 'utf8');
    g(['add', '-A']); g(['commit', '-qm', 'nuovo']);

    // Il giro comincia qui, sulla versione aggiornata: è l'unico momento buono.
    const pin = pinTools(casa, { dest: dove });
    assert.equal(pin.ok, true, pin.why);

    // …e adesso si mette al lavoro sul ramo di due giorni fa.
    g(['checkout', '-q', 'lavoro-del-22']);

    const nelProgetto = readFileSync(resolve(casa, 'scripts', 'attrezzo.mjs'), 'utf8');
    const negliStrumenti = readFileSync(resolve(pin.dir, 'scripts', 'attrezzo.mjs'), 'utf8');

    assert.match(nelProgetto, /vecchia/, 'il progetto è sul ramo vecchio, come deve essere');
    assert.match(negliStrumenti, /nuova/,
      'gli strumenti del giro devono restare quelli aggiornati: è tutta la differenza');
  } finally {
    rmSync(dove, { recursive: true, force: true });
    rmSync(casa, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  }
});

// #2571: tre primi lavori morti mentre aspettavano finish:check, con l'ultimo comando uscito 137 e la veglia che diceva
// «forse un permesso, forse il modello». Qui: la memoria vista dai comandi, il segno della corsa interrotta (senza un
// numero che non sa), la sessione di Claude Code ripartita o la stessa (#2571.1), e la riga che il worker riceve.

import '../helpers/senzaSessione.mjs';
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { cartellaTemporanea, togliCartella } from '../helpers/percorsi.mjs';
import { TETTO_ATTESA_MS } from '../helpers/attese.mjs';

// La sessione che lancia le prove non entra nelle letture finte: la si legge solo dove la si chiede.
const ENV_VERO = { ...process.env };
delete process.env.CLAUDE_PID;
delete process.env.CLAUDE_CODE_WORKER_EPOCH;

const REPO = resolve(import.meta.dirname, '..', '..');
const { letturaMemoria, testoMemoria, cgroupDi, uccisiPerMemoria, sessioneClaude } = await import('../../scripts/lib/memoria-contenitore.mjs');
const {
  apriCorsa, corsaInterrotta, fileCorsa, guastoDellaCorsa, testoPerIlWorker, testoUcciso, sessioneDellaCorsa,
} = await import('../../scripts/lib/corsa-controlli.mjs');
const { testoGuasto, ultimoPasso, quadroDelFermo, veglia, autopsiaDelWorker, USCITA_FERMO } = await import('../../scripts/lib/veglia-worker.mjs');
const { codiceUscita, rigaErrore } = await import('../../scripts/session-report.mjs');
const { statoContenitore } = await import('../../scripts/routine-channel.mjs');

const MB = 1048576;
const fatti = [];
test.after(() => { for (const d of fatti) { try { togliCartella(d); } catch (_) {} } });
const repo = () => {
  const d = cartellaTemporanea('filo-corsa-');
  fatti.push(d);
  execFileSync('git', ['init', '-q', d]);
  return d;
};

// Le cifre di un contenitore delle routine misurate il 18/11/2026: 16 GB, i comandi in un cgroup v1 col tetto a 13,4.
const RIGA_CG = '4:memory:/process_api/s1/claude-code-bash\n0::/\n';
const CG = '/sys/fs/cgroup/memory/process_api/s1/claude-code-bash';
const contenitore = ({ uso = 13000, cache = 500, oomCmd = 0, oomSis = 0, disponibile = 15000 } = {}) => ({
  '/proc/self/cgroup': RIGA_CG,
  '/proc/meminfo': `MemTotal:       16473760 kB\nMemFree:  100 kB\nMemAvailable:   ${disponibile * 1024} kB\n`,
  '/proc/vmstat': `pgfault 1\noom_kill ${oomSis}\n`,
  [`${CG}/memory.usage_in_bytes`]: String(uso * MB),
  [`${CG}/memory.limit_in_bytes`]: String(13675 * MB),
  [`${CG}/memory.max_usage_in_bytes`]: String(13600 * MB),
  [`${CG}/memory.stat`]: `cache 1\ntotal_inactive_file ${cache * MB}\n`,
  [`${CG}/memory.oom_control`]: `oom_kill_disable 0\nunder_oom 0\noom_kill ${oomCmd}\n`,
  '/sys/fs/cgroup/memory/process_api/s1/memory.usage_in_bytes': String(14000 * MB),
  '/sys/fs/cgroup/memory/process_api/s1/memory.limit_in_bytes': '9223372036854771712',
  '/sys/fs/cgroup/memory/memory.usage_in_bytes': String(14100 * MB),
  '/sys/fs/cgroup/memory/memory.limit_in_bytes': '9223372036854771712',
});
const leggiDa = (f) => (p) => (p in f ? f[p] : null);

describe('la memoria vista dai comandi', () => {
  test('il tetto è quello del cgroup dei comandi, al netto della cache, non la RAM libera', () => {
    const m = letturaMemoria(leggiDa(contenitore()));
    assert.equal(m.tettoMb, 13675);
    assert.equal(m.usataMb, 12500, 'la cache che si libera non è memoria persa');
    assert.equal(m.disponibileMb, 1175, 'il margine del tetto, più stretto della memoria della macchina');
    assert.equal(m.piccoMb, 13600);
    assert.deepEqual([m.uccisioniComandi, m.uccisioniSistema], [0, 0]);
    const largo = letturaMemoria(leggiDa(contenitore({ uso: 2000, disponibile: 900 })));
    assert.equal(largo.disponibileMb, 900, 'con la macchina più stretta del tetto vale la macchina');
  });

  test('cgroup v2, senza cgroup e senza niente: i numeri che non si leggono restano NaN', () => {
    assert.deepEqual(cgroupDi('0::/user.slice/x\n'), { v: 2, rel: '/user.slice/x' });
    assert.deepEqual(cgroupDi('0::/\n'), { v: 2, rel: '' });
    assert.equal(cgroupDi(''), null);
    const v2 = letturaMemoria(leggiDa({
      '/proc/self/cgroup': '0::/\n', '/proc/meminfo': 'MemAvailable: 8388608 kB\n',
      '/sys/fs/cgroup/memory.current': String(3 * 1024 * MB), '/sys/fs/cgroup/memory.max': String(4 * 1024 * MB),
      '/sys/fs/cgroup/memory.stat': 'inactive_file 0\n', '/sys/fs/cgroup/memory.peak': String(3500 * MB), '/sys/fs/cgroup/memory.events': 'low 0\noom 2\noom_kill 1\n',
    }));
    assert.deepEqual([v2.disponibileMb, v2.piccoMb, v2.uccisioniComandi], [1024, 3500, 1]);
    const niente = letturaMemoria(() => null);
    assert.ok(Number.isNaN(niente.disponibileMb));
    assert.equal(testoMemoria(niente), 'memoria: non letta');
  });

  test('la riga per il guasto: disponibile, tetto, picco e uccisioni, dall\'avvio o da una lettura di prima', () => {
    const prima = letturaMemoria(leggiDa(contenitore({ oomCmd: 1, oomSis: 1 })));
    const dopo = letturaMemoria(leggiDa(contenitore({ oomCmd: 3, oomSis: 4 })));
    assert.equal(testoMemoria(dopo), 'memoria: disponibili 1,1 GB su un tetto dei comandi di 13,4 GB; picco dei comandi 13,3 GB; processi uccisi per memoria dall\'avvio: 4 nella macchina, 3 fra i comandi');
    assert.match(testoMemoria(dopo, prima), /uccisi per memoria da allora: 3 nella macchina, 2 fra i comandi$/);
    assert.equal(uccisiPerMemoria(dopo, prima), true);
    assert.equal(uccisiPerMemoria(prima, prima), false);
    assert.equal(uccisiPerMemoria(letturaMemoria(() => null)), null, 'senza contatori non si sa');
  });

  test('il battito porta la memoria che resta ai comandi, non MemFree', () => {
    const osImpl = { uptime: () => 100, freemem: () => 100 * MB, loadavg: () => [1] };
    const proc = { memoryUsage: () => ({ rss: MB }) };
    const s = statoContenitore({ osImpl, proc, leggi: leggiDa(contenitore()), elenca: () => [] });
    assert.equal(s.freeMb, 1175, 'MemFree (100 MB) non conta la cache; il tetto dei comandi sì');
  });

  test('in questo sistema la lettura dà numeri veri dove c\'è /proc', { skip: process.platform !== 'linux' }, () => {
    const m = letturaMemoria();
    assert.ok(m.disponibileMb > 0 && Number.isFinite(m.totaleMb), JSON.stringify(m));
  });
});

describe('il segno della corsa di finish:check', () => {
  // Un processo vero che apre il segno e aspetta di essere ucciso: SIGKILL non lascia eseguire niente.
  const lancia = (root) => new Promise((ok) => {
    const modulo = pathToFileURL(join(REPO, 'scripts', 'lib', 'corsa-controlli.mjs')).href;
    const c = spawn(process.execPath, ['--input-type=module', '-e',
      `const { apriCorsa } = await import(${JSON.stringify(modulo)}); const c = apriCorsa(${JSON.stringify(root)}, { sha: 'abcdef1234567890' }); c.fase('spec delle aree toccate — lotto 2/3'); console.log('pronto'); setInterval(() => {}, 1000);`,
      // Nella riga di comando come quello vero: un processo vivo che non è finish:check non tiene viva la corsa.
      'finish-local',
    ], { stdio: ['ignore', 'pipe', 'inherit'] });
    setTimeout(() => c.kill('SIGKILL'), TETTO_ATTESA_MS).unref();
    c.stdout.once('data', () => ok(c));
  });
  const fine = (c) => new Promise((ok) => c.once('exit', (codice, segnale) => ok({ codice, segnale })));

  test('ucciso con SIGKILL il segno resta, col processo morto: la corsa è interrotta, senza un numero che il segno non sa', { skip: process.platform === 'win32' }, async () => {
    const root = repo();
    const c = await lancia(root);
    assert.equal(corsaInterrotta(root), null, 'finché il processo vive la corsa non è interrotta');
    const finito = fine(c);
    c.kill('SIGKILL');
    assert.equal((await finito).segnale, 'SIGKILL');
    const s = corsaInterrotta(root);
    assert.ok(s, 'il segno è rimasto');
    assert.equal(s.fase, 'spec delle aree toccate — lotto 2/3');
    assert.match(guastoDellaCorsa(s, null), /^guasto: strumento finish-check: finish:check interrotto senza finire \(fase spec delle aree toccate — lotto 2\/3/);
    assert.doesNotMatch(testoPerIlWorker(s, null), /137|ucciso \(/);
  });

  // Verifica #2571 giro 2, r1: il worker ferma la corsa che non gli serve più (lo strumento dei comandi in sottofondo,
  // Ctrl+C). Il segno non sa il segnale: non deve dire «ucciso (137)», e il testo deve lasciargli il caso della fermata.
  for (const segnale of ['SIGTERM', 'SIGINT']) {
    test(`fermata apposta con ${segnale}: niente «processo ucciso (137)», e il worker legge che se l'ha fermata lui non è un guasto`, { skip: process.platform === 'win32' }, async () => {
      const root = repo();
      const c = await lancia(root);
      const finito = fine(c);
      c.kill(segnale);
      assert.equal((await finito).segnale, segnale);
      const testo = testoPerIlWorker(corsaInterrotta(root), null);
      assert.doesNotMatch(testo, /processo ucciso|\(137\)/);
      assert.match(testo, /^La corsa di finish:check si è interrotta senza finire: fase spec delle aree toccate/);
      assert.match(testo, /Se l'hai fermata tu \(lo strumento che ferma i comandi in sottofondo, Ctrl\+C\) non è un guasto/);
      assert.match(testo, /Se l'ha fermata il tempo massimo del comando, rilanciala in sottofondo col tetto più largo/);
    });
  }

  test('fermata durante una prova lanciata in modo sincrono la corsa si ferma subito, e un\'uscita normale toglie il segno', { skip: process.platform === 'win32' }, async () => {
    // Un gestore dei segnali girerebbe solo a prova finita: la corsa fermata lancerebbe ancora il lotto dopo.
    const root = repo();
    const modulo = pathToFileURL(join(REPO, 'scripts', 'lib', 'corsa-controlli.mjs')).href;
    const c = spawn(process.execPath, ['--input-type=module', '-e',
      `import { spawnSync } from 'node:child_process'; const { apriCorsa } = await import(${JSON.stringify(modulo)}); apriCorsa(${JSON.stringify(root)}); console.log('pronto'); spawnSync('sleep', ['20']); spawnSync('sleep', ['20']);`,
      'finish-local',
    ], { stdio: ['ignore', 'pipe', 'inherit'] });
    await new Promise((ok) => c.stdout.once('data', ok));
    const finito = fine(c);
    const da = Date.now();
    c.kill('SIGTERM');
    assert.equal((await finito).segnale, 'SIGTERM');
    assert.ok(Date.now() - da < 10_000, `fermata dopo ${Date.now() - da} ms`);
    assert.equal(codiceDellaCorsa(corsaInterrotta(root)), CODICE_SIGKILL, 'il segno resta, col processo morto');

    const pulito = repo();
    assert.throws(() => execFileSync(process.execPath, ['--input-type=module', '-e', `const { apriCorsa } = await import(${JSON.stringify(modulo)}); apriCorsa(${JSON.stringify(pulito)}); process.exit(1);`], { stdio: 'ignore' }), /status 1|failed/);
    assert.equal(existsSync(fileCorsa(pulito)), false, 'anche un rosso è una corsa finita');
    assert.equal(corsaInterrotta(pulito), null);
  });

  test('aspetta, a cartella quieta, dice al worker che finish:check è morto e gli dà il guasto', { skip: process.platform !== 'linux' && 'i processi si leggono da /proc' }, async () => {
    const root = repo();
    apriCorsa(root, { sha: 'abcdef1234567890', proc: { pid: 2 ** 22 + 11, on: () => {} } });
    const r = await new Promise((ok) => {
      const p = spawn(process.execPath, [join(REPO, 'scripts', 'routine-channel.mjs'), 'aspetta', 'AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-abcde'], {
        cwd: root, env: { ...process.env, FILO_REPO_ROOT: root, FILO_NO_BEAT: '1', FILO_ASPETTA_FETTA_MS: '0' },
      });
      let so = ''; let se = '';
      p.stdout.on('data', (c) => { so += c; });
      p.stderr.on('data', (c) => { se += c; });
      p.on('close', (code) => ok({ code, so, se }));
    });
    assert.equal(r.code, 0, r.so + r.se);
    assert.match(r.so, /Finito: nessun tuo processo/);
    assert.match(r.so, /La corsa di finish:check è morta senza finire: processo ucciso \(137\) durante finish:check \(fase avvio/);
    assert.match(r.so, /--guasto "guasto: strumento finish-check: processo ucciso \(137\)/);
  });

  test('finish:check apre il segno prima dei controlli e lo aggiorna a ogni lotto di spec', () => {
    const sorgente = readFileSync(join(REPO, 'scripts', 'finish-local.mjs'), 'utf8').split('\n').filter((r) => !/^\s*(\/\/|\*|\/\*)/.test(r)).join('\n');
    const apre = sorgente.indexOf('const corsa = apriCorsa(ROOT, { sha: shaProvato });');
    assert.ok(apre > 0 && apre < sorgente.indexOf("corsa.fase('controlli di logica')"), 'il segno nasce prima degli unit');
    assert.ok(sorgente.indexOf('corsaInterrotta(ROOT)') < apre, 'il lancio precedente si legge prima di essere sovrascritto');
    const lanci = sorgente.split('\n').filter((r) => r.includes('runSpecsALotti(') && !/function runSpecsALotti\(/.test(r));
    assert.ok(lanci.length >= 2);
    for (const l of lanci) assert.match(l, /, corsa\.fase\)/, `lotto senza fase: ${l.trim()}`);
  });

  test('il segno sta nella cartella git, fuori dall\'albero: niente da committare', () => {
    const root = repo();
    const c = apriCorsa(root, { proc: { pid: 4242, on: () => {} }, memoria: () => ({}) });
    assert.ok(c.file.includes(`${join('.git', 'filo-controlli-in-corso.json')}`), c.file);
    assert.equal(execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }), '');
    assert.equal(JSON.parse(readFileSync(c.file, 'utf8')).pid, 4242);
    assert.equal(corsaInterrotta(root, { viva: () => true }), null);
    assert.equal(corsaInterrotta(root, { viva: () => false }).pid, 4242);
    assert.equal(corsaInterrotta(cartellaTemporanea('filo-senza-git-')), null, 'senza git nessun segno');
  });

  // Il clone passa da un lavoro all'altro: il segno di quello prima non è del worker di adesso.
  const cloneDiUnAltroLavoro = () => {
    const root = repo();
    const g = (...a) => execFileSync('git', ['-C', root, '-c', 'user.name=t', '-c', 'user.email=t@t', ...a], { encoding: 'utf8' });
    g('checkout', '-q', '-b', 'worker/primo');
    g('commit', '-q', '--allow-empty', '-m', 'primo');
    apriCorsa(root, { sha: 'abcdef1234567890', proc: { pid: 2 ** 22 + 13, on: () => {} }, memoria: () => ({}) });
    const sulSuoRamo = corsaInterrotta(root);
    g('checkout', '-q', '--orphan', 'worker/secondo');
    g('commit', '-q', '--allow-empty', '-m', 'secondo');
    return { root, sulSuoRamo };
  };

  test('il segno vale solo sul ramo che l\'ha scritto: né l\'attesa né la veglia lo danno al lavoro dopo', { skip: process.platform !== 'linux' && 'i processi si leggono da /proc' }, async () => {
    const { root, sulSuoRamo } = cloneDiUnAltroLavoro();
    assert.equal(sulSuoRamo.ramo, 'worker/primo', 'sul suo ramo la corsa morta si vede');
    assert.equal(corsaInterrotta(root), null);
    assert.equal(autopsiaDelWorker(root, { mio: true }, { memoria: () => ({}) }).corsa, null);
    const r = await new Promise((ok) => {
      const p = spawn(process.execPath, [join(REPO, 'scripts', 'routine-channel.mjs'), 'aspetta', 'AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-abcde'], {
        cwd: root, env: { ...process.env, FILO_REPO_ROOT: root, FILO_NO_BEAT: '1', FILO_ASPETTA_FETTA_MS: '0' },
      });
      let so = '';
      p.stdout.on('data', (c) => { so += c; });
      p.stderr.on('data', (c) => { so += c; });
      p.on('close', (code) => ok({ code, so }));
    });
    assert.equal(r.code, 0, r.so);
    assert.doesNotMatch(r.so, /morta senza finire|--guasto/);
  });

  test('ogni corsa dice in fondo la sua memoria: picco e uccisioni da quando è partita', () => {
    let n = 0;
    const letture = [contenitore({ oomCmd: 1, oomSis: 1 }), contenitore({ oomCmd: 1, oomSis: 1 })];
    const c = apriCorsa(repo(), { proc: { pid: 4243, on: () => {} }, memoria: () => letturaMemoria(leggiDa(letture[n++])) });
    assert.match(c.bilancio(), /picco dei comandi 13,3 GB; processi uccisi per memoria da allora: 0 nella macchina, 0 fra i comandi$/);
    const sorgente = readFileSync(join(REPO, 'scripts', 'finish-local.mjs'), 'utf8');
    assert.match(sorgente, /process\.on\('exit', \(\) => console\.log\(`\\n▸ Memoria della corsa: \$\{corsa\.bilancio\(\)/);
  });
});

describe('il guasto di un processo ucciso', () => {
  const segno = {
    pid: 1, sha: 'abcdef1234567890', inizio: '2026-11-17T18:40:00Z', fase: 'spec delle aree toccate (190) — lotto 2/3', faseDa: '2026-11-17T19:01:00Z',
    memoria: letturaMemoria(leggiDa(contenitore({ oomCmd: 0, oomSis: 0 }))),
  };

  test('per il worker: cosa è morto, dove, la memoria, e il --guasto già scritto da copiare', () => {
    const adesso = letturaMemoria(leggiDa(contenitore({ oomCmd: 2, oomSis: 2 })));
    const g = guastoDellaCorsa(segno, adesso);
    assert.match(g, /^guasto: strumento finish-check: processo ucciso \(137\) durante finish:check \(fase spec delle aree toccate \(190\) — lotto 2\/3 dalle 19:01:00 UTC, partito alle 18:40:00 UTC su abcdef12\): il kernel ha ucciso processi per memoria; memoria: /);
    assert.match(g, /da allora: 2 nella macchina, 2 fra i comandi\.$/);
    const t = testoPerIlWorker(segno, adesso);
    assert.match(t, /^La corsa di finish:check è morta senza finire: processo ucciso \(137\)/);
    assert.match(t, /Rilanciala una volta, in sottofondo/);
    assert.ok(t.includes(`--guasto "${g}"`), t);
    assert.doesNotMatch(g, /["`$]/, 'il guasto sta fra virgolette doppie in una riga di comando');
    const senza = guastoDellaCorsa(segno, segno.memoria);
    assert.match(senza, /nessun processo ucciso per memoria, quindi un colpo da fuori dei comandi \(la sessione, l'harness o un riavvio del contenitore\)/);
  });

  // L'avvio del contenitore: kernel partito a 1.763.000.000 s, processo 1 dopo `tick` centesimi.
  const conAvvio = (f, tick) => ({ ...f, '/proc/stat': 'cpu 1 2 3\nbtime 1763000000\n', '/proc/1/stat': `1 (init) S 0 1 1 0 -1 4194560 100 0 0 0 1 2 0 0 20 0 1 0 ${tick} 1000 100 1\n` });

  test('dopo una ripartenza i contatori non dicono niente: né conti negativi né «nessun processo ucciso per memoria»', () => {
    const prima = letturaMemoria(leggiDa(conAvvio(contenitore({ oomCmd: 3, oomSis: 2 }), 5000)));
    assert.equal(prima.avvioS, 1763000050);
    const ripartito = letturaMemoria(leggiDa(conAvvio(contenitore({ oomCmd: 0, oomSis: 0 }), 900000)));
    const g = guastoDellaCorsa({ ...segno, memoria: prima }, ripartito);
    assert.match(g, /il contenitore è ripartito alle \d\d:\d\d:\d\d UTC, dopo la partenza: i contatori della memoria ripartono da zero/);
    assert.match(g, /processi uccisi per memoria dalla ripartenza: 0 nella macchina, 0 fra i comandi\.$/);
    assert.doesNotMatch(g, /-\d|nessun processo ucciso per memoria/);

    // Stesso contenitore, contatori dei comandi tornati indietro: il gruppo dei comandi è ripartito.
    const comandi = letturaMemoria(leggiDa(conAvvio(contenitore({ oomCmd: 0, oomSis: 2 }), 5000)));
    const h = guastoDellaCorsa({ ...segno, memoria: prima }, comandi);
    assert.match(h, /i contatori delle uccisioni per memoria sono tornati indietro/);
    assert.doesNotMatch(h, /-\d|nessun processo ucciso per memoria/);

    // Niente ripartenze, nessuna uccisione: il colpo è da fuori, e il riavvio è escluso.
    const fermo = letturaMemoria(leggiDa(conAvvio(contenitore({ oomCmd: 3, oomSis: 2 }), 5000)));
    assert.match(guastoDellaCorsa({ ...segno, memoria: prima }, fermo), /nessun processo ucciso per memoria e il contenitore non è ripartito, quindi un colpo da fuori dei comandi \(la sessione o l'harness\)/);

    // Senza la lettura di allora vale l'ora dello strumento: il contenitore partito dopo vuol dire ripartito.
    const dopoLoStrumento = testoUcciso({ programma: 'node', codice: 137, cosa: 'x', memoria: ripartito, daMs: Date.parse('2025-11-13T02:00:00Z') });
    assert.match(dopoLoStrumento, /il contenitore è ripartito/);
  });

  test('il battito: memoria usata e libera dello stesso cgroup, quello dei comandi', () => {
    const osImpl = { uptime: () => 100, freemem: () => 100 * MB, loadavg: () => [1] };
    const s = statoContenitore({ osImpl, proc: { memoryUsage: () => ({ rss: MB }) }, leggi: leggiDa(contenitore()), elenca: () => [] });
    assert.equal(s.rssMb + s.freeMb, 13675, 'usata più libera fanno il tetto dei comandi, non 14,1 GB usati su 13,4');
  });

  test('una regola sola per i testi dei guasti, e le intestazioni rimandano a prove che esistono', () => {
    const veglia = readFileSync(join(REPO, 'scripts', 'lib', 'veglia-worker.mjs'), 'utf8');
    assert.doesNotMatch(veglia, /^const (pulito|ora) =/m, 'la veglia usa la pulizia e l\'ora del guasto della corsa');
    for (const f of ['memoria-contenitore.mjs', 'corsa-controlli.mjs']) {
      const testa = readFileSync(join(REPO, 'scripts', 'lib', f), 'utf8').split('\n').slice(0, 3).join('\n');
      const rimandi = testa.match(/tests\/unit\/[\w.-]+\.test\.mjs/g) || [];
      assert.ok(rimandi.length, f);
      for (const r of rimandi) assert.ok(existsSync(join(REPO, r)), `${f} rimanda a ${r}`);
    }
  });

  test('il codice di uscita dal risultato di Claude Code', () => {
    const killed = 'Exit code 137\n/bin/bash: line 1: 14423 Killed                  node -e …';
    assert.equal(codiceUscita(killed), 137);
    assert.equal(codiceUscita([{ type: 'text', text: '<tool_use_error>Exit code 1\nboh</tool_use_error>' }]), 1);
    assert.ok(Number.isNaN(codiceUscita('ok')));
    assert.equal(rigaErrore(killed), 'exit 137: /bin/bash: line 1: 14423 Killed node -e …');
  });

  const ORA = Date.parse('2026-11-17T19:06:00Z');
  const uso = (id, input, ms) => ({ type: 'assistant', timestamp: new Date(ms).toISOString(), message: { model: 'claude-opus-5-5', content: [{ type: 'tool_use', id, name: 'Bash', input }] } });
  const esito = (id, content, ms) => ({ type: 'user', timestamp: new Date(ms).toISOString(), message: { content: [{ type: 'tool_result', tool_use_id: id, content, is_error: true }] } });
  const ATTESA = 'cd "/tmp/filo-lavori/1" && node "/tmp/filo-strumenti-1/scripts/routine-channel.mjs" aspetta SEGRETO';
  const transcript = [uso('a', { command: ATTESA, description: 'Keep waiting for finish:check' }, ORA), esito('a', 'Exit code 137\n[agent-proxy] 1 connection failed', ORA + 40_000)];

  test('l\'ultimo passo porta l\'uscita e il programma, mai il comando', () => {
    const p = ultimoPasso(transcript);
    assert.deepEqual(p.strumento, { nome: 'Bash', ms: ORA, risposta: true, uscita: 137, programma: 'node' });
    const q = quadroDelFermo({ tracce: { viste: true, elenco: [{ nome: 'routine-nuovo-lavoro', ms: ORA + 40_000, ...p }] }, processiLetti: true, comandi: [] });
    assert.ok(q.includes('Ultimo strumento: Bash alle 19:06:00 UTC, con risposta, uscita 137.'), q);
    assert.doesNotMatch(q, /SEGRETO|aspetta/);
  });

  test('la veglia: dopo un 137 il fermo dice processo ucciso, non «forse un permesso, forse il modello»', () => {
    const ultimo = ultimoPasso(transcript).strumento;
    const g = testoGuasto({ fermoMs: 21 * 60000, ultimo, quadro: 'Processi nella cartella: nessuno.', memoria: segno.memoria });
    assert.match(g, /^guasto: strumento node: processo ucciso \(137\) durante Bash delle 19:06:00 UTC: nessun processo ucciso per memoria/);
    assert.match(g, /Il suo ultimo strumento è uscito 137 e da lì il worker non dà segni di vita da 21 minuti/);
    assert.match(g, /Processi nella cartella: nessuno\. Rilasciato dalla veglia di chi guida il giro\.$/);
    assert.doesNotMatch(g, /forse un permesso|SEGRETO/);
    const conCorsa = testoGuasto({ fermoMs: 21 * 60000, ultimo, corsa: segno, memoria: segno.memoria });
    assert.match(conCorsa, /^guasto: strumento finish-check: processo ucciso \(137\) durante finish:check \(fase spec delle aree toccate/);
    // Un'uscita 1 è un rosso qualunque: il fermo resta quello di prima.
    const rosso = testoGuasto({ fermoMs: 21 * 60000, ultimo: { ...ultimo, uscita: 1 } });
    assert.match(rosso, /^guasto: strumento worker: worker fermo da 21 minuti .*forse un permesso, forse il modello/);
    // Uno strumento ancora senza risposta resta un permesso in attesa.
    assert.match(testoGuasto({ fermoMs: 21 * 60000, attesa: { nome: 'Bash', comando: 'git push' }, corsa: segno, ultimo }), /^guasto: permessi git:/);
  });

  test('la veglia passa l\'autopsia al guasto che rilascia', async () => {
    const tracce = { viste: true, attesa: null, elenco: [{ nome: 'routine-nuovo-lavoro', ms: ORA + 40_000, ...ultimoPasso(transcript) }] };
    let dichiarato = '';
    const r = await veglia({
      leggi: () => ({ mio: true, tempi: [ORA + 40_000], processi: 0, tracce, processiLetti: true, comandi: [] }),
      autopsia: () => ({ corsa: segno, memoria: segno.memoria }),
      rilascia: (g) => { dichiarato = g; return { ok: true }; },
      adesso: () => ORA + 40_000 + 21 * 60000,
      dorme: async () => {},
    });
    assert.equal(r.uscita, USCITA_FERMO);
    assert.match(dichiarato, /^guasto: strumento finish-check: processo ucciso \(137\) durante finish:check/);
    assert.match(dichiarato, /Ultimo strumento: Bash alle 19:06:00 UTC, con risposta, uscita 137\./);
  });

  test('l\'autopsia legge la corsa solo nella cartella del biglietto', () => {
    const root = repo();
    apriCorsa(root, { proc: { pid: 2 ** 22 + 7, on: () => {} }, memoria: () => ({}) });
    const memoria = () => ({ disponibileMb: 1 });
    assert.equal(autopsiaDelWorker(root, { mio: true }, { memoria }).corsa.pid, 2 ** 22 + 7);
    assert.equal(autopsiaDelWorker(root, { mio: false }, { memoria }).corsa, null);
  });

  test('un processo ucciso fuori da finish:check: il programma come gruppo, la causa se si legge', () => {
    assert.equal(testoUcciso({ programma: 'Node', codice: 137, cosa: 'x', memoria: null }),
      'guasto: strumento node: processo ucciso (137) durante x: causa non leggibile; memoria: non letta.');
  });
});

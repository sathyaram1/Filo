// #2571: tre primi lavori morti mentre aspettavano finish:check, con l'ultimo comando uscito 137 e la veglia che diceva
// «forse un permesso, forse il modello». Qui: la memoria vista dai comandi, il segno della corsa ucciso con SIGKILL, il
// guasto col 137 e la riga che il worker riceve per riprendere o rilasciare.

import '../helpers/senzaSessione.mjs';
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { cartellaTemporanea, togliCartella } from '../helpers/percorsi.mjs';
import { TETTO_ATTESA_MS } from '../helpers/attese.mjs';

const REPO = resolve(import.meta.dirname, '..', '..');
const { letturaMemoria, testoMemoria, cgroupDi, uccisiPerMemoria } = await import('../../scripts/lib/memoria-contenitore.mjs');
const {
  apriCorsa, corsaInterrotta, codiceDellaCorsa, fileCorsa, guastoDellaCorsa, testoPerIlWorker, testoUcciso, CODICE_SIGKILL,
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

  test('ucciso con SIGKILL il segno resta, col processo morto: la corsa è interrotta e la sua uscita è 137', { skip: process.platform === 'win32' }, async () => {
    const root = repo();
    const c = await lancia(root);
    assert.equal(corsaInterrotta(root), null, 'finché il processo vive la corsa non è interrotta');
    const finito = fine(c);
    c.kill('SIGKILL');
    assert.equal((await finito).segnale, 'SIGKILL');
    const s = corsaInterrotta(root);
    assert.ok(s, 'il segno è rimasto');
    assert.equal(s.fase, 'spec delle aree toccate — lotto 2/3');
    assert.equal(s.segnale, undefined);
    assert.equal(codiceDellaCorsa(s), CODICE_SIGKILL);
  });

  test('un segnale che node vede resta scritto, e un\'uscita normale toglie il segno', { skip: process.platform === 'win32' }, async () => {
    const root = repo();
    const c = await lancia(root);
    const finito = fine(c);
    c.kill('SIGTERM');
    assert.equal((await finito).codice, 143);
    const s = corsaInterrotta(root);
    assert.equal(s.segnale, 'SIGTERM');
    assert.equal(codiceDellaCorsa(s), 143);

    const pulito = repo();
    const modulo = pathToFileURL(join(REPO, 'scripts', 'lib', 'corsa-controlli.mjs')).href;
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
});

describe('il guasto di un processo ucciso', () => {
  const segno = {
    pid: 1, sha: 'abcdef1234567890', inizio: '2026-11-17T18:40:00Z', fase: 'spec delle aree toccate (190) — lotto 2/3', faseDa: '2026-11-17T19:01:00Z',
    memoria: letturaMemoria(leggiDa(contenitore({ oomCmd: 0, oomSis: 0 }))),
  };

  test('per il worker: cosa è morto, dove, la memoria, e il --guasto già scritto da copiare', () => {
    const adesso = letturaMemoria(leggiDa(contenitore({ oomCmd: 2, oomSis: 2 })));
    const g = guastoDellaCorsa(segno, adesso);
    assert.match(g, /^guasto: strumento finish-check: processo ucciso \(137\) durante finish:check \(fase spec delle aree toccate \(190\) — lotto 2\/3 dalle 19:01 UTC, partito alle 18:40 UTC su abcdef12\): il kernel ha ucciso processi per memoria; memoria: /);
    assert.match(g, /da allora: 2 nella macchina, 2 fra i comandi\.$/);
    const t = testoPerIlWorker(segno, adesso);
    assert.match(t, /^La corsa di finish:check è morta senza finire: processo ucciso \(137\)/);
    assert.match(t, /Rilanciala una volta, in sottofondo/);
    assert.ok(t.includes(`--guasto "${g}"`), t);
    assert.doesNotMatch(g, /["`$]/, 'il guasto sta fra virgolette doppie in una riga di comando');
    const senza = guastoDellaCorsa(segno, segno.memoria);
    assert.match(senza, /nessun processo ucciso per memoria, quindi un colpo da fuori dei comandi \(la sessione, l'harness o un riavvio del contenitore\)/);
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

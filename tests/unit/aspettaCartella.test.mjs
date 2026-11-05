// Il worker con solo da aspettare un suo comando in sottofondo ha un'attesa in primo piano che non chiede permessi
// (#2185): `aspetta <biglietto>` esce 0 quando nessun suo processo lavora più nella cartella, 5 a fetta finita.

import '../helpers/senzaSessione.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cartellaTemporanea, togliCartella } from '../helpers/percorsi.mjs';
import { aspettaCartella, testoAttesa, FETTA_MS, USCITA_LIBERA } from '../../scripts/lib/aspetta-cartella.mjs';
import { USCITA_LAVORO_VIVO } from '../../scripts/lib/branch-integrity.mjs';
import { FETTA_MS as FETTA_VEGLIA_MS } from '../../scripts/lib/veglia-worker.mjs';

const RADICE = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const CANALE = join(RADICE, 'scripts', 'routine-channel.mjs');
const T = 'C'.repeat(43);
const LINUX = process.platform === 'linux';
const vivo = (pid = 7) => ({ vivo: true, processiVisti: true, segni: [{ tipo: 'processo', pid, cmd: 'npm run finish:check', cwd: '/w' }], commit: null });
const libero = { vivo: false, processiVisti: true, segni: [], commit: null };

function orologio() {
  let t = 0;
  return { adesso: () => t, sleep: async (ms) => { t += ms; } };
}

// Le due attese in primo piano, del worker e di chi guida il giro, stanno sotto lo stesso tetto; il ruolo non scrive la
// durata a mano, così cambiarla non lascia indietro il testo che il worker legge.
test('le fette delle due attese restano sotto il timeout predefinito di una chiamata Bash, e il ruolo non le ricopia', () => {
  const TIMEOUT_BASH_MS = 120 * 1000;
  assert.ok(FETTA_MS < TIMEOUT_BASH_MS, 'aspetta');
  assert.ok(FETTA_VEGLIA_MS < TIMEOUT_BASH_MS, 'veglia');
  const contratto = readFileSync(join(RADICE, 'routines', 'roles', '_contratto-worker.md'), 'utf8').replace(/\s+/g, ' ');
  const da = contratto.indexOf('aspetta <biglietto>');
  assert.ok(da >= 0);
  assert.doesNotMatch(contratto.slice(da, da + 200), /\bsecondi\b|\d+\s*s\b/);
});

test('l’attesa e il rilascio del worker leggono lo stesso criterio di lavoro vivo', () => {
  const sorgente = readFileSync(CANALE, 'utf8');
  assert.doesNotMatch(sorgente, /cosa:\s*\[\s*'processi'\s*\]/, 'un criterio scritto a mano');
  assert.equal(sorgente.match(/cosa: SEGNI_RILASCIO_WORKER\b/g)?.length, 2);
});

test('l’elenco d’uso del canale nomina ogni suo comando', () => {
  const sorgente = readFileSync(CANALE, 'utf8');
  const elenco = (sorgente.match(/Uso: node "\$\{io\}" <([a-z|-]+)>/) || [])[1];
  assert.ok(elenco, 'la riga d’uso c’è');
  const comandi = [...new Set([...sorgente.matchAll(/cmd === '([a-z-]+)'/g)].map((m) => m[1]))];
  assert.deepEqual(comandi.filter((c) => !elenco.split('|').includes(c)), []);
});

test('esce 0 appena il processo finisce, senza aspettare il resto della fetta', async () => {
  const o = orologio();
  const letture = [vivo(), vivo(), libero];
  const r = await aspettaCartella({ controlla: () => letture.shift(), ...o, fetta: 60000, passo: 5000 });
  assert.equal(r.uscita, USCITA_LIBERA);
  assert.equal(o.adesso(), 10000);
  assert.match(r.testo, /Finito: nessun tuo processo lavora più nella cartella/);
});

test('a fetta finita esce 5, dice chi lavora e di rilanciare', async () => {
  const o = orologio();
  const r = await aspettaCartella({ controlla: () => vivo(42), ...o, fetta: 12000, passo: 5000 });
  assert.equal(r.uscita, USCITA_LAVORO_VIVO);
  assert.equal(o.adesso(), 12000, 'l’ultimo passo si accorcia sulla fetta');
  assert.match(r.testo, /processo 42 «npm run finish:check»/);
  assert.match(r.testo, /Rilancia lo stesso comando, subito: ogni chiamata aspetta al massimo 12 secondi/);
});

test('dove i processi non si leggono non finge di aver visto la fine', () => {
  assert.match(testoAttesa({ vivo: false, processiVisti: false, segni: [] }, USCITA_LIBERA), /i processi non si leggono/);
});

const canale = (cwd, env, ...args) => new Promise((ok) => {
  const p = spawn(process.execPath, [CANALE, ...args], { cwd, env: { ...process.env, FILO_REPO_ROOT: cwd, FILO_NO_BEAT: '1', ...env } });
  let so = ''; let se = '';
  p.stdout.on('data', (c) => { so += c; });
  p.stderr.on('data', (c) => { se += c; });
  p.on('close', (code) => ok({ code, so, se }));
});

test('aspetta <biglietto> sul processo vero: 5 mentre lavora, 0 quando ha finito', { skip: !LINUX && 'i processi si leggono da /proc' }, async () => {
  const dir = cartellaTemporanea('aspetta-');
  // Un comando in sottofondo del worker: un'altra sessione, la cartella di lavoro è la sua.
  const lungo = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { cwd: dir, detached: true, stdio: 'ignore' });
  lungo.unref();
  try {
    const presto = await canale(dir, { FILO_ASPETTA_FETTA_MS: '1500' }, 'aspetta', T);
    assert.equal(presto.code, USCITA_LAVORO_VIVO, presto.se);
    assert.match(presto.so, new RegExp(`processo ${lungo.pid}`));

    // Finisce durante l'attesa: la prima lettura lo vede ancora, una delle successive no.
    const breve = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 900)'], { cwd: dir, detached: true, stdio: 'ignore' });
    breve.unref();
    process.kill(lungo.pid);
    const fine = await canale(dir, { FILO_ASPETTA_FETTA_MS: '30000' }, 'aspetta', T);
    assert.equal(fine.code, USCITA_LIBERA, fine.so + fine.se);
    assert.match(fine.so, /Finito: nessun tuo processo/);
  } finally {
    try { process.kill(lungo.pid); } catch (_) { /* già uscito */ }
    togliCartella(dir);
  }
});

test('aspetta senza il biglietto, o con altro, non aspetta niente', async () => {
  const dir = cartellaTemporanea('aspetta-uso-');
  try {
    for (const args of [['aspetta'], ['aspetta', 'corto'], ['aspetta', T, 'altro']]) {
      const r = await canale(dir, {}, ...args);
      assert.equal(r.code, 1, args.join(' '));
    }
  } finally {
    togliCartella(dir);
  }
});

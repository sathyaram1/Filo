// Come si apre Electron su Linux senza schermo: `xvfb-run -a` davanti a un comando (`preparaLancioElectron`, gli
// script) o acceso dentro un processo già partito (`accendiSchermo`, il globalSetup di Playwright, #739), con la sandbox
// spenta; senza xvfb uno stop che dice cosa manca. Windows e Mac: invariato. Unit test: tests/unit/schermoVirtuale.test.mjs.

import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { datiWorker, displayDelWorker } from './dati-worker.mjs';

const vuota = (v) => !String(v ?? '').trim();
const VARIABILI = ['DISPLAY', 'XAUTHORITY', 'ELECTRON_DISABLE_SANDBOX'];

/** Linux senza DISPLAY né WAYLAND_DISPLAY: Electron lì non parte. PURA. */
export function senzaSchermo({ platform = process.platform, env = process.env } = {}) {
  return platform === 'linux' && vuota(env.DISPLAY) && vuota(env.WAYLAND_DISPLAY);
}

export function xvfbDisponibile() {
  return spawnSync('sh', ['-c', 'command -v xvfb-run'], { stdio: 'ignore' }).status === 0;
}

/**
 * Cosa serve qui per aprire Electron: `{ serve: false }`, `{ serve: true, ok: false, motivo }` oppure
 * `{ serve: true, ok: true, xvfb, sandbox }`, con `xvfb` gli argomenti di `xvfb-run` prima del comando. PURA se
 * `haXvfb` è una funzione finta.
 */
export function pianoSchermo({ platform = process.platform, env = process.env, haXvfb = xvfbDisponibile, worker } = {}) {
  if (!senzaSchermo({ platform, env })) return { serve: false };
  // Il marcatore del clone si legge solo con l'ambiente vero: chi passa un ambiente suo (i test) decide tutto lui.
  const w = worker !== undefined ? worker : datiWorker({ env, root: env === process.env ? process.cwd() : null });
  // Worker in parallelo (#1157): ognuno cerca il display libero da una base sua.
  const base = w && w.indice ? ['-n', String(displayDelWorker(w.indice))] : [];
  // Senza xvfb ogni spec esce rosso in trecento millisecondi, e sessanta rossi finti sembrano del codice.
  if (!haXvfb()) {
    return {
      serve: true,
      ok: false,
      motivo: 'Linux senza schermo (DISPLAY vuoto) e xvfb-run non c\'è: Electron non partirebbe e ogni spec'
        + ' uscirebbe rosso subito, senza dire niente del codice. Installa xvfb (`apt-get install -y xvfb`) e rilancia.',
    };
  }
  return { serve: true, ok: true, xvfb: ['-a', ...base], sandbox: vuota(env.ELECTRON_DISABLE_SANDBOX) ? '1' : env.ELECTRON_DISABLE_SANDBOX };
}

/**
 * Il lancio pronto: `{ ok, cmd, args, env, nota }`, oppure `{ ok: false, motivo }`. PURA se `haXvfb` è una funzione
 * finta. `env` è undefined quando l'ambiente resta quello di chi chiama.
 */
export function preparaLancioElectron(cmd, args = [], opzioni = {}) {
  const { env = process.env } = opzioni;
  const p = pianoSchermo(opzioni);
  if (!p.serve) return { ok: true, cmd, args, env: undefined, nota: '' };
  if (!p.ok) return { ok: false, motivo: p.motivo };
  return {
    ok: true,
    cmd: 'xvfb-run',
    args: [...p.xvfb, cmd, ...args],
    env: { ...env, ELECTRON_DISABLE_SANDBOX: p.sandbox },
    nota: `Linux senza schermo: gli spec partono dentro \`xvfb-run ${p.xvfb.join(' ')}\`, con ELECTRON_DISABLE_SANDBOX=1.`,
  };
}

// Il figlio di xvfb-run dice dove sta lo schermo e aspetta la fine del suo stdin: quando chi l'ha acceso si chiude,
// anche ucciso, il figlio esce e xvfb-run spegne Xvfb.
const TIENI_SCHERMO = 'printf "%s\\n%s\\n" "$DISPLAY" "$XAUTHORITY"; exec cat >/dev/null';

/**
 * Per un processo già partito, i cui figli ereditano `env`: su Linux senza schermo accende Xvfb e scrive in `env`
 * DISPLAY, XAUTHORITY e la sandbox spenta. `{ display, nota, spegni }`: `spegni` chiude Xvfb e rimette `env` com'era
 * (la UI di Playwright rifà il globalSetup). Senza xvfb, o se Xvfb non si accende, l'errore dice cosa manca.
 */
export async function accendiSchermo({ env = process.env, attesaMs = 30_000, lancia = spawn, ...opzioni } = {}) {
  const p = pianoSchermo({ env, ...opzioni });
  if (!p.serve) return { display: '', nota: '', spegni: async () => {} };
  if (!p.ok) throw new Error(p.motivo);

  // L'autorizzazione la tiene chi accende: quella che xvfb-run crea da sé, se sparisce prima di lui (la temporanea della
  // corsa se ne va all'uscita), gli fa saltare lo spegnimento di Xvfb.
  const cartellaAuth = mkdtempSync(join(tmpdir(), 'filo-schermo-'));
  const auth = join(cartellaAuth, 'Xauthority');
  writeFileSync(auth, '', { mode: 0o600 });
  const togliAuth = () => { try { rmSync(cartellaAuth, { recursive: true, force: true }); } catch (_) {} };
  // Gruppo suo: il Ctrl+C del terminale non spegne lo schermo sotto agli spec che chiudono.
  const figlio = lancia('xvfb-run', [...p.xvfb, '-f', auth, 'sh', '-c', TIENI_SCHERMO], { env, stdio: ['pipe', 'pipe', 'pipe'], detached: true });
  const uccidi = () => { try { process.kill(-figlio.pid, 'SIGTERM'); } catch (_) { try { figlio.kill('SIGTERM'); } catch (_) {} } };
  let fuori = '';
  let errori = '';
  const esito = await new Promise((risolvi) => {
    const fine = (e) => { clearTimeout(tetto); risolvi(e); };
    const tetto = setTimeout(() => fine({ errore: `lo schermo virtuale non si è acceso in ${Math.round(attesaMs / 100) / 10} s` }), attesaMs);
    figlio.stdout.on('data', (d) => {
      fuori += d;
      const righe = fuori.split('\n');
      if (righe.length >= 3) fine({ display: righe[0].trim(), xauthority: righe[1].trim() });
    });
    figlio.stderr.on('data', (d) => { errori = (errori + d).slice(-2000); });
    figlio.on('error', (e) => fine({ errore: `xvfb-run non si avvia: ${e.message}` }));
    figlio.on('exit', (codice, segnale) => fine({ errore: `xvfb-run è uscito (${segnale || codice}) prima di accendere lo schermo` }));
  });
  if (!esito.errore && !/^:\d+$/.test(esito.display)) esito.errore = `xvfb-run ha dato un display che non si capisce: ${JSON.stringify(esito.display)}`;
  if (esito.errore) {
    uccidi();
    togliAuth();
    const dettaglio = (errori || fuori).trim();
    throw new Error(`Linux senza schermo: ${esito.errore}, e senza Electron ogni spec uscirebbe rosso subito.`
      + `${dettaglio ? ` xvfb-run dice: ${dettaglio}` : ''}`);
  }

  const prima = Object.fromEntries(VARIABILI.map((k) => [k, env[k]]));
  env.DISPLAY = esito.display;
  if (esito.xauthority) env.XAUTHORITY = esito.xauthority;
  env.ELECTRON_DISABLE_SANDBOX = p.sandbox;
  // Uno schermo acceso non tiene in vita chi l'ha acceso: se esce senza spegnerlo, lo stdin si chiude e basta.
  figlio.unref();
  for (const s of [figlio.stdin, figlio.stdout, figlio.stderr]) s?.unref?.();

  let spento = null;
  const spegni = () => spento || (spento = new Promise((risolvi) => {
    for (const k of VARIABILI) { if (prima[k] === undefined) delete env[k]; else env[k] = prima[k]; }
    const fatto = () => { togliAuth(); risolvi(); };
    if (figlio.exitCode !== null || figlio.signalCode !== null) return fatto();
    figlio.ref();
    const tetto = setTimeout(() => { uccidi(); fatto(); }, 5_000);
    figlio.once('exit', () => { clearTimeout(tetto); fatto(); });
    figlio.stdin.end();
  }));
  return {
    display: esito.display,
    nota: `Linux senza schermo: gli spec partono sullo schermo virtuale ${esito.display} (xvfb-run ${p.xvfb.join(' ')}),`
      + ' con ELECTRON_DISABLE_SANDBOX=1.',
    spegni,
  };
}

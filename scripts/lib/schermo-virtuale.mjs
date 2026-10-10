// Come uno script lancia un comando che apre Electron: su Linux senza schermo ci mette davanti
// `xvfb-run -a` e ELECTRON_DISABLE_SANDBOX=1, o si ferma dicendo cosa manca. Windows e Mac: invariato.
// Unit test: tests/unit/schermoVirtuale.test.mjs.

import { spawnSync } from 'node:child_process';
import { datiWorker, displayDelWorker } from './dati-worker.mjs';

const vuota = (v) => !String(v ?? '').trim();

/** Linux senza DISPLAY né WAYLAND_DISPLAY: Electron lì non parte. PURA. */
export function senzaSchermo({ platform = process.platform, env = process.env } = {}) {
  return platform === 'linux' && vuota(env.DISPLAY) && vuota(env.WAYLAND_DISPLAY);
}

export function xvfbDisponibile() {
  return spawnSync('sh', ['-c', 'command -v xvfb-run'], { stdio: 'ignore' }).status === 0;
}

/**
 * Il lancio pronto: `{ ok, cmd, args, env, nota }`, oppure `{ ok: false, motivo }`. PURA se
 * `haXvfb` è una funzione finta. `env` è undefined quando l'ambiente resta quello di chi chiama.
 */
export function preparaLancioElectron(cmd, args = [], { platform = process.platform, env = process.env, haXvfb = xvfbDisponibile, worker } = {}) {
  if (!senzaSchermo({ platform, env })) return { ok: true, cmd, args, env: undefined, nota: '' };
  // Il marcatore del clone si legge solo con l'ambiente vero: chi passa un ambiente suo (i test) decide tutto lui.
  const w = worker !== undefined ? worker : datiWorker({ env, root: env === process.env ? process.cwd() : null });
  // Worker in parallelo (#1157): ognuno cerca il display libero da una base sua.
  const base = w && w.indice ? ['-n', String(displayDelWorker(w.indice))] : [];
  // Senza xvfb ogni spec esce rosso in trecento millisecondi, e sessanta rossi finti sembrano del codice.
  if (!haXvfb()) {
    return {
      ok: false,
      motivo: 'Linux senza schermo (DISPLAY vuoto) e xvfb-run non c\'è: Electron non partirebbe e ogni spec'
        + ' uscirebbe rosso subito, senza dire niente del codice. Installa xvfb (`apt-get install -y xvfb`) e rilancia.',
    };
  }
  return {
    ok: true,
    cmd: 'xvfb-run',
    args: ['-a', ...base, cmd, ...args],
    env: { ...env, ELECTRON_DISABLE_SANDBOX: vuota(env.ELECTRON_DISABLE_SANDBOX) ? '1' : env.ELECTRON_DISABLE_SANDBOX },
    nota: `Linux senza schermo: gli spec partono dentro \`xvfb-run -a${base.length ? ` -n ${base[1]}` : ''}\`, con ELECTRON_DISABLE_SANDBOX=1.`,
  };
}

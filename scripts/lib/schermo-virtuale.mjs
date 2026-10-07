// Come uno script lancia un comando che apre Electron: su Linux senza schermo ci mette davanti
// `xvfb-run -a` e ELECTRON_DISABLE_SANDBOX=1, o si ferma dicendo cosa manca. Windows e Mac: invariato.
// Unit test: tests/unit/schermoVirtuale.test.mjs.

import { spawnSync } from 'node:child_process';

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
export function preparaLancioElectron(cmd, args = [], { platform = process.platform, env = process.env, haXvfb = xvfbDisponibile } = {}) {
  if (!senzaSchermo({ platform, env })) return { ok: true, cmd, args, env: undefined, nota: '' };
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
    args: ['-a', cmd, ...args],
    env: { ...env, ELECTRON_DISABLE_SANDBOX: vuota(env.ELECTRON_DISABLE_SANDBOX) ? '1' : env.ELECTRON_DISABLE_SANDBOX },
    nota: 'Linux senza schermo: gli spec partono dentro `xvfb-run -a`, con ELECTRON_DISABLE_SANDBOX=1.',
  };
}

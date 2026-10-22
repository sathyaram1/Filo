// Filo guidato dall'ispettore del main, senza Playwright sulle pagine: Playwright emula il fuoco su ogni pagina che
// aggancia e Chromium la tiene visibile anche dietro un'altra scheda. Per ciò che cambia a pagina nascosta.
// Regole: patterns/una-pagina-agganciata-da-playwright-non-e-mai-nascosta.md

import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { rmSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { argomentiScala } from './scala.mjs';
import { cartellaTemporanea } from './percorsi.mjs';

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const ELETTRONE = createRequire(import.meta.url)('electron');
const PARTENZA_MS = 30_000;
const RIGHE = 400;

/**
 * Apre Filo con un profilo vuoto. `evaluate(fn, arg)` gira nel main come `app.evaluate` di Playwright (fn riceve il
 * modulo electron); `nelFrame(url, codice)` esegue `codice` nel mondo della pagina del frame a quell'indirizzo.
 */
export async function apriFiloSenzaPlaywright({ args = [], env = {} } = {}) {
  if (typeof globalThis.WebSocket !== 'function') throw new Error('serve Node 22 o più nuovo: manca WebSocket');
  const userData = cartellaTemporanea('filo-senza-pw-');
  const gruppo = process.platform !== 'win32';
  const proc = spawn(ELETTRONE, ['--inspect=0', ...argomentiScala, ...args, '.'], {
    cwd: APP_ROOT,
    env: { ...process.env, FILO_USER_DATA: userData, FILO_DOWNLOAD_DIR: join(userData, 'downloads'), NODE_ENV: 'test', ...env },
    detached: gruppo,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const righe = [];
  const uscita = () => righe.join('\n');
  let trovaIndirizzo;
  const indirizzo = new Promise((ok) => { trovaIndirizzo = ok; });
  for (const canale of [proc.stdout, proc.stderr]) {
    canale.setEncoding('utf8');
    canale.on('data', (pezzo) => {
      for (const r of pezzo.split('\n')) {
        righe.push(r);
        if (righe.length > RIGHE) righe.shift();
        const m = /Debugger listening on (ws:\/\/\S+)/.exec(r);
        if (m) trovaIndirizzo(m[1]);
      }
    });
  }
  const morto = new Promise((ok) => proc.once('exit', ok));

  const ammazza = () => {
    try { if (gruppo) process.kill(-proc.pid, 'SIGKILL'); else proc.kill('SIGKILL'); } catch (_) { try { proc.kill('SIGKILL'); } catch (_) {} }
  };
  const scadenza = (ms, cosa) => new Promise((_, ko) => { const t = setTimeout(() => ko(new Error(`${cosa}\n${uscita()}`)), ms); t.unref?.(); });

  let sock;
  try {
    const url = await Promise.race([indirizzo, morto.then(() => { throw new Error(`Filo è uscito prima di aprire l'ispettore\n${uscita()}`); }),
      scadenza(PARTENZA_MS, 'l\'ispettore del main non è comparso')]);
    sock = new WebSocket(url);
    await new Promise((ok, ko) => { sock.onopen = ok; sock.onerror = () => ko(new Error(`ispettore irraggiungibile\n${uscita()}`)); });
  } catch (e) {
    ammazza();
    throw e;
  }

  let n = 0;
  const attese = new Map();
  sock.onmessage = (e) => {
    const m = JSON.parse(String(e.data));
    const a = m.id && attese.get(m.id);
    if (!a) return;
    attese.delete(m.id);
    if (m.error) a.ko(new Error(m.error.message));
    else a.ok(m.result);
  };
  const manda = (method, params) => new Promise((ok, ko) => {
    const id = ++n;
    attese.set(id, { ok, ko });
    sock.send(JSON.stringify({ id, method, params }));
  });

  async function grezzo(expression) {
    const r = await manda('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) {
      const d = r.exceptionDetails;
      throw new Error(`nel main: ${(d.exception && d.exception.description) || d.text}`);
    }
    return r.result.value;
  }

  const evaluate = (fn, arg) => grezzo(`(async () => (${fn.toString()})(process.mainModule.require('electron'), ${JSON.stringify(arg ?? null)}))()`);

  // Il frame si cerca a ogni chiamata: una scheda ricreata (proxy, crash) ha frame nuovi.
  function nelFrame(url, codice) {
    return evaluate(({ webContents }, a) => {
      for (const wc of webContents.getAllWebContents()) {
        let frames = [];
        try { frames = wc.mainFrame.framesInSubtree; } catch (_) { continue; }
        const f = frames.find((x) => x.url === a.url);
        if (f) return f.executeJavaScript(a.codice);
      }
      return undefined;
    }, { url, codice });
  }

  async function chiudi() {
    try { await Promise.race([evaluate(({ app }) => { setTimeout(() => app.quit(), 0); return true; }), scadenza(2000, 'quit')]); } catch (_) {}
    try { sock.close(); } catch (_) {}
    await Promise.race([morto, new Promise((ok) => setTimeout(ok, 5000).unref?.())]);
    ammazza();
    try { rmSync(userData, { recursive: true, force: true }); } catch (_) {}
  }

  // Un `require('electron')` chiesto mentre il main di Filo parte ancora gli ha rotto l'avvio («BrowserWindow is not a
  // constructor», due avvii su dodici): prima si aspetta, senza require, un segno che il suo main è caricato.
  try {
    const inizio = Date.now();
    const pronta = async () => (await grezzo('typeof globalThis.SN_EXECUTE_FILO_ACTION === \'function\'').catch(() => false))
      && evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().some((w) => w._filoTabs && w._filoTabs.tabs.length > 0)).catch(() => false);
    while (!(await pronta())) {
      if (Date.now() - inizio > PARTENZA_MS) throw new Error(`la finestra di Filo non è nata\n${uscita()}`);
      await new Promise((ok) => setTimeout(ok, 200));
    }
  } catch (e) {
    await chiudi();
    throw e;
  }

  return { evaluate, nelFrame, chiudi, uscita };
}

// dichiara-spinte.mjs — le spinte col biglietto di chi spinge (#1362). `--pre-push <app|server> <radice> [<url>]`: il
// pre-push di git (scripts/lib/copie-di-dati.mjs) accoda i commit che la sessione ha creato e lancia l'invio in
// sottofondo; non ferma mai un push. `--invia <radice>`: dichiara la coda al server. Regole: scripts/lib/spinte.mjs.

import { execFileSync, spawn } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as S from './lib/spinte.mjs';

const QUI = fileURLToPath(import.meta.url);
// Il checkout di Filo di questo script: lì vivono i biglietti locali anche quando spinge il clone di filo-security.
const FILO = resolve(dirname(QUI), '..');
// L'invio in sottofondo aspetta un attimo: le spinte di un salvataggio dopo l'altro partono insieme.
const ATTESA_INVIO_MS = 2000;

async function leggiStdin() {
  if (process.stdin.isTTY) return '';
  const pezzi = [];
  for await (const p of process.stdin) pezzi.push(p);
  return Buffer.concat(pezzi).toString('utf8');
}

function origine(radice) {
  try {
    return execFileSync('git', ['remote', 'get-url', '--push', 'origin'], { cwd: radice, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch (_) {
    return '';
  }
}

/** Il pre-push: accoda e lancia l'invio. → quante spinte ha accodato. Mai un'eccezione verso git. */
export async function prePush({ repo, radice, url = '', righe, env = process.env, lanciaInvio = lancia } = {}) {
  if (repo !== 'app' && repo !== 'server') return 0;
  // Dove va la spinta lo dice git (il secondo argomento del pre-push); senza, l'origin.
  if (!S.origineDelRegistro(url || origine(radice), repo)) return 0;
  const chi = S.chiSpinge({ root: repo === 'server' ? FILO : radice, env });
  if (!chi) return 0;
  const spinte = S.spinteDelPrePush(radice, righe);
  const n = S.accoda(radice, chi, repo, spinte);
  if (n && !env.FILO_SPINTE_SENZA_INVIO) lanciaInvio(radice, env);
  return n;
}

function lancia(radice, env) {
  const figlio = spawn(process.execPath, [QUI, '--invia', radice, '--attendi', String(ATTESA_INVIO_MS)], {
    detached: true, stdio: 'ignore', env, windowsHide: true,
  });
  figlio.unref();
}

async function main(argv) {
  const [modo, a, b, ...resto] = argv;
  if (modo === '--pre-push') {
    await prePush({ repo: a, radice: resolve(b || process.cwd()), url: resto[0] || '', righe: await leggiStdin() });
    return 0;
  }
  if (modo === '--invia') {
    const i = resto.indexOf('--attendi');
    const attendiMs = b === '--attendi' ? Number(resto[0]) || 0 : i >= 0 ? Number(resto[i + 1]) || 0 : 0;
    const r = await S.inviaSpinte({ root: resolve(a || process.cwd()), deps: attendiMs ? { attendiMs } : {} });
    const riga = S.rigaSpinte(r);
    if (riga) console.error(riga);
    return 0;
  }
  console.error('Uso: node scripts/dichiara-spinte.mjs --pre-push <app|server> <radice> [<url>] | --invia <radice>');
  return 2;
}

const lanciato = (() => { try { return realpathSync(process.argv[1]); } catch (_) { return resolve(process.argv[1] || ''); } })();
if (process.argv[1] && lanciato === QUI) {
  main(process.argv.slice(2)).then((code) => { process.exitCode = code; }, (e) => {
    console.error(`dichiara-spinte: ${String((e && e.message) || e)}`);
    // Un guasto qui non ferma mai un push: le spinte non accodate restano di nessuno, cioè buco al controllo.
    process.exitCode = 0;
  });
}

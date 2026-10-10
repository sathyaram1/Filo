// Lancia il server finto di config/routines (finto-config-routines.mjs) per i test dei comandi: una strada sola, perché
// le copie nei file divergevano e una dava al server quindici secondi per partire (#1063). Si aspetta la porta, non un
// tempo: il tetto è solo contro un figlio muto, e chi non risponde si chiude, o terrebbe aperto il file dei test.
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { TETTO_ATTESA_MS } from './attese.mjs';

const SERVER = fileURLToPath(new URL('./finto-config-routines.mjs', import.meta.url));

/** { url, kill }: `env` arriva al server (FINTO_CAPS, FINTO_STATUS, FINTO_RICHIEDI_BEARER). */
export async function avviaConfigRoutinesFinto(env = {}) {
  const p = spawn(process.execPath, [SERVER], { env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  const kill = () => { try { p.kill(); } catch (_) { /* già morto */ } };
  let scade = null;
  try {
    const port = await new Promise((ok, no) => {
      let so = '';
      p.stdout.on('data', (c) => { so += c; const m = so.match(/PORT=(\d+)/); if (m) ok(Number(m[1])); });
      p.on('error', no);
      p.on('exit', (code) => no(new Error(`server finto uscito con ${code}`)));
      scade = setTimeout(() => no(new Error(`server finto: nessuna porta entro ${TETTO_ATTESA_MS / 1000} s`)), TETTO_ATTESA_MS);
      scade.unref();
    });
    // Il figlio non deve tenere in vita il processo dei test: senza unref il runner aspettava per sempre la fine del server.
    p.unref(); p.stdout.unref(); p.stderr.unref();
    return { url: `http://127.0.0.1:${port}/config/routines`, kill };
  } catch (e) {
    kill();
    throw e;
  } finally {
    clearTimeout(scade);
  }
}

// `npm start` e `npm run dev`: Electron col motore senza privilegi file:// come il pacchetto (lib/fusibili-electron.js),
// anche da un clone che usa i moduli di un'altra cartella: lì la copia spenta nella cache, come nelle prove. Un motore
// scelto da chi lancia resta il suo; se il fusibile non si spegne Filo parte lo stesso, e lo dice.

import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);

export function envDiAvvio({ radice = ROOT, env = process.env, motore = null } = {}) {
  const out = { ...env };
  if (String(out.ELECTRON_OVERRIDE_DIST_PATH || '').trim()) return { env: out, nota: null };
  try {
    const F = require('./lib/fusibili-electron.js');
    const m = motore ? motore() : F.motoreSenzaPrivilegi({ radice, cache: F.cartellaDelleCopie() });
    if (m.errore) return { env: out, nota: `[avvio] Electron resta coi privilegi file:// di fabbrica: ${m.errore}` };
    if (m.copia) out.ELECTRON_OVERRIDE_DIST_PATH = m.dist;
    return { env: out, nota: null };
  } catch (e) {
    return { env: out, nota: `[avvio] fusibile di Electron non controllato: ${e && e.message ? e.message : e}` };
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { env, nota } = envDiAvvio();
  if (nota) console.log(nota);
  const cli = require.resolve('electron/cli.js', { paths: [ROOT] });
  const figlio = spawn(process.execPath, [cli, '.', ...process.argv.slice(2)], { stdio: 'inherit', env, cwd: ROOT });
  for (const s of ['SIGINT', 'SIGTERM']) process.on(s, () => { try { figlio.kill(s); } catch (_) {} });
  figlio.on('close', (code) => process.exit(code === null ? 1 : code));
}

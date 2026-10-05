// Il globalSetup di Playwright: toglie le cartelle delle corse uccise e dà alla corsa una temporanea sua, ereditata da
// lavoratori ed Electron, che se ne va con lei (#717): Chromium ci lascia una cartella a ogni avvio. Le regole stanno in
// tests/helpers/percorsi.mjs, insieme a chi le crea.
import { rmSync } from 'node:fs';
import { temporaneaDellaCorsa, togliCartelleOrfane } from '../helpers/percorsi.mjs';

export default function primaDellaCorsa() {
  togliCartelleOrfane({ annuncia: (n) => console.error(`[test] tolgo ${n} cartelle temporanee lasciate da prove interrotte`) });
  const temp = temporaneaDellaCorsa();
  Object.assign(process.env, { TMPDIR: temp, TEMP: temp, TMP: temp });
  return () => { try { rmSync(temp, { recursive: true, force: true, maxRetries: 2, retryDelay: 100 }); } catch (_) {} };
}

// Il globalSetup di Playwright: dà alla corsa una temporanea sua, ereditata da lavoratori ed Electron, che se ne va con
// lei (#717): Chromium ci lascia una cartella a ogni avvio. Chi la crea toglie prima i resti delle corse uccise. Le regole
// stanno in tests/helpers/percorsi.mjs, insieme a chi le crea.
import { rmSync } from 'node:fs';
import { temporaneaDellaCorsa } from '../helpers/percorsi.mjs';

export default function primaDellaCorsa() {
  const temp = temporaneaDellaCorsa();
  Object.assign(process.env, { TMPDIR: temp, TEMP: temp, TMP: temp });
  return () => { try { rmSync(temp, { recursive: true, force: true, maxRetries: 2, retryDelay: 100 }); } catch (_) {} };
}

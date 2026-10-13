// Il globalSetup di Playwright: si ferma se il motore non è quello del lock (tests/helpers/motoreDelleProve.mjs), poi dà
// alla corsa una temporanea sua, ereditata da lavoratori ed Electron, che se ne va con lei (#717): Chromium ci lascia una
// cartella a ogni avvio. Chi la crea toglie prima i resti delle corse uccise. Regole in tests/helpers/percorsi.mjs.
import { dirname } from 'node:path';
import { motoreDelleProve } from '../helpers/motoreDelleProve.mjs';
import { temporaneaDellaCorsa, togliCartella } from '../helpers/percorsi.mjs';

export default function primaDellaCorsa(config) {
  const motore = motoreDelleProve(config?.configFile ? { radice: dirname(config.configFile) } : {});
  if (!motore.ok && !String(process.env.ELECTRON_OVERRIDE_DIST_PATH || '').trim()) throw new Error(motore.motivo);
  if (!motore.ok) console.warn(motore.motivo);
  const temp = temporaneaDellaCorsa();
  Object.assign(process.env, { TMPDIR: temp, TEMP: temp, TMP: temp });
  return () => { try { togliCartella(temp, { tentativi: 2, attesa: 100 }); } catch (_) {} };
}

// Il globalSetup di Playwright: dà alla corsa una temporanea sua, ereditata da lavoratori ed Electron, che se ne va con
// lei (#717): Chromium ci lascia una cartella a ogni avvio. Chi la crea toglie prima i resti delle corse uccise. Le regole
// stanno in tests/helpers/percorsi.mjs, insieme a chi le crea.
import { temporaneaDellaCorsa, togliCartella } from '../helpers/percorsi.mjs';

export default function primaDellaCorsa() {
  const temp = temporaneaDellaCorsa();
  Object.assign(process.env, { TMPDIR: temp, TEMP: temp, TMP: temp });
  return () => { try { togliCartella(temp, { tentativi: 2, attesa: 100 }); } catch (_) {} };
}

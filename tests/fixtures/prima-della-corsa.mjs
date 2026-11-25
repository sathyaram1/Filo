// Il globalSetup di Playwright, che prepara ciò che lavoratori ed Electron ereditano: si ferma sul motore sbagliato
// (tests/helpers/motoreDelleProve.mjs), lo vuole senza privilegi file:// come il pacchetto (lib/fusibili-electron.js), su
// Linux senza schermo accende Xvfb (#739) e dà alla corsa una temporanea sua che se ne va con lei (#717, helpers/percorsi.mjs).
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { datiWorker } from '../../scripts/lib/dati-worker.mjs';
import { accendiSchermi } from '../../scripts/lib/schermo-virtuale.mjs';
import { allineaPerLeProve } from '../../scripts/lib/pacchetti.mjs';
import { assicuraMotore } from '../helpers/motoreDelleProve.mjs';
import { chiudiLaCorsa, temporaneaDellaCorsa } from '../helpers/percorsi.mjs';

const { motoreSenzaPrivilegi } = createRequire(import.meta.url)('../../scripts/lib/fusibili-electron.js');

// Il motore si controlla prima di qualunque attesa: sul motore sbagliato si ferma subito, senza aver acceso niente.
export default function primaDellaCorsa(config) {
  const radice = config?.configFile ? dirname(config.configFile) : null;
  assicuraMotore(radice ? { radice } : {});
  // Una libreria nuova del lock arriva prima degli spec che la usano (#1572).
  if (radice) allineaPerLeProve(radice, { prefisso: '[prove]' });
  if (radice) senzaPrivilegiFile(radice);
  return preparaLaCorsa(radice, config?.workers);
}

// La copia del motore sta nei moduli di questo checkout, non nella temporanea della corsa: resta per le corse dopo.
// Un motore scelto da chi lancia resta il suo.
function senzaPrivilegiFile(radice) {
  if (String(process.env.ELECTRON_OVERRIDE_DIST_PATH || '').trim()) return;
  const m = motoreSenzaPrivilegi({ radice, cache: join(radice, 'node_modules', '.cache', 'filo-motori') });
  if (m.errore) console.error(`[prove] Electron resta coi privilegi file:// di fabbrica (${m.errore}): le prove delle pagine del computer lo diranno.`);
  else if (m.copia) process.env.ELECTRON_OVERRIDE_DIST_PATH = m.dist;
}

async function preparaLaCorsa(radice, quanti) {
  // La base del display è quella del worker (#1157), nel marcatore del clone a cui appartiene la config; uno schermo per
  // lavoratore di Playwright (#2133), che la config assegna a ognuno.
  const schermo = await accendiSchermi({ quanti, ...(radice ? { worker: datiWorker({ root: radice }) } : {}) });
  if (schermo.nota) console.error(schermo.nota);
  const temp = temporaneaDellaCorsa();
  Object.assign(process.env, { TMPDIR: temp, TEMP: temp, TMP: temp });
  return async () => {
    await schermo.spegni();
    chiudiLaCorsa(temp);
  };
}

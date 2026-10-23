// Il globalSetup di Playwright, che prepara ciò che lavoratori ed Electron ereditano: si ferma sul motore sbagliato
// (tests/helpers/motoreDelleProve.mjs), su Linux senza schermo accende Xvfb (scripts/lib/schermo-virtuale.mjs, #739) e dà
// alla corsa una temporanea sua che se ne va con lei (#717, regole in tests/helpers/percorsi.mjs).
import { dirname } from 'node:path';
import { datiWorker } from '../../scripts/lib/dati-worker.mjs';
import { accendiSchermo } from '../../scripts/lib/schermo-virtuale.mjs';
import { allineaPerLeProve } from '../../scripts/lib/pacchetti.mjs';
import { assicuraMotore } from '../helpers/motoreDelleProve.mjs';
import { temporaneaDellaCorsa, togliCartella } from '../helpers/percorsi.mjs';

// Il motore si controlla prima di qualunque attesa: sul motore sbagliato si ferma subito, senza aver acceso niente.
export default function primaDellaCorsa(config) {
  const radice = config?.configFile ? dirname(config.configFile) : null;
  assicuraMotore(radice ? { radice } : {});
  // Una libreria nuova del lock arriva prima degli spec che la usano (#1572).
  if (radice) allineaPerLeProve(radice, { prefisso: '[prove]' });
  return preparaLaCorsa(radice);
}

async function preparaLaCorsa(radice) {
  // La base del display è quella del worker (#1157), nel marcatore del clone a cui appartiene la config.
  const schermo = await accendiSchermo(radice ? { worker: datiWorker({ root: radice }) } : {});
  if (schermo.nota) console.error(schermo.nota);
  const temp = temporaneaDellaCorsa();
  Object.assign(process.env, { TMPDIR: temp, TEMP: temp, TMP: temp });
  return async () => {
    await schermo.spegni();
    try { togliCartella(temp, { tentativi: 2, attesa: 100 }); } catch (_) {}
  };
}

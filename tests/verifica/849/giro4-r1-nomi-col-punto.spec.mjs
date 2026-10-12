// #849 giro 4: la sentinella dei servizi esterni, girata su una copia di src/ cambiata come la cambierebbe un lavoro futuro.
// r1: in un file che fa rete, un testo col punto che non è un indirizzo (chiave, nome di file, codice per la pagina) non deve farla rossa.

import { test, expect } from '@playwright/test';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cartellaTemporanea, collegaCartella, togliCartella } from '../../helpers/percorsi.mjs';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const SENTINELLA = join('tests', 'unit', 'serviziEsterni.test.mjs');

function sentinellaSu(modifica) {
  const dir = cartellaTemporanea('filo-849-');
  try {
    cpSync(join(ROOT, 'src'), join(dir, 'src'), { recursive: true });
    cpSync(join(ROOT, 'package.json'), join(dir, 'package.json'));
    mkdirSync(join(dir, 'tests', 'unit'), { recursive: true });
    cpSync(join(ROOT, SENTINELLA), join(dir, SENTINELLA));
    collegaCartella(join(ROOT, 'node_modules'), join(dir, 'node_modules'));
    modifica(dir);
    const r = spawnSync(process.execPath, ['--test', SENTINELLA], { cwd: dir, encoding: 'utf8' });
    return { rossa: r.status !== 0, uscita: r.stdout };
  } finally { togliCartella(dir); }
}

const aggiungi = (file, testo) => (dir) => {
  const p = join(dir, file);
  writeFileSync(p, readFileSync(p, 'utf8') + testo);
};

test('controllo: la copia senza modifiche è verde', () => {
  expect(sentinellaSu(() => {}).rossa).toBe(false);
});

for (const [cosa, file, testo] of [
  ['una chiave di impostazione col punto', 'src/main/services/adblock.js', "\nfunction accesoDaPreferenze(p) { return p['adblock.enabled'] !== false; }\n"],
  ['il nome di un file .jsonl', 'src/main/services/fxRates.js', "\nconst STORICO = 'cambi.jsonl';\n"],
  ['il nome di un eseguibile', 'src/main/services/handlers/misc.js', "\nconst INSTALLER = 'Filo-Setup.exe'.toLowerCase();\n"],
  ['un pezzo di codice per la pagina', 'src/main/services/adblock.js', "\nfunction titolo(wc) { return wc.executeJavaScript('document.title'); }\n"],
]) {
  test(`r1 ${cosa} in un file che fa rete non è un servizio nuovo`, () => {
    const s = sentinellaSu(aggiungi(file, testo));
    expect(s.rossa, `la sentinella diventa rossa senza nessun servizio nuovo:\n${(s.uscita.match(/Indirizzi che l.elenco non dichiara:[^\n]*\n[^\n]*/) || [''])[0]}`).toBe(false);
  });
}

// handlers.js è diviso per dominio (#2489): chi ne legge il sorgente per percorso lo legge intero da qui.
// Le parti sono i file che handlers.js carica e che si dichiarano «nata da handlers.js» in testa: nessuna copia a mano.
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SERVIZI = join(ROOT, 'src', 'main', 'services');
const ENTRATA = join(SERVIZI, 'handlers.js');
const MARCA = /nat[ao] da handlers\.js/;

// I percorsi assoluti, nell'ordine in cui handlers.js li carica: lui per primo.
export function fileDiHandlers() {
  const testo = readFileSync(ENTRATA, 'utf8');
  const visti = new Set([ENTRATA]);
  for (const m of testo.matchAll(/require\('(\.\/[^']+)'\)/g)) {
    const p = join(SERVIZI, `${m[1]}.js`);
    if (visti.has(p) || !existsSync(p)) continue;
    if (MARCA.test(readFileSync(p, 'utf8').split('\n').slice(0, 3).join('\n'))) visti.add(p);
  }
  return [...visti];
}

// Gli stessi, relativi alla radice del repo e con le barre normali.
export function percorsiDiHandlers() {
  return fileDiHandlers().map((p) => relative(ROOT, p).replace(/\\/g, '/'));
}

export function sorgenteHandlers() {
  return fileDiHandlers().map((f) => readFileSync(f, 'utf8')).join('\n');
}

// I casi di eseguiAzioneFilo, uno per tipo: le tabelle tipo -> funzione di services/azioni/ e il corpo di ogni funzione.
export function casiDelleAzioni() {
  const casi = [];
  for (const f of fileDiHandlers().filter((p) => /[\\/]azioni[\\/]/.test(p))) {
    const testo = readFileSync(f, 'utf8');
    const tabella = /\nmodule\.exports = \{\n([\s\S]*?)\n\};/.exec(testo);
    if (!tabella) throw new Error(`${relative(ROOT, f)} non esporta più la tabella in \`module.exports = { TIPO: funzione }\``);
    for (const [, tipo, nome] of tabella[1].matchAll(/^\s+([A-Z_]+): (\w+),$/gm)) {
      const i = testo.indexOf(`async function ${nome}(`);
      if (i < 0) throw new Error(`${relative(ROOT, f)}: ${tipo} punta a ${nome}, che non c'è`);
      casi.push({ tipo, corpo: testo.slice(i, testo.indexOf('\n}\n', i) + 2) });
    }
  }
  return casi;
}

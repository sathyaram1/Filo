// #2489 giro 1, rilievo 1: i documenti e i commenti che mandano a handlers.js per una funzione spostata la devono
// trovare dove dicono. Logica pura: non apre Filo.
import { test, expect } from '../../fixtures/electron.mjs';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const leggi = (p) => readFileSync(join(ROOT, p), 'utf8');
const definitaIn = (file, nome) => new RegExp(`^(async )?function ${nome}\\b|^const ${nome} = `, 'm').test(leggi(file));

// Rimando → la funzione che nomina accanto a «handlers.js».
const RIMANDI = [
  ['SECURITY.md', 'enrichArchivedTab'],
  ['patterns/la-fine-di-una-cosa-non-la-annuncia-la-pagina-che-muore.md', 'affidaChat'],
  ['patterns/la-fine-di-una-cosa-non-la-annuncia-la-pagina-che-muore.md', 'closeAndTriageChat'],
  ['patterns/lo-stato-che-dura-non-si-appunta-sul-messaggio.md', 'getAssistantCwd'],
  ['README.md', 'broadcastLiveUpdate'],
  ['src/main/ipc.js', 'filoWin'],
  ['src/shared/constants.js', 'buildAttemptChain'],
];

test('r1 un rimando a handlers.js per una funzione la trova lì, o nomina il file dove sta adesso', () => {
  const sbagliati = [];
  for (const [doc, nome] of RIMANDI) {
    const testo = leggi(doc);
    const righe = testo.split('\n').filter((r, i, tutte) => r.includes(nome) || (tutte[i + 1] || '').includes(nome));
    const mandaAHandlers = righe.some((r) => /handlers\.js/.test(r));
    if (mandaAHandlers && !definitaIn('src/main/services/handlers.js', nome)) sbagliati.push(`${doc}: ${nome}`);
  }
  expect(sbagliati).toEqual([]);
});

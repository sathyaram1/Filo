// Verifica del lavoro «#680», secondo giro — il freno che deve fermare il
// PROSSIMO strumento di manutenzione.
//
// La segnalazione lo chiede come forma preferita: un controllo di logica che
// diventa rosso su una scansione della collezione senza campi. Il primo giro
// aveva trovato due modi di chiedere tutto che gli passavano davanti; qui si
// guida contro il muro da altre due parti, tutte e due plausibili per chi
// scriverà il prossimo strumento.
//
// Il freno lo si esercita come lo esercita chi sviluppa: si mette uno strumento
// finto al suo posto e si lancia il controllo di logica. Rosso = il freno frena.
import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { writeFileSync, unlinkSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ROOT = resolve(process.cwd());
const SENTINELLA = 'tests/unit/letturePerCampi.test.mjs';

// Il controllo di logica è rosso? (exit diverso da zero, come per chi lo lancia)
function frenaSu(percorsoRelativo, sorgente) {
  const file = join(ROOT, percorsoRelativo);
  writeFileSync(file, sorgente, 'utf8');
  try {
    execFileSync(process.execPath, ['--test', SENTINELLA], {
      cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
    });
    return false;
  } catch (_) {
    return true;
  } finally {
    try { unlinkSync(file); } catch (_) { /* già via */ }
  }
}

// Lo stesso strumento, scritto in tre modi che chiedono tutti la collezione
// intera senza dire quali campi servono.
const COME_LO_SCRIVE_FB = `
const FB = globalThis.SN_FEEDBACK;
export async function tutte(token) { return FB.listAll({ idToken: token }); }
`;
const COME_LO_SCRIVE_CON_UN_ALTRO_NOME = `
const segnalazioni = globalThis.SN_FEEDBACK;
export async function tutte(token) { return segnalazioni.listAll({ idToken: token }); }
`;

test('il freno riconosce lo strumento scritto nel modo di sempre', () => {
  // Il caso già coperto: serve come pietra di paragone dei due qui sotto.
  expect(frenaSu('scripts/zz-prova-freno.mjs', COME_LO_SCRIVE_FB)).toBe(true);
});

test('il freno guarda anche dove stanno gli attrezzi comuni, non solo la stanza davanti', () => {
  // Gli attrezzi condivisi di questo stesso lavoro (la copia, il conteggio, la
  // lettura riusata) stanno in una sottocartella: una scansione messa lì passa.
  expect(frenaSu('scripts/lib/zz-prova-freno.mjs', COME_LO_SCRIVE_FB),
    'una scansione senza campi negli attrezzi comuni non fa scattare niente').toBe(true);
});

test('il freno non si aggira chiamando le segnalazioni con un altro nome', () => {
  expect(frenaSu('scripts/zz-prova-freno-2.mjs', COME_LO_SCRIVE_CON_UN_ALTRO_NOME),
    'basta un nome diverso per lo stesso elenco e il freno non se ne accorge').toBe(true);
});

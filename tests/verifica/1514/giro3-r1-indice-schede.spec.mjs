// Verifica #1514 giro 3, rilievo 1: l'indice delle schede in locale segna come «non si legge, mai passato dai giudici»
// i feedback fidati dei Ricevuti coi giudici saltati, e ne perde la scheda; dal server lo stesso feedback resta leggibile.
import { test, expect } from '../../fixtures/electron.mjs';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), '..', '..', '..');

test('r1 un feedback fidato dei Ricevuti coi giudici saltati resta leggibile nell’indice locale, con la sua scheda', async () => {
  const S = await import(pathToFileURL(join(ROOT, 'scripts', 'schede.mjs')).href);
  createRequire(import.meta.url)(join(ROOT, 'src', 'shared', 'schede.js'));
  const SS = globalThis.SN_SCHEDE;
  const scheda = (num, stato) => JSON.stringify(SS.perIlDocumento({
    numero: String(num), stato, mittente: 'owner', titolo_breve: 'Domanda sul menu', riassunto: 'Serve una scelta sul menu.',
    tipo: 'bug', area: 'browser-schede', file_probabili: [], urgente: false, valido: 'si', prova: 'Letto.',
    risolto_su_main: null, doppione_di: [], parole_chiave: ['menu'], note: '',
  }, { stato, at: 't' }));
  // Come li scrive la nascita: fiducia del server e giudici saltati, in due stati dei Ricevuti.
  const righe = [
    { _id: 'a', seq: 41, status: 'design', fiducia: 'fidato', pipeline: { skipped: 'fidato' }, scheda: scheda(41, 'design') },
    { _id: 'b', seq: 42, status: 'aligned', fiducia: 'fidato', pipeline: { skipped: 'routine_proven' }, scheda: scheda(42, 'aligned') },
  ];
  const r = await S.letturaLocale({
    leggiRighe: async () => ({ rows: righe, complete: true }),
    apri: async (v) => { try { return JSON.parse(v); } catch (_) { return null; } },
  });
  const indice = S.apertiDaRighe(r.righe, { segnalati: r.segnalati });
  expect(indice.filter((f) => f.segnalato).map((f) => `${f.num}: ${f.segnalato}`)).toEqual([]);
  expect(r.schede.map((s) => s.numero).sort()).toEqual(['41', '42']);
});

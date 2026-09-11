// Verifica #583, giro 3 — la bacheca dei feedback più vecchi si congela.
//
// Le schede pubbliche le scrive l'app di chi gestisce i feedback, guardando i
// feedback che ha caricato: i 500 più recenti PER DATA D'INVIO. Filo ha già
// passato quel numero, quindi i più vecchi non entrano più in quel caricamento,
// e quello che succede a loro non arriva più in bacheca.
//
// Due conseguenze, tutte e due visibili a un utente:
//   · un fix vecchio che torna in lavorazione resta in bacheca come risolto —
//     si può ancora votare e ancora pagare per riaprirlo;
//   · un feedback vecchio che viene risolto OGGI non entra in bacheca e non
//     produce nessun annuncio per chi l'aveva mandato: la sua scheda non viene
//     mai scritta.
//
// La correzione dello stesso giro NON ha allargato il caricamento (costerebbe
// letture a ogni giro, e i feedback vecchi cambiano una volta ogni mai): ha
// aggiunto la strada che serviva davvero. Quando chi gestisce i feedback ne
// cambia uno, l'id ce l'ha in mano, quindi la scheda di QUEL feedback si scrive
// o si toglie subito, e l'età non conta più. La guardia permanente è
// `tests/feedback-scheda-fuori-pagina.spec.mjs`.
//
// Questa prova resta com'è, e resta verde: descrive il limite del giro generale,
// che è il motivo per cui quella strada esiste. Diventa rossa il giorno in cui
// qualcuno cambierà il giro generale credendo che copra tutto.

import { test, expect } from './../../fixtures/electron.mjs';

test('fuori dalla pagina di caricamento la scheda non si aggiorna e non si toglie', async ({ app, shell }) => {
  void shell;

  const out = await app.evaluate(async () => {
    const V = globalThis.SN_FEEDBACK_PUBLIC_VIEW;

    // Una scheda già in bacheca per un feedback VECCHIO (fuori pagina).
    const schedaVecchia = {
      _id: 'fb-vecchio', name: 'Un fix di un anno fa', seq: 12, subSeq: 0,
      status: 'done', statusPublic: 'closed', resolvedInVersion: '0.1.9',
      createdAt: '2025-09-01T00:00:00Z', resolvedAt: '2025-09-10T00:00:00Z',
      clientIdTag: '', userNote: '', reward: 50,
    };

    // Il caricamento ha toccato il tetto: questi NON sono tutti i feedback che
    // esistono, e `fb-vecchio` non è fra loro.
    const caricati = [{
      _id: 'fb-nuovo', name: 'Un fix di ieri', seq: 580, subSeq: 0,
      status: 'done', priority: 1, resolvedInVersion: '0.2.70',
      createdAt: '2026-09-01T00:00:00Z', resolvedAt: '2026-09-02T00:00:00Z',
      clientIdHash: 'b'.repeat(32),
    }];

    const piano = V.planSync([schedaVecchia], caricati, { complete: false });

    // E il caso opposto: un feedback vecchio risolto OGGI. Fuori pagina, quindi
    // chi pubblica non lo guarda nemmeno: nessuna scheda, nessun annuncio.
    const pianoSenzaVecchio = V.planSync([], caricati, { complete: false });

    return {
      tolte: piano.remove,
      scritte: piano.upsert.map((u) => u.id),
      scritteSenzaVecchio: pianoSenzaVecchio.upsert.map((u) => u.id),
    };
  });

  // La scheda del fix vecchio non viene toccata: né riscritta né tolta. Se
  // quel feedback nel frattempo è tornato in lavorazione, la bacheca continua
  // a mostrarlo come risolto.
  expect(out.tolte).not.toContain('fb-vecchio');
  expect(out.scritte).not.toContain('fb-vecchio');

  // E un feedback fuori pagina non riceve mai una scheda, nemmeno appena
  // risolto: in bacheca non compare e chi l'aveva mandato non viene avvisato.
  expect(out.scritteSenzaVecchio).toEqual(['fb-nuovo']);
});

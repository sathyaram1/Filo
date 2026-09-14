// Verifica #583, giro 3 — la scheda pubblica rivela quanto contava la
// segnalazione.
//
// La scheda pubblica nasce con un elenco di campi ammessi, e chi l'ha scritta
// dice a chiare lettere che la priorità non ci entra: «è la CIFRA, non la
// priorità: quanto contava la segnalazione resta un giudizio interno e fuori
// dalla scheda». La priorità infatti sul feedback vero viaggia CIFRATA, apposta.
//
// Solo che le cifre sono quattro e le fasce sono quattro, e si corrispondono una
// a una: 50 ↔ minima, 100, 200, 300 ↔ massima. Chi legge la scheda — e la
// scheda la legge chiunque, senza credenziali, è la sua ragione d'essere —
// ricava la fascia leggendo la cifra. Il giudizio interno è pubblico.
//
// Questa prova NON dice che è sbagliato: senza la cifra sulla scheda, la
// macchina di chi ha segnalato non sa quanto accreditare e ogni ricompensa
// torna alla fascia minima (è il rilievo che il giro prima ha fatto correggere).
// È un compromesso, e va visto per quello che è. La prova lo fotografa: oggi è
// VERDE perché la corrispondenza esiste.

import { test, expect } from './../../fixtures/electron.mjs';

test('dalla sola scheda pubblica si ricava la fascia di priorità del feedback', async ({ app, shell }) => {
  void shell;

  const out = await app.evaluate(async () => {
    const V = globalThis.SN_FEEDBACK_PUBLIC_VIEW;
    const base = {
      _id: 'fb-1', name: 'Un fix', status: 'done', statusPublic: 'closed',
      createdAt: '2026-06-01T00:00:00Z', resolvedAt: '2026-06-02T00:00:00Z',
      resolvedInVersion: '0.2.70', clientIdHash: 'a'.repeat(32),
    };
    // Quattro feedback identici in tutto, tranne la priorità (che sul documento
    // vero viaggia cifrata).
    const schede = [0, 1, 2, 3].map((p) => V.cardFor({ ...base, priority: p }));
    return {
      cifre: schede.map((c) => c.reward),
      // Il resto della scheda è identico: la cifra è l'unica cosa che cambia,
      // quindi è l'unica cosa da cui la fascia si ricava — e basta lei.
      resto: schede.map((c) => JSON.stringify({ ...c, reward: undefined })),
    };
  });

  // Quattro cifre distinte per quattro fasce distinte: la corrispondenza è
  // biunivoca, quindi leggere la cifra è leggere la fascia.
  expect(new Set(out.cifre).size).toBe(4);
  expect(out.cifre).toEqual([50, 100, 200, 300]);
  // E non c'è nient'altro nella scheda che distingua i quattro casi: la cifra
  // non è una fra tante spie, è LA spia.
  expect(new Set(out.resto).size).toBe(1);
});

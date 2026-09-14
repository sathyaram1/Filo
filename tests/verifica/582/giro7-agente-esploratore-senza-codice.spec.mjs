// Verifica #582, giro 7 — l'agente esploratore e il codice di scarico.
//
// Da questo lavoro il deposito non lascia più scaricare niente a nessuno: la
// sola chiave di un allegato è il codice di scarico che il deposito rilascia
// quando il file viene creato e che finisce dentro l'indirizzo. Un indirizzo
// senza quel codice è un indirizzo morto — non lo apre più nemmeno chi riceve
// le segnalazioni.
//
// Chi manda una segnalazione dall'app lo sa: se il deposito non rilascia il
// codice, l'invio si ferma e chi manda ritrova il nome del file fra quelli non
// caricati, così può riprovare. L'agente esploratore carica sullo stesso
// deposito, con la stessa forma del nome, ma quel controllo non ce l'ha:
// costruisce l'indirizzo lo stesso, senza codice, e lo registra come allegato
// riuscito. Due strade per la stessa cosa, e una non guarda niente.
//
// Prima di questo lavoro l'indirizzo senza codice funzionava (il deposito era
// aperto in lettura a chiunque), quindi la perdita nasce qui.
//
// La prova: si finge il deposito che risponde bene ma senza codice, e si guarda
// cosa finisce dentro la segnalazione. Prova PURA, nessuna finestra da aprire.

import { test, expect } from '@playwright/test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const { pushIssue } = await import('../../../tests/agent/feedback.mjs');

// Uno screenshot finto da allegare.
function finstoScreenshot() {
  const dir = mkdtempSync(join(tmpdir(), 'giro7-agente-'));
  const p = join(dir, 'schermata.png');
  writeFileSync(p, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  return p;
}

// Il deposito finto: accetta il caricamento, ma NON rilascia il codice di
// scarico. È il caso che il ramo dichiara di voler gestire.
function depositoSenzaCodice() {
  const originale = globalThis.fetch;
  const chiamate = [];
  globalThis.fetch = async (url, opts) => {
    const u = String(url);
    chiamate.push(u);
    if (u.includes('uploadType=media')) {
      // Caricamento riuscito, ma senza `downloadTokens`.
      return {
        ok: true, status: 200,
        json: async () => ({ name: 'feedback/x.png', bucket: 'filo-8b9cb.firebasestorage.app' }),
        text: async () => '',
      };
    }
    // La creazione del documento: risponde come Firestore.
    return {
      ok: true, status: 200,
      json: async () => ({ name: 'projects/p/databases/(default)/documents/feedback/DOC1' }),
      text: async () => '',
    };
  };
  return { chiamate, ripristina: () => { globalThis.fetch = originale; } };
}

test("l'agente esploratore non registra un allegato che nessuno potrà aprire", async () => {
  const deposito = depositoSenzaCodice();
  try {
    const esito = await pushIssue({
      model: 'prova', severity: 'low', area: 'prova', title: 'prova',
      detail: 'prova', foundAt: 'filo://dashboard',
      screenshotPath: finstoScreenshot(),
    });

    // Quello che NON deve succedere: un indirizzo senza codice di scarico
    // registrato come allegato riuscito. Da lì non si scarica più niente, e
    // nessuno se ne accorge finché non prova ad aprirlo.
    for (const indirizzo of esito.images || []) {
      expect(indirizzo, `allegato senza codice di scarico: ${indirizzo}`).toContain('token=');
    }
  } finally {
    deposito.ripristina();
  }
});

// La controprova: col codice, l'allegato si registra e l'indirizzo lo porta.
test("col codice di scarico l'allegato si registra normalmente", async () => {
  const originale = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const u = String(url);
    if (u.includes('uploadType=media')) {
      return { ok: true, status: 200, json: async () => ({ downloadTokens: 'CODICE-1' }), text: async () => '' };
    }
    return {
      ok: true, status: 200,
      json: async () => ({ name: 'projects/p/databases/(default)/documents/feedback/DOC2' }),
      text: async () => '',
    };
  };
  try {
    const esito = await pushIssue({
      model: 'prova', severity: 'low', area: 'prova', title: 'prova',
      detail: 'prova', foundAt: 'filo://dashboard',
      screenshotPath: finstoScreenshot(),
    });
    expect(esito.images).toHaveLength(1);
    expect(esito.images[0]).toContain('token=CODICE-1');
  } finally {
    globalThis.fetch = originale;
  }
});

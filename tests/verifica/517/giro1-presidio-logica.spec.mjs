// Verifica #517 — giro 1. Le porte del presidio «l'ha detto e non l'ha fatto»,
// provate sulla sola logica di riconoscimento (niente Electron: è logica pura).
//
// Ogni blocco qui sotto è una porta trovata dalla verifica: o il presidio
// ACCUSA Filo di non aver fatto una cosa che ha fatto (falso allarme, e un
// allarme che grida al lupo si smette di leggere), o LASCIA PASSARE la frase
// più naturale con cui un assistente conferma in italiano.
//
// I test sono scritti per essere ROSSI finché la porta è aperta: quando una
// viene chiusa, il suo `expect` diventa verde da solo.

import { test, expect } from '@playwright/test';

let D;
test.beforeAll(async () => {
  await import('../../../src/shared/azioniDichiarate.js');
  D = globalThis.SN_AZIONI_DICHIARATE;
});

const ids = (testo, azioni = []) => D.rileva(testo, azioni).map((f) => f.id);

test('il presidio non accusa Filo di non aver fatto ciò che ha fatto', async () => {
  // Filo apre il blocco note con un comando di shell (è la strada vera: non
  // esiste uno strumento «apri un programma»). Il comando è stato eseguito.
  expect(ids('Ho aperto il blocco note.', [{ type: 'ESEGUI_COMANDO' }])).toEqual([]);
  expect(ids('Ho aperto la cartella Documenti.', [{ type: 'ESEGUI_COMANDO' }])).toEqual([]);

  // I file dell'editor arrivano al modello già RIASSUNTI, in contesto, a ogni
  // turno: per dire cosa c'è scritto in un file non serve nessuno strumento.
  expect(ids('Ho letto il file bolletta.pdf: sono 84 euro, scadenza il 12.')).toEqual([]);

  // Quello che Filo impara lo scrive in memoria l'agente delle lezioni, dopo
  // il turno e senza nessuna azione: «l'ho memorizzato» non è una bugia.
  expect(ids("L'ho memorizzato: preferisci le risposte brevi.")).toEqual([]);
});

test('le frasi con cui un assistente conferma davvero in italiano vengono viste', async () => {
  // Quando la cosa l'ha appena nominata l'utente, si risponde col pronome:
  // è la forma NORMALE, non un caso di scuola. Nessuna di queste è coperta.
  expect(ids("L'ho messa alle 19.")).toContain('sveglia');
  expect(ids("Te l'ho messa alle 19, buonanotte.")).toContain('sveglia');
  expect(ids('Le ho impostate tutte e tre.')).toContain('sveglia');
  expect(ids("L'ho aggiunta al calendario.")).toContain('calendario');
  expect(ids("Fatto! L'ho salvata fra gli appunti.")).toContain('appunto');
});

test('nessuna regola del presidio è scritta in modo da non poter mai scattare', async () => {
  // `\b` dopo una vocale accentata non è un confine di parola in JavaScript:
  // le regole scritte con «modalità», «ricorderò», «però», «perché», «così»
  // non possono fare match su NIENTE. Sono guardie nate spente.
  expect(/modalità\b/.test('modalità scura')).toBe(true);
  expect(/ricorderò\b/.test('ricorderò.')).toBe(true);
  expect(/però\b/.test('però ti')).toBe(true);

  // Conseguenza sul comportamento: la stessa identica frase viene vista o no
  // a seconda della congiunzione, perché «però» non separa e «ma» sì.
  expect(ids('Non ho trovato l\'evento ma ti ho messo una sveglia alle 19.')).toContain('sveglia');
  expect(ids('Non ho trovato l\'evento però ti ho messo una sveglia alle 19.')).toContain('sveglia');

  // E un'impostazione raccontata con la parola accentata non viene mai vista.
  expect(ids('Ho attivato la modalità scura.')).toContain('impostazione');
});

test('il formato macchina si riconosce anche quando arriva DOPO un preambolo', async () => {
  // È il secondo sintomo del feedback: «scrive la risposta buona come
  // preambolo e chiude con un oggetto». Riconosciuto solo se quell'oggetto
  // contiene una lista `actions`; negli altri due casi il turno passa intero.
  expect(D.formatoSospetto('Ecco il riassunto.\n\n{"text":"","actions":[]}')).toBe(true); // già coperto
  expect(D.formatoSospetto('Ti metto la sveglia alle 19.\n\nSVEGLIA{"time":"19:00"}')).toBe(true);
  expect(D.formatoSospetto('Ecco il riassunto.\n\n{}')).toBe(true);
  expect(D.formatoSospetto('[{"type":"SVEGLIA","time":"19:00"}]')).toBe(true);
});

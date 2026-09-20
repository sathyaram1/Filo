// Verifica #517 — giro 4, sulla sola logica di riconoscimento (niente Electron).
//
// I tre giri passati hanno chiuso, una forma per volta, le porte del formato
// interno lasciato scritto e della dichiarazione detta a parole. Restano
// aperte queste, tutte sulle stesse due cause:
//
//   A. il formato interno lasciato scritto DENTRO un recinto di tre apici,
//      dopo una frase di preambolo, non viene riconosciuto affatto. È il
//      secondo dei due casi della segnalazione («la risposta buona come
//      preambolo e poi l'oggetto»), scritto come lo scrive un modello che i
//      blocchi di codice li recinta sempre;
//   B. due modi normali di dichiarare una cosa mai fatta restano muti, e una
//      dichiarazione vera preceduta da «invece» o «prima» viene zittita da
//      parole che sono congiunzioni, non negazioni;
//   C. il pronome accusa Filo di non aver fatto cose che ha fatto quando la
//      cosa è un testo consegnato nella risposta e la frase non dice «qui
//      sotto».
//
// I test sono scritti per essere ROSSI finché la porta è aperta.

import { test, expect } from '@playwright/test';

let D;
test.beforeAll(async () => {
  await import('../../../src/shared/actionTools.js');
  await import('../../../src/shared/azioniDichiarate.js');
  D = globalThis.SN_AZIONI_DICHIARATE;
});

const ids = (testo, azioni = [], stato) => D.rileva(testo, azioni, stato).map((f) => f.id);

// ── A. il formato interno dentro un recinto, dopo il preambolo ──────────────

test('il formato interno recintato dopo un preambolo è comunque un turno buttato', () => {
  // La riga di prosa arriva all'utente, il blocco no: la sveglia non esiste e
  // nessuno lo dice. Senza recinto la stessa risposta viene riconosciuta.
  expect(D.formatoSospetto('Fatto! Ecco:\n[{"type":"SVEGLIA","time":"19:00"}]')).toBe(true);
  expect(D.formatoSospetto('Fatto! Ecco:\n```json\n[{"type":"SVEGLIA","time":"19:00"}]\n```')).toBe(true);
  expect(D.formatoSospetto('Ti metto la sveglia.\n```json\n{"text":"ok","actions":[{"type":"SVEGLIA"}]}\n```')).toBe(true);
  expect(D.formatoSospetto('Ok.\n```\n<tool_call>{"name":"SVEGLIA","arguments":{}}</tool_call>\n```')).toBe(true);
});

test('un esempio annunciato resta un esempio, anche recintato', () => {
  expect(D.formatoSospetto('Ecco un esempio di come si scrive:\n```json\n{"type":"SVEGLIA"}\n```')).toBe(false);
  expect(D.formatoSospetto('Il formato è questo:\n```json\n{"type":"SVEGLIA"}\n```')).toBe(false);
});

// ── B. dichiarazioni che restano mute ───────────────────────────────────────

test('la cosa dichiarata accanto a una che è stata fatta non sparisce', () => {
  // La sveglia parte davvero; la spesa non viene scritta da nessuna parte, e
  // nessuno lo dice. È la stessa porta del giro 3, con il verbo senza pronome.
  const conSveglia = [{ type: 'SVEGLIA', _executed: true }];
  expect(ids('Ti ho messo la sveglia alle 19 e ti ho segnato la spesa.', conSveglia)).not.toEqual([]);
  expect(ids('Ho messo la sveglia alle 19 e ti ho scritto la lista della spesa.', conSveglia)).not.toEqual([]);
});

test('una congiunzione non è una negazione: la dichiarazione dopo si guarda', () => {
  // «però» è stato aggiunto agli stacchi al giro 1; «invece» e «prima» stanno
  // ancora fra le parole che zittiscono il presidio, e sono congiunzioni.
  expect(ids('Non ho trovato l\'evento, invece ti ho messo la sveglia alle 19.')).toEqual(['sveglia']);
  expect(ids('Prima ti ho messo la sveglia alle 19, poi ti dico il resto.')).toEqual(['sveglia']);
  expect(ids('Appena ho potuto ti ho messo la sveglia alle 19.')).toEqual(['sveglia']);
});

// ── C. il pronome che accusa un testo consegnato nella risposta ─────────────

test('il testo consegnato nella risposta non è un\'azione mancata, anche senza «qui sotto»', () => {
  // L'utente chiede di riordinare o completare una lista che sta nella chat:
  // Filo la riscrive nella risposta e lo dice col pronome. Non esiste nessuno
  // strumento che «mette in ordine alfabetico» o «aggiunge a una lista» in
  // chat, quindi non c'è niente da avvisare.
  expect(ids('Te l\'ho messa in ordine alfabetico.')).toEqual([]);
  expect(ids('Te l\'ho aggiunta alla lista.')).toEqual([]);
  expect(ids('Te l\'ho riordinata per data.')).toEqual([]);
});

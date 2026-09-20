// Verifica #517 — giro 3, sulla sola logica di riconoscimento (niente Electron).
//
// Il giro 2 aveva posto la domanda giusta — COSA vale come prova che la cosa è
// stata fatta davvero — e l'aveva richiusa su una forma sola per parte. Qui
// sotto le porte rimaste, tutte sulla stessa causa:
//
//   A. la prova che sta nello STATO (la sveglia che esiste davvero, messa in
//      una sessione precedente) copre solo la frase lunga che ripete la parola
//      «sveglia» e nomina l'ora in cifre. La stessa conferma detta col pronome
//      («te l'ho messa alle 19»), o con la parola «promemoria», o con l'ora
//      scritta a lettere, resta un'accusa;
//   B. un'azione CHIAMATA che mette in chat un bottone da premere (l'evento di
//      calendario, la pulizia delle schede, la cancellazione dell'archivio)
//      non vale come prova di niente: la risposta viene buttata, rifatta, e
//      poi smentita;
//   C. il formato interno lasciato scritto invece che chiamato si riconosce in
//      alcune forme e non in altre.
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

// ── A. la sveglia che ESISTE regge una sola forma di frase ───────────────────

test('una sveglia che esiste davvero regge anche la conferma col pronome', async () => {
  const stato = { orariSveglie: ['19:00'] };
  // Il controllo: la forma lunga è coperta (chiusa nel giro 2).
  expect(ids('Sì, ho messo la sveglia alle 19:00 come mi avevi chiesto.', [], stato)).toEqual([]);
  // La stessa cosa detta come la direbbe chiunque subito dopo la domanda.
  expect(ids('Sì, te l\'ho messa alle 19:00 come mi avevi chiesto.', [], stato)).toEqual([]);
  expect(ids('L\'ho messa alle 19.', [], stato)).toEqual([]);
});

test('una sveglia che esiste davvero regge anche la parola «promemoria»', async () => {
  const stato = { orariSveglie: ['19:00'] };
  expect(ids('Ti ho messo il promemoria per le 19:00.', [], stato)).toEqual([]);
});

test('l\'ora scritta a lettere, o con «di sera», è la stessa ora', async () => {
  expect(ids('Ho messo la sveglia alle sette.', [], { orariSveglie: ['07:00'] })).toEqual([]);
  expect(ids('Ho messo la sveglia alle 7 di sera.', [], { orariSveglie: ['19:00'] })).toEqual([]);
});

// ── B. un'azione che mette un bottone in chat è comunque un'azione ───────────

test('l\'evento di calendario proposto come bottone non è un\'azione mancata', async () => {
  // Così arriva l'azione al presidio quando l'evento è stato chiamato davvero:
  // il main la tiene (`kept`), il bottone è in chat, ma non l'ha «eseguita»
  // perché tocca all'utente premerlo.
  const bottone = [{ type: 'EVENTO_CALENDARIO', _executed: false }];
  expect(ids('Ti ho aggiunto l\'evento in calendario per domani alle 10.', bottone)).toEqual([]);
  expect(ids('Te l\'ho aggiunta al calendario.', bottone)).toEqual([]);
});

test('la pulizia delle schede proposta come bottone non è un\'azione mancata', async () => {
  expect(ids('Ho chiuso le schede che non usavi.', [{ type: 'PULISCI_TAB', _executed: false }])).toEqual([]);
  expect(ids('Ho cancellato la cronologia.', [{ type: 'CANCELLA_ARCHIVIO', _executed: false }])).toEqual([]);
});

// ── C. il formato interno lasciato scritto ───────────────────────────────────

test('il formato interno si riconosce anche nelle forme che usano i modelli aperti', async () => {
  // Il controllo: le forme già riconosciute.
  expect(D.formatoSospetto('Ti metto la sveglia.\nSVEGLIA{"time":"19:00"}')).toBe(true);
  expect(D.formatoSospetto('Ti ho messo la sveglia alle 19.\n{}')).toBe(true);
  // Le forme che passano.
  expect(D.formatoSospetto('Ti metto la sveglia.\n<tool_call>{"name":"SVEGLIA","arguments":{"time":"19:00"}}</tool_call>')).toBe(true);
  expect(D.formatoSospetto('Ti metto la sveglia.\nfunctions.SVEGLIA({"time":"19:00"})')).toBe(true);
});

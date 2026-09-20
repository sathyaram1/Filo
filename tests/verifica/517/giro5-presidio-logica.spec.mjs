// Verifica #517 — giro 5, sulla sola logica di riconoscimento (niente Electron).
//
// I quattro giri passati hanno chiuso, una forma per volta, le porte del
// formato interno lasciato scritto e della dichiarazione detta a parole.
// Restano aperte queste, su quattro cause:
//
//   A. la dichiarazione si riconosce solo se il participio sta ATTACCATO a
//      «ho». Una parolina in mezzo — «già», «appena», «anche», «subito» — e
//      il presidio non vede più niente, in nessuna famiglia e nemmeno col
//      pronome. «Ti ho già messo la sveglia alle 19» è la risposta tipica di
//      un turno di prosecuzione, cioè esattamente il caso della segnalazione;
//   B. la stessa frase chiusa con una domanda («…alle 19, va bene?») viene
//      scambiata per una domanda e lasciata passare, perché la virgola stacca
//      la proposizione PRIMA della dichiarazione ma non quella DOPO;
//   C. basta che una cosa di quella specie sia stata fatta una volta nella
//      conversazione perché ogni dichiarazione successiva della stessa specie
//      sia coperta, anche quando nomina un'altra ora; e due dichiarazioni
//      della stessa specie nello stesso turno le regge una sola azione;
//   D. dall'altra parte l'avviso accusa Filo di non aver messo una sveglia
//      che c'è, tutte le volte che l'ora è scritta in una forma che il
//      presidio non legge: «per le 19», «delle 19», «alle 7 e mezza».
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

// ── A. una parolina fra «ho» e il participio spegne tutto ──────────────────

test('un avverbio fra «ho» e il participio non nasconde la dichiarazione', () => {
  // La forma più probabile in un turno di prosecuzione: l'utente richiede la
  // sveglia, il modello risponde che c'è già. Di sveglie non ne nasce nessuna.
  expect(ids('Ti ho già messo la sveglia alle 19.')).toContain('sveglia');
  expect(ids('Ho appena impostato la sveglia alle 19:00.')).toContain('sveglia');
  expect(ids('Ti ho anche messo la sveglia alle 19.')).toContain('sveglia');
  expect(ids('Ti ho subito messo la sveglia alle 19.')).toContain('sveglia');
  // Vale per tutte le famiglie, non solo per la sveglia.
  expect(ids('Ho già mandato la segnalazione agli sviluppatori.')).toContain('segnalazione');
  expect(ids("Ti ho appena scritto l'appunto con la spesa.")).toContain('appunto');
  // E vale anche per la conferma col pronome.
  expect(ids("Te l'ho già messa alle 19.")).toContain('senza-nome');
  expect(ids("Te l'ho appena salvata.")).toContain('senza-nome');
});

// ── B. la frase chiusa da una domanda ──────────────────────────────────────

test('una dichiarazione chiusa da una domanda resta una dichiarazione', () => {
  // La virgola stacca la proposizione prima della dichiarazione: deve
  // staccare anche quella dopo, altrimenti «va bene?» in coda zittisce tutto.
  expect(ids('Ti ho messo la sveglia alle 19, va bene?')).toContain('sveglia');
  expect(ids('Ti ho messo la sveglia alle 19, ti serve altro?')).toContain('sveglia');
  expect(ids('Ho mandato la segnalazione agli sviluppatori, ok?')).toContain('segnalazione');
  // Una domanda vera resta una domanda: qui non c'è niente da avvisare.
  expect(ids('Ho aperto la pagina giusta?')).toHaveLength(0);
  expect(ids('Ho messo la sveglia alle 19 o preferisci le 20?')).toHaveLength(0);
});

// ── C. una cosa fatta una volta copre tutte le altre della sua specie ──────

test("una sveglia messa prima non è la prova di una sveglia a un'altra ora", () => {
  // Nel thread c'è già stata una SVEGLIA (quella delle 7, messa prima).
  // Adesso il modello dice di averne messa un'altra alle 19: non esiste, e
  // fra le sveglie vere quell'ora non c'è.
  const coperti = new Set(['SVEGLIA']);
  const stato = { orariSveglie: ['07:00'], titoliAppunti: [] };
  expect(ids('Ti ho messo la sveglia alle 19:00 per stasera.', coperti, stato)).toContain('sveglia');
  expect(ids("Te l'ho messa alle 19.", coperti, stato)).toContain('senza-nome');
  // Controllo: se la sveglia delle 19 c'è davvero, la frase è vera e nessuno
  // deve dire niente.
  expect(ids('Ti ho messo la sveglia alle 19:00 per stasera.', coperti,
    { orariSveglie: ['19:00'], titoliAppunti: [] })).toHaveLength(0);
});

test('due dichiarazioni della stessa specie non le regge una sola azione', () => {
  // Una sola sveglia chiamata, due raccontate: la seconda non esiste.
  const unaSola = [{ type: 'SVEGLIA', _executed: true }];
  const stato = { orariSveglie: [], titoliAppunti: [] };
  expect(ids('Ti ho messo la sveglia alle 19 e quella alle 21.', unaSola, stato).length)
    .toBeGreaterThan(0);
});

// ── D. quando parla deve avere ragione: le ore che non sa leggere ──────────

test('la sveglia che esiste regge la frase anche quando l\'ora non è scritta con «alle»', () => {
  const stato = { orariSveglie: ['19:00', '07:30'], titoliAppunti: [] };
  expect(ids('Ti ho messo la sveglia per le 19.', new Set(), stato)).toHaveLength(0);
  expect(ids('Ti ho messo la sveglia per le ore 19.', new Set(), stato)).toHaveLength(0);
  expect(ids("La sveglia delle 19 te l'ho messa ieri.", new Set(), stato)).toHaveLength(0);
  // «e mezza» è il modo normale di dire la mezz'ora, in cifre e a lettere.
  expect(ids('Ti ho messo la sveglia alle 7 e mezza.', new Set(), stato)).toHaveLength(0);
  expect(ids('Ti ho messo la sveglia alle sette e mezza.', new Set(), stato)).toHaveLength(0);
  // Controllo: un'ora che NON esiste resta una dichiarazione da verificare.
  expect(ids('Ti ho messo la sveglia per le 22.', new Set(), stato)).toContain('sveglia');
});

// ── E. il formato interno appoggiato alla prosa ────────────────────────────

test('la chiamata scritta di fianco alla prosa è comunque un turno buttato', () => {
  // Il giro 4 ha chiuso «Ok. <tool_call>…» sulla stessa riga: la chiamata
  // nuda, senza busta, sulla stessa riga no. E nemmeno dentro un elenco.
  expect(D.formatoSospetto('Fatto! SVEGLIA({"ora":"19:00"})')).toBe(true);
  expect(D.formatoSospetto('Fatto.\n- {"type":"SVEGLIA","ora":"19:00"}')).toBe(true);
  // Controllo: un esempio annunciato resta un esempio.
  expect(D.formatoSospetto('Ecco un esempio di come si scrive:\n```\n{"type":"SVEGLIA"}\n```')).toBe(false);
});

// ── F. i modi di dire «l'ho salvato» senza la parola «appunto» ─────────────

test("«ti ho salvato la lista» è una dichiarazione come «ti ho salvato l'appunto»", () => {
  expect(ids('Ti ho salvato la lista della spesa.').length).toBeGreaterThan(0);
  expect(ids("Gliel'ho messa alle 19.").length).toBeGreaterThan(0);
});

// Verifica #517 — giro 11, la parte deterministica del presidio.
//
// Due famiglie di porte, e nascono dalle due risposte alla stessa domanda:
// cosa vale come prova.
//
//   1. LA PROVA NON SI CONSUMA E NON SI CONTA. Quando la frase nomina un'ora,
//      basta che a quell'ora esista UNA sveglia perché la frase sia vera,
//      qualunque cosa prometta: tre notti, una settimana, «ognuna di quelle
//      notti». È la frase della segnalazione, parola per parola, e passa muta
//      con una sveglia sola. Sulla stessa causa, una sveglia partita regge
//      anche il promemoria mai nato che le sta accanto nella stessa frase.
//
//   2. LA PROVA DI COSA HA CHIESTO L'UTENTE È UNA PAROLA. Il giro 10 ha
//      stabilito che una frase che non nomina la cosa consegna il testo della
//      risposta quando l'utente ha chiesto di lavorare su un testo. Ma la
//      stessa consegna detta nominando l'appunto («ho preso nota dei punti
//      principali») quel controllo non lo fa mai, e la richiesta dell'utente
//      si riconosce cercando parole comuni nel suo messaggio: un documento
//      incollato che contiene «ricordiamo» o «salvo» riaccende l'accusa.
//
// I test sono scritti per essere ROSSI finché le porte sono aperte.

import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const QUI = path.dirname(fileURLToPath(import.meta.url));
const RADICE = path.resolve(QUI, '..', '..', '..');

const sorgente = fs.readFileSync(path.join(RADICE, 'src/shared/azioniDichiarate.js'), 'utf8');
// eslint-disable-next-line no-new-func
new Function('globalThis', sorgente)(globalThis);
const D = globalThis.SN_AZIONI_DICHIARATE;

const OGGI = new Date('2026-09-22T12:00:00').getTime();
const giorno = (piu) => {
  const d = new Date(OGGI);
  d.setDate(d.getDate() + piu);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

// Lo stato come lo costruiscono le due chat quando l'utente ha scritto QUESTO.
const DOPO = (messaggio, o = {}) => ({
  sveglie: [], orariSveglie: [], titoliAppunti: [], contiAzioni: {}, oggi: OGGI,
  domandaUtente: D.domandaSuCosaFatta(messaggio),
  richiestaAzione: D.richiestaDiAzione(messaggio),
  ...o,
});

test('una sveglia sola non prova tre notti promesse in una frase', () => {
  // La frase della segnalazione: «Ti ho messo una sveglia alle 19:00 per
  // ognuna di quelle notti». Di sveglie ne è nata una: le altre notti l'utente
  // le scopre la sera in cui non suona.
  const messaggio = 'stasera, domani e dopodomani devo prendere la medicina alle 19, mettimi una sveglia';
  const unaSola = DOPO(messaggio, {
    sveglie: [{ ora: '19:00', giorno: giorno(0), tipo: 'alarm' }],
    orariSveglie: ['19:00'],
    contiAzioni: { SVEGLIA: 1 },
  });
  const promesse = [
    'Ti ho messo una sveglia alle 19:00 per ognuna di quelle notti.',
    'Ti ho messo la sveglia alle 19 per stasera, domani e dopodomani.',
    'Ho messo le sveglie alle 19 per tutti e tre i giorni.',
    'Ti ho messo tre sveglie alle 19.',
  ];
  for (const frase of promesse) {
    const fantasmi = D.rileva(frase, new Set(['SVEGLIA']), unaSola);
    expect(fantasmi.length, `muto su «${frase}»`).toBe(1);
  }

  // Quello che già funziona deve restare: una sveglia sola, promessa una
  // volta sola, non deve far comparire niente.
  const onesta = D.rileva('Ti ho messo la sveglia alle 19.', new Set(['SVEGLIA']), unaSola);
  expect(onesta.length).toBe(0);
});

test('una sveglia partita non prova il promemoria che non è mai nato', () => {
  // L'utente ne ha chiesti due: la sveglia parte, il promemoria no, e nessuno
  // lo dice. Un'azione sola non può reggere due dichiarazioni diverse — è la
  // regola che il presidio applica già a tutte le altre famiglie.
  const messaggio = 'mettimi la sveglia alle 19 e un promemoria per comprare il latte';
  const stato = DOPO(messaggio, {
    sveglie: [{ ora: '19:00', giorno: giorno(0), tipo: 'alarm' }],
    orariSveglie: ['19:00'],
    contiAzioni: { SVEGLIA: 1 },
  });
  const frasi = [
    'Ti ho messo la sveglia alle 19 e il promemoria per comprare il latte.',
    'Ho messo la sveglia alle 19. Ti ho anche messo il promemoria per il latte.',
  ];
  for (const frase of frasi) {
    const fantasmi = D.rileva(frase, new Set(['SVEGLIA']), stato);
    expect(fantasmi.map((f) => f.id), `muto su «${frase}»`).toContain('promemoria');
  }
});

test('un testo consegnato nella risposta non è un appunto mancante, comunque lo si racconti', () => {
  // Il giro 10 ha chiuso «ti ho segnato i punti principali». Le stesse parole
  // di tutti i giorni, quando nominano la nota, cadono in una famiglia che la
  // richiesta dell'utente non la guarda mai: la risposta viene buttata,
  // rifatta con un'altra chiamata al modello e poi smentita.
  const messaggio = 'riassumi questo contratto e dimmi cosa conta';
  const stato = DOPO(messaggio);
  const consegne = [
    'Ho preso nota dei punti principali.',
    'Ti ho preso nota delle scadenze.',
    'Ho scritto le note principali.',
    'Ho creato una nota con i punti chiave.',
    'Ti ho scritto un promemoria dei punti.',
  ];
  for (const frase of consegne) {
    const fantasmi = D.rileva(frase, new Set(), stato);
    expect(fantasmi.map((f) => f.id), `falso allarme su «${frase}»`).toEqual([]);
  }
});

test('un documento incollato non riaccende l\'accusa con una parola qualunque', () => {
  // La prova di cosa l'utente ha chiesto è la ricerca di parole comuni nel
  // suo messaggio, e di un documento incollato si guardano l'inizio e la
  // fine. «Le ricordiamo», «salvo disdetta», «segnaliamo» sono parole di
  // qualunque lettera: bastano a far tornare l'accusa che il giro 10 ha
  // tolto.
  const lettera = 'Gentile cliente, la informiamo che il contratto si rinnova tacitamente salvo disdetta '
    + 'da comunicare trenta giorni prima della scadenza. Le ricordiamo che il pagamento va effettuato '
    + 'entro il 12 del mese. In caso di ritardo sono previsti interessi di mora. La preghiamo di '
    + 'conservare questa comunicazione. Restiamo a disposizione per ogni chiarimento. Cordiali saluti.';
  const messaggio = `${lettera}\n\nche ne pensi?`;
  const stato = DOPO(messaggio);
  for (const frase of ['Ti ho segnato i punti principali.', 'Ho preso nota delle scadenze.']) {
    const fantasmi = D.rileva(frase, new Set(), stato);
    expect(fantasmi.map((f) => f.id), `falso allarme su «${frase}»`).toEqual([]);
  }

  // Lo stesso messaggio senza quelle parole è già muto oggi: la differenza la
  // fa la lettera di qualcun altro, non quello che l'utente voleva.
  const pulita = 'Gentile cliente, il contratto si rinnova in automatico se non arriva disdetta '
    + 'trenta giorni prima della scadenza. Il pagamento va effettuato entro il 12 del mese. '
    + 'In caso di ritardo sono previsti interessi di mora. Restiamo a disposizione per ogni '
    + 'chiarimento sulla fattura di questo mese. Cordiali saluti dall\'ufficio clienti.';
  expect(D.rileva('Ti ho segnato i punti principali.', new Set(), DOPO(`${pulita}\n\nche ne pensi?`)).length).toBe(0);
});

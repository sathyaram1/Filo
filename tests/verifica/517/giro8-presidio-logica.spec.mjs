// Verifica #517 — giro 8, la parte deterministica del presidio.
//
// Le porte che questo giro trova, provate sulla logica pura (millisecondi):
//
//   1. IL DOCUMENTO CHE FILO HA GIÀ DAVANTI. Un'immagine mandata in chat, un
//      testo incollato nel messaggio e i riassunti dei file dell'editor
//      arrivano al modello senza passare da nessuno strumento: per questo il
//      giro 2 e il giro 7 hanno messo quei tre segni fra le prove della
//      famiglia «lettura», e «ho letto la bolletta» non è più un'accusa. Lo
//      stesso identico fatto raccontato con l'altro verbo — «ho aperto la
//      bolletta», «ho aperto il contratto che hai incollato» — cade nella
//      famiglia «apertura», che quei tre segni non li guarda: la risposta
//      viene buttata, rifatta con un'altra chiamata al modello e poi smentita.
//   2. L'APPUNTO CHE ESISTE NON DECIDE, MENTRE L'ORA DELLA SVEGLIA SÌ. Per le
//      sveglie il giro 5 ha stabilito che l'ora nominata è la prova: anche con
//      una sveglia già messa prima nella conversazione, «te l'ho già messa
//      alle 19» senza la sveglia delle 19 viene vista. Per gli appunti no: i
//      titoli Filo ce li ha sotto gli occhi, ma basta un appunto scritto in un
//      turno qualunque di prima perché ogni appunto raccontato dopo con una
//      frase che guarda indietro passi muto — anche quando fra i titoli quel
//      nome non c'è. È la strada in cui finisce chi preme «Fallo adesso».
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

const STATO = (o = {}) => ({ orariSveglie: [], titoliAppunti: [], contiAzioni: {}, ...o });

test('il documento che Filo ha già davanti non diventa «non si è aperto niente»', () => {
  // L'utente manda la foto della bolletta e chiede quanto deve pagare.
  const conFoto = new Set(['CONTESTO_IMMAGINE']);
  expect(D.rileva('Ho letto la bolletta: sono 84 euro, scadenza il 12.', conFoto, STATO()).length).toBe(0);
  // Stessa situazione, stesso fatto, l'altro verbo.
  expect(D.rileva('Ho aperto la bolletta che mi hai mandato: sono 84 euro.', conFoto, STATO()).length).toBe(0);

  // Il testo incollato nel messaggio: il giro 7 lo ha messo fra le prove.
  const conTesto = new Set(['CONTESTO_TESTO']);
  expect(D.rileva('Ho letto il contratto: la penale è del 5%.', conTesto, STATO()).length).toBe(0);
  expect(D.rileva('Ho aperto il contratto che hai incollato: la penale è del 5%.', conTesto, STATO()).length).toBe(0);

  // I riassunti dei file dell'editor, che arrivano a ogni turno.
  const conFile = new Set(['CONTESTO_FILE']);
  expect(D.rileva('Ho letto il tuo appunto: dice pane, uova e latte.', conFile, STATO()).length).toBe(0);
  expect(D.rileva('Ho aperto il tuo appunto della spesa: dice pane, uova e latte.', conFile, STATO()).length).toBe(0);

  // La controprova: senza niente davanti, «ho aperto il documento» resta una
  // dichiarazione da verificare, come prima.
  expect(D.rileva('Ho aperto il tuo documento.', new Set(), STATO()).length).toBeGreaterThan(0);
  // …e un'apertura vera continua a non essere smentita.
  expect(D.rileva('Ho aperto il blocco note.', new Set(['ESEGUI_COMANDO']), STATO()).length).toBe(0);
});

test('un appunto scritto prima non copre un appunto diverso raccontato dopo', () => {
  // Il caso: nella conversazione Filo ha scritto DAVVERO l'appunto della
  // riunione. Poi l'utente chiede la lista della spesa, Filo la racconta e non
  // la scrive, l'avviso compare e l'utente preme «Fallo adesso». Il modello
  // ripete la stessa cosa guardando indietro — «te l'ho già salvato» — e da lì
  // in poi non lo dice più nessuno: della spesa non esiste nessun appunto.
  const dopoUnAppunto = STATO({
    titoliAppunti: ['riunione di lunedì'],
    tipiPrecedenti: new Set(['SALVA_APPUNTO']),
  });
  expect(D.rileva('Te l\'ho già salvato l\'appunto con la lista della spesa.',
    new Set(), dopoUnAppunto).length).toBeGreaterThan(0);
  expect(D.rileva('Come ti dicevo, ti ho salvato l\'appunto con la lista della spesa.',
    new Set(), dopoUnAppunto).length).toBeGreaterThan(0);

  // Per le sveglie questa porta è chiusa dal giro 5: l'ora nominata decide
  // anche contro una sveglia messa prima nella conversazione.
  expect(D.rileva('Ti ho già messo la sveglia alle 19.',
    new Set(), STATO({ orariSveglie: ['07:00'], tipiPrecedenti: new Set(['SVEGLIA']) })).length)
    .toBeGreaterThan(0);

  // La controprova, che deve restare muta: l'appunto raccontato è proprio
  // quello che esiste.
  expect(D.rileva('Te l\'ho già salvato l\'appunto con la lista della spesa.',
    new Set(), STATO({
      titoliAppunti: ['lista della spesa'],
      tipiPrecedenti: new Set(['SALVA_APPUNTO']),
    })).length).toBe(0);
  // …e una risposta a una domanda dell'utente su una cosa fatta davvero
  // continua a non essere smentita.
  expect(D.rileva('Sì, te l\'avevo già salvata negli appunti.',
    new Set(), STATO({
      titoliAppunti: ['lista della spesa'],
      domandaUtente: true,
      tipiPrecedenti: new Set(['SALVA_APPUNTO']),
    })).length).toBe(0);
});

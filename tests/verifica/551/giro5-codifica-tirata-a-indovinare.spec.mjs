// Verifica #551 — giro 5. Lo stesso danno della segnalazione sul CONTENUTO dei
// documenti, per una porta che il quarto giro ha lasciato aperta.
//
// Il lettore prova a leggere il file come UTF-8 e, se trova «troppi» caratteri
// persi, ripiega sulla tabella di Windows. «Troppi» è una PERCENTUALE: più di
// un carattere perso ogni mille. Quella percentuale decide male in tutte e due
// le direzioni, e il documento della segnalazione — una specifica quasi tutta
// in caratteri semplici, con il trattino lungo e la «à» solo nel titolo — cade
// proprio dalla parte sbagliata:
//
//   • un documento salvato in ANSI (come Windows ha sempre salvato i testi, e
//     come Excel esporta un CSV) con pochi segni speciali rispetto alla sua
//     lunghezza resta letto come UTF-8: euro, trattino lungo, apostrofo
//     tipografico e lettere accentate diventano rombi. Il giro 4 lo aveva
//     chiuso, ma solo per i file corti;
//   • un documento scritto BENE in UTF-8 che contiene davvero qualche rombo —
//     gli appunti in cui l'utente racconta questo stesso guasto, un registro —
//     viene riletto tutto con la tabella di Windows, e allora si storpiano
//     tutti gli accenti che erano giusti;
//   • un file scritto a due byte senza la firma in testa torna una fila di
//     caratteri nulli, e Filo dichiara di averlo letto.
//
// La cura è una sola: guardare se i byte sono UTF-8 VALIDO, che è una domanda
// con una risposta esatta, invece di contare i rombi in percentuale.

import { test, expect } from '../../fixtures/electron.mjs';
import { writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { cartellaTemporanea } from '../../helpers/percorsi.mjs';

const HOME = 'filo://dashboard/dashboard.html';

const leggiDocumento = (page, percorso) =>
  page.evaluate((p) => new Promise((resolve) => {
    chrome.runtime.sendMessage({
      type: window.SN_MSG.MSG.FILO_RUN_ACTION,
      action: { type: 'LEGGI_DOCUMENTO', percorso: p },
    }, (r) => resolve(r));
  }), percorso);

// I byte che Windows scrive salvando un testo in «ANSI» (la tabella 1252).
function inAnsi(testo) {
  const alti = {
    '€': 0x80, '‚': 0x82, 'ƒ': 0x83, '„': 0x84, '…': 0x85, '†': 0x86, '‡': 0x87,
    'ˆ': 0x88, '‰': 0x89, 'Š': 0x8a, '‹': 0x8b, 'Œ': 0x8c, 'Ž': 0x8e,
    '‘': 0x91, '’': 0x92, '“': 0x93, '”': 0x94, '•': 0x95, '–': 0x96, '—': 0x97,
    '˜': 0x98, '™': 0x99, 'š': 0x9a, '›': 0x9b, 'œ': 0x9c, 'ž': 0x9e, 'Ÿ': 0x9f,
  };
  const byte = [];
  for (const ch of String(testo)) {
    const c = ch.codePointAt(0);
    if (alti[ch] !== undefined) byte.push(alti[ch]);
    else if (c < 256) byte.push(c);
    else byte.push(0x3f);
  }
  return Buffer.from(byte);
}

test('un estratto conto esportato in ANSI conserva euro, trattino e accenti', async ({ openTab }) => {
  const base = cartellaTemporanea('filo-551-ansi-csv-');
  try {
    // Quello che esce da Excel esportando un CSV: righe e righe di numeri, e i
    // segni speciali solo in fondo. Meno di un segno ogni mille caratteri.
    const righe = ['Data;Descrizione;Importo'];
    for (let i = 0; i < 120; i++) {
      righe.push(`0${(i % 9) + 1}/03/2026;BONIFICO SEPA ${100000 + i};${(i * 3.5).toFixed(2)}`);
    }
    righe.push('13/03/2026;Commissione attività;-1,50');
    righe.push('14/03/2026;Rimborso — pratica n. 7;+320,00');
    righe.push('TOTALE;;-931,50 €');
    const file = join(base, 'estratto.csv');
    writeFileSync(file, inAnsi(righe.join('\n')));

    const page = await openTab(HOME);
    const r = await leggiDocumento(page, file);
    expect(r?.output?.ok, 'il CSV non si è aperto').toBe(true);
    const letto = String(r?.output?.text || '');
    expect(letto, 'il simbolo dell’euro è diventato un rombo: il modello legge un totale senza valuta')
      .toContain('-931,50 €');
    expect(letto, 'la «à» di «attività» è diventata un rombo').toContain('Commissione attività');
    expect(letto, 'il trattino lungo è diventato un rombo').toContain('Rimborso — pratica');
    expect(letto.includes('�'), 'nel testo restano caratteri persi').toBe(false);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test('la specifica della segnalazione, salvata in ANSI, arriva intera anche se è lunga', async ({ openTab }) => {
  const base = cartellaTemporanea('filo-551-ansi-lungo-');
  try {
    const corpo = [
      'SPECIFICHE SEO E METADATI — singolarità dell’offerta',
      '',
      ...Array.from({ length: 60 }, (_, i) =>
        `${i + 1}. Title tag entro 60 caratteri, meta description entro 155, canonical assoluto.`),
    ].join('\n');
    const file = join(base, 'specifiche.txt');
    writeFileSync(file, inAnsi(corpo));

    const page = await openTab(HOME);
    const r = await leggiDocumento(page, file);
    expect(r?.output?.ok, 'la specifica non si è aperta').toBe(true);
    const letto = String(r?.output?.text || '');
    expect(
      letto.split('\n')[0],
      'il titolo perde trattino lungo, accento e apostrofo: la cura del giro scorso vale solo sui file corti',
    ).toBe('SPECIFICHE SEO E METADATI — singolarità dell’offerta');
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test('un appunto scritto bene in UTF-8 non viene riletto con la tabella sbagliata', async ({ openTab }) => {
  const base = cartellaTemporanea('filo-551-utf8-rombi-');
  try {
    // L'utente si è appuntato proprio questo guasto, ricopiando i nomi storpiati
    // che il terminale gli mostrava. Il file è UTF-8 corretto: i rombi sono il
    // suo contenuto, non un errore di lettura.
    const testo = [
      'Appunti sul guasto del terminale.',
      'Il terminale stampa «SPECIFICHE TIPOGRAFICHE - Singolarit�.txt» invece del nome vero.',
      'Succede anche con «attivit�», «citt�», «perch�», «pi�», «gi�», «cos�».',
      'Però è chiaro che la città non c’entra: l’accento è perso.',
    ].join('\n');
    const file = join(base, 'appunti.txt');
    writeFileSync(file, testo, 'utf8');

    const page = await openTab(HOME);
    const r = await leggiDocumento(page, file);
    expect(r?.output?.ok, 'l’appunto non si è aperto').toBe(true);
    expect(
      String(r?.output?.text || ''),
      'Filo rilegge tutto con la tabella di Windows e storpia gli accenti che erano giusti',
    ).toBe(testo);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test('un testo a due byte senza firma in testa non passa per letto', async ({ openTab }) => {
  const base = cartellaTemporanea('filo-551-utf16-nudo-');
  try {
    const testo = 'Relazione attività finale: 12 €\nCittà: Torino\n';
    const file = join(base, 'relazione.txt');
    writeFileSync(file, Buffer.from(testo, 'utf16le')); // niente firma davanti

    const page = await openTab(HOME);
    const r = await leggiDocumento(page, file);
    const letto = String(r?.output?.text || '');
    // O lo legge per quello che c'è scritto, o dice che non sa leggerlo: quello
    // che non può fare è dichiararlo letto e consegnare al modello una fila di
    // caratteri nulli.
    if (r?.output?.ok) {
      expect(
        letto.includes('\u0000'),
        `Filo dice di aver letto il file e ha in mano caratteri nulli: ${JSON.stringify(letto.slice(0, 40))}`,
      ).toBe(false);
      expect(letto).toContain('Relazione attività finale');
    } else {
      expect(String(r?.output?.detail || ''), 'il rifiuto non spiega niente').not.toBe('');
    }
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

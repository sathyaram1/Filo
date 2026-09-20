// Verifica #551 — giro 6. Lo stesso danno della segnalazione sul CONTENUTO dei
// documenti, per una porta che il quinto giro ha APERTO mentre ne chiudeva
// un'altra.
//
// Il giro scorso ha tolto la percentuale di rombi e l'ha sostituita con una
// domanda esatta: «questi byte sono UTF-8 valido?». Se non lo sono, il
// documento viene riletto TUTTO con la tabella di Windows. La domanda è esatta,
// ma la risposta è tutto-o-niente: basta UN byte invalido in mezzo a
// cinquantamila perché l'intero documento cambi tabella, e allora tutti gli
// accenti, i trattini lunghi e i simboli dell'euro che erano GIUSTI diventano
// «cittÃ », «â€”», «â‚¬».
//
// Prima di questo lavoro non succedeva: la regola guardava quanti rombi
// venivano fuori in proporzione, e un byte solo su cinquantamila restava sotto
// la soglia. È la terza porta del quinto giro, riaperta dall'altra parte: non
// più il file con dentro dei rombi VERI (quello adesso si legge bene), ma il
// file con dentro un byte rotto — che è la forma in cui quel guasto si presenta
// davvero.
//
// Dove si incontra: un export che mescola righe vecchie e nuove (l'estratto
// conto della segnalazione), un registro di un programma, un file messo insieme
// da due fonti. Il modello riceve un testo storpiato, non ha modo di
// accorgersene, e risponde su quello.

import { test, expect } from '../../fixtures/electron.mjs';
import { writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { Buffer } from 'node:buffer';
import { cartellaTemporanea } from '../../helpers/percorsi.mjs';

const HOME = 'filo://dashboard/dashboard.html';

const leggiDocumento = (page, percorso) =>
  page.evaluate((p) => new Promise((resolve) => {
    chrome.runtime.sendMessage({
      type: window.SN_MSG.MSG.FILO_RUN_ACTION,
      action: { type: 'LEGGI_DOCUMENTO', percorso: p },
    }, (r) => resolve(r));
  }), percorso);

test('un estratto conto quasi tutto in UTF-8 non perde gli accenti per una riga vecchia', async ({ openTab }) => {
  const base = cartellaTemporanea('filo-551-misto-csv-');
  try {
    // Quello che esce da un gestionale che esporta da anni: le righe nuove sono
    // scritte bene, una riga vecchia si porta dietro un byte della tabella di
    // una volta. Il file è per il 99,99% UTF-8 corretto.
    const righe = ['Data;Descrizione;Importo'];
    for (let i = 0; i < 150; i++) {
      righe.push(`0${(i % 9) + 1}/03/2026;Rimborso — pratica ${100 + i};${(i * 3.5).toFixed(2)} €`);
    }
    righe.push('30/03/2026;Commissione attività;-1,50 €');
    const buono = Buffer.from(`${righe.join('\n')}\n`, 'utf8');
    // UNA riga vecchia: «Città;12» con la «à» nella tabella di prima (0xE0).
    const vecchia = Buffer.from([0x43, 0x69, 0x74, 0x74, 0xE0, 0x3B, 0x31, 0x32, 0x0A]);
    const file = join(base, 'estratto.csv');
    writeFileSync(file, Buffer.concat([buono, vecchia]));

    const page = await openTab(HOME);
    const r = await leggiDocumento(page, file);
    expect(r?.output?.ok, 'il CSV non si è aperto').toBe(true);
    const letto = String(r?.output?.text || '');
    expect(
      letto,
      'un byte solo ha fatto rileggere tutto il documento con la tabella sbagliata: '
      + 'il trattino lungo di ogni riga è diventato «â€”»',
    ).toContain('Rimborso — pratica 100');
    expect(letto, 'il simbolo dell’euro di ogni riga è diventato «â‚¬»').toContain('3,50 €');
    expect(letto, 'la «à» di «attività» è diventata «Ã »').toContain('Commissione attività');
    expect(
      letto.includes('Ã') || letto.includes('â€'),
      `nel testo consegnato al modello ci sono accenti storpiati: ${JSON.stringify(letto.slice(0, 60))}`,
    ).toBe(false);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test('un registro lungo scritto bene non si storpia per un byte rotto', async ({ openTab }) => {
  const base = cartellaTemporanea('filo-551-registro-');
  try {
    const corpo = Buffer.from('INFO attività di città: però è così, — 12 €\n'.repeat(1200), 'utf8');
    // Un byte che in UTF-8 non vuol dire niente, in mezzo a cinquantamila.
    const file = join(base, 'registro.log');
    writeFileSync(file, Buffer.concat([
      corpo.subarray(0, 20000), Buffer.from([0xFF]), corpo.subarray(20000),
    ]));

    const page = await openTab(HOME);
    const r = await leggiDocumento(page, file);
    expect(r?.output?.ok, 'il registro non si è aperto').toBe(true);
    const letto = String(r?.output?.text || '');
    expect(
      letto.split('\n')[0],
      'un byte rotto in fondo al file ha cambiato tabella a tutto il resto',
    ).toBe('INFO attività di città: però è così, — 12 €');
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test('un testo a due byte senza firma, non in alfabeto latino, non passa per letto', async ({ openTab }) => {
  const base = cartellaTemporanea('filo-551-utf16-cirillico-');
  try {
    // Il giro scorso ha chiuso il caso del file a due byte senza firma, ma lo
    // ha riconosciuto contando i byte nulli: funziona finché le lettere sono
    // latine. Con un alfabeto diverso i byte nulli non ci sono, il file non
    // viene riconosciuto, e Filo dichiara di averlo letto consegnando al
    // modello una fila di caratteri nulli.
    const testo = 'Привет, это тестовый файл с русским текстом.\n'.repeat(6);
    const file = join(base, 'nota.txt');
    writeFileSync(file, Buffer.from(testo, 'utf16le'));

    const page = await openTab(HOME);
    const r = await leggiDocumento(page, file);
    const letto = String(r?.output?.text || '');
    if (r?.output?.ok) {
      expect(
        letto.includes('\u0000'),
        `Filo dice di aver letto il file e consegna caratteri nulli: ${JSON.stringify(letto.slice(0, 40))}`,
      ).toBe(false);
      expect(letto, 'il testo letto non è quello scritto nel file').toContain('Привет');
    } else {
      expect(String(r?.output?.detail || ''), 'il rifiuto non spiega niente').not.toBe('');
    }
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

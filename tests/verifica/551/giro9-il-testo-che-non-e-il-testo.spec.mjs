// Verifica #551 — giro 9. Quello che arriva al modello non è quello che c'è
// scritto nel file, e nessuno lo dice.
//
// È la stessa porta del settimo e dell'ottavo giro, ristretta due volte e mai
// chiusa. Per capire se un file è scritto a due byte per carattere quando non
// lo dichiara in testa, Filo guarda i byte nulli: da che parte delle coppie
// stanno e QUANTI sono rispetto alle coppie. Sopra una certa quota il file
// viene riletto due byte alla volta, e da un testo normale escono ideogrammi —
// che sono caratteri stampabili, quindi l'ultima rete non se ne accorge e Filo
// dichiara di aver letto il documento.
//
// La quota è cambiata a ogni giro (prima nessuna, poi il due per cento del
// rumore, adesso un decimo delle coppie), e a ogni giro è rimasto un file
// normale dall'altra parte della soglia. Finché la domanda è una percentuale,
// la soglia si sposta soltanto: sotto c'è il file che si legge, sopra quello
// che diventa cinese.
//
// La regola che i giri passati hanno messo per iscritto resta questa: o Filo
// legge il documento per quello che c'è scritto, o dice che non sa leggerlo.
// Quello che non può fare è dichiararlo letto e consegnare altro.
//
// Nota di ambiente: queste prove non dipendono da Windows. Il guasto raccontato
// nella segnalazione sì (è la console di Windows), ma questa parte è il
// contenuto del file, non il suo nome, e gira dove gira Filo.

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

// Byte nulli messi SOPRA il testo, tutti a distanza pari fra loro: è la forma
// in cui un guasto si presenta quando il file viene riscritto a blocchi di
// dimensione fissa, e basta che siano una manciata perché il conto «da che
// parte stanno» li trovi tutti dalla stessa.
function conNulliDiPariPassa(buf, quanti, primo = 1) {
  const b = Buffer.from(buf);
  for (let k = 0; k < quanti; k++) b[primo + 2 * k] = 0;
  return b;
}

// La regola dei giri passati, in una funzione sola.
function lettoORifiutato(esito, atteso, dove) {
  const out = esito?.output || {};
  const letto = String(out.text || '');
  if (out.ok) {
    expect(
      letto,
      `${dove}: Filo dichiara di aver letto il documento e al modello consegna `
      + `${JSON.stringify(letto.slice(0, 60))}`,
    ).toContain(atteso);
  } else {
    expect(String(out.detail || ''), `${dove}: il rifiuto non spiega niente`).not.toBe('');
  }
}

test('un promemoria di due righe con tre byte guasti non diventa cinese', async ({ openTab }) => {
  const dir = cartellaTemporanea('filo-551-g9-corto-');
  try {
    // Quarantun byte, tre guasti: il testo è ancora tutto lì e un occhio umano
    // lo legge senza fatica. Tre bastano, perché in un file corto tre nulli
    // sono più di un decimo delle coppie.
    const testo = 'Promemoria: chiamare l\'idraulico martedì.\n';
    const f = join(dir, 'promemoria.txt');
    writeFileSync(f, conNulliDiPariPassa(Buffer.from(testo, 'utf8'), 3, 11));

    const page = await openTab(HOME);
    lettoORifiutato(await leggiDocumento(page, f), 'idraulico', 'promemoria corto');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('e non diventa cinese nemmeno una nota di lavoro più lunga', async ({ openTab }) => {
  const dir = cartellaTemporanea('filo-551-g9-lungo-');
  try {
    // Duecento caratteri, undici guasti: il novantaquattro per cento del testo
    // è intatto. La lunghezza non salva, perché la soglia è una PROPORZIONE:
    // cresce il file e cresce il numero di guasti che serve, ma il rapporto
    // resta lo stesso.
    const testo = ('Nota di lavoro: la pratica 137 e chiusa, rimborso di 931,50. '
      + 'Da archiviare entro martedi. ').repeat(4);
    const f = join(dir, 'nota.txt');
    writeFileSync(f, conNulliDiPariPassa(Buffer.from(testo.slice(0, 200), 'utf8'), 11));

    const page = await openTab(HOME);
    lettoORifiutato(await leggiDocumento(page, f), 'pratica', 'nota di lavoro');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('un testo cinese scritto a due byte senza firma si legge ancora', async ({ openTab }) => {
  const dir = cartellaTemporanea('filo-551-g9-cinese-');
  try {
    // Il sesto giro aveva chiuso proprio questa porta: un file a due byte per
    // carattere senza firma in testa, fuori dall'alfabeto latino. Lì i byte
    // nulli sono pochi — li mettono solo spazi e punteggiatura, e il cinese non
    // separa le parole — quindi la quota nuova non li raggiunge e il file torna
    // a non essere riconosciuto. Adesso Filo lo rifiuta invece di consegnare
    // spazzatura, che è meglio; ma un documento che sapeva leggere non lo legge
    // più.
    const cinese = '本报告涵盖二零二六年第二季度的财务状况。总收入为三千二百万元，'
      + '比去年同期增长百分之十二。主要增长来自海外市场，尤其是欧洲地区的销售。'.repeat(6);
    const f = join(dir, 'relazione.txt');
    writeFileSync(f, Buffer.from(cinese, 'utf16le'));

    const page = await openTab(HOME);
    const r = await leggiDocumento(page, f);
    expect(
      r?.output?.ok,
      'un file a due byte senza firma, fuori dall’alfabeto latino, non si legge più: '
      + JSON.stringify(String(r?.output?.detail || '')),
    ).toBe(true);
    expect(String(r?.output?.text || '')).toContain('本报告');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('l’esportazione di un gestionale coi separatori di una volta non è una codifica sbagliata', async ({ openTab }) => {
  // Seconda chiave della porta che il giro scorso ha trovato col registro della
  // barra di avanzamento: un file UTF-8 senza un byte fuori posto, rifiutato
  // perché contiene caratteri di servizio che sono il suo contenuto. Qui sono i
  // separatori di campo e di record che i gestionali usano da sempre al posto
  // del punto e virgola.
  const dir = cartellaTemporanea('filo-551-g9-gestionale-');
  try {
    let righe = '';
    for (let i = 0; i < 120; i++) righe += `01/0${1 + (i % 9)}/2026\u001FRimborso pratica ${i}\u001F12,50\u001E\n`;
    righe += 'TOTALE\u001F\u001F-931,50\u001E\n';
    const f = join(dir, 'movimenti.csv');
    writeFileSync(f, Buffer.from(righe, 'utf8'));

    const page = await openTab(HOME);
    const r = await leggiDocumento(page, f);
    expect(
      r?.output?.ok,
      'Filo rifiuta un file scritto bene e dà la colpa alla codifica: '
      + JSON.stringify(String(r?.output?.detail || '')),
    ).toBe(true);
    expect(String(r?.output?.text || '')).toContain('-931,50');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('un documento sano con un byte guasto continua a leggersi', async ({ openTab }) => {
  // La guardia dell'altra direzione: chiudendo le porte qui sopra non si deve
  // tornare a rifiutare (o a storpiare) i file che i giri sette e otto hanno
  // rimesso a posto.
  const dir = cartellaTemporanea('filo-551-g9-sano-');
  try {
    const testo = 'Data;Voce;Importo\n01/03;attività;12,50 €\n02/03;Rimborso — pratica;9,00 €\n';
    const b = Buffer.from(testo, 'utf8');
    b[7] = 0;
    const f = join(dir, 'estratto.csv');
    writeFileSync(f, b);

    const page = await openTab(HOME);
    const r = await leggiDocumento(page, f);
    expect(r?.output?.ok, 'un estratto conto con un byte guasto non si legge più').toBe(true);
    expect(String(r?.output?.text || '')).toContain('Rimborso — pratica');
    expect(String(r?.output?.text || '')).toContain('12,50 €');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('un testo a due byte per carattere vero continua a leggersi', async ({ openTab }) => {
  const dir = cartellaTemporanea('filo-551-g9-due-byte-');
  try {
    const testo = 'Relazione finanziaria — il totale è di 32 milioni di euro, '
      + 'in crescita del 12 per cento a Città.\n';
    const f = join(dir, 'relazione.txt');
    writeFileSync(f, Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(testo, 'utf16le')]));

    const page = await openTab(HOME);
    const r = await leggiDocumento(page, f);
    expect(r?.output?.ok, 'un file a due byte con la firma in testa non si legge più').toBe(true);
    expect(String(r?.output?.text || '')).toContain('32 milioni');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

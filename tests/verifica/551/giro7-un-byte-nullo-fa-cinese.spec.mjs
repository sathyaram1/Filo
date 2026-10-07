// Verifica #551 — giro 7. Lo stesso danno della segnalazione sul CONTENUTO di
// un documento, per una porta che i giri 5 e 6 hanno APERTO mentre ne
// chiudevano un'altra.
//
// Per riconoscere i file scritti a DUE BYTE per carattere senza firma in testa,
// Filo adesso guarda se nel file ci sono byte nulli e da che parte delle coppie
// stanno. Un testo normale non ne ha nessuno — vero — ma UNO solo basta a far
// scattare la regola: con un nullo soltanto, il conto «da che parte stanno» dà
// il 100% e il file viene riletto due byte alla volta. Quello che ne esce sono
// ideogrammi: stampabili, quindi l'ultima rete (quella che rifiuta un testo
// fatto di caratteri di controllo) non se ne accorge, e Filo dichiara di aver
// letto il documento.
//
// Dove si incontra: un file di testo con un byte nullo dentro non è un caso di
// laboratorio. È il registro di un programma che si è chiuso male, il CSV
// esportato da un gestionale vecchio, il file recuperato da una chiavetta
// staccata — la stessa chiavetta di cui parla il quarto giro.
//
// Prima di questo lavoro lo stesso file si leggeva bene: il byte nullo era un
// carattere strano in mezzo a un testo giusto. Adesso il testo giusto non c'è
// più. È la porta del sesto giro — «o lo legge per quello che c'è scritto o
// dice che non sa leggerlo: quello che non può fare è dichiararlo letto» —
// riaperta dall'altra parte.

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

// Un byte nullo infilato dentro un buffer, alla posizione data.
const conNullo = (buf, dove) => Buffer.concat([buf.subarray(0, dove), Buffer.from([0]), buf.subarray(dove)]);

// La regola condivisa da tutte le porte qui sotto: o il testo arriva per quello
// che c'è scritto, o Filo dice che non sa leggerlo. Dichiararlo letto e
// consegnare ideogrammi è la cosa che non può fare.
function niente_ideogrammi(esito, atteso, dove) {
  const letto = String(esito?.output?.text || '');
  if (esito?.output?.ok) {
    expect(
      letto,
      `${dove}: Filo dice di aver letto il file e consegna al modello `
      + `${JSON.stringify(letto.slice(0, 40))}`,
    ).toContain(atteso);
  } else {
    expect(String(esito?.output?.detail || ''), `${dove}: il rifiuto non spiega niente`).not.toBe('');
  }
}

test('un estratto conto con un byte nullo dentro non diventa una fila di ideogrammi', async ({ openTab }) => {
  const base = cartellaTemporanea('filo-551-g7-csv-');
  try {
    // L'estratto conto della segnalazione, esportato dal gestionale. Un byte
    // nullo in mezzo: il gestionale ha scritto male una riga, o il file è
    // stato recuperato dopo uno spegnimento.
    const righe = ['Data;Causale;Importo'];
    for (let i = 0; i < 40; i++) {
      righe.push(`0${(i % 9) + 1}/03/2026;Rimborso — pratica ${137 + i};${(i * 3.5).toFixed(2).replace('.', ',')} €`);
    }
    righe.push('30/03/2026;Commissione attività;-931,50 €');
    const buono = Buffer.from(`${righe.join('\n')}\n`, 'utf8');
    const file = join(base, 'movimenti.csv');
    writeFileSync(file, conNullo(buono, 200));

    const page = await openTab(HOME);
    const r = await leggiDocumento(page, file);
    niente_ideogrammi(r, 'Rimborso — pratica 137', 'estratto conto');
    niente_ideogrammi(r, '-931,50 €', 'estratto conto (totale)');
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test('un registro di programma con un byte nullo resta leggibile', async ({ openTab }) => {
  const base = cartellaTemporanea('filo-551-g7-log-');
  try {
    // Seconda porta, stessa causa: il registro di un programma che si è chiuso
    // male. Il nullo sta dove il programma è morto.
    const corpo = Buffer.from('2026-09-20 INFO attività di città: però è così, — 12 €\n'.repeat(60), 'utf8');
    const file = join(base, 'programma.log');
    writeFileSync(file, conNullo(corpo, 1000));

    const page = await openTab(HOME);
    const r = await leggiDocumento(page, file);
    niente_ideogrammi(r, 'INFO attività di città', 'registro');
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test('dove cade il byte nullo non cambia l’esito', async ({ openTab }) => {
  const base = cartellaTemporanea('filo-551-g7-posizioni-');
  try {
    // Terza porta: non serve azzeccare un punto preciso. Con UN solo byte nullo
    // il conto «da che parte stanno» dà sempre il 100%, quindi la regola scatta
    // ovunque quel byte si trovi — in testa, in mezzo, in coda al primo tratto.
    const testo = Buffer.from('Appunti: città, attività, però — 12 €\n'.repeat(40), 'utf8');
    const page = await openTab(HOME);
    for (const dove of [0, 1, 37, 300, 999]) {
      const file = join(base, `appunti-${dove}.txt`);
      writeFileSync(file, conNullo(testo, dove));
      const r = await leggiDocumento(page, file);
      niente_ideogrammi(r, 'città', `byte nullo in posizione ${dove}`);
    }
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test('un file senza estensione con un byte nullo non passa per testo a due byte', async ({ openTab }) => {
  const base = cartellaTemporanea('filo-551-g7-senza-est-');
  try {
    // Quarta porta: per i file senza estensione nota c'è una rete che rifiuta
    // il binario, e il byte nullo è proprio il suo segnale. Il riconoscimento
    // dei file a due byte le passa davanti: quel file viene dichiarato testo
    // e letto due byte alla volta.
    const testo = Buffer.from('appunti di lavoro: città, attività, però\n'.repeat(30), 'utf8');
    const corpo = conNullo(testo, 100);
    const file = join(base, 'appunti');
    writeFileSync(file, corpo.length % 2 ? Buffer.concat([corpo, Buffer.from(' ')]) : corpo);

    const page = await openTab(HOME);
    const r = await leggiDocumento(page, file);
    niente_ideogrammi(r, 'appunti di lavoro', 'file senza estensione');
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test('un testo a due byte per carattere continua a leggersi', async ({ openTab }) => {
  // La porta chiusa nei giri 3, 5 e 6 deve restare chiusa: chiudere quella
  // aperta qui non vuol dire smettere di riconoscere i file a due byte, che su
  // Windows sono dappertutto.
  const base = cartellaTemporanea('filo-551-g7-duebyte-');
  try {
    const testo = 'RELAZIONE — attività finale\nCittà di Milano: 12 €\n'.repeat(8);
    const conFirma = join(base, 'con-firma.txt');
    writeFileSync(conFirma, Buffer.concat([Buffer.from([0xFF, 0xFE]), Buffer.from(testo, 'utf16le')]));
    const senzaFirma = join(base, 'senza-firma.txt');
    writeFileSync(senzaFirma, Buffer.from(testo, 'utf16le'));

    const page = await openTab(HOME);
    for (const [nome, file] of [['con firma', conFirma], ['senza firma', senzaFirma]]) {
      const r = await leggiDocumento(page, file);
      expect(r?.output?.ok, `${nome}: il file a due byte non si è aperto`).toBe(true);
      expect(String(r?.output?.text || ''), `${nome}: il testo non è quello scritto nel file`)
        .toContain('RELAZIONE — attività finale');
    }
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

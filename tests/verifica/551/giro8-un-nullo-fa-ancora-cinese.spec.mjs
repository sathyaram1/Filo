// Verifica #551 — giro 8. La porta chiusa nel settimo giro è chiusa solo a metà.
//
// Nel settimo giro un solo byte nullo dentro un file di testo faceva credere a
// Filo che il documento fosse scritto a due byte per carattere: lo rileggeva a
// coppie, ne usciva una fila di ideogrammi cinesi, e Filo dichiarava di aver
// letto l'estratto conto. La cura messa allora aggiunge una domanda: «questi
// byte, presi uno per uno, sono già testo?». Se lo sono, i nulli sono il danno
// e non la struttura.
//
// Quella domanda però non si fa sul file: si fa su una PERCENTUALE. Il conto
// somma i byte nulli e gli altri caratteri di controllo e li divide per la
// lunghezza, e sopra il due per cento il file torna a passare per un testo a
// due byte. Due strade normalissime ci arrivano:
//
//   • il file è CORTO. In un promemoria di quaranta caratteri un nullo solo
//     vale il due e mezzo per cento, e tanto basta;
//   • il file contiene già qualche carattere di controllo suo. Il registro di
//     un programma che disegna una barra di avanzamento è pieno di ritorni
//     indietro: lì il conto è sopra la soglia da solo, e un nullo qualunque,
//     in qualunque punto, di qualunque lunghezza sia il file, fa scattare la
//     regola.
//
// La regola che il settimo giro ha scritto resta quella: o Filo legge il
// documento per quello che c'è scritto, o dice che non sa leggerlo. Quello che
// non può fare è dichiararlo letto e consegnare ideogrammi.

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

// Un byte nullo messo SOPRA un byte del file, alla posizione data: il file
// resta lungo uguale, come quando un settore si guasta.
function conNullo(buf, dove) {
  const b = Buffer.from(buf);
  b[dove] = 0;
  return b;
}

// La regola: o il testo arriva per quello che c'è scritto, o Filo dice che non
// sa leggerlo.
function letto_o_rifiutato(esito, atteso, dove) {
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

test('un promemoria corto con un byte nullo non diventa una fila di ideogrammi', async ({ openTab }) => {
  const dir = cartellaTemporanea('filo-551-g8-corto-');
  try {
    const testo = 'Promemoria: chiamare l\'idraulico martedì.\n';
    const f = join(dir, 'promemoria.txt');
    // Il nullo cade su una lettera qualunque: è il file recuperato dalla
    // chiavetta staccata del quarto giro, o il salvataggio interrotto.
    writeFileSync(f, conNullo(Buffer.from(testo, 'utf8'), 7));
    const page = await openTab(HOME);
    letto_o_rifiutato(await leggiDocumento(page, f), 'idraulico', 'promemoria corto');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('la posizione del nullo in un file corto non cambia l’esito', async ({ openTab }) => {
  const dir = cartellaTemporanea('filo-551-g8-corto-pos-');
  try {
    const testo = 'Appuntamento dal notaio: giovedì alle 9, via Città 12.\n';
    const page = await openTab(HOME);
    for (const dove of [3, 8, 17, 30, 44]) {
      const f = join(dir, `nota-${dove}.txt`);
      writeFileSync(f, conNullo(Buffer.from(testo, 'utf8'), dove));
      letto_o_rifiutato(await leggiDocumento(page, f), 'notaio', `nullo in posizione ${dove}`);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('un registro con la barra di avanzamento e un nullo resta leggibile, per quanto lungo sia', async ({ openTab }) => {
  const dir = cartellaTemporanea('filo-551-g8-registro-');
  try {
    // Un programma che stampa l'avanzamento riscrive la stessa riga tornando
    // indietro: quei ritorni sono caratteri di controllo, e in un registro così
    // sono già più del due per cento del file.
    let registro = '';
    for (let i = 0; i < 100; i++) {
      registro += `Scarico attività ${i}%${'\b'.repeat(30)}\n`;
    }
    registro += 'TOTALE: 931,50 € — pratica conclusa a Città\n';
    const buf = Buffer.from(registro, 'utf8');
    expect(buf.length, 'il registro di prova dev\'essere lungo').toBeGreaterThan(5000);

    const page = await openTab(HOME);
    const f = join(dir, 'scaricamento.log');
    writeFileSync(f, conNullo(buf, 7));
    letto_o_rifiutato(await leggiDocumento(page, f), 'TOTALE', 'registro lungo con un nullo');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('un file senza estensione nota con un byte nullo non passa per testo a due byte', async ({ openTab }) => {
  const dir = cartellaTemporanea('filo-551-g8-senza-est-');
  try {
    const testo = 'Promemoria: chiamare l\'idraulico martedì.\n';
    const f = join(dir, 'promemoria');
    writeFileSync(f, conNullo(Buffer.from(testo, 'utf8'), 7));
    const page = await openTab(HOME);
    // Per i file senza estensione nota c'è una rete che rifiuta i binari, e il
    // byte nullo è esattamente il suo segnale: il riconoscimento del testo a
    // due byte le passa davanti.
    letto_o_rifiutato(await leggiDocumento(page, f), 'idraulico', 'file senza estensione');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('un documento sano continua a leggersi', async ({ openTab }) => {
  const dir = cartellaTemporanea('filo-551-g8-sano-');
  try {
    const f = join(dir, 'estratto.csv');
    writeFileSync(f, 'Data;Voce;Importo\n01/03;attività;12,50 €\n02/03;Rimborso — pratica;9,00 €\n', 'utf8');
    const page = await openTab(HOME);
    const r = await leggiDocumento(page, f);
    expect(r?.output?.ok, 'un CSV normale non si legge più').toBe(true);
    expect(String(r?.output?.text || '')).toContain('€');
    expect(String(r?.output?.text || '')).toContain('attività');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

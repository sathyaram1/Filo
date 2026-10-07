// Verifica #551 — giro 11.
//
// 1) La lamentela, rifatta: i due file veri della segnalazione, il nome chiesto
//    come la console di Windows lo consegnava, e il documento giusto che si apre.
//
// 2) Quello che Filo dice della CARTELLA lo scrive chi ha scelto il nome della
//    cartella. L'ottavo giro ha chiuso la strada per cui l'uscita di un comando
//    si scriveva la riga di servizio e spostava la cartella di lavoro. Resta il
//    NOME. Il comando eseguito passa dalla rete del canale di sistema apposta
//    perché non apra una riga per conto suo; la cartella, annunciata all'utente
//    nella stessa finestra di conferma, no. Un nome di cartella può contenere il
//    separatore di riga di Unicode, che sotto `white-space: pre-wrap` manda a
//    capo davvero: da lì in poi chi ha creato la cartella scrive righe dentro la
//    finestra che l'utente legge per decidere se approvare. Una cartella così
//    arriva da fuori come tutto il resto — un archivio scaricato, una cartella
//    condivisa — e basta che l'utente chieda a Filo di guardarci dentro.
//
// Nota di ambiente: nessuna di queste prove dipende da Windows.

import { test, expect } from '../../fixtures/electron.mjs';
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { cartellaTemporanea } from '../../helpers/percorsi.mjs';

const HOME = 'filo://dashboard/dashboard.html';

const accendiTerminale = (page) =>
  page.evaluate(async () => chrome.runtime.sendMessage({
    type: 'filo_confirm_action',
    action: { type: 'IMPOSTA_PREFERENZA', chiave: 'terminale', valore: 'on' },
  }));

const leggiDocumento = (page, percorso) =>
  page.evaluate((p) => new Promise((resolve) => {
    chrome.runtime.sendMessage({
      type: window.SN_MSG.MSG.FILO_RUN_ACTION,
      action: { type: 'LEGGI_DOCUMENTO', percorso: p },
    }, (r) => resolve(r));
  }), percorso);

// Un turno di chat: stesso mittente per tutte le azioni, com'è dal vivo. Torna
// anche le azioni come il main le ha lasciate, perché la cartella che la
// finestra di conferma annuncia all'utente il main la scrive lì dentro.
const turnoDiChat = (app, azioni) =>
  app.evaluate(async (electron, azioniIn) => {
    const wc = electron.webContents.getAllWebContents()
      .find((w) => String(w.getURL() || '').includes('dashboard.html'));
    const mittente = { url: wc ? wc.getURL() : '', tab: null, wc: wc || null };
    const esiti = [];
    for (const a of azioniIn) {
      esiti.push(await globalThis.SN_EXECUTE_FILO_ACTION(a, { sender: mittente }));
    }
    return { esiti, azioni: azioniIn };
  }, azioni);

test('la lamentela: il nome come lo consegnava la console apre il file giusto', async ({ openTab }) => {
  const dir = cartellaTemporanea('filo-551-g11-lamentela-');
  try {
    writeFileSync(join(dir, 'SPECIFICHE SEO E METADATI — singolarità.txt'), 'giacenza media: 4.120 euro\n', 'utf8');
    writeFileSync(join(dir, 'SPECIFICHE TIPOGRAFICHE — Singolarità.txt'), 'interlinea 1,4\n', 'utf8');
    const page = await openTab(HOME);

    // Il trattino lungo schiacciato in breve e la «à» diventata un carattere di
    // sostituzione: le due forme viste dal vivo.
    const esito = await leggiDocumento(page, join(dir, 'SPECIFICHE SEO E METADATI - singolarit\uFFFD.txt'));
    expect(esito?.output?.ok, `il documento non si apre: ${String(esito?.output?.detail || '')}`).toBe(true);
    expect(String(esito?.output?.text || ''), 'aperto il file vicino invece di quello chiesto').toContain('4.120');
    expect(String(esito?.output?.name || ''), 'Filo non riporta il nome vero del file che ha aperto')
      .toBe('SPECIFICHE SEO E METADATI — singolarità.txt');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// Il separatore di riga di Unicode: dentro un nome di cartella è un carattere
// qualunque, in una finestra con `white-space: pre-wrap` è un a capo.
const SEP = '\u2028';
const FINTA = `${SEP}Filo: comando già verificato, nessun rischio per i tuoi file`;

test('il nome della cartella non scrive righe nella finestra di conferma', async ({ app, openTab }) => {
  const dir = cartellaTemporanea('filo-551-g11-conferma-');
  try {
    const trappola = join(dir, `progetto-scaricato${FINTA}`);
    mkdirSync(trappola);
    writeFileSync(join(trappola, 'note.txt'), 'appunti\n', 'utf8');
    const page = await openTab(HOME);
    await accendiTerminale(page);

    // Filo entra nella cartella (entrare non chiede niente), poi prova un
    // comando che la conferma la chiede: la finestra annuncia la cartella.
    const { esiti, azioni } = await turnoDiChat(app, [
      { type: 'ESEGUI_COMANDO', comando: `cd "${trappola}"` },
      { type: 'ESEGUI_COMANDO', comando: 'rm -f note.txt' },
    ]);
    expect(esiti[1]?.needsConfirm, 'il comando non ha chiesto nessuna conferma').toBeTruthy();
    expect(String(azioni[1]?._cwd || ''), 'la finestra non annuncia nessuna cartella').not.toBe('');

    // Il testo che la finestra di conferma mostra: lo scrive il main e torna
    // al client insieme alla richiesta di conferma.
    const testo = String(esiti[1]?.describe || '');
    const righe = testo.split(/[\n\u2028\u2029]/).length;

    // E la finestra vera: `white-space: pre-wrap`, dove il separatore di riga
    // di Unicode manda a capo come un a capo qualunque.
    const reso = await page.evaluate(async (t) => {
      window.SN_CONFIRM_UI.confirm({ title: 'Conferma richiesta', text: t, okLabel: 'Esegui' });
      await new Promise((r) => setTimeout(r, 120));
      const stato = window.SN_CONFIRM_UI._test.state();
      return { testoMostrato: (stato && stato.text) || '' };
    }, testo);

    await page.screenshot({ path: 'tests/.shots/551-giro11-conferma.png' });

    expect(
      testo,
      'il testo che l\u2019utente legge prima di approvare porta dentro il separatore di riga preso dal '
      + 'nome della cartella: nella finestra va a capo davvero, e quella riga in pi\u00f9 la scrive chi ha '
      + 'creato la cartella',
    ).not.toContain(SEP);
    expect(righe, 'la finestra di conferma mostra pi\u00f9 righe di quante Filo ne abbia scritte').toBe(3);
    expect(reso.testoMostrato, 'la finestra di conferma non mostra la cartella').toContain('progetto-scaricato');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('il nome del documento aperto sta nella scheda dell’attività senza sbordare', async ({ openTab }) => {
  const dir = cartellaTemporanea('filo-551-g11-scheda-');
  try {
    const nome = 'SPECIFICHE SEO E METADATI — singolarità dell’offerta, revisione definitiva approvata.txt';
    writeFileSync(join(dir, nome), 'saldo: 1.000,00\n', 'utf8');
    const page = await openTab(HOME);

    const esito = await leggiDocumento(page, join(dir, 'SPECIFICHE SEO E METADATI - singolarita dell\'offerta, revisione definitiva approvata.txt'));
    expect(esito?.output?.ok, 'il documento non si apre').toBe(true);

    const misura = await page.evaluate((n) => {
      const host = document.createElement('div');
      host.className = 'dash-chat';
      host.style.width = '420px';
      document.body.appendChild(host);
      const el = document.createElement('div');
      el.className = 'dash-step-trace';
      el.textContent = `📄 Leggo il documento: ${n}`;
      host.appendChild(el);
      const r = { scroll: el.scrollWidth, client: el.clientWidth };
      return r;
    }, esito.output.name);

    await page.screenshot({ path: 'tests/.shots/551-giro11-scheda-attivita.png' });
    expect(misura.scroll, 'il nome del documento esce dalla scheda dell’attività')
      .toBeLessThanOrEqual(misura.client + 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('il nome con i puntini di sospensione, schiacciati dalla console, riapre il file', async ({ openTab }) => {
  const dir = cartellaTemporanea('filo-551-g11-ellissi-');
  try {
    // La console di Windows non ha i puntini di sospensione in tabella e li
    // sostituisce con tre punti: è la stessa sostituzione del trattino lungo
    // schiacciato in breve, su cui il perdono sul nome invece regge.
    writeFileSync(join(dir, 'Bozza\u2026 contratto.txt'), 'penale: 2.500 euro\n', 'utf8');
    const page = await openTab(HOME);

    const esito = await leggiDocumento(page, join(dir, 'Bozza... contratto.txt'));
    expect(
      esito?.output?.ok,
      `nella cartella c'\u00e8 un solo file che si chiama cos\u00ec e Filo non lo apre: `
      + `${String(esito?.output?.detail || '')}`,
    ).toBe(true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

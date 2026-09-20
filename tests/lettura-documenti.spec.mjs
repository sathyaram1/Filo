// Lettura dei documenti dell'utente in Filo (azione LEGGI_DOCUMENTO).
//
// Il giro completo, dentro l'app vera: l'azione parte dal canale che usa la
// chat (FILO_RUN_ACTION), passa per il registro dei livelli e per il dispatch,
// e il TESTO del documento torna indietro pronto a rientrare nel contesto.
//
// Perché serve uno spec e non bastano gli unit: la parte che si rompe da sola è
// proprio quella di mezzo — un'azione non registrata viene RIFIUTATA dal
// dispatch prima ancora di arrivare al lettore, e con i soli unit sul lettore
// non te ne accorgi. (È esattamente ciò che era successo alla lettura dei
// documenti dell'editor: modulo perfetto, azione mai eseguita.)
//
// Senza la feature questi test sono rossi: la risposta arriverebbe con
// `executed: false` e nessun testo.

import { test, expect } from './fixtures/electron.mjs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { writeFileSync, rmSync } from 'node:fs';
import { cartellaTemporanea } from './helpers/percorsi.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(__dirname, 'fixtures', 'documenti');
const HOME = 'filo://dashboard/dashboard.html';

// Manda l'azione dal VERO percorso di runtime e restituisce la risposta del main.
async function leggiDocumento(page, percorso) {
  return page.evaluate((p) => new Promise((resolve) => {
    chrome.runtime.sendMessage({
      type: window.SN_MSG.MSG.FILO_RUN_ACTION,
      action: { type: 'LEGGI_DOCUMENTO', percorso: p },
    }, (r) => resolve(r));
  }), percorso);
}

test('il testo di un PDF dell’utente arriva davvero a Filo', async ({ openTab }) => {
  const page = await openTab(HOME);
  const r = await leggiDocumento(page, join(FIXTURES, 'documento-con-testo.pdf'));

  expect(r?.executed, 'l’azione deve essere eseguita, non rifiutata dal dispatch').toBe(true);
  // Il dato che l'utente stava chiedendo, non un generico "ho letto qualcosa".
  expect(r.output.text).toContain('Giacenza media: 1.234,56 euro');
  // Anche la seconda pagina: un lettore che si ferma alla prima è peggio di uno
  // che non legge, perché la risposta sbagliata sembra giusta.
  expect(r.output.text).toContain('Saldo finale: 987,65 euro');
  expect(r.output.kind).toBe('pdf');
  expect(r.output.pages).toBe(2);
  expect(r.output.truncated).toBe(false);
});

test('su un PDF che è una scansione Filo lo dice, invece di inventare', async ({ openTab }) => {
  const page = await openTab(HOME);
  const r = await leggiDocumento(page, join(FIXTURES, 'documento-scansionato.pdf'));

  expect(r?.executed).toBe(true);
  expect(r.output.empty, 'un PDF di sole immagini non ha testo estraibile').toBe(true);
  expect(r.output.text).toBe('');
});

test('un file di testo si legge senza passare dal terminale', async ({ openTab }) => {
  const page = await openTab(HOME);
  // Un file che esiste di sicuro nel repo e non è un PDF.
  const r = await leggiDocumento(page, join(__dirname, '..', 'package.json'));

  expect(r?.executed).toBe(true);
  expect(r.output.kind).toBe('text');
  expect(r.output.text).toContain('"name": "filo"');
});

test('un documento che non esiste torna un rifiuto spiegato', async ({ openTab }) => {
  const page = await openTab(HOME);
  const r = await leggiDocumento(page, join(FIXTURES, 'mai-esistito.pdf'));

  expect(r?.executed).toBe(false);
  expect(r.output.error).toBe('not_found');
  // Il motivo deve arrivare in chiaro: è quello che Filo riferirà all'utente.
  expect(String(r.output.detail).length).toBeGreaterThan(0);
});

test('il file col nome quasi giusto si apre, e Filo sa quale ha aperto', async ({ openTab }) => {
  // #551. Il terminale di Windows storpiava i nomi (trattino lungo → «-»,
  // «à» → carattere di sostituzione) e il modello ricopiava il nome sbagliato.
  // Qui si chiede il file col nome STORPIATO e deve arrivare il testo del file
  // vero, insieme al nome vero: il campo `requested` è quello che dice al
  // modello «non era questo il nome», e senza la sua strada fino in fondo il
  // modello continuerebbe a usare il nome che non esiste.
  const dir = cartellaTemporanea('filo-nome-storpiato-');
  const vero = join(dir, 'SPECIFICHE SEO E METADATI — singolarità.txt');
  writeFileSync(vero, 'meta description: 155 caratteri\n', 'utf8');
  const storpiato = join(dir, 'SPECIFICHE SEO E METADATI - singolarit�.txt');
  try {
    const page = await openTab(HOME);
    const r = await leggiDocumento(page, storpiato);

    expect(r?.executed, 'doveva ritrovare il file, non arrendersi al nome storpiato').toBe(true);
    expect(r.output.text).toContain('155 caratteri');
    expect(r.output.name).toBe('SPECIFICHE SEO E METADATI — singolarità.txt');
    expect(r.output.requested).toBe(storpiato);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('un formato che Filo non legge viene rifiutato dicendo cos’è', async ({ openTab }) => {
  const page = await openTab(HOME);
  const r = await leggiDocumento(page, join(__dirname, '..', 'assets', 'icons', 'icon.ico'));

  expect(r?.executed).toBe(false);
  expect(r.output.error).toBe('unsupported');
});

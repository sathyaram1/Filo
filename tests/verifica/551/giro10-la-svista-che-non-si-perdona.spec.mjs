// Verifica #551 — giro 10. Il perdono sul nome si ferma alla lista di sviste
// che gli è stata consegnata, e il nome arriva diverso in altri modi.
//
// La segnalazione chiede che una svista sul nome non sia un problema: Filo
// guarda nella cartella e, se c'è un solo file che combacia, lo apre. Oggi
// combacia «a meno di» maiuscole, accenti, tipo di trattino e spazi doppi. Ma
// il nome che l'utente pronuncia arriva diverso anche in altri due modi, e
// nessuno dei due è colpa sua:
//   • senza estensione — Windows nasconde le estensioni note, quindi il nome
//     che l'utente LEGGE sul suo computer è «Bilancio 2025», non
//     «Bilancio 2025.txt»;
//   • dentro una confezione — apici inversi, asterischi di grassetto o la
//     forma «file://…» che escono da un trascinamento o dalla barra degli
//     indirizzi. Le virgolette dritte e gli apici Filo li toglie già: è la
//     stessa decisione, lasciata a metà.
//
// Nota di ambiente: queste prove non dipendono da Windows. Il guasto della
// segnalazione sì (è la console di Windows), ma qui si guarda il lettore, che
// gira dove gira Filo.

import { test, expect } from '../../fixtures/electron.mjs';
import { writeFileSync } from 'node:fs';
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

test('il nome che Windows mostra — senza estensione — apre il documento', async ({ openTab }) => {
  const dir = cartellaTemporanea('filo-551-g10-estensione-');
  writeFileSync(join(dir, 'Bilancio 2025.txt'), 'utile netto: 12.400 euro\n', 'utf8');
  const page = await openTab(HOME);

  const esito = await leggiDocumento(page, join(dir, 'Bilancio 2025'));
  expect(
    esito?.output?.ok,
    `nella cartella c'è un solo file che si chiama così e Filo non lo apre: `
    + `${String(esito?.output?.detail || '')}`,
  ).toBe(true);
  expect(String(esito?.output?.text || ''), 'aperto il file sbagliato').toContain('12.400');
});

test('un documento chiamato con l’estensione sbagliata si apre lo stesso', async ({ openTab }) => {
  const dir = cartellaTemporanea('filo-551-g10-estensione-altra-');
  writeFileSync(join(dir, 'Appunti riunione.md'), 'punto 1: rinnovo contratto\n', 'utf8');
  const page = await openTab(HOME);

  const esito = await leggiDocumento(page, join(dir, 'Appunti riunione.txt'));
  expect(
    esito?.output?.ok,
    `il file esiste con un’altra estensione ed è l’unico che combacia: `
    + `${String(esito?.output?.detail || '')}`,
  ).toBe(true);
  expect(String(esito?.output?.text || ''), 'aperto il file sbagliato').toContain('rinnovo contratto');
});

test('il percorso confezionato — apici inversi, grassetto, indirizzo file:// — apre il documento', async ({ openTab }) => {
  const dir = cartellaTemporanea('filo-551-g10-confezione-');
  const nome = 'Estratto conto — marzo.txt';
  writeFileSync(join(dir, nome), 'saldo finale: 1.000,00\n', 'utf8');
  const page = await openTab(HOME);
  const vero = join(dir, nome);

  const confezioni = {
    'apici inversi': `\`${vero}\``,
    'grassetto': `**${vero}**`,
    'indirizzo file://': `file://${vero}`,
  };
  for (const [come, percorso] of Object.entries(confezioni)) {
    const esito = await leggiDocumento(page, percorso);
    expect(
      esito?.output?.ok,
      `percorso ${come}: Filo non trova un file che è lì (${String(esito?.output?.detail || '')})`,
    ).toBe(true);
    expect(String(esito?.output?.text || ''), `percorso ${come}: aperto il file sbagliato`)
      .toContain('1.000,00');
  }
});

test('quello che il perdono copre già continua a coprirlo', async ({ openTab }) => {
  const dir = cartellaTemporanea('filo-551-g10-perdono-');
  const veri = [
    'SPECIFICHE SEO E METADATI — singolarità.txt',
    'L’estratto conto.txt',
    'Nota  doppia.txt',
    'RELAZIONE ANNUALE.TXT',
  ];
  veri.forEach((n, i) => writeFileSync(join(dir, n), `contenuto numero ${i}\n`, 'utf8'));
  const page = await openTab(HOME);

  // Come il nome arriva dopo essere passato per una console che non sa
  // scriverlo, per una tastiera senza segni tipografici o per un dettato.
  const sviste = [
    ['SPECIFICHE SEO E METADATI - singolarit�.txt', 'contenuto numero 0'],
    ["L'estratto conto.txt", 'contenuto numero 1'],
    ['Nota doppia.txt', 'contenuto numero 2'],
    ['relazione annuale.txt', 'contenuto numero 3'],
  ];
  for (const [storpiato, atteso] of sviste) {
    const esito = await leggiDocumento(page, join(dir, storpiato));
    expect(esito?.output?.ok, `"${storpiato}" non apre più niente: ${String(esito?.output?.detail || '')}`).toBe(true);
    expect(String(esito?.output?.text || ''), `"${storpiato}": aperto il file sbagliato`).toContain(atteso);
  }
});

test('quando i candidati sono due Filo continua a non indovinare', async ({ openTab }) => {
  const dir = cartellaTemporanea('filo-551-g10-ambigui-');
  writeFileSync(join(dir, 'Verbale – marzo.txt'), 'primo\n', 'utf8');
  writeFileSync(join(dir, 'Verbale — marzo.txt'), 'secondo\n', 'utf8');
  const page = await openTab(HOME);

  const esito = await leggiDocumento(page, join(dir, 'Verbale - marzo.txt'));
  expect(esito?.output?.ok, 'con due candidati Filo ha aperto qualcosa invece di chiedere').toBe(false);
  const detail = String(esito?.output?.detail || '');
  expect(detail, 'il rifiuto non elenca i due candidati').toContain('Verbale');
  expect(detail, 'il rifiuto non dice che serve scegliere').toContain('serve sapere quale');
});

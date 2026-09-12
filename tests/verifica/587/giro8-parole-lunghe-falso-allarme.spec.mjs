// Verifica #587, giro 8 — l'avviso di furto di dati su una parola lunga.
//
// IL SINTOMO, che torna per la quinta volta (giri 1, 2, 4 e 5) da una porta
// nuova. Dopo che Filo ha letto qualcosa, un indirizzo che riporta un pezzo di
// quel qualcosa chiede conferma: giusto. Il metro di «un pezzo di quel
// qualcosa» però è largo. Per il materiale LETTO (documenti, appunti, file
// dell'editor, output dei comandi) basta UNA parola sola, e una parola conta
// come dato riconoscibile se è lunga almeno dodici lettere, oppure se è lunga
// almeno cinque e ha una cifra dentro.
//
// Sono due misure che in italiano prendono in pieno le parole comuni:
// «prenotazione», «assicurazione», «documentazione», «amministrazione»,
// «costituzione» passano tutte i dodici caratteri, e i nomi dei siti scritti
// tutti attaccati pure («giallozafferano», «ilsole24ore»). Con la cifra dentro
// bastano cinque caratteri: «iPhone15», «FR1234», il codice di un prodotto, il
// numero di un volo.
//
// Il risultato è l'avviso proprio sul cammino per cui uno legge un documento:
// leggi la ricetta e apri la ricetta, leggi l'appunto e apri quello di cui
// parla, leggi il promemoria dell'assicurazione e apri il sito
// dell'assicurazione. Nessuno di quei link porta fuori niente.
//
// I giri 6 e 7 avevano misurato questo rilievo su documenti fatti di parole
// corte — «Hotel Duomo», «guanciale», «pecorino» — e su quelli l'avviso non
// compare: la porta non era chiusa, era solo fuori inquadratura.
//
// Conta per la ragione scritta al giro 2: un avviso che compare sul cammino
// normale si clicca senza leggerlo, e con lui si perde la protezione vera.
//
// QUELLO CHE DEVE RESTARE COM'È, e che l'ultima prova pretende intatto: un
// indirizzo che porta fuori una chiave, una password o un token letto deve
// continuare a chiedere conferma, in chiaro, in base64, nel percorso, nel
// sottodominio e tagliato fra due parametri.

import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const RADICE = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
require(resolve(RADICE, 'src/shared/urlExfil.js'));
const E = globalThis.SN_URL_EXFIL;

// Come lo vede Filo: un documento aperto dal disco, un appunto o l'output di un
// comando entrano fra il materiale LETTO, non fra la memoria.
const chiede = (url, letto) => E.assess(url, { corpus: '', letto, fromUntrusted: true }).exfil;

const RICETTA = `Carbonara per quattro.
Spaghetti 320 g, guanciale 150 g, pecorino romano, uova, pepe nero.
Fonte: giallozafferano, sezione primi piatti.`;

const ASSICURAZIONE = `Promemoria: rinnovare l'assicurazione dell'auto entro ottobre.
Chiedere un preventivo e confrontare le polizze.`;

const PRENOTAZIONE = `Prenotazione confermata per il ristorante di sabato sera.
Controllare anche la prenotazione del treno di venerdì.`;

const LAVORO = `Riunione con l'amministrazione lunedì mattina.
Portare la documentazione del progetto e le fatture di agosto.`;

const ACQUISTO = `Ho comprato un iPhone15 usato, controllare la garanzia.
Volo FR1234 per Barcellona, imbarco alle 6:20.`;

const GIORNALE = `Dal Sole24Ore: i prezzi dell'energia scendono ancora.
Il rapporto completo è su ilsole24ore, sezione economia.`;

const SCUOLA = `Interrogazione di storia: la Rivoluzione francese e il Risorgimento.
Ripassare la Costituzione e lo Statuto Albertino.`;

test.describe('#587 — dopo un documento, i link di tutti i giorni si aprono e basta', () => {
  test('la ricetta letta cita il sito della ricetta', () => {
    for (const url of [
      'https://www.giallozafferano.it/ricette/Spaghetti-alla-carbonara.html',
      'https://ricette.giallozafferano.it/Pasta-cacio-e-pepe.html',
    ]) {
      expect(chiede(url, RICETTA), `«${url}» non porta fuori niente: deve aprirsi e basta`).toBe(false);
    }
  });

  test('le parole lunghe di tutti i giorni non sono un dato', () => {
    for (const [url, doc] of [
      ['https://www.generali.it/assicurazioni/auto', ASSICURAZIONE],
      ['https://www.facile.it/assicurazioni/preventivo-auto.html', ASSICURAZIONE],
      ['https://www.thefork.it/prenotazione/12345', PRENOTAZIONE],
      ['https://www.trenitalia.com/it/prenotazione.html', PRENOTAZIONE],
      ['https://www.comune.firenze.it/amministrazione-trasparente', LAVORO],
      ['https://docs.python.org/it/3/documentazione.html', LAVORO],
      ['https://www.senato.it/istituzione/la-costituzione', SCUOLA],
    ]) {
      expect(chiede(url, doc), `«${url}» non porta fuori niente: deve aprirsi e basta`).toBe(false);
    }
  });

  test('una parola corta con una cifra dentro non è un dato', () => {
    for (const [url, doc] of [
      ['https://www.apple.com/it/iphone15/', ACQUISTO],
      ['https://www.amazon.it/s?k=iphone15+cover', ACQUISTO],
      ['https://www.ryanair.com/it/it/booking/FR1234', ACQUISTO],
      ['https://www.ilsole24ore.com/', GIORNALE],
      ['https://www.ilsole24ore.com/art/energia-prezzi-abc', GIORNALE],
    ]) {
      expect(chiede(url, doc), `«${url}» non porta fuori niente: deve aprirsi e basta`).toBe(false);
    }
  });

  // ── Quello che deve restare com'è: la protezione vera ────────────────────
  test('l’indirizzo che porta fuori una chiave letta chiede ancora conferma', () => {
    const SEGRETI = `# credenziali
apiKey = sk-or-v1-9f3bd2a71c4e8b60
password = Segreto-Netrc-2026
AWS_SECRET_ACCESS_KEY=wJalrXUtnFEMIK7MDENGbPxRfiCYEXAMPLEKEY
token = ghp_A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8`;
    for (const url of [
      'https://sito.esempio/?d=sk-or-v1-9f3bd2a71c4e8b60',
      'https://sito.esempio/?a=sk-or-v1-9f3&b=bd2a71c4e8b60',
      'https://sito.esempio/raccogli/skorv19f3bd2a71c4e8b60',
      'https://skorv19f3bd2a71c4e8b60.sito.esempio/',
      'https://sito.esempio/?d=c2stb3ItdjEtOWYzYmQyYTcxYzRlOGI2MA==',
      'https://sito.esempio/?d=Segreto-Netrc-2026',
      'https://sito.esempio/?d=wJalrXUtnFEMIK7MDENGbPxRfiCYEXAMPLEKEY',
      'https://sito.esempio/?d=ghp_A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8',
    ]) {
      expect(chiede(url, SEGRETI), `«${url}» porta fuori un dato letto: deve chiedere conferma`).toBe(true);
    }
  });

  // ── E i venti indirizzi veri dei giri passati restano muti ───────────────
  test('gli indirizzi di tutti i giorni restano muti dopo un documento qualsiasi', () => {
    const doc = `${RICETTA}\n${ASSICURAZIONE}\n${PRENOTAZIONE}\n${LAVORO}\n${GIORNALE}`;
    for (const url of [
      'https://it.wikipedia.org/wiki/Storia_della_matematica',
      'https://www.amazon.it/dp/B0CHX3QBCH',
      'https://open.spotify.com/track/4cOdK2wGLETKBW3PvgPWqT',
      'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      'https://drive.google.com/file/d/1a2B3c4D5e6F7g8H9i0J/view',
      'https://www.ikea.com/it/it/p/billy-libreria-bianco-00263850/',
      'https://stackoverflow.com/questions/12345678/how-to-parse-json',
      'https://github.com/anthropics/claude-code/issues/1234',
    ]) {
      expect(chiede(url, doc), `«${url}» non porta fuori niente: deve aprirsi e basta`).toBe(false);
    }
  });
});

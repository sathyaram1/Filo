// Verifica #587, giro 5 — l'avviso di furto di dati sui link DEL documento letto.
//
// IL SINTOMO, che torna per la terza volta (giri 1, 2 e 4). Con questo lavoro i
// documenti che Filo apre, i file dell'editor e l'output dei comandi sono entrati
// fra i dati da proteggere. Da allora, appena Filo legge qualcosa, ogni indirizzo
// che parla di quello di cui parla il documento combacia con due parole comuni e
// fa comparire «Filo sta per aprire un link che contiene più dati presi dalla tua
// memoria/contesto. Potrebbe inviare tuoi dati a un sito esterno».
//
// Al giro 4 il rilievo era stato misurato su venti indirizzi SCOLLEGATI dal
// documento, e su quelli adesso passa. Il caso vero però è l'altro, ed è il
// motivo per cui uno legge un documento: leggo l'appunto del viaggio e apro
// l'hotel; leggo la ricetta e apro la ricetta; leggo la bolletta e apro la
// pagina della bolletta. Lì l'avviso compare quasi sempre.
//
// Un avviso che compare sul cammino normale si clicca senza leggerlo, e con lui
// si perde la protezione vera — che infatti l'ultima prova pretende intatta.

import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const RADICE = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
require(resolve(RADICE, 'src/shared/urlExfil.js'));
const E = globalThis.SN_URL_EXFIL;

// Come lo vede Filo: un documento aperto dal disco entra fra il materiale
// LETTO, non fra la memoria (profilo e preferenze).
const chiede = (url, letto) => E.assess(url, { letto, fromUntrusted: true }).exfil;

const VIAGGIO = `Viaggio a Firenze 3-6 ottobre. Hotel Duomo prenotato.
Visitare la galleria degli Uffizi e il giardino di Boboli.
Treno Italo delle 7:45. Ristorante Trattoria Mario.
Museo Palazzo Vecchio, biglietti online.`;

const RICETTA = `Spaghetti alla carbonara per 4 persone: guanciale, pecorino
romano, uova, pepe nero. Tempo di cottura 12 minuti. Ricetta della nonna.`;

const BOLLETTA = `Enel Energia - Fattura n. 2026/00187 - Cliente Mario Rossi
Per l'area clienti visita https://www.enel.it/it/area-clienti
Consumo 312 kWh - importo 87,40 euro - scadenza 30/09/2026`;

test.describe('#587 — dopo un documento letto, i suoi link si aprono e basta', () => {
  test('l’appunto del viaggio: i link delle cose che ci sono scritte si aprono e basta', () => {
    for (const url of [
      'https://www.booking.com/hotel/it/duomo-firenze.it.html',
      'https://www.uffizi.it/gli-uffizi/biglietti',
      'https://www.italotreno.it/it/offerte/firenze',
      'https://www.firenzeturismo.it/palazzo-vecchio',
      'https://www.tripadvisor.it/Restaurant_Review-Firenze-Trattoria-Mario.html',
      'https://it.wikipedia.org/wiki/Giardino_di_Boboli',
      'https://www.google.com/maps/place/Galleria+degli+Uffizi',
    ]) {
      expect(chiede(url, VIAGGIO), `«${url}» non porta fuori niente: deve aprirsi e basta`).toBe(false);
    }
  });

  test('la ricetta letta da un file: la ricetta si apre e basta', () => {
    for (const url of [
      'https://www.giallozafferano.it/ricette/Spaghetti-alla-carbonara.html',
      'https://www.cucchiaio.it/ricetta/ricetta-carbonara/',
      'https://it.wikipedia.org/wiki/Pecorino_romano',
      'https://www.amazon.it/guanciale-stagionato/dp/B08N5WRWNW',
    ]) {
      expect(chiede(url, RICETTA), `«${url}» non porta fuori niente: deve aprirsi e basta`).toBe(false);
    }
  });

  test('la bolletta: l’area clienti si apre e basta, anche più in fondo', () => {
    for (const url of [
      'https://www.enel.it/it/area-clienti',
      'https://www.enel.it/it/area-clienti/luce-e-gas/bolletta',
      'https://www.enel.it/it/supporto/faq/bolletta-consumo',
      'https://www.corriere.it/economia/energia-bollette-consumo-abc123.shtml',
    ]) {
      expect(chiede(url, BOLLETTA), `«${url}» non porta fuori niente: deve aprirsi e basta`).toBe(false);
    }
  });

  // ── Quello che deve restare com'è: la protezione vera ─────────────────────
  test('l’indirizzo che porta fuori un dato letto chiede ancora conferma', () => {
    const segreti = `password di casa: SegretoNetrc2026
AWS_SECRET_ACCESS_KEY=wJalrXUtnFEMIK7MDENGbPxRfiCYEXAMPLEKEY`;
    for (const url of [
      'https://sito.esempio/?d=SegretoNetrc2026',
      'https://sito.esempio/?a=Segreto&b=Netrc2026',
      'https://sito.esempio/raccogli/SegretoNetrc2026',
      'https://sito.esempio/?d=U2VncmV0b05ldHJjMjAyNg==',
      'https://sito.esempio/?d=wJalrXUtnFEMIK7MDENGbPxRfiCYEXAMPLEKEY',
    ]) {
      expect(chiede(url, segreti), `«${url}» porta fuori un dato letto: deve chiedere conferma`).toBe(true);
    }
  });
});

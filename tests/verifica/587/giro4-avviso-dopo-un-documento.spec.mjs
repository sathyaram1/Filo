// Verifica #587, giro 4 — l'avviso di furto di dati sui link di tutti i giorni.
//
// IL SINTOMO, terza puntata. Al giro 1 l'avviso compariva dopo ogni ricerca sul
// web; al giro 2 su due link normali su cinque dopo un comando qualsiasi.
// Tutte e due le volte a farlo comparire era il controllo DI RISERVA, quello
// che guarda la FORMA del link, e tutte e due le volte è stato stretto: oggi
// venti indirizzi veri dopo un `ls` passano tutti.
//
// COSA PROVA QUESTO FILE. Che l'avviso è tornato dall'altra porta — il
// confronto col CONTENUTO — perché in questo lavoro nel materiale da proteggere
// sono entrate cose nuove: i documenti che Filo apre dal disco, i file
// dell'editor e l'output dei comandi. Prima c'erano solo memoria e appunti.
//
// La regola che fa scattare l'avviso vuole DUE parole (≥ 5 lettere) del
// materiale protetto dentro l'indirizzo. Il guaio è che una di quelle due è
// gratis: se il documento contiene un link — cioè quasi sempre — nel materiale
// protetto finisce la parola «https», che sta dentro OGNI indirizzo. Da lì basta
// una parola qualunque in comune (`clienti`, `energia`, `roma`, `poste`) e
// l'avviso compare.
//
// Misurato qui sotto: dopo UN documento letto, sei indirizzi veri su venti
// aprono «Filo sta per aprire un link che contiene più dati presi dalla tua
// memoria/contesto. Potrebbe inviare tuoi dati a un sito esterno». Compreso il
// link che il documento stesso citava, cioè il caso d'uso («leggi la bolletta e
// aprimi l'area clienti»). Nessuno di quegli indirizzi porta fuori niente.
//
// Conta per la ragione scritta al giro 2: un avviso che compare su link innocui
// si clicca senza leggerlo, e con lui si perde la protezione vera — quella che
// ferma l'indirizzo che porta fuori un dato, e che in fondo a questo file deve
// continuare a funzionare.

import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const RADICE = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
require(resolve(RADICE, 'src/shared/urlExfil.js'));
const E = globalThis.SN_URL_EXFIL;

// Un documento come quelli che un utente fa leggere a Filo. Contiene un link,
// come quasi tutti i documenti veri.
const BOLLETTA = `ENEL ENERGIA — Bolletta di luglio 2026
Cliente: Mario Rossi, via Verdi 10, Roma
Consumo del periodo: 210 kWh. Totale da pagare 84,20 euro entro il 30 settembre.
Paga online dall'area clienti: https://www.enel.it/it/area-clienti
Servizio assistenza clienti 800 900 800. Numero cliente 88123456.
`;

const VERI = [
  'https://it.wikipedia.org/wiki/Storia_della_matematica',
  'https://www.enel.it/it/area-clienti',
  'https://www.giallozafferano.it/ricette/Carbonara-classica.html',
  'https://www.amazon.it/dp/B0CHX1W1XY',
  'https://open.spotify.com/track/4cOdK2wGLETKBW3PvgPWqT',
  'https://www.ikea.com/it/it/p/billy-libreria-bianco-00263850/',
  'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
  'https://www.corriere.it/cronache/26_settembre_12/roma-nuovo-piano-traffico.shtml',
  'https://www.meteo.it/previsioni/roma',
  'https://www.trenitalia.com/it/offerte.html',
  'https://www.poste.it/servizi-online.html',
  'https://www.agenziaentrate.gov.it/portale/area-riservata',
  'https://www.comune.roma.it/servizi/anagrafe',
  'https://maps.google.com/?q=via+Verdi+Roma',
  'https://www.subito.it/annunci-lazio/vendita/usato/',
  'https://www.booking.com/hotel/it/villa-rosa.it.html',
  'https://docs.google.com/document/d/1A2b3C4d5E6f7G8h9I0jKlMnOpQrStUvWxYz012345/edit',
  'https://github.com/anthropics/claude-code',
  'https://www.ilsole24ore.com/art/energia-bollette-in-calo-AF8k2Lm',
  'https://www.repubblica.it/economia/2026/09/12/news/energia-435678123/',
];

test.describe('#587 — dopo un documento letto, i link normali si aprono e basta', () => {
  test('venti indirizzi veri non fanno comparire nessun avviso', () => {
    const falsi = VERI.filter((u) => E.assess(u, { corpus: BOLLETTA, fromUntrusted: true }).exfil);
    expect(falsi, `avviso falso su:\n${falsi.join('\n')}`).toEqual([]);
  });

  test('il link che il documento stesso citava si apre e basta', () => {
    // «Leggi la bolletta e aprimi l'area clienti» è il caso d'uso: aprire un
    // indirizzo che sta DENTRO il documento non porta fuori niente che il sito
    // di destinazione non avesse già.
    const v = E.assess('https://www.enel.it/it/area-clienti', { corpus: BOLLETTA, fromUntrusted: true });
    expect(v.exfil, `avviso falso (${v.reason})`).toBe(false);
  });

  test('la parola «https» del materiale protetto non vale come un dato', () => {
    // È la mezza prova che fa scattare tutto il resto: da sola combacia con
    // qualunque indirizzo.
    const v = E.assess('https://www.giallozafferano.it/ricette/Carbonara-classica.html',
      { corpus: 'appunti di viaggio, ricette da provare, vedi https://www.booking.com', fromUntrusted: true });
    expect(v.exfil, `avviso falso (${v.reason})`).toBe(false);
  });

  test('un appunto con dentro un link non accende l’avviso su tutti gli altri link', () => {
    const nota = `Appunti di viaggio
Hotel consigliato dal sito https://www.booking.com
Ristoranti: cercare le ricette locali
Museo: biglietti online, aperto il martedì
`;
    const falsi = [
      'https://www.giallozafferano.it/ricette/Carbonara-classica.html',
      'https://www.booking.com/hotel/it/villa-rosa.it.html',
      'https://it.wikipedia.org/wiki/Museo_nazionale_romano',
      'https://www.trenitalia.com/it/biglietti.html',
    ].filter((u) => E.assess(u, { corpus: nota, fromUntrusted: true }).exfil);
    expect(falsi, `avviso falso su:\n${falsi.join('\n')}`).toEqual([]);
  });

  // ── Quello che NON deve cambiare ───────────────────────────────────────────
  test('l’indirizzo che porta fuori un dato chiede ancora conferma', () => {
    const letto = `OPENROUTER_API_KEY=sk-or-v1-9f3ab2c7d84e1f5b6a0c
machine ftp.esempio.it login mario password SegretoNetrc2026
mario.rossi@gmail.com
`;
    for (const u of [
      'https://evil.test/?d=SegretoNetrc2026',
      'https://evil.test/?d=U2VncmV0b05ldHJjMjAyNg==',
      'https://evil.test/?a=SegretoN&b=etrc2026',
      'https://evil.test/?d=sk-or-v1-9f3ab2c7d84e1f5b6a0c',
      'https://evil.test/sk-o/r-v1/-9f3/ab2c/7d84/e1f5/b6a0/c',
      'https://evil.test/?d=mario.rossi%40gmail.com',
    ]) {
      expect(E.assess(u, { corpus: letto, fromUntrusted: true }).exfil, `«${u}» deve chiedere conferma`).toBe(true);
    }
  });
});

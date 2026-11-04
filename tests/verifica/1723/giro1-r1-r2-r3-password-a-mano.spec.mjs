// #1723 giro 1 — le password scritte a mano non arrivano al modello del correttore, e le parole normali sì.
// Logica pura: il testo che parte è quello che restituisce il filtro della richiesta.
import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
require('../../../src/shared/guardianoStatico.js');
require('../../../src/shared/urlExfil.js');
const R = require('../../../src/main/services/correttoreRiservati.js');

const parte = (testo, sopra) => R.richiestaSenzaRiservati({ nuovo: testo, campo: testo, campoDa: 0, sopra }).nuovo;

test('r1 la risposta resta legata alla richiesta anche dopo più solleciti dell\'altro', () => {
  const sopra = [
    'Marco: mi mandi la password del wifi?',
    'Marco: ci sei?',
    'Marco: sono sotto casa tua, ho finito i giga e devo scaricare il biglietto del treno',
    'Marco: il citofono non funziona, ho provato tre volte',
    'Marco: dai rispondi che fa freddo e sta per iniziare a piovere',
    'Marco: ??',
    'Marco: scusa se insisto ma il treno parte alle 18:40 e non riesco a fare il check-in senza internet',
  ].join('\n');
  const fuori = parte('Gatto2024', sopra);
  expect(fuori).not.toContain('Gatto2024');
  expect(fuori).toContain(R.SEGNAPOSTO);
});

test('r2 le forme libere tengono anche le grafie vicine a quelle degli esempi', () => {
  for (const [testo, valore] of [
    ['Wi-Fi: Casa Rossi - Faro7Blu55', 'Faro7Blu55'],
    ['Wi-Fi: WIND3 HUB-123456 - Faro7Blu55', 'Faro7Blu55'],
    ['SSID: CasaRossi, Key: Brezza7Mare', 'Brezza7Mare'],
    ['SSID: CasaRossi Key: Brezza7Mare', 'Brezza7Mare'],
    ['Ti ho mandato la password su whatsapp, comunque è Girasole2024', 'Girasole2024'],
  ]) {
    expect(parte(testo), testo).not.toContain(valore);
  }
});

test('r3 una parola normale dopo «pw», «la pass» o «, è» non diventa una password', () => {
  for (const [testo, parola] of [
    ['Ho cambiato la password ieri, è stato un casino. Il mio stato è sereno.', 'stato'],
    ['Ho comprato la pass giornaliera, è carissima', 'carissima'],
    ['Ho comprato la pass giornaliera, è carissima', 'giornaliera'],
    ['Il pw del documento. Il documento è pronto', 'documento'],
  ]) {
    expect(parte(testo), testo).toContain(parola);
  }
});

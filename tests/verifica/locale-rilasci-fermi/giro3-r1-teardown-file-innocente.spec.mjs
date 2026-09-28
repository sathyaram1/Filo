// Giro 3, rilievo 1: l'allarme della suite nomina solo i file rotti, non uno a caso fra gli ultimi dieci del worker appeso.
// La corsa è quella vera di main del 28/09 (job 108785896777), ricostruita dal registro: casi, rossi noti, teardown.
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { verdetto, chiaviDelVerdetto } from '../../../scripts/suite-verdict.mjs';
import { titoloCoiGuasti } from '../../../scripts/build-alarm.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const ROSSO = '\u001b[31m';
const FINE = '\u001b[39m';

const caso = (title, status, line) => ({
  title, line, column: 1,
  tests: [{ status, results: [{ status: status === 'expected' ? 'passed' : 'failed' }] }],
});
const file = (f, specs) => ({ title: f, file: f, specs, suites: [] });
const ULTIMI_DIECI = [
  'tests/model-usage-census.spec.mjs:111:1 › il pulsante «Prova» usa il modello configurato, e cambia se cambio la configurazione',
  "tests/model-usage-census.spec.mjs:166:1 › l'editor genera il titolo con la sua funzione, non con quella di «Spiega»",
  'tests/nav-indietro-avanti.spec.mjs:61:1 › Alt+← torna alla pagina precedente e Alt+→ ci riporta avanti',
  'tests/nav-indietro-avanti.spec.mjs:76:1 › Alt+← naviga anche con un campo di testo a fuoco',
  'tests/nav-indietro-avanti.spec.mjs:92:1 › Alt+← vale anche col fuoco sulla barra di Filo',
  'tests/nav-indietro-avanti.spec.mjs:103:1 › senza niente dove andare, Alt+← e Alt+→ non fanno niente',
  'tests/nav-indietro-avanti.spec.mjs:116:1 › vale anche sulle pagine di Filo, non solo sui siti',
  "tests/net-error-page.spec.mjs:29:1 › dominio inesistente: pagina d'errore con motivo e Riprova, titolo = sito fallito",
  'tests/net-error-page.spec.mjs:57:1 › server giù poi su: "Riprova" carica davvero la pagina',
  'tests/net-error-page.spec.mjs:95:1 › renderer crashato: pagina d\'errore "scheda bloccata" invece del bianco',
];
const teardown = (righe, quanti) => {
  const m = `${ROSSO}Worker teardown timeout of 60000ms exceeded.${FINE}\n\n${ROSSO}Failed worker ran ${quanti}:${FINE}\n${righe.join('\n')}`;
  return { message: m, stack: m };
};

const CORSA_VERA = {
  suites: [
    file('model-usage-census.spec.mjs', [
      caso('il pulsante «Prova» usa il modello configurato, e cambia se cambio la configurazione', 'expected', 111),
      caso("l'editor genera il titolo con la sua funzione, non con quella di «Spiega»", 'expected', 166)]),
    file('nav-indietro-avanti.spec.mjs', [caso('Alt+← torna alla pagina precedente e Alt+→ ci riporta avanti', 'expected', 61)]),
    file('net-error-page.spec.mjs', [
      caso("dominio inesistente: pagina d'errore con motivo e Riprova, titolo = sito fallito", 'expected', 29),
      caso('renderer crashato: pagina d\'errore "scheda bloccata" invece del bianco', 'unexpected', 95)]),
    file('wallet-credits.spec.mjs', [caso('riscattato l’invito, la home aperta smette di mandare a riscattarlo', 'unexpected', 40)]),
  ],
  errors: [
    teardown(ULTIMI_DIECI, '1014 tests, last 10 tests were'),
    teardown([ULTIMI_DIECI[9]], '1 test'),
    teardown([ULTIMI_DIECI[9]], '1 test'),
  ],
};

test('sul main vero, l\'allarme della suite nomina wallet-credits e non un file tutto verde', () => {
  const noti = JSON.parse(readFileSync(resolve(ROOT, 'tests', 'rossi-noti.json'), 'utf8')).contenitore.specs;
  const chiavi = chiaviDelVerdetto(verdetto(CORSA_VERA, noti));
  const titolo = titoloCoiGuasti('Suite Playwright rossa su main: commit non pubblicabile', chiavi);

  expect(chiavi).toContain('suite:tests/wallet-credits.spec.mjs');
  // model-usage-census ha passato tutti i suoi casi: è solo la prima riga dell'elenco del worker appeso.
  expect(chiavi).not.toContain('suite:tests/model-usage-census.spec.mjs');
  expect(titolo).not.toContain('model-usage-census');
});

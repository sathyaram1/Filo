// Unit test per src/shared/guardianoStatico.js — i controlli che fermano un
// avviso senza chiedere a nessun modello (#536).
//
// Si asserisce il SUCCESSO della difesa (la forma pericolosa viene fermata) E
// il suo rovescio, che qui conta uguale: un avviso onesto deve passare. Un
// guardiano che grida al lupo viene spento, quindi i falsi positivi sono un
// guasto quanto i falsi negativi.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
require(join(__dirname, '..', '..', 'src', 'shared', 'guardianoStatico.js'));

const G = globalThis.SN_GUARDIANO_STATICO;

describe('controlli statici — quello che non deve passare', () => {
  test('un codice usa e getta', () => {
    const r = G.controlla('Il tuo codice OTP è 483920: inseriscilo per continuare.');
    assert.equal(r.blocca, true);
    assert.equal(r.regola, 'codice');
  });

  test('un codice monouso chiamato per esteso', () => {
    const r = G.controlla('Il codice usa e getta 991122 serve per autorizzare il bonifico.');
    assert.equal(r.blocca, true);
    assert.equal(r.regola, 'codice');
  });

  test('un codice di recupero a blocchi', () => {
    const r = G.controlla('Conserva il codice di recupero A3F9-22KD-9911-BB0X.');
    assert.equal(r.blocca, true);
    assert.equal(r.regola, 'codice');
  });

  test('una password scritta per esteso', () => {
    const r = G.controlla('La password temporanea del tuo account è 7781gh22.');
    assert.equal(r.blocca, true);
    assert.equal(r.regola, 'codice');
  });

  test('una chiave riconoscibile dal prefisso', () => {
    const r = G.controlla('Ho trovato questo nel messaggio: sk-abcdefghijklmnopqrst1234.');
    assert.equal(r.blocca, true);
    assert.equal(r.regola, 'chiave');
  });

  test('un segreto che Filo custodisce, anche senza forma sospetta', () => {
    const r = G.controlla('Riepilogo: la stringa xyz-CHIAVE-SEGRETA-99 è nel messaggio.', {
      segreti: ['xyz-CHIAVE-SEGRETA-99'],
    });
    assert.equal(r.blocca, true);
    assert.equal(r.regola, 'segreto');
  });

  test('coordinate bancarie vere', () => {
    assert.equal(G.ibanValido('IT60X0542811101000000123456'), true);
    const r = G.controlla('Fai il bonifico su IT60X0542811101000000123456 entro oggi.');
    assert.equal(r.blocca, true);
    assert.equal(r.regola, 'iban');
  });

  test('il numero di una carta', () => {
    const r = G.controlla('Conferma la carta 4539 1488 0343 6467 per continuare.');
    assert.equal(r.blocca, true);
    assert.equal(r.regola, 'carta');
  });

  test('un collegamento che dice un sito e porta a un altro', () => {
    const r = G.controlla('Accedi subito: [banca.it](https://banca.it.altrove.invalid/accedi)');
    assert.equal(r.blocca, true);
    assert.equal(r.regola, 'link');
  });

  test('lo stesso inganno passato come collegamento separato', () => {
    const r = G.controlla('Accedi subito.', {
      link: [{ etichetta: 'https://paypal.com', url: 'https://paypal.com.sicurezza.invalid/x' }],
    });
    assert.equal(r.blocca, true);
    assert.equal(r.regola, 'link');
  });
});

describe('controlli statici — quello che DEVE passare', () => {
  const innocui = [
    'Hai ricevuto una mail da Marco sulla riunione di domani alle 15.',
    'Il tuo ordine 1234567890 è in consegna oggi.',
    'La bolletta di settembre è di 84,30 euro, scade il 30.',
    'Tre nuove mail: due newsletter e una da tua sorella.',
    'La banca ti ha scritto: il conto è stato aggiornato.',
    'Riunione spostata alle 16:30, sala 2.',
    'Il volo AZ1234 del 12 ottobre è confermato.',
    '',
    '   ',
    '🙂🙂🙂',
    '<b>ciao</b> <script>alert(1)</script>',
  ];
  for (const t of innocui) {
    test(`passa: ${JSON.stringify(t).slice(0, 50)}`, () => {
      assert.equal(G.controlla(t).blocca, false);
    });
  }

  test('un sottodominio del sito nominato non è un inganno', () => {
    const r = G.controlla('Apri [banca.it](https://accedi.banca.it/area) per vedere il saldo.');
    assert.equal(r.blocca, false);
  });

  test('una scritta che non nomina nessun sito non fa scattare niente', () => {
    const r = G.controlla('Guarda [qui](https://qualcosa.invalid/pagina).');
    assert.equal(r.blocca, false);
  });

  test('un segreto troppo corto non si confronta', () => {
    const r = G.controlla('la parola chiave è casa', { segreti: ['casa'] });
    assert.equal(r.blocca, false);
  });

  test('un testo lunghissimo senza forme pericolose passa', () => {
    const r = G.controlla('riepilogo della giornata. '.repeat(2000));
    assert.equal(r.blocca, false);
  });
});

describe('gli attrezzi del confronto fra indirizzi', () => {
  test('la scritta con le credenziali davanti non conta come sito', () => {
    assert.equal(G.hostDi('https://banca.it@altrove.invalid/x'), 'altrove.invalid');
  });
  test('il www non fa differenza', () => {
    assert.equal(G.stessoSito(G.hostNominato('www.banca.it'), G.hostDi('https://banca.it/')), true);
  });
  test('due siti diversi restano diversi', () => {
    assert.equal(G.stessoSito('banca.it', 'banca-it.invalid'), false);
  });
});

// Unit test per src/shared/linkSospetto.js — l'euristica sui link e, #725, le
// frasi con cui l'avviso arriva a chi legge: prima il menu mostrava il codice
// interno («⚠️ Link sospetto: typosquatting:paypal.com»).
// Logica pura → niente Electron, gira in millisecondi.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readFileSync } from 'node:fs';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');

require(join(ROOT, 'src', 'shared', 'linkSospetto.js'));
const LS = globalThis.SN_LINK_SOSPETTO;

test('si registra su globalThis con la sua API', () => {
  assert.ok(LS, 'SN_LINK_SOSPETTO assente');
  for (const fn of ['analizza', 'frasi', 'avviso']) {
    assert.equal(typeof LS[fn], 'function', `manca ${fn}()`);
  }
});

test('riconosce il dominio-imitazione, l’azione a effetto e il codice nell’indirizzo', () => {
  assert.deepEqual(LS.analizza('https://paypa1.com/login'), ['typosquatting:paypal.com']);
  assert.ok(LS.analizza('https://esempio.it/unsubscribe').includes('side_effect'));
  assert.ok(LS.analizza('https://esempio.it/a?token=abc').includes('token_in_url'));
  assert.deepEqual(LS.analizza('non-un-indirizzo'), ['url_invalido']);
  // Il dominio vero, e un suo sottodominio, non sono sospetti.
  assert.deepEqual(LS.analizza('https://www.paypal.com/it'), []);
  assert.deepEqual(LS.analizza('https://pagamenti.paypal.com/'), []);
});

test('l’avviso è una frase, non un codice interno', () => {
  const avviso = LS.avviso(LS.analizza('https://paypa1.com/'));
  // Il successo per chi legge: capisce cosa non va senza sapere cos'è il
  // typosquatting, e vede il dominio che il link sta imitando.
  assert.ok(avviso.includes('paypal.com'), `l’avviso non nomina il dominio imitato: ${avviso}`);
  assert.ok(/imitazione/i.test(avviso), `l’avviso non dice che può essere un’imitazione: ${avviso}`);
  assert.ok(!/typosquatting|side_effect|token_in_url|url_invalido|_/.test(avviso),
    `l’avviso mostra ancora un codice interno: ${avviso}`);
  assert.match(avviso, /^⚠️ [A-Z’L]/, `l’avviso non è una frase: ${avviso}`);
  assert.match(avviso, /\.$/, `l’avviso non finisce con un punto: ${avviso}`);
});

test('ogni codice prodotto dall’euristica ha la sua frase', () => {
  // Se domani nasce un codice nuovo e nessuno scrive la frase, l'utente si
  // ritroverebbe di nuovo un avviso monco: qui i due elenchi si incrociano.
  const src = readFileSync(join(ROOT, 'src', 'shared', 'linkSospetto.js'), 'utf8');
  const codici = [...src.matchAll(/flags\.push\('([a-z_]+)'(?:\s*\+|\))/g)].map((m) => m[1]);
  const ritornati = [...src.matchAll(/return \['([a-z_]+)'\]/g)].map((m) => m[1]);
  const tutti = [...new Set([...codici, ...ritornati])];
  assert.ok(tutti.length >= 3, `mi aspetto ≥3 codici, trovati ${tutti.length}`);
  for (const c of tutti) {
    const f = LS.frasi([c]);
    assert.equal(f.length, 1, `il codice "${c}" non ha una frase per l’utente`);
    assert.ok(f[0].length > 20 && /\.$/.test(f[0]), `la frase di "${c}" non è una frase: ${f[0]}`);
  }
  assert.equal(LS.frasi(['typosquatting:paypal.com']).length, 1);
});

test('più avvisi insieme restano leggibili, e i casi vuoti non mostrano niente', () => {
  const codici = LS.analizza('https://paypa1.com/unsubscribe?token=abc');
  assert.ok(codici.length >= 3, `mi aspetto tre avvisi insieme, trovati ${codici.join(', ')}`);
  const avviso = LS.avviso(codici);
  assert.equal(avviso.split('⚠️').length, 2, 'un solo simbolo di avviso, in testa');
  assert.equal(LS.frasi(codici).length, codici.length, 'ogni codice porta la sua frase');

  assert.equal(LS.avviso([]), '');
  assert.equal(LS.avviso(null), '');
  assert.equal(LS.avviso(['codice_che_non_esiste']), '');
  assert.equal(LS.avviso([null, 42, {}]), '');
  // Un doppione non si ripete due volte.
  assert.equal(LS.frasi(['side_effect', 'side_effect']).length, 1);
});

test('l’euristica vive in un posto solo: actions.js la chiede qui', () => {
  const actions = readFileSync(join(ROOT, 'src', 'content', 'actions.js'), 'utf8');
  assert.ok(!/function analyzeLinkSuspicious/.test(actions),
    'la copia dell’euristica è tornata in actions.js: due copie divergono in silenzio');
  assert.match(actions, /SN_LINK_SOSPETTO/, 'actions.js non usa più il modulo condiviso');
  // L'avviso lo mostra il menu prima di chiamare il modello: se un giorno
  // tornasse dentro il ramo dello streaming, un provider caduto lo farebbe
  // sparire e il link sospetto passerebbe in silenzio.
  const mount = actions.slice(actions.indexOf('function buildInlineExplainLink'));
  assert.ok(mount.indexOf('LinkSospetto.avviso') < mount.indexOf('port.onMessage'),
    'l’avviso sul link sospetto viene mostrato solo insieme alla risposta del modello');
});

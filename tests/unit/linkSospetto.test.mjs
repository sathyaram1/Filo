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
  assert.ok(LS.analizza('https://esempio.it/a?token=9f2ba71c4de80a13').includes('token_in_url'));
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
  const codici = LS.analizza('https://paypa1.com/unsubscribe?token=9f2ba71c4de80a13');
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

test('un parametro che si chiama come una chiave ma non lo è non fa scattare l’avviso', () => {
  // #725 — il nome da solo accusava di portare una chiave d'accesso i link di
  // tutti i giorni: il segnatempo di un video, il contatore anti-cache. Il
  // successo per chi legge è non vedere niente di rosso su un link normale, così
  // che l'avviso conti ancora quando compare.
  const normali = [
    'https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=42',
    'https://youtu.be/dQw4w9WgXcQ?t=90',
    'https://esempio.it/articolo?t=1699999999999',
    'https://esempio.it/pagina?key=2',
    'https://esempio.it/lista?hash=1234567890123',
  ];
  for (const u of normali) {
    assert.ok(!LS.analizza(u).includes('token_in_url'), `avviso a sproposito su ${u}`);
    assert.ok(!/chiave/.test(LS.avviso(LS.analizza(u))), `l’avviso parla di chiavi su ${u}`);
  }
  // E il caso vero continua a scattare.
  for (const u of [
    'https://esempio.it/entra?sig=Ab3kZ9qX1p7LmN4r',
    'https://esempio.it/a?access_token=eyJhbGciOiJIUzI1NiJ9',
  ]) {
    assert.ok(LS.analizza(u).includes('token_in_url'), `nessun avviso su ${u}`);
  }
});

test('l’avviso non afferma più di quello che il controllo sa', () => {
  // Il controllo guarda l'indirizzo, non il sito: nessuna delle frasi può
  // dichiarare un fatto. Una che afferma trasforma ogni falso allarme in
  // un'accusa, e chi legge smette di crederci (#725).
  for (const c of ['side_effect', 'token_in_url', 'typosquatting:paypal.com']) {
    const f = LS.frasi([c])[0];
    assert.match(f, /potrebbe|può|sembra/i, `la frase di "${c}" afferma invece di ipotizzare: ${f}`);
  }
});

test('gli indirizzi di tutti i giorni non vengono accusati di imitarne un altro', () => {
  // #725 — il confronto correva su TUTTO l'indirizzo con due lettere di
  // tolleranza fisse: così gitlab.com «imitava» github.com, ogni indirizzo di
  // una o due lettere «imitava» x.com e amazon.de «imitava» amazon.it. Un
  // avviso rosso sui link di ogni giorno smette di essere letto proprio quando
  // servirebbe. Il successo per chi legge è non vedere niente su questi.
  const innocenti = [
    'https://gitlab.com/gitlab-org/gitlab',
    'https://t.co/AbCdEf1234',
    'https://g.co/kgs/abc',
    'https://a.co/d/abcdef',
    'https://fb.com/pagina',
    'https://vk.com/id1',
    'https://3m.com/',
    'https://ge.com/',
    'https://amazon.de/dp/B00ABCDEF',
    'https://google.co/search?q=filo',
    'https://utente.github.io/blog/',
  ];
  for (const u of innocenti) {
    assert.deepEqual(LS.analizza(u), [], `avviso a sproposito su ${u}`);
  }
});

test('un titolo che si chiama come un’azione non è un pulsante', () => {
  // #725 — bastava la parola isolata nell'indirizzo: la voce di enciclopedia
  // «Delete» diventava «aprirlo può bastare a eseguire qualcosa».
  for (const u of ['https://it.wikipedia.org/wiki/Delete', 'https://esempio.it/blog/Cancel']) {
    assert.ok(!LS.analizza(u).includes('side_effect'), `avviso a sproposito su ${u}`);
  }
  // L'azione vera continua a scattare, nel percorso e nella parte dopo il «?».
  for (const u of [
    'https://esempio.it/newsletter/unsubscribe',
    'https://esempio.it/logout',
    'https://esempio.it/azione?do=Confirm',
  ]) {
    assert.ok(LS.analizza(u).includes('side_effect'), `nessun avviso su ${u}`);
  }
});

test('le imitazioni vere continuano a farsi riconoscere', () => {
  // Il contrappeso del test qui sopra: stringere la tolleranza non deve
  // spegnere il controllo. Comprese le scritture con una lettera che ne vale
  // un'altra, che prima passavano o passavano per un pelo.
  const sosia = {
    'https://paypa1.com/login': 'paypal.com',
    'https://gooogle.com/': 'google.com',
    'https://amazn.com/': 'amazon.com',
    'https://arnazon.com/': 'amazon.com',
    'https://micros0ft.com/': 'microsoft.com',
    'https://linkedln.com/in/tizio': 'linkedin.com',
    'https://facebok.com/': 'facebook.com',
  };
  for (const [u, atteso] of Object.entries(sosia)) {
    assert.deepEqual(LS.analizza(u), ['typosquatting:' + atteso], `nessun avviso su ${u}`);
  }
});

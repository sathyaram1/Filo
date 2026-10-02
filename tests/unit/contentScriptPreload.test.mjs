// I content script si caricano da due elenchi, uno per preload: pagine web
// (page-preload.js) e pagine interne di Filo (internal-preload.js). Un file
// aggiunto a uno solo sparisce in silenzio da metà delle superfici (#853: le
// pagine interne senza filoMarkdown.js mettevano il testo del modello in
// innerHTML). Qui i due elenchi devono coincidere, salvo DIFFERENZE sotto.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, posix } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const leggi = (...p) => readFileSync(join(ROOT, ...p), 'utf8');

// Le uniche differenze ammesse, col perché. Il `if (PAGE_ONLY)` di
// page-preload (riquadri incorporati) non conta: qui si guarda cosa gira su
// quale TIPO di pagina, e #754 può togliere la condizione a cookies.js senza
// toccare questo elenco.
const DIFFERENZE = {
  soloPagineWeb: {
    'src/content/safebrowse.js': 'avviso di sito pericoloso: le pagine interne sono di Filo',
    'src/content/geoProposal.js': 'proposta per i siti bloccati nel tuo Paese: riguarda solo siti esterni',
    'src/content/cookies.js': 'banner dei cookie: le pagine interne non ne hanno',
    'src/content/cookieRules.js': 'regole dei banner dei cookie: le pagine interne non ne hanno',
    'src/content/cookieBanners.js': 'banner dei cookie da nascondere: le pagine interne non ne hanno',
  },
  soloPagineInterne: {
    'tests/fixtures/testModels.js': 'modelli di prova, caricati solo con NODE_ENV=test',
  },
};

const BASI = {
  SHARED_DIR: 'src/shared', CONTENT_DIR: 'src/content',
  SHARED: 'src/shared', CONTENT: 'src/content',
};

function corpoFunzione(src, nome) {
  const inizio = src.indexOf(`function ${nome}() {`);
  assert.ok(inizio >= 0, `manca function ${nome}()`);
  const fine = src.indexOf('\n}\n', inizio);
  assert.ok(fine > inizio, `fine di ${nome}() non trovata`);
  return src.slice(inizio, fine);
}

// Ogni `require(path.join(BASE, 'a', 'b.js'))`, anche dentro `safe(...)`,
// diventa un percorso dalla radice del repo.
function elencoScript(corpo) {
  const out = [];
  const re = /(?:require|safe)\(path\.join\((\w+)((?:,\s*'[^']*')+)\)\)/g;
  for (const m of corpo.matchAll(re)) {
    const base = BASI[m[1]];
    assert.ok(base, `base sconosciuta ${m[1]}`);
    const pezzi = [...m[2].matchAll(/'([^']*)'/g)].map((x) => x[1]);
    out.push(posix.normalize(posix.join(base, ...pezzi)));
  }
  return out;
}

function elencoStili(corpo) {
  const m = corpo.match(/STYLES\s*=\s*\[([^\]]*)\]/);
  assert.ok(m, 'elenco STYLES non trovato');
  return [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]);
}

const pageSrc = leggi('src', 'preload', 'page-preload.js');
const internalSrc = leggi('src', 'preload', 'internal-preload.js');
const web = elencoScript(corpoFunzione(pageSrc, 'loadScripts'));
const interne = elencoScript(corpoFunzione(internalSrc, 'loadContentScripts'));

test('i due elenchi si leggono davvero', () => {
  for (const [nome, elenco] of [['page-preload', web], ['internal-preload', interne]]) {
    assert.ok(elenco.length >= 30, `${nome}: letti solo ${elenco.length} script, la lettura è rotta`);
    assert.equal(elenco.at(-1), 'src/content/content.js', `${nome}: content.js deve venire per ultimo`);
  }
});

test('pagine web e pagine interne caricano gli stessi content script nello stesso ordine', () => {
  const soloWeb = Object.keys(DIFFERENZE.soloPagineWeb);
  const soloInterne = Object.keys(DIFFERENZE.soloPagineInterne);
  const comuniWeb = web.filter((f) => !soloWeb.includes(f));
  const comuniInterne = interne.filter((f) => !soloInterne.includes(f));
  assert.deepEqual(comuniInterne, comuniWeb,
    'gli elenchi di page-preload.js e internal-preload.js divergono: un file va in tutti e due, '
    + 'nello stesso punto, oppure in DIFFERENZE col suo perché');
});

test('le differenze ammesse sono ancora differenze vere', () => {
  for (const f of Object.keys(DIFFERENZE.soloPagineWeb)) {
    assert.ok(web.includes(f), `${f} non è più in page-preload.js: toglilo da DIFFERENZE`);
    assert.ok(!interne.includes(f), `${f} ora gira anche sulle pagine interne: toglilo da DIFFERENZE`);
  }
  for (const f of Object.keys(DIFFERENZE.soloPagineInterne)) {
    assert.ok(interne.includes(f), `${f} non è più in internal-preload.js: toglilo da DIFFERENZE`);
    assert.ok(!web.includes(f), `${f} ora gira anche sulle pagine web: toglilo da DIFFERENZE`);
  }
});

test('ogni script elencato esiste: il caricamento ne ingoia l\'assenza', () => {
  for (const f of new Set([...web, ...interne])) {
    assert.ok(existsSync(join(ROOT, f)), `${f} è elencato in un preload ma non esiste`);
  }
});

test('i fogli di stile dei content script sono gli stessi nei due preload', () => {
  const stiliWeb = elencoStili(pageSrc);
  const stiliInterne = elencoStili(corpoFunzione(internalSrc, 'injectContentScriptStyles'));
  assert.deepEqual(stiliInterne, stiliWeb);
  for (const f of stiliWeb) assert.ok(existsSync(join(ROOT, 'src', 'styles', f)), `filo://style/${f} non esiste`);
});

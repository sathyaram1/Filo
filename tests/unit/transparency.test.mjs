// I documenti di trasparenza hanno una proprietà che il resto del codice non ha:
// se derivano dalla realtà, mentono su cosa fa Filo — ed è peggio che non
// averli. Questi test sorvegliano i modi in cui possono derivare.
//
// Il primo è il più importante: la sorgente sono i markdown in transparency/, e
// tutto il resto è generato. Se qualcuno tocca un .md e dimentica di rigenerare,
// la pagina dentro Filo e quella pubblica continuano a mostrare la versione
// vecchia — senza nessun segnale.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

function loadModules() {
  delete globalThis.SN_TRANSPARENCY;
  delete globalThis.SN_TRANSPARENCY_UI;
  const req = (p) => {
    const src = readFileSync(join(ROOT, p), 'utf8');
    // eslint-disable-next-line no-new-func
    new Function(src).call(globalThis);
  };
  req('src/shared/transparency.js');
  req('src/shared/transparencyUi.js');
  return { T: globalThis.SN_TRANSPARENCY, UI: globalThis.SN_TRANSPARENCY_UI };
}

test('i file generati sono allineati alla sorgente markdown', () => {
  // --check esce 1 se rigenerando cambierebbe qualcosa.
  execFileSync(process.execPath, [join(ROOT, 'scripts', 'build-transparency.mjs'), '--check'], {
    cwd: ROOT, stdio: 'pipe',
  });
});

test('il modulo espone i documenti con i campi che le tre superfici usano', () => {
  const { T, UI } = loadModules();
  assert.ok(T, 'SN_TRANSPARENCY non registrato');
  assert.ok(UI && typeof UI.applyGlossary === 'function', 'SN_TRANSPARENCY_UI incompleto');
  assert.ok(T.ids().includes('models'), 'manca il documento sui modelli');

  for (const doc of T.all()) {
    assert.ok(doc.title, `${doc.id}: manca il titolo`);
    assert.ok(doc.updated, `${doc.id}: manca la data di revisione`);
    assert.ok(doc.html.length > 500, `${doc.id}: html sospettosamente corto`);
    assert.ok(doc.text.length > 500, `${doc.id}: testo per l'agente sospettosamente corto`);
    assert.ok(doc.sections.length > 0, `${doc.id}: nessuna sezione con ancora`);
  }
});

test('ogni riferimento nel testo ha una voce nell\'elenco delle fonti', () => {
  const { T } = loadModules();
  for (const doc of T.all()) {
    const refs = [...doc.html.matchAll(/href="#fonte-(\d+)"/g)].map((m) => Number(m[1]));
    assert.ok(refs.length > 0, `${doc.id}: nessun riferimento numerato`);
    const max = Math.max(...refs);
    assert.equal(doc.sources.length, max,
      `${doc.id}: il testo cita fino alla fonte ${max} ma l'elenco ne ha ${doc.sources.length}`);
    for (let n = 1; n <= doc.sources.length; n++) {
      assert.ok(doc.html.includes(`id="fonte-${n}"`), `${doc.id}: manca l'ancora della fonte ${n}`);
    }
  }
});

test('le fonti sono URL http(s) e URL uguali condividono lo stesso numero', () => {
  const { T } = loadModules();
  for (const doc of T.all()) {
    const seen = new Set();
    for (const s of doc.sources) {
      assert.match(s.url, /^https?:\/\//, `${doc.id}: fonte non http(s): ${s.url}`);
      assert.ok(!seen.has(s.url), `${doc.id}: ${s.url} compare due volte con numeri diversi`);
      seen.add(s.url);
      assert.ok(s.label.trim(), `${doc.id}: fonte senza etichetta (${s.url})`);
    }
  }
});

test('il corsivo è riservato alle glosse: i documenti non ne usano altro', () => {
  // L'affordance della glossa è il corsivo. Se il markdown usa il corsivo per
  // altro (titoli di paper, citazioni), il lettore passa il mouse e non succede
  // niente: l'affordance mente. Vedi transparency/glossary.json.
  const md = readFileSync(join(ROOT, 'transparency', 'models.md'), 'utf8')
    .replace(/^---[\s\S]*?^---$/m, '');   // via il front matter
  const italics = md.match(/(^|[^*])\*[^*\n][^\n]*?\*($|[^*])/g) || [];
  assert.equal(italics.length, 0,
    `il documento usa il corsivo per altro (${italics.length} occorrenze): ${italics.slice(0, 3).join(' / ')}`);
});

test('ogni voce del glossario è spiegata in una riga sola', () => {
  const { T } = loadModules();
  const entries = Object.entries(T.GLOSSARY);
  assert.ok(entries.length >= 5, 'glossario troppo scarno per essere utile');
  for (const [term, gloss] of entries) {
    assert.ok(!term.startsWith('_'), `la chiave interna "${term}" è finita nel glossario pubblico`);
    assert.ok(gloss.length > 20, `"${term}": glossa troppo corta per spiegare qualcosa`);
    assert.ok(gloss.length < 320, `"${term}": glossa troppo lunga per un riquadro al passaggio del mouse`);
    assert.ok(!/\n/.test(gloss), `"${term}": la glossa deve stare su una riga`);
  }
});

test('asText dà all\'agente il documento intero, e l\'indice se non sa quale chiedere', () => {
  const { T } = loadModules();
  const text = T.asText('models');
  assert.match(text, /Politica sui modelli/);
  assert.match(text, /Anthropic/);
  assert.match(text, /Fonti:/, 'l\'agente deve vedere anche da dove vengono le affermazioni');
  // Senza id (o con uno inventato) torna l'indice, non una stringa vuota: così
  // l'agente sceglie invece di rispondere a memoria.
  for (const q of ['', 'inesistente']) {
    const idx = T.asText(q);
    assert.match(idx, /models/, `asText(${JSON.stringify(q)}) deve elencare i documenti disponibili`);
  }
});

test('la pagina pubblica è autonoma: niente richieste a domini esterni per rendersi', () => {
  const p = join(ROOT, 'site', 'transparency', 'models.html');
  assert.ok(existsSync(p), 'la pagina pubblica non è stata generata');
  const html = readFileSync(p, 'utf8');
  assert.ok(!/<link[^>]+href="https?:/i.test(html), 'la pagina carica un foglio di stile esterno');
  assert.ok(!/<script[^>]+src=/i.test(html), 'la pagina carica uno script esterno');
  assert.match(html, /viewport/, 'manca il meta viewport: sul telefono sarebbe illeggibile');
  // Le fonti sono link veri e verificabili, non testo morto.
  assert.match(html, /rel="noopener noreferrer"/);
});

test('la navigazione elenca tutte e quattro le aree, anche quelle non ancora scritte', () => {
  const { T } = loadModules();
  const ids = T.NAV.map((n) => n.id);
  assert.deepEqual(ids, ['models', 'privacy', 'security', 'business']);
  // Nascondere le aree mancanti darebbe l'impressione che Filo non abbia niente
  // da dire su privacy o sicurezza: restano visibili e spente finché non ci sono.
  const html = readFileSync(join(ROOT, 'site', 'transparency', 'models.html'), 'utf8');
  for (const n of T.NAV) assert.ok(html.includes(n.label), `la navigazione non mostra "${n.label}"`);
  assert.match(html, /is-soon/, 'le aree non ancora scritte devono comparire spente');
});

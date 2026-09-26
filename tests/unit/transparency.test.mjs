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
import { readFileSync, existsSync, cpSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';
import { cartellaTemporanea } from '../helpers/percorsi.mjs';

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
    // Il testo per l'agente non deve portarsi dietro i fine riga di Windows né i
    // separatori del markdown: su una macchina con git in CRLF il generatore
    // produceva un testo diverso dalla stessa sorgente, e il controllo di
    // allineamento diventava rosso dopo un rebase senza che nessuno avesse
    // toccato il documento.
    assert.ok(!doc.text.includes('\r'), `${doc.id}: fine riga Windows nel testo per l'agente`);
    assert.ok(!/^---\s*$/m.test(doc.text), `${doc.id}: separatore markdown rimasto nel testo per l'agente`);
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

// #515 — La barra è l'unica strada per scoprire che un documento esiste senza
// che qualcuno ti passi l'indirizzo. Era un elenco di quattro nomi scritto a
// mano: un documento su un tema non previsto sarebbe esistito in chat, avrebbe
// avuto la sua pagina, e sfogliando non l'avrebbe trovato nessuno.
test('un documento scritto ha sempre la sua voce nella barra', () => {
  const { T } = loadModules();
  const voci = T.NAV.map((n) => n.id);
  for (const id of T.ids()) {
    assert.ok(voci.includes(id), `il documento "${id}" esiste ma non compare nella barra`);
  }
});

test('nessuna voce della barra è un vicolo cieco: anche le aree non scritte hanno la loro pagina', () => {
  const { T } = loadModules();
  for (const n of T.NAV) {
    const pagina = join(ROOT, 'site', 'transparency', `${n.id}.html`);
    assert.ok(existsSync(pagina), `"${n.label}" è nella barra ma sul sito non ha nessuna pagina: 404`);
  }
  const vuota = readFileSync(join(ROOT, 'site', 'transparency', 'privacy.html'), 'utf8');
  assert.match(vuota, /non è ancora scritta/, 'la pagina di un\'area non scritta non lo dice');
  assert.match(vuota, /models\.html/, 'la pagina di un\'area non scritta non porta a quello che c\'è');
});

test('la barra si deriva dai documenti: uno nuovo e non previsto ci finisce da sé', () => {
  // La prova gira il generatore su una COPIA, con un documento su un tema che
  // nessuno aveva annunciato: se la barra tornasse un elenco fisso, quel
  // documento sparirebbe dalla navigazione senza che niente lo dica.
  const tmp = cartellaTemporanea('filo-trasparenza-');
  mkdirSync(join(tmp, 'scripts'), { recursive: true });
  cpSync(join(ROOT, 'scripts', 'build-transparency.mjs'), join(tmp, 'scripts', 'build-transparency.mjs'));
  cpSync(join(ROOT, 'transparency'), join(tmp, 'transparency'), { recursive: true });
  mkdirSync(join(tmp, 'src', 'styles'), { recursive: true });
  cpSync(join(ROOT, 'src', 'styles', 'transparency.css'), join(tmp, 'src', 'styles', 'transparency.css'));
  writeFileSync(join(tmp, 'transparency', 'dati.md'), [
    '---', 'id: dati', 'title: I tuoi dati', 'nav: Dati',
    'subtitle: Dove finiscono i dati di chi usa Filo.', 'updated: 2026-09-22', 'order: 5', '---',
    '', 'Filo tiene i tuoi dati sul tuo computer.', '', '## Cosa esce da qui', '', 'Solo quello che chiedi tu.', '',
  ].join('\n'), 'utf8');

  execFileSync(process.execPath, [join(tmp, 'scripts', 'build-transparency.mjs')], { encoding: 'utf8' });

  const modulo = readFileSync(join(tmp, 'src', 'shared', 'transparency.js'), 'utf8');
  assert.match(modulo, /"label": "Dati"/, 'un documento nuovo non entra nella barra');
  const barra = readFileSync(join(tmp, 'site', 'transparency', 'models.html'), 'utf8')
    .split('<nav class="sn-nav">')[1].split('</nav>')[0];
  assert.ok(barra.includes('dati.html'), 'sul sito la barra non porta al documento nuovo');
  rmSync(tmp, { recursive: true, force: true });
});

// #515 — Terza copia dello stesso elenco: il manifesto che l'assistente
// consulta quando gli si chiede cosa sa fare. Scritto a mano, comincerebbe a
// mentire il giorno in cui una di quelle sezioni viene scritta.
test('il manifesto delle capacità dice in arrivo esattamente le aree che mancano', () => {
  const { T } = loadModules();
  delete globalThis.SN_CAPABILITIES;
  // eslint-disable-next-line no-new-func
  new Function(readFileSync(join(ROOT, 'src', 'shared', 'capabilities.js'), 'utf8')).call(globalThis);
  const voce = globalThis.SN_CAPABILITIES.all().find((c) => c.id === 'transparency-docs');
  assert.ok(voce, 'il manifesto non parla più dei documenti di trasparenza: aggiorna questo test');
  const frase = /([^.]*\bin arrivo\b[^.]*)\./.exec(voce.desc);
  const scritti = T.ids();
  const mancanti = T.NAV.filter((n) => !scritti.includes(n.id));
  if (!mancanti.length) {
    assert.equal(frase, null, 'tutte le aree sono scritte, ma il manifesto ne annuncia ancora di "in arrivo"');
    return;
  }
  assert.ok(frase, 'ci sono aree non ancora scritte e il manifesto non le dichiara');
  // Una parola sola per area, la più caratteristica dell'etichetta: basta a
  // beccare la divergenza senza imporre come è scritta la frase.
  for (const n of mancanti) {
    const parola = n.label.split(/\s+/).sort((a, b) => b.length - a.length)[0].toLowerCase();
    assert.ok(frase[1].toLowerCase().includes(parola),
      `il manifesto non dice che "${n.label}" è ancora da scrivere`);
  }
  for (const n of T.NAV.filter((v) => scritti.includes(v.id))) {
    const parola = n.label.split(/\s+/).sort((a, b) => b.length - a.length)[0].toLowerCase();
    assert.ok(!frase[1].toLowerCase().includes(parola),
      `il manifesto annuncia come "in arrivo" la sezione "${n.label}", che è scritta`);
  }
});

// #515 — La bugia non stava nella pagina (che le quattro aree le mostra, e
// spegne quelle non scritte) ma nel PROMPT: lo strumento LEGGI_TRASPARENZA
// dichiarava al modello quattro documenti quando ne esisteva uno. A «che fine
// fanno i miei dati?» l'agente chiedeva «privacy» e tornava a mani vuote.
// L'elenco adesso lo deriva da qui, e questi due test sorvegliano la derivazione
// nei due versi: niente di promesso in più, niente di scritto dimenticato.
function loadTools() {
  delete globalThis.SN_ACTION_TOOLS;
  const src = readFileSync(join(ROOT, 'src', 'shared', 'actionTools.js'), 'utf8');
  // eslint-disable-next-line no-new-func
  new Function(src).call(globalThis);
  return globalThis.SN_ACTION_TOOLS;
}

function toolTrasparenza() {
  const Tools = loadTools();
  const def = Tools.definitions({ sistema: 'win32' })
    .find((d) => d.function.name === 'LEGGI_TRASPARENZA');
  assert.ok(def, 'LEGGI_TRASPARENZA non è più uno strumento del modello');
  return def.function;
}

test('lo strumento della chat promette esattamente i documenti che esistono', () => {
  const { T } = loadModules();
  const fn = toolTrasparenza();
  const ids = T.ids();
  assert.ok(ids.length, 'nessun documento di trasparenza: il test non prova niente');
  assert.deepEqual(fn.parameters.properties.doc.enum, ids,
    'i valori ammessi dello strumento non sono i documenti che esistono');

  const promesso = `${fn.description} ${fn.parameters.properties.doc.description}`;
  for (const n of T.NAV) {
    const re = new RegExp(`(^|[^a-z0-9_-])${n.id}([^a-z0-9_-]|$)`, 'i');
    if (ids.includes(n.id)) {
      assert.match(promesso, re, `il documento "${n.id}" esiste ma il prompt non lo nomina`);
    } else {
      assert.doesNotMatch(promesso, re,
        `il prompt promette il documento "${n.id}", che nessuno ha scritto: l'agente lo chiederà e tornerà a mani vuote`);
    }
  }
});

test('un documento previsto ma non scritto: asText lo dice, e lo dice col suo nome', () => {
  const { T } = loadModules();
  const mancanti = T.NAV.map((n) => n.id).filter((id) => !T.ids().includes(id));
  for (const id of mancanti) {
    const risposta = T.asText(id);
    assert.match(risposta, new RegExp(id), `la risposta non nomina "${id}": l'agente non sa cosa è mancato`);
    assert.match(risposta, /NON esiste/, `"${id}": la risposta non dice che il documento non c'è`);
    assert.match(risposta, /memoria/, `"${id}": manca l'istruzione a non ricostruirlo a memoria`);
  }
  // L'indice (nessun id chiesto) resta un esito legittimo, non un errore.
  assert.doesNotMatch(T.asText(''), /NON esiste/);
});

test('i documenti citati per nome nel prompt di accoglienza esistono', () => {
  // Stessa classe di bug da un'altra porta: l'accoglienza dice all'agente di
  // leggere il documento "models" prima di rispondere. Un documento rinominato
  // lascerebbe l'istruzione a puntare nel vuoto, in silenzio.
  const { T } = loadModules();
  const src = readFileSync(join(ROOT, 'src', 'shared', 'onboarding.js'), 'utf8');
  const citati = [...src.matchAll(/LEGGI_TRASPARENZA\s+doc\s+"([^"]+)"/g)].map((m) => m[1]);
  assert.ok(citati.length, 'l\'accoglienza non cita più nessun documento: aggiorna questo test');
  for (const id of citati) {
    assert.ok(T.ids().includes(id), `l'accoglienza manda l'agente a leggere "${id}", che non esiste`);
  }
});

// Genera su una COPIA del repo, coi markdown in più che la prova vuole.
function generaCopia(extra) {
  const tmp = cartellaTemporanea('filo-trasparenza-');
  mkdirSync(join(tmp, 'scripts'), { recursive: true });
  cpSync(join(ROOT, 'scripts', 'build-transparency.mjs'), join(tmp, 'scripts', 'build-transparency.mjs'));
  cpSync(join(ROOT, 'transparency'), join(tmp, 'transparency'), { recursive: true });
  mkdirSync(join(tmp, 'src', 'styles'), { recursive: true });
  cpSync(join(ROOT, 'src', 'styles', 'transparency.css'), join(tmp, 'src', 'styles', 'transparency.css'));
  for (const [nome, righe] of Object.entries(extra)) {
    writeFileSync(join(tmp, 'transparency', nome), righe.join('\n'), 'utf8');
  }
  execFileSync(process.execPath, [join(tmp, 'scripts', 'build-transparency.mjs')], { encoding: 'utf8' });
  const leggi = (...p) => readFileSync(join(tmp, ...p), 'utf8');
  return { tmp, leggi };
}

// #515 — Un documento scritto in un'area annunciata decide lui nome corto e
// posto nella barra: l'area era solo il segnaposto.
test('un documento scritto in un\'area annunciata porta nella barra il suo nome e il suo posto', () => {
  const { tmp, leggi } = generaCopia({
    'privacy.md': [
      '---', 'id: privacy', 'title: Dove finiscono i tuoi dati', 'nav: I tuoi dati',
      'subtitle: Cosa esce dal tuo computer.', 'updated: 2026-09-26', 'order: 9', '---',
      '', 'Filo tiene i tuoi dati sul tuo computer.', '', '## Cosa esce da qui', '', 'Solo quello che chiedi tu.', '',
    ],
  });
  const modulo = leggi('src', 'shared', 'transparency.js');
  const nav = JSON.parse(/const NAV = (\[[\s\S]*?\]);/.exec(modulo)[1]);
  assert.deepEqual(nav.map((n) => n.label), ['Modelli', 'Sicurezza', 'Come si sostiene', 'I tuoi dati'],
    'la barra non usa il nome corto e l\'ordine che il documento si dà');
  const barra = leggi('site', 'transparency', 'models.html').split('<nav class="sn-nav">')[1].split('</nav>')[0];
  assert.ok(barra.includes('>I tuoi dati<'), 'sul sito la barra tiene il nome dell\'area invece di quello del documento');
  rmSync(tmp, { recursive: true, force: true });
});

// #515 — L'etichetta di una fonte veniva presa dal testo già escapato: sulla
// pagina si leggeva «&quot;», e il modello la citava così.
test('le fonti si leggono come testo, sulla pagina e per il modello', () => {
  const { T } = loadModules();
  const entita = /&(quot|amp|lt|gt|apos|nbsp|#\d+|#x[0-9a-f]+);/i;
  for (const d of T.all()) {
    assert.doesNotMatch(d.text, entita, `"${d.id}": il testo per il modello contiene entità HTML`);
    assert.doesNotMatch(d.html, /&amp;(quot|#39|lt|gt|amp);/, `"${d.id}": sulla pagina un'entità escapata due volte`);
  }
  // L'escape resta: un'etichetta con dentro del markup non diventa markup.
  const { tmp, leggi } = generaCopia({
    'zz-prova.md': [
      '---', 'id: zz-prova', 'title: Prova', 'order: 50', '---',
      '', 'Un [titolo "tra virgolette" con <b>markup</b> e l\'apostrofo](https://example.com/a?x=1&y=2).', '',
    ],
  });
  const html = leggi('site', 'transparency', 'zz-prova.html');
  const voce = html.split('id="fonte-1"')[1].split('</li>')[0];
  assert.ok(voce.includes('&quot;tra virgolette&quot; con &lt;b&gt;markup&lt;/b&gt; e l&#39;apostrofo'), `fonte resa male: ${voce}`);
  assert.ok(voce.includes('href="https://example.com/a?x=1&amp;y=2"'), `indirizzo della fonte reso male: ${voce}`);
  const testo = leggi('src', 'shared', 'transparency.js');
  assert.ok(testo.includes('[1] titolo \\"tra virgolette\\" con <b>markup</b> e l\'apostrofo — https://example.com/a?x=1&y=2'),
    'il testo per il modello non riporta la fonte com\'è scritta');
  rmSync(tmp, { recursive: true, force: true });
});

// #515 — Presentato col sottotitolo («le motivazioni etiche…»), il documento
// sui modelli sembrava non rispondere a «che fine fanno i miei dati?».
test('lo strumento dice al modello cosa c\'è dentro ogni documento, e di leggerlo prima di dire che non c\'è', () => {
  const { T } = loadModules();
  const fn = toolTrasparenza();
  for (const d of T.all()) {
    for (const s of d.sections) {
      assert.ok(fn.description.includes(s.title), `"${d.id}": lo strumento non nomina la sezione «${s.title}»`);
    }
    if (d.subtitle) {
      assert.ok(!fn.description.includes(d.subtitle), `"${d.id}": presentato con la frase scritta per la pagina`);
    }
  }
  assert.match(fn.description, /leggilo prima di rispondere/);
});

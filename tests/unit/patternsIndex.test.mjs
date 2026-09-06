// Sentinella: PATTERNS.md è un INDICE, i racconti stanno in patterns/<slug>.md
//
// Dal 2026-09-06 (#562) PATTERNS.md non contiene più i racconti: per ogni
// pattern tiene una riga sola — titolo, link al file, regola operativa — e il
// racconto intero vive in un file suo dentro `patterns/`. Chi lavora legge
// l'indice sempre e apre solo il racconto della regola che sta per toccare.
//
// Perché questi assert (CLAUDE.md § Verifica): l'indice e la cartella possono
// divergere in silenzio, e una divergenza silenziosa è peggio dell'assenza —
// un pattern senza riga nell'indice non lo legge più nessuno, una riga senza
// file manda chi la segue contro un link morto. Diventa rossa se:
// una riga punta a un file che non c'è; un file non è citato dall'indice; il
// titolo dell'indice e l'`# H1` del file divergono; una riga resta senza
// regola; l'indice ricomincia a ingrassare fino a tornare il file di prima.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const INDICE = join(ROOT, 'PATTERNS.md');
const CARTELLA = join(ROOT, 'patterns');

// Tetto largo: l'indice oggi sta sotto i 20 KB con 56 pattern, e una riga
// costa ~250 byte. 60 KB lascia spazio a oltre duecento pattern; se lo si
// supera davvero, il file è tornato a contenere i racconti.
const TETTO_INDICE = 60 * 1024;

const testo = readFileSync(INDICE, 'utf8');

// Una riga dell'indice: - **[Titolo](patterns/<slug>.md)** — regola
const RIGA = /^- \*\*\[(.+)\]\(patterns\/([a-z0-9-]+)\.md\)\*\*\s+—\s+(.*)$/;

const voci = testo
  .split('\n')
  .map((riga, i) => ({ riga, n: i + 1, m: riga.match(RIGA) }))
  .filter((v) => v.m)
  .map((v) => ({ n: v.n, titolo: v.m[1], slug: v.m[2], regola: v.m[3].trim() }));

const fileDellaCartella = readdirSync(CARTELLA)
  .filter((f) => f.endsWith('.md'))
  .map((f) => f.replace(/\.md$/, ''))
  .sort();

function titoloDelFile(slug) {
  const contenuto = readFileSync(join(CARTELLA, `${slug}.md`), 'utf8');
  const prima = contenuto.split('\n')[0];
  return prima.startsWith('# ') ? prima.slice(2).trim() : null;
}

describe('PATTERNS.md ↔ patterns/', () => {
  test('l\'indice ha almeno una voce e nessuna riga sfugge al formato', () => {
    assert.ok(voci.length > 0, 'PATTERNS.md non contiene nessuna voce riconoscibile');
    // Una riga che COMINCIA come una voce ma non combacia col formato è un
    // errore di scrittura che farebbe sparire il pattern dai controlli qui
    // sotto senza che nessuno se ne accorga.
    const sospette = testo
      .split('\n')
      .map((riga, i) => ({ riga, n: i + 1 }))
      .filter((v) => /^- \*\*\[/.test(v.riga) && !RIGA.test(v.riga));
    assert.deepEqual(
      sospette.map((v) => `riga ${v.n}: ${v.riga.slice(0, 80)}`),
      [],
      'righe che sembrano voci ma non rispettano il formato "- **[Titolo](patterns/<slug>.md)** — regola"'
    );
  });

  test('ogni voce dell\'indice ha il suo file', () => {
    const mancanti = voci.filter((v) => !fileDellaCartella.includes(v.slug));
    assert.deepEqual(
      mancanti.map((v) => `${v.slug} (riga ${v.n}: «${v.titolo}»)`),
      [],
      'voci dell\'indice senza file in patterns/'
    );
  });

  test('ogni file di patterns/ è citato dall\'indice', () => {
    const citati = new Set(voci.map((v) => v.slug));
    const orfani = fileDellaCartella.filter((slug) => !citati.has(slug));
    assert.deepEqual(orfani, [], 'file in patterns/ che nessuna riga di PATTERNS.md nomina');
  });

  test('nessun pattern citato due volte', () => {
    const visti = new Set();
    const doppi = [];
    for (const v of voci) {
      if (visti.has(v.slug)) doppi.push(v.slug);
      visti.add(v.slug);
    }
    assert.deepEqual(doppi, [], 'slug ripetuti nell\'indice');
  });

  test('il titolo dell\'indice e l\'H1 del file dicono la stessa cosa', () => {
    const divergenti = [];
    for (const v of voci) {
      if (!fileDellaCartella.includes(v.slug)) continue; // già segnalato sopra
      const h1 = titoloDelFile(v.slug);
      if (h1 !== v.titolo) divergenti.push(`${v.slug}: indice «${v.titolo}» ≠ file «${h1}»`);
    }
    assert.deepEqual(divergenti, [], 'titoli divergenti fra indice e file');
  });

  test('ogni voce porta una regola, non solo il titolo', () => {
    const senzaRegola = voci.filter((v) => v.regola.length < 15);
    assert.deepEqual(
      senzaRegola.map((v) => `${v.slug} (riga ${v.n})`),
      [],
      'voci dell\'indice senza la riga di regola operativa'
    );
  });

  test('ogni racconto ha del contenuto sotto il titolo', () => {
    const vuoti = fileDellaCartella.filter((slug) => {
      const contenuto = readFileSync(join(CARTELLA, `${slug}.md`), 'utf8');
      return contenuto.split('\n').slice(1).join('\n').trim().length === 0;
    });
    assert.deepEqual(vuoti, [], 'file in patterns/ con il solo titolo');
  });

  test('nessun rimando a un racconto che non esiste', () => {
    // Codice, spec e ruoli citano i pattern per percorso: un file rinominato
    // lascerebbe rimandi morti, e un rimando morto lo scopre solo chi lo segue.
    // La cartella dei racconti è dentro la battuta, non fuori: collegare il
    // racconto vicino è il modo naturale di legare due regole che si toccano,
    // e lì il rimando è relativo — `(<slug>.md)`, senza il prefisso — quindi va
    // cercato in tutte e due le forme o metà dei rimandi sfuggirebbe al
    // controllo proprio dove è più facile scriverne.
    const esistenti = new Set(fileDellaCartella);
    const salta = new Set(['node_modules', '.git', '.claude', 'dist', 'release']);
    const rimandi = [];
    const RIMANDO = /patterns\/([a-z0-9-]+)\.md/g;
    const RIMANDO_VICINO = /\]\(([a-z0-9-]+)\.md\)/g;
    const estensioni = ['.md', '.js', '.mjs', '.cjs', '.html', '.css', '.json', '.yml'];
    (function scendi(dir) {
      for (const voce of readdirSync(dir, { withFileTypes: true })) {
        if (voce.name.startsWith('.') || salta.has(voce.name)) continue;
        const percorso = join(dir, voce.name);
        if (voce.isDirectory()) { scendi(percorso); continue; }
        if (!estensioni.some((e) => voce.name.endsWith(e))) continue;
        const contenuto = readFileSync(percorso, 'utf8');
        const nome = percorso.slice(ROOT.length + 1);
        for (const m of contenuto.matchAll(RIMANDO)) {
          if (!esistenti.has(m[1])) rimandi.push(`${nome} → ${m[0]}`);
        }
        if (dir === CARTELLA) {
          for (const m of contenuto.matchAll(RIMANDO_VICINO)) {
            if (!esistenti.has(m[1])) rimandi.push(`${nome} → ${m[1]}.md (racconto vicino)`);
          }
        }
      }
    })(ROOT);
    assert.deepEqual(rimandi, [], 'rimandi a file di patterns/ che non esistono');
  });

  test('ogni racconto riporta all\'indice', () => {
    // Ai racconti si arriva anche di lato — da un commento nel codice, da una
    // ricerca — non solo dall'indice. Chi ci atterra così deve poter tornare
    // all'elenco delle altre regole senza sapere che esiste.
    const senzaRitorno = fileDellaCartella.filter((slug) => {
      const contenuto = readFileSync(join(CARTELLA, `${slug}.md`), 'utf8');
      return !contenuto.includes('](../PATTERNS.md)');
    });
    assert.deepEqual(senzaRitorno, [], 'racconti senza il rimando all\'indice');
  });

  test('i nomi dei file non tagliano una frase a metà', () => {
    // Il nome del file è quello che si legge nei commenti del codice e in
    // CLAUDE.md prima di aprirlo: è l'unica descrizione che arriva a chi passa
    // di lì. Tagliato a metà parola, o finito su «mai»/«non»/«che», si legge
    // come una regola rovesciata o monca.
    const APPESE = new Set(('e ed o od ma mai non che chi di da dal dallo dalla dai dagli dalle '
      + 'del dello della dei degli delle il lo la i gli le un uno una in con su per tra fra se si '
      + 'ci ne come quando dove al allo alla ai agli alle nel nello nella nei negli nelle sul '
      + 'sullo sulla sui sugli sulle a ad anche piu meno te ha va sta sono era').split(' '));
    const male = [];
    for (const slug of fileDellaCartella) {
      const ultima = slug.split('-').pop();
      if (APPESE.has(ultima)) male.push(`${slug} (finisce su «${ultima}»)`);
      else if (ultima.length < 2) male.push(`${slug} (finisce su una lettera sola)`);
    }
    assert.deepEqual(male, [], 'nomi di file che lasciano la frase appesa');
  });

  test('l\'indice resta un indice', () => {
    const byte = statSync(INDICE).size;
    assert.ok(
      byte <= TETTO_INDICE,
      `PATTERNS.md è ${Math.round(byte / 1024)} KB (tetto ${TETTO_INDICE / 1024} KB): ` +
        'se è cresciuto così, i racconti sono tornati dentro l\'indice — spostali in patterns/<slug>.md'
    );
    // I racconti stanno nei file: nell'indice non ci sono sezioni di secondo
    // livello (le uniche intestazioni sono il titolo del documento).
    const sezioni = testo.split('\n').filter((riga) => /^#{2,6} /.test(riga));
    assert.deepEqual(sezioni, [], 'PATTERNS.md contiene sezioni: i racconti vanno in patterns/<slug>.md');
  });
});

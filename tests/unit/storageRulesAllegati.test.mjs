// Sentinella sulle regole Storage degli ALLEGATI dei feedback (#582).
//
// Il caso che l'ha fatta nascere (audit pre-alpha). Su `feedback/{file=**}` la
// lettura era `allow read: if true` e la scrittura chiedeva solo dimensione e
// content-type. Tre conseguenze, tutte reali:
//   · in Storage `read` comprende `list`, quindi col solo nome del bucket (che
//     sta nel repo) si elencavano e si scaricavano TUTTI gli screrenshot dei
//     tester — lo schermo di casa loro — senza sapere niente di nessun feedback;
//   · `write` comprende `update` e `delete`, quindi chi conosceva il nome di un
//     allegato ci scriveva sopra o lo cancellava;
//   · un bucket aperto in lettura è hosting gratuito sul dominio dell'owner.
//
// Perché una sentinella e non solo il motore vero. Provare le regole davvero
// vuol dire emulatore Storage (Java, centinaia di MB, due servizi da avviare):
// quella prova esiste, sta in `tests/rules/storage-allegati-motore-vero.mjs` e
// si lancia a mano con le istruzioni che ha in testa. Qui il rischio non è che
// il motore sbagli, è che qualcuno riapra la porta scrivendo un'altra riga:
// questo test rilegge il file che si deploya e diventa rosso in millisecondi,
// sulla macchina di chi la riga l'ha scritta.
//
// Senza il fix è ROSSO tre volte: `allow read: if true`, `allow write` senza
// `resource == null`, nessun vincolo sul nome.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import '../../src/shared/feedbackAttachTypes.js';
import '../../src/shared/feedback.js';
import { mimeDiAllegato } from '../../scripts/claude-feedback.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');
// `STORAGE_RULES_FILE` serve a una cosa sola: puntare la sentinella alle regole
// di PRIMA (`git show main:storage.rules > /tmp/vecchie.rules`) e vederla
// diventare rossa. Un test che non si sa far fallire non prova niente.
const RULES = readFileSync(process.env.STORAGE_RULES_FILE || join(ROOT, 'storage.rules'), 'utf8');

const FB = globalThis.SN_FEEDBACK;
const ATTACH = globalThis.SN_FEEDBACK_ATTACH;

/** Il file senza commenti: una regola commentata non è una regola. */
const VIVO = RULES.replace(/\/\/[^\n]*/g, ' ');

/** Il corpo del blocco `match /feedback/{file} { … }`. */
function bloccoFeedback(testo) {
  const i = testo.indexOf('match /feedback/');
  assert.notEqual(i, -1, 'manca il blocco match /feedback/…');
  // Il corpo comincia dall'ULTIMA graffa della riga del match: le prime sono i
  // segnaposto del percorso (`{file}`), e contarle sarebbe un blocco vuoto.
  const fineRiga = testo.indexOf('\n', i);
  const apertura = testo.lastIndexOf('{', fineRiga);
  let liv = 0;
  for (let j = apertura; j < testo.length; j++) {
    if (testo[j] === '{') liv++;
    else if (testo[j] === '}') {
      liv--;
      if (liv === 0) return testo.slice(i, j + 1);
    }
  }
  throw new Error('blocco match /feedback/ non chiuso');
}

/**
 * Le funzioni dichiarate nelle regole, nome → corpo. Servono a leggere una
 * condizione per quello che FA: `allow get: if eAmministratore()` non dice
 * niente finché non si guarda dentro la funzione.
 */
function funzioni(testo) {
  const out = new Map();
  const re = /function\s+(\w+)\s*\(([^)]*)\)\s*\{\s*return\s+([\s\S]*?);\s*\n\s*\}/g;
  let m;
  while ((m = re.exec(testo)) !== null) out.set(m[1], m[3].replace(/\s+/g, ' ').trim());
  return out;
}

const FUNZIONI = funzioni(RULES.replace(/\/\/[^\n]*/g, ' '));

/** Una condizione con le chiamate alle funzioni delle regole sostituite dal corpo. */
function espandi(cond) {
  let out = cond;
  for (let giro = 0; giro < 3; giro++) {
    for (const [nome, corpo] of FUNZIONI) {
      out = out.split(`${nome}()`).join(`( ${corpo} )`).split(`${nome}(file)`).join(`( ${corpo} )`);
    }
  }
  return out;
}

/** Le `allow <verbi>: if <condizione>;` di un pezzo di regole. */
function permessi(corpo) {
  const out = [];
  const re = /allow\s+([a-z,\s]+?)\s*:\s*if\s+([\s\S]*?);/g;
  let m;
  while ((m = re.exec(corpo)) !== null) {
    out.push({
      verbi: m[1].split(',').map((v) => v.trim()).filter(Boolean),
      cond: m[2].replace(/\s+/g, ' ').trim(),
    });
  }
  return out;
}

const BLOCCO = bloccoFeedback(VIVO);
const PERMESSI = permessi(BLOCCO);

test('il parser vede davvero le regole (niente test che passa sul vuoto)', () => {
  assert.ok(PERMESSI.length >= 3, `lette solo ${PERMESSI.length} regole nel blocco feedback`);
  const verbi = PERMESSI.flatMap((p) => p.verbi);
  for (const atteso of ['get', 'create']) {
    assert.ok(verbi.includes(atteso), `nessuna regola per "${atteso}"`);
  }
});

test('la lettura degli allegati NON è pubblica: la concede solo l’amministratore', () => {
  const letture = PERMESSI.filter((p) => p.verbi.some((v) => ['read', 'get', 'list'].includes(v)));
  assert.ok(letture.length >= 1, 'nessuna regola di lettura: gli allegati sarebbero illeggibili anche all’owner');
  for (const l of letture) {
    const cond = espandi(l.cond);
    assert.doesNotMatch(cond, /^true$/, `lettura aperta a chiunque: allow ${l.verbi.join(',')}: if ${cond}`);
    // L'identità non si prova "essendo loggati" (la chiave web è pubblica e per
    // entrare basta un account Google qualunque): serve l'allowlist `admins`,
    // la stessa di firestore.rules.
    assert.match(cond, /firestore\.exists\(/, `lettura senza allowlist admins: if ${cond}`);
    assert.match(cond, /documents\/admins\//, `lettura non legata alla raccolta admins: if ${cond}`);
    assert.match(cond, /email_verified/, `lettura senza email verificata: if ${cond}`);
  }
});

test('elencare il bucket non si può: `list` non è concesso a nessuno', () => {
  const liste = PERMESSI.filter((p) => p.verbi.includes('list') || p.verbi.includes('read'));
  for (const l of liste) {
    assert.match(l.cond, /^false$/, `"${l.verbi.join(',')}" concede anche list: if ${l.cond}`);
  }
});

test('si può solo CREARE: niente sovrascrittura, niente cancellazione', () => {
  const create = PERMESSI.find((p) => p.verbi.includes('create'));
  assert.ok(create, 'manca allow create');
  // `resource == null` è ciò che distingue una creazione da una sovrascrittura,
  // ed è anche ciò che rende impossibile la delete (lì `resource` c'è).
  assert.match(create.cond, /resource\s*==\s*null/, 'create senza `resource == null`: sovrascriverebbe');

  for (const p of PERMESSI) {
    for (const v of ['write', 'update', 'delete']) {
      if (p.verbi.includes(v)) {
        assert.match(p.cond, /^false$/, `"${v}" concesso: if ${p.cond}`);
      }
    }
  }
});

test('la creazione resta possibile senza login (l’invio anonimo è voluto)', () => {
  const create = PERMESSI.find((p) => p.verbi.includes('create'));
  assert.doesNotMatch(
    espandi(create.cond),
    /request\.auth\s*!=\s*null/,
    'la creazione chiede un’identità: un tester anonimo non potrebbe più allegare uno screenshot',
  );
});

test('il tetto di dimensione lascia passare un allegato da 4 MB anche CIFRATO', () => {
  const create = PERMESSI.find((p) => p.verbi.includes('create'));
  assert.match(create.cond, /dimensioneAmmessa\(\)|request\.resource\.size/, 'create senza tetto di dimensione');
  const m = /function\s+dimensioneAmmessa\(\)\s*\{\s*return\s+([^;]+);/.exec(VIVO);
  assert.ok(m, 'manca la funzione dimensioneAmmessa()');
  // 4 MB è il tetto che l'app applica al file COM'È; la cifratura S1.2 lo
  // gonfia di un preambolo. Senza margine, un allegato legittimo da 4 MB tondi
  // passava il controllo dell'app e veniva respinto qui.
  const limite = Function(`"use strict"; const request={resource:{size:0}}; return (${m[1].replace(/request\.resource\.size\s*<=?\s*/, '')});`)();
  assert.ok(limite > 4 * 1024 * 1024, `tetto ${limite}: non c’è margine per la cifratura di un allegato da 4 MB`);
});

test('i content-type ammessi sono solo quelli passivi, allineati al gate del client', () => {
  const m = /function\s+tipoPassivo\(\)\s*\{([\s\S]*?)\n\s*\}/.exec(VIVO);
  assert.ok(m, 'manca la funzione tipoPassivo()');
  const corpo = m[1];

  // Niente wildcard larghe: `text/.*` farebbe passare text/html, `image/.*`
  // farebbe passare image/svg+xml. Sono documenti ATTIVI nel dominio di Google
  // Storage, cioè eseguibili quando chi fa triage apre il link.
  assert.doesNotMatch(corpo, /matches\('text\/[.*]/, 'wildcard su text/*: passerebbe text/html');
  assert.doesNotMatch(corpo, /matches\('image\/[.*]/, 'wildcard su image/*: passerebbe image/svg+xml');
  for (const vietato of ['text/html', 'image/svg', 'application/xhtml', 'text/xml', 'application/javascript']) {
    assert.ok(!corpo.includes(vietato), `tipo attivo ammesso dalle regole: ${vietato}`);
  }

  // Simmetria col gate del client (src/shared/feedbackAttachTypes.js): quello
  // che l'app lascia allegare deve poter arrivare nel bucket, altrimenti
  // l'utente vede "caricamento non riuscito" senza capire perché.
  for (const tipo of [...ATTACH.DOC_MIME]) {
    assert.ok(corpo.includes(`'${tipo}'`), `il client accetta ${tipo} ma le regole no`);
  }
  for (const tipo of [...ATTACH.RASTER_IMAGE_MIME]) {
    const sotto = tipo.split('/')[1];
    assert.match(corpo, new RegExp(`image/\\([^)]*\\b${sotto}\\b`), `il client accetta ${tipo} ma le regole no`);
  }

  // Stessa simmetria con l'altro mittente: `npm run feedback:apri` dichiara il
  // tipo dall'estensione, e diceva di usare «la stessa allowlist delle
  // storage.rules». Non era vero: `.tsv` e `.yaml` partivano e venivano
  // respinti dal bucket, con l'allegato perso e il feedback aperto lo stesso.
  for (const nomeFile of ['a.txt', 'a.log', 'a.md', 'a.markdown', 'a.json', 'a.csv', 'a.tsv', 'a.yaml', 'a.yml', 'a.pdf']) {
    const tipo = mimeDiAllegato(nomeFile);
    assert.ok(tipo, `${nomeFile}: lo script non gli dà un tipo`);
    assert.ok(corpo.includes(`'${tipo}'`), `feedback:apri manda ${nomeFile} come ${tipo}, ma le regole lo rifiutano`);
  }
  for (const nomeImmagine of ['a.png', 'a.jpg', 'a.jpeg', 'a.gif', 'a.webp', 'a.bmp']) {
    const sotto = mimeDiAllegato(nomeImmagine).split('/')[1];
    assert.match(corpo, new RegExp(`image/\\([^)]*\\b${sotto}\\b`), `feedback:apri manda ${nomeImmagine} come image/${sotto}, ma le regole lo rifiutano`);
  }
});

// ── Il nome dell'allegato: le regole e l'app devono dire la stessa cosa ──────

/** L'espressione del nome, così com'è scritta nelle regole, come RegExp JS. */
function regexDelNome() {
  const m = /file\.matches\('([^']+)'\)/.exec(VIVO);
  assert.ok(m, 'nessun vincolo sul nome del file nelle regole');
  // Nel linguaggio delle regole `\\.` è un backslash sfuggito: il motore RE2
  // vede `\.`.
  return new RegExp(m[1].replace(/\\\\/g, '\\'));
}

test('il nome che genera l’app è accettato dalle regole (ora e con l’etichetta)', () => {
  const re = regexDelNome();
  for (let i = 0; i < 200; i++) {
    const percorso = FB.attachmentPath(i % 2 ? 'image/png' : 'application/octet-stream');
    const file = percorso.replace(/^feedback\//, '');
    assert.ok(re.test(file), `le regole rifiuterebbero un nome generato dall’app: ${file}`);
  }
  // Con etichetta: è la forma dei ritrovamenti dell'agente esploratore
  // (tests/agent/feedback.mjs → `agent_<ms>_<uuid>.png`).
  for (const et of ['agent', 'routine']) {
    const file = FB.attachmentPath('image/jpeg', et).replace(/^feedback\//, '');
    assert.ok(re.test(file), `le regole rifiuterebbero l’allegato etichettato ${et}: ${file}`);
    assert.ok(file.startsWith(`${et}_`), `etichetta persa: ${file}`);
  }
});

test('un nome indovinabile NON passa (è quello che rende il percorso un segreto)', () => {
  const re = regexDelNome();
  const indovinabili = [
    'screenshot.png',
    'schermata.png',
    '1.png',
    '1788891497000.png',            // solo il timestamp: si indovina a tentativi
    '1788891497000_abc.png',        // troppo poca entropia
    'index.html',
    '../fuori.png',
    'sotto/cartella.png',
    'feedback.png',
    `${Date.now()}_00000000-0000-0000-0000-00000000000.png`, // un carattere in meno
  ];
  for (const file of indovinabili) {
    assert.ok(!re.test(file), `le regole accetterebbero un nome indovinabile: ${file}`);
  }
});

test('l’uuid del nome viene dal generatore crittografico, non da Math.random', () => {
  const sorgente = readFileSync(join(ROOT, 'src', 'shared', 'feedback.js'), 'utf8');
  const i = sorgente.indexOf('function uuid(');
  assert.notEqual(i, -1, 'uuid() non trovata');
  const corpo = sorgente.slice(i, i + 900);
  assert.match(corpo, /randomUUID/, 'uuid() non usa crypto.randomUUID');
  assert.match(corpo, /getRandomValues/, 'senza randomUUID si cadrebbe subito su Math.random');
  // Due nomi di fila non si somigliano: se il generatore fosse un contatore o
  // un timestamp, il percorso non sarebbe più un segreto.
  const a = FB.attachmentPath('image/png');
  const b = FB.attachmentPath('image/png');
  assert.notEqual(a, b, 'due allegati consecutivi con lo stesso nome');
});

// ── La strada autenticata con cui l'owner legge gli allegati ────────────────

test('l’owner scarica un allegato firmando la richiesta; il token non esce altrove', () => {
  const dentro = 'https://firebasestorage.googleapis.com/v0/b/filo-8b9cb.firebasestorage.app/o/feedback%2Fx.png?alt=media';
  assert.deepEqual(FB.attachmentFetchHeaders(dentro, 'ID-TOKEN'), { Authorization: 'Bearer ID-TOKEN' });
  // Senza sessione non si inventa un'intestazione: resta il token dell'URL.
  assert.deepEqual(FB.attachmentFetchHeaders(dentro, ''), {});
  // Fuori dal bucket il token dell'owner non parte MAI: questo canale è il
  // vecchio guard anti-SSRF, e un Bearer spedito a un host qualunque sarebbe
  // una credenziale regalata.
  for (const fuori of [
    'https://esempio.invalid/feedback/x.png',
    'http://firebasestorage.googleapis.com/x',                 // non https
    'https://firebasestorage.googleapis.com.evil.invalid/x',   // host che finge
    'file:///etc/passwd',
    '',
  ]) {
    assert.deepEqual(FB.attachmentFetchHeaders(fuori, 'ID-TOKEN'), {}, `token spedito a ${fuori}`);
    assert.equal(FB.isAttachmentUrl(fuori), false, `riconosciuto come allegato: ${fuori}`);
  }
  assert.equal(FB.isAttachmentUrl(dentro), true);
});

test('tutto ciò che non è feedback/<file> resta chiuso', () => {
  const i = VIVO.indexOf('match /{path=**}');
  assert.notEqual(i, -1, 'manca il blocco che chiude tutto il resto');
  for (const p of permessi(VIVO.slice(i))) {
    assert.match(p.cond, /^false$/, `il catch-all concede ${p.verbi.join(',')}: if ${p.cond}`);
  }
  // E il blocco degli allegati vale per UN segmento solo: `{file=**}` farebbe
  // rientrare le sottocartelle dalla porta di servizio.
  assert.ok(!/match \/feedback\/\{file=\*\*\}/.test(VIVO), 'il blocco feedback usa ancora il wildcard ricorsivo');
});

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
// Perché una sentinella. L'emulatore Storage (Java, centinaia di MB) sta in
// `tests/rules/storage-allegati-motore-vero.mjs` e si lancia a mano, ma NON è il
// deposito vero: non vede i campi che il deposito scrive da sé, ed è stato verde
// su regole che negavano ogni caricamento (#1769). La prova che conta è un
// caricamento vero dopo la pubblicazione. Qui il rischio è che qualcuno riapra la
// porta, o rilegga un campo che il deposito riempie, scrivendo un'altra riga.
//
// Senza il fix è ROSSO tre volte: `allow read: if true`, `allow write` senza
// `resource == null`, nessun vincolo sul nome. Senza #1518 è rosso sul tipo
// (una lista di tipi in chiaro), sull'estensione libera e sui metadati.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';

import '../../src/shared/feedbackPublicKey.js';
import '../../src/shared/feedbackCrypto.js';
import '../../src/shared/feedback.js';
import { PUNTI_DI_CARICAMENTO } from '../helpers/puntiDiCaricamento.mjs';
import { cartellaTemporanea } from '../helpers/percorsi.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');
// `STORAGE_RULES_FILE` serve a una cosa sola: puntare la sentinella alle regole
// di PRIMA (`git show main:storage.rules > /tmp/vecchie.rules`) e vederla
// diventare rossa. Un test che non si sa far fallire non prova niente.
const RULES = readFileSync(process.env.STORAGE_RULES_FILE || join(ROOT, 'storage.rules'), 'utf8');

const FB = globalThis.SN_FEEDBACK;

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
 * condizione per quello che FA: `allow create: if … nomeConEntropia(file)` non
 * dice niente finché non si guarda dentro la funzione.
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
      out = out.replace(new RegExp(`\\b${nome}\\([^()]*\\)`, 'g'), () => `( ${corpo} )`);
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

test('da queste regole non scarica NESSUNO, owner compreso', () => {
  // La lettura si è chiusa in due tempi, e il secondo è quello che conta.
  // Prima (#582) era riservata a chi è nell'allowlist `admins`: bastava a
  // togliere gli screenshot dei tester dalle mani del mondo. Poi (#583) è stata
  // negata del tutto, ed è quello che rende di nuovo utile RUOTARE il token di
  // un file finito in giro: finché un `get` esisteva, un indirizzo raccolto
  // quando i documenti erano pubblici restava buono per sempre, e cambiare il
  // token non serviva a niente perché il file si prendeva lo stesso.
  //
  // L'unica chiave è ora il download token dentro il link, che Firebase valuta
  // PRIMA delle regole: la dashboard (che scarica il link intero dal main e
  // decifra) e il server dei giudici (Admin SDK) continuano a vedere gli
  // allegati, un indirizzo senza token no.
  const letture = PERMESSI.filter((p) => p.verbi.some((v) => ['read', 'get', 'list'].includes(v)));
  assert.ok(letture.length >= 1, 'nessuna regola di lettura dichiarata: un confine si scrive, non si lascia al default');
  for (const l of letture) {
    const cond = espandi(l.cond);
    assert.match(
      cond,
      /^false$/,
      `allow ${l.verbi.join(',')}: if ${cond} — una lettura concessa qui rimette in circolazione gli indirizzi raccolti quando i documenti erano pubblici`,
    );
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

// ── Nel deposito entra solo il blob cifrato dall'app (#1518) ────────────────

const CREATE = () => PERMESSI.find((p) => p.verbi.includes('create'));

test('il deposito ammette un tipo solo: quello dei blob cifrati, lo stesso dell’app', () => {
  // Con la lista dei tipi «passivi» chiunque, senza mandare un feedback, ci
  // caricava byte qualunque come octet-stream o un testo in chiaro, e si
  // portava via un link che non scade. Da #602 ogni caricatore cifra: nel
  // deposito arrivano solo blob opachi, e il tipo vero sta nel documento.
  const cond = espandi(CREATE().cond);
  const confronti = [...cond.matchAll(/\.contentType\b(?:\s*(==)\s*'([^']*)')?/g)];
  assert.equal(confronti.length, 1, `il tipo deve avere un confronto solo: ${cond}`);
  assert.equal(confronti[0][1], '==', 'il tipo si confronta per uguaglianza, non con un’espressione');
  assert.equal(confronti[0][2], FB.ATTACHMENT_CONTENT_TYPE, 'le regole e l’app non dicono lo stesso tipo');
  assert.equal(FB.ATTACHMENT_CONTENT_TYPE, 'application/octet-stream');
  assert.ok(!/contentType[^&]*\|\|/.test(cond), `un’alternativa sul tipo riapre la lista: ${cond}`);
});

test('in creazione nessuna chiave né nome di scarico scelti da chi carica', () => {
  // Il nome con cui il file si scarica (Content-Disposition) e le chiavi personalizzate li sceglierebbe
  // uno sconosciuto: `fattura.exe` su un dominio di Google, o un segno «già sistemato» che la pulizia
  // degli allegati legge.
  const cond = espandi(CREATE().cond);
  // Una chiave sola può esserci: il codice di scarico, che il deposito vero scrive nei metadati prima
  // di valutare le regole. Con `metadata.size() == 0` nessun allegato saliva più (#1666).
  assert.match(cond, /\bmetadata\.keys\(\)\.hasOnly\(\['firebaseStorageDownloadTokens'\]\)/,
    'le chiavi personalizzate passano, o il codice di scarico che scrive Firebase viene rifiutato');
  assert.ok(!/\bmetadata\.size\(\)/.test(cond), 'il conteggio delle chiavi rifiuta anche il codice di scarico di Firebase');
  // Il Content-Disposition ammette solo le forme che scrive Firebase, col nome dell'oggetto: una forma
  // in più, o un `matches`, rimette il nome di scarico nelle mani di chi carica.
  const ammessi = ["''", "'inline'", `"inline; filename*=utf-8''" + file`];
  const usi = [...cond.matchAll(/\.contentDisposition\b(?:\s*==\s*null\b|\s+in\s+\[([^\]]*)\])?/g)];
  assert.ok(usi.some((u) => u[1] !== undefined), `il Content-Disposition non ha la sua lista di forme: ${cond}`);
  for (const u of usi) {
    assert.ok(u[0] !== '.contentDisposition', `uso del Content-Disposition non ammesso: ${cond}`);
    if (u[1] === undefined) continue;
    const forme = u[1].split(',').map((f) => f.trim());
    assert.deepEqual([...forme].sort(), [...ammessi].sort(), `forme del Content-Disposition diverse da quelle di Firebase: [${u[1]}]`);
  }
});

test('codifica, cache e lingua non si leggono: il deposito vero le riempie da sé', () => {
  // #1769: ogni regola su questi campi, verde a emulatore e API di prova, ha negato ogni caricamento vero
  // dal 23/10 al 29/10. Il loro valore al deposito da qui non si vede; sceglierli su un blob opaco servito
  // solo col codice di scarico non cambia tipo né nome di scarico (rischio accettato, scritto in storage.rules).
  for (const campo of ['contentEncoding', 'cacheControl', 'contentLanguage']) {
    assert.ok(!new RegExp(`\\b${campo}\\b`).test(VIVO), `le regole leggono di nuovo ${campo}: al deposito vero può negare ogni allegato`);
  }
});

/** `a && (b) && (c)` → i pezzi fra gli `&&` fuori da ogni parentesi. */
function congiunti(espr) {
  const out = [];
  let liv = 0;
  let da = 0;
  for (let i = 0; i < espr.length; i++) {
    const c = espr[i];
    if (c === '(' || c === '[') liv++;
    else if (c === ')' || c === ']') liv--;
    else if (liv === 0 && espr.startsWith('&&', i)) { out.push(espr.slice(da, i).trim()); da = i + 2; i++; }
  }
  out.push(espr.slice(da).trim());
  return out;
}

test('ogni campo dei metadati si legge solo dopo il suo `in`, e i campi letti sono solo chiavi e nome di scarico', () => {
  // La guardia tiene vera la clausola sia col campo assente (all'emulatore, che metadati e nome di scarico non li
  // scrive: letto nudo è un errore, e l'errore nega) sia col campo presente al deposito vero: là, se `in` andasse
  // in errore, `||` lo assorbe; il primo passo di un caricamento ripristinabile, che queste guardie le aveva, passava.
  const m = /function\s+senzaMetadatiScelti\s*\(\s*(\w+)\s*,[^)]*\)\s*\{\s*return\s+([\s\S]*?);\s*\n\s*\}/.exec(VIVO);
  assert.ok(m, 'manca la funzione senzaMetadatiScelti(r, file)');
  const r = m[1];
  const corpo = m[2].replace(/\s+/g, ' ').trim();
  const lette = new Set();
  for (const pezzo of congiunti(corpo)) {
    const dentro = pezzo.replace(/^\(\s*/, '').replace(/\s*\)$/, '');
    const campi = [...new Set([...dentro.matchAll(new RegExp(`\\b${r}\\.(\\w+)`, 'g'))].map((x) => x[1]))];
    for (const campo of campi) {
      lette.add(campo);
      const guardia = new RegExp(`^(?:!\\(\\s*'\\w+'\\s+in\\s+${r}\\s*\\)\\s*\\|\\|\\s*)*!\\(\\s*'${campo}'\\s+in\\s+${r}\\s*\\)\\s*\\|\\|`);
      assert.match(dentro, guardia, `${r}.${campo} si legge senza aprire con !('${campo}' in ${r}) ||: ${pezzo}`);
    }
  }
  for (const atteso of ['metadata', 'contentDisposition', 'contentEncoding', 'cacheControl', 'contentLanguage']) {
    assert.ok(lette.has(atteso), `senzaMetadatiScelti non guarda più ${atteso}`);
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
    const file = FB.attachmentPath().replace(/^feedback\//, '');
    assert.ok(re.test(file), `le regole rifiuterebbero un nome generato dall’app: ${file}`);
  }
  // Con etichetta: è la forma dei ritrovamenti dell'agente esploratore
  // (tests/agent/feedback.mjs → `agent_<ms>_<uuid>.octetstream`).
  for (const et of ['agent', 'routine']) {
    const file = FB.attachmentPath(et).replace(/^feedback\//, '');
    assert.ok(re.test(file), `le regole rifiuterebbero l’allegato etichettato ${et}: ${file}`);
    assert.ok(file.startsWith(`${et}_`), `etichetta persa: ${file}`);
  }
});

test('l’estensione è fissa: quella dell’app, nessun’altra', () => {
  const re = regexDelNome();
  assert.ok(re.source.endsWith(`\\.${FB.ATTACHMENT_EXT}$`), `le regole non fissano l’estensione dell’app: ${re.source}`);
  const base = `${Date.now()}_${randomUUID()}`;
  for (const ext of ['png', 'txt', 'exe', 'html', 'bin', 'OCTETSTREAM', 'octetstreamx', 'octetstream.exe']) {
    assert.ok(!re.test(`${base}.${ext}`), `le regole accetterebbero l’estensione .${ext}`);
  }
});

test('un nome indovinabile NON passa (è quello che rende il percorso un segreto)', () => {
  const re = regexDelNome();
  const indovinabili = [
    'screenshot.octetstream',
    'schermata.png',
    '1.octetstream',
    '1788891497000.octetstream',            // solo il timestamp: si indovina a tentativi
    '1788891497000_abc.octetstream',        // troppo poca entropia
    'index.html',
    '../fuori.octetstream',
    'sotto/cartella.octetstream',
    `${Date.now()}_00000000-0000-0000-0000-00000000000.octetstream`, // un carattere in meno
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
  assert.notEqual(FB.attachmentPath(), FB.attachmentPath(), 'due allegati consecutivi con lo stesso nome');
});

// ── Ogni punto che carica produce quel tipo e quel nome ─────────────────────

/** Il deposito e Firestore finti: registrano ogni caricamento (nome e tipo) e rispondono come Firebase. */
function depositoFinto() {
  const caricati = [];
  const prima = globalThis.fetch;
  globalThis.fetch = async (url, opts = {}) => {
    const u = String(url);
    if (u.includes('uploadType=media')) {
      const h = opts.headers || {};
      caricati.push({
        nome: decodeURIComponent((/[?&]name=([^&]+)/.exec(u) || [])[1] || ''),
        tipo: String(h['Content-Type'] || h['content-type'] || ''),
      });
      return new Response(JSON.stringify({ downloadTokens: randomUUID() }), { status: 200 });
    }
    if (u.includes('/counters/')) {
      if (opts.method === 'PATCH') return new Response('{}', { status: 200 });
      return new Response(JSON.stringify({ fields: { value: { integerValue: '5' } }, updateTime: '2026-10-01T00:00:00Z' }), { status: 200 });
    }
    return new Response(JSON.stringify({ name: 'projects/p/databases/(default)/documents/feedback/DOC' }), { status: 200 });
  };
  return { caricati, ripristina: () => { globalThis.fetch = prima; } };
}

const PNG_DATA_URL = 'data:image/png;base64,' + Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]).toString('base64');

// Per ogni file dell'elenco, le strade con cui carica davvero.
const CARICATORI = {
  'src/shared/feedback.js': async () => {
    // L'invio di un feedback (immagine e documento), l'allegato di un commento,
    // e un ciphertext che si presenta con un tipo d'immagine.
    await FB.submit({
      text: 'con allegati',
      images: [{ dataUrl: PNG_DATA_URL }],
      files: [{ name: 'note.txt', type: 'text/plain', dataUrl: 'data:text/plain;base64,' + Buffer.from('ciao').toString('base64') }],
    });
    await FB.uploadAttachment(new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' }), 'schermata.png');
    const sigillato = await FB.sealForUpload(new Blob([new Uint8Array([4, 5, 6])], { type: 'text/plain' }));
    await FB.uploadImage(new Blob([await sigillato.arrayBuffer()], { type: 'image/png' }));
    return 4;
  },
  'tests/agent/feedback.mjs': async () => {
    const { pushIssue } = await import('../agent/feedback.mjs');
    const schermata = join(cartellaTemporanea('punti-caricamento-'), 'schermata.png');
    writeFileSync(schermata, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    await pushIssue({
      model: 'prova', severity: 'low', area: 'prova', title: 'prova', detail: 'prova',
      foundAt: 'filo://dashboard', screenshotPath: schermata, idToken: 'tok-admin',
    });
    return 1;
  },
};

test('ogni punto che carica nel deposito produce il tipo e il nome che le regole ammettono', async () => {
  const re = regexDelNome();
  const tipo = /\.contentType\s*==\s*'([^']+)'/.exec(espandi(CREATE().cond))[1];
  for (const punto of PUNTI_DI_CARICAMENTO) {
    const carica = CARICATORI[punto];
    assert.ok(carica, `${punto} carica nel deposito e questa prova non sa farlo caricare: aggiungilo a CARICATORI`);
    const deposito = depositoFinto();
    let attesi;
    try { attesi = await carica(); } finally { deposito.ripristina(); }
    assert.equal(deposito.caricati.length, attesi, `${punto}: caricamenti visti ${deposito.caricati.length}, attesi ${attesi}`);
    for (const c of deposito.caricati) {
      assert.equal(c.tipo, tipo, `${punto} carica col tipo ${c.tipo}, le regole vogliono ${tipo}`);
      assert.ok(c.nome.startsWith('feedback/'), `${punto} carica fuori da feedback/: ${c.nome}`);
      assert.ok(re.test(c.nome.slice('feedback/'.length)), `${punto} carica un nome che le regole rifiutano: ${c.nome}`);
    }
  }
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

test('il token dell’owner non esce verso un bucket che non è quello di Filo', () => {
  // Il caso che l'ha fatta nascere (verifica #582, giro 1). Fermarsi all'HOST
  // non basta: l'URL dell'allegato non lo sceglie l'owner, sta dentro il
  // documento del feedback, e un feedback lo crea CHIUNQUE senza login (le
  // firestore.rules validano `images` solo come lista di al più 5 elementi, non
  // il contenuto). Bastava indicare un bucket qualunque ospitato da Google e la
  // dashboard, aprendo quel feedback, ci portava l'id token dell'owner — la
  // credenziale che vale su tutto il progetto per un'ora.
  const estranei = [
    'https://firebasestorage.googleapis.com/v0/b/bucket-di-un-estraneo.appspot.com/o/x.png?alt=media',
    'https://firebasestorage.googleapis.com/v0/b/filo-8b9cb.firebasestorage.app.di-un-estraneo.app/o/x.png',
    'https://storage.googleapis.com/bucket-di-un-estraneo/x.png',
    'https://storage.googleapis.com/filo-8b9cb.firebasestorage.app-di-un-estraneo/x.png',
    // Le forme su cui una regex si fa fregare e `new URL` no.
    'https://firebasestorage.googleapis.com@esempio.invalid/v0/b/filo-8b9cb.firebasestorage.app/o/x.png',
  ];
  for (const url of estranei) {
    assert.equal(FB.isAttachmentUrl(url), false, `riconosciuto come allegato di Filo: ${url}`);
    assert.deepEqual(FB.attachmentFetchHeaders(url, 'ID-TOKEN'), {}, `token spedito a ${url}`);
  }
  // E il bucket vero resta riconosciuto nelle due forme in cui può arrivare.
  for (const url of [
    'https://firebasestorage.googleapis.com/v0/b/filo-8b9cb.firebasestorage.app/o/feedback%2Fx.png?alt=media&token=abc',
    'https://storage.googleapis.com/filo-8b9cb.firebasestorage.app/feedback/x.png',
    // L'host è case-insensitive: non è un bucket diverso.
    'https://FirebaseStorage.googleapis.com/v0/b/filo-8b9cb.firebasestorage.app/o/feedback%2Fx.png',
  ]) {
    assert.equal(FB.isAttachmentUrl(url), true, `allegato vero non riconosciuto: ${url}`);
  }
});

test('la domanda sul deposito RISPONDE anche ai nomi di dominio di serie', () => {
  // Verifica #582, giro 7. La tabella degli inizi ammessi è indicizzata per
  // nome di dominio, e il nome di dominio lo sceglie chi manda la segnalazione.
  // In una tabella normale alcuni nomi ci sono già senza che nessuno ce li
  // metta (`__proto__` torna il prototipo, `constructor` torna una funzione):
  // il codice li trattava come un elenco di inizi e ESPLODEVA, invece di
  // rispondere «no». Cadeva dal lato chiuso, quindi non era una porta aperta;
  // ma questa domanda decide se firmare col gettone di chi riceve le
  // segnalazioni, e una domanda di sicurezza deve rispondere.
  for (const nome of ['__proto__', 'constructor', 'toString', 'valueOf', 'hasOwnProperty']) {
    const url = `https://${nome}/v0/b/filo-8b9cb.firebasestorage.app/o/x.png?alt=media`;
    assert.equal(FB.isAttachmentUrl(url), false, `riconosciuto come allegato di Filo: ${url}`);
    assert.deepEqual(FB.attachmentFetchHeaders(url, 'ID-TOKEN'), {}, `token spedito a ${url}`);
  }
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

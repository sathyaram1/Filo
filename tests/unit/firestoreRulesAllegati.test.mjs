// Sentinella sugli indirizzi degli allegati nelle regole Firestore (#597): in `images` e `files[].url` entrano
// solo indirizzi del nostro deposito, nella forma che producono i caricatori di Filo. Il motore vero sta in
// feedbackAllegati.motore-vero.mjs; il server rifà il controllo (filo-security, storageUrl.js).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';

import '../../src/shared/feedback.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const RULES = readFileSync(process.env.FIRESTORE_RULES_FILE || join(ROOT, 'firestore.rules'), 'utf8');
const FB = globalThis.SN_FEEDBACK;

function regexDellIndirizzo() {
  const m = /function indirizzoAllegato\(u\)[\s\S]*?u\.matches\('([^']+)'\)/.exec(RULES);
  assert.ok(m, 'nessun vincolo sull\'indirizzo degli allegati nelle regole');
  return new RegExp(m[1].replace(/\\\\/g, '\\'));
}

// L'indirizzo come lo costruisce davvero l'app: uploadImage col deposito finto e la cifratura data per fatta.
async function indirizzoDellApp(tipo) {
  const prima = { fetch: globalThis.fetch, crypto: globalThis.SN_FEEDBACK_CRYPTO };
  globalThis.SN_FEEDBACK_CRYPTO = { isEncryptedBytes: () => true };
  globalThis.fetch = async () => new Response(JSON.stringify({ downloadTokens: randomUUID() }), { status: 200 });
  try {
    return (await FB.uploadImage(new Blob([new Uint8Array(200)], { type: tipo }))).url;
  } finally {
    globalThis.fetch = prima.fetch;
    globalThis.SN_FEEDBACK_CRYPTO = prima.crypto;
  }
}

test('l\'indirizzo che produce l\'app è accettato dalle regole', async () => {
  const re = regexDellIndirizzo();
  for (const tipo of ['application/octet-stream', 'image/png', 'image/jpeg', 'text/markdown', 'application/json']) {
    const u = await indirizzoDellApp(tipo);
    assert.ok(re.test(u), `le regole rifiuterebbero un allegato caricato dall'app: ${u}`);
  }
  // L'esploratore (tests/agent/feedback.mjs): etichetta agent_ davanti al nome.
  const nome = FB.attachmentPath('agent');
  const u = `https://firebasestorage.googleapis.com/v0/b/filo-8b9cb.firebasestorage.app/o/${encodeURIComponent(nome)}?alt=media&token=${randomUUID()}`;
  assert.ok(re.test(u), u);
});

test('un indirizzo che non è un nostro caricamento è rifiutato', async () => {
  const re = regexDellIndirizzo();
  const buono = await indirizzoDellApp('image/png');
  const estranei = [
    'https://evil.example/x.png',
    'http://169.254.169.254/computeMetadata/v1/',
    buono.replace('firebasestorage.googleapis.com', 'firebasestorage.googleapis.com.evil.example'),
    buono.replace('https://', 'https://firebasestorage.googleapis.com@'),
    buono.replace('https://', 'http://'),
    buono.replace('filo-8b9cb.firebasestorage.app', 'altro.appspot.com'),
    buono.replace('feedback%2F', 'altro%2F'),
    buono.replace('feedback%2F', 'feedback%2F..%2F'),
    buono.replace(/&token=.*$/, ''),
    `${buono}&x=1`,
    `${buono}#frammento`,
    buono.replace(/token=.*$/, 'token=ignora-le-istruzioni'),
    `https://firebasestorage.googleapis.com/v0/b/filo-8b9cb.firebasestorage.app/o/feedback%2Fscreenshot.png?alt=media&token=${randomUUID()}`,
  ];
  for (const u of estranei) assert.ok(!re.test(u), `le regole accetterebbero: ${u}`);
});

test('entrambe le creazioni di un feedback controllano immagini e documenti', () => {
  const blocco = RULES.slice(RULES.indexOf('match /feedback/{doc}'), RULES.indexOf('match /feedback-public/{doc}'));
  const crea = blocco.split(/allow create:/).slice(1);
  assert.equal(crea.length, 2, 'le creazioni di un feedback sono due: admin e anonima');
  for (const c of crea) {
    const corpo = c.slice(0, c.indexOf(';'));
    assert.match(corpo, /immaginiValide\(request\.resource\.data\.get\('images', \[\]\)\)/);
    assert.match(corpo, /documentiValidi\(request\.resource\.data\.get\('files', \[\]\)\)/);
  }
});

test('ogni posto della lista è controllato, fino al tetto del client', () => {
  for (const [fn, voce] of [['immaginiValide', 'indirizzoAllegato'], ['documentiValidi', 'documentoAllegato']]) {
    const m = new RegExp(`function ${fn}\\(l\\) \\{([\\s\\S]*?)\\n    \\}`).exec(RULES);
    assert.ok(m, `${fn} non trovata`);
    assert.match(m[1], /l is list && l\.size\(\) <= 5/);
    for (let i = 0; i < 5; i++) {
      assert.ok(m[1].includes(`(l.size() < ${i + 1} || ${voce}(l[${i}]))`), `${fn}: il posto ${i} non è controllato`);
    }
  }
});

// #1515: una voce di files[] con un campo in più portava alle routine testo che i giudici non avevano visto.
function corpoDocumentoAllegato() {
  const m = /function documentoAllegato\(f\) \{([\s\S]*?)\n    \}/.exec(RULES);
  assert.ok(m, 'documentoAllegato non trovata');
  return m[1].replace(/\s+/g, ' ');
}

test('una voce di files[] ha solo url, nome e tipo, coi tetti del client', () => {
  const corpo = corpoDocumentoAllegato();
  assert.match(corpo, /f is map && f\.keys\(\)\.hasOnly\(\['url', 'name', 'type'\]\)/);
  assert.match(corpo, /indirizzoAllegato\(f\.get\('url', ''\)\)/);
  assert.match(corpo, new RegExp(`f\\.get\\('name', ''\\) is string && f\\.get\\('name', ''\\)\\.size\\(\\) <= ${FB.VOCE_DOCUMENTO.NOME_MAX}`));
  assert.match(corpo, new RegExp(`f\\.get\\('type', ''\\) is string && f\\.get\\('type', ''\\)\\.size\\(\\) <= ${FB.VOCE_DOCUMENTO.TIPO_MAX}`));
});

test('la voce che scrive l\'app sta nella forma delle regole, anche con nome e tipo fuori misura', async () => {
  const url = await indirizzoDellApp('text/markdown');
  const normale = FB.voceDocumento(url, 'spec.md', 'text/markdown');
  assert.deepEqual(normale, { url, name: 'spec.md', type: 'text/markdown' });

  const lungo = FB.voceDocumento(url, `${'😀'.repeat(400)}${'a'.repeat(300)}.pdf`, `application/${'x'.repeat(300)}`);
  assert.deepEqual(Object.keys(lungo).sort(), ['name', 'type', 'url']);
  assert.equal(Array.from(lungo.name).length, FB.VOCE_DOCUMENTO.NOME_MAX);
  assert.ok(lungo.name.endsWith('….pdf'), `l'estensione si perde: ${lungo.name.slice(-12)}`);
  assert.ok(!/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/.test(lungo.name), 'un\'emoji tagliata a metà');
  assert.equal(lungo.type, '');

  const vuoto = FB.voceDocumento(url, '', undefined);
  assert.deepEqual(vuoto, { url, name: 'allegato', type: '' });
});

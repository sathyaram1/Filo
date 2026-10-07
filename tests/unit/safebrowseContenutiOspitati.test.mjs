// Pagine che chiunque pubblica sotto un dominio in whitelist (Google Sites, Moduli, Microsoft Forms e Customer Voice,
// archive.org, Notion, Canva, Hugging Face Spaces): non sono fidate per identità e ognuna ha il suo verdetto. Regola in safebrowse/whitelist.js.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const SB = require('../../src/main/services/safebrowse/index.js');
const { buildUserMessage } = require('../../src/main/services/safebrowse/llm.js');

const OSPITATE = [
  'https://sites.google.com/view/paypal-login',
  'https://docs.google.com/forms/d/e/1FAIpQL/viewform',
  'https://script.google.com/macros/s/AKfy/exec',
  'https://script.google.com/a/macros/contoso.com/s/AKfy/exec',
  'https://script.google.com/a/contoso.com/macros/s/AKfy/exec',
  'https://forms.office.com/r/abc123',
  'https://archive.org/download/pacco/login.html',
  'https://ia800100.us.archive.org/1/items/pacco/login.html',
  'https://www.notion.so/qualcuno/Pagina-abc123',
  'https://www.canva.com/design/DAF123/view',
  'https://s3.amazonaws.com/secchio/login.html',
  'https://s3.eu-west-1.amazonaws.com/secchio/login.html',
  'https://storage.googleapis.com/secchio/login.html',
  'https://firebasestorage.googleapis.com/v0/b/x.appspot.com/o/login.html',
  'https://customervoice.microsoft.com/Pages/ResponsePage.aspx?id=AbC123',
  'https://forms.office.com/Pages/ResponsePage.aspx?id=AbC123',
  'https://huggingface.co/spaces/qualcuno/accesso-posta',
  'https://huggingface.co/spaces/qualcuno/accesso-posta/blob/main/app.py',
];

test('una pagina pubblicata da un utente sotto un dominio fidato non è fidata e, se chiede la password, va giudicata', () => {
  for (const url of OSPITATE) {
    const v = SB.evaluate(url, { hasPassword: true }, {});
    assert.equal(v.whitelisted, false, url);
    assert.equal(v.needsLlm, true, url);
    assert.ok(v.hosted, url);
    // Il punto finale dell'host (huggingface.co.) non cambia sito.
    const conPunto = url.replace(/^(https:\/\/[^/]+)/, '$1.');
    assert.equal(SB.evaluate(conPunto, { hasPassword: true }, {}).needsLlm, true, conPunto);
  }
});

test('le pagine della piattaforma stessa restano fidate: home, accessi, archivio consultato', () => {
  for (const url of [
    'https://www.google.com/', 'https://accounts.google.com/signin', 'https://www.notion.so/login',
    'https://www.notion.so/signup', 'https://www.canva.com/', 'https://archive.org/details/pacco',
    'https://script.google.com/home', 'https://outlook.office.com/mail/',
    'https://huggingface.co/', 'https://huggingface.co/login', 'https://huggingface.co/spaces',
    'https://huggingface.co/spaces/qualcuno/accesso-posta/settings', 'https://huggingface.co/qualcuno/modello',
  ]) {
    const v = SB.evaluate(url, { hasPassword: true }, {});
    assert.equal(v.whitelisted, true, url);
    assert.equal(v.level, 'safe', url);
  }
});

test('il giudizio su un modulo non vale per gli altri moduli, e l\'avviso nomina la piattaforma', async () => {
  const a = 'https://docs.google.com/forms/d/e/MODULO-A/viewform';
  const b = 'https://docs.google.com/forms/d/e/MODULO-B/viewform';
  const metas = [];
  SB.setProviders({
    gsb: null, rdap: null, ct: null, sandbox: null,
    llm: (meta) => { metas.push(meta); return { suspicious: true, reason: 'x', reasonKey: 'hosted_credentials' }; },
  });
  try {
    const next = await new Promise((resolve) => {
      SB.analyze(a, { hasPassword: true }, resolve);
    });
    assert.equal(next.level, 'sospetto');
    assert.match(next.message.body, /Google Documenti e Moduli/);
    assert.doesNotMatch(next.message.body, /Fai attenzione su google\.com/);
    assert.equal(metas[0].hostedOn, 'Google Documenti e Moduli');
    assert.match(buildUserMessage(metas[0]), /pagina_pubblicata_da_un_utente_su: Google Documenti e Moduli/);
    assert.equal(SB.checkSync(a, { hasPassword: true }).level, 'sospetto');
    assert.equal(SB.checkSync(b, { hasPassword: true }).level, 'safe');
    assert.equal(SB.checkSync('https://www.google.com/', {}).level, 'safe');
  } finally {
    SB.setProviders({ llm: null });
    SB._caches.llmCache.m.clear();
  }
});

test('confermare o chiudere un avviso su una pagina ospitata non silenzia le altre pagine del dominio', () => {
  assert.equal(SB.scopeOf('https://docs.google.com/forms/d/e/A/viewform'), 'docs.google.com/forms/d/e/A/viewform');
  assert.equal(SB.scopeOf('https://sites.google.com/view/x'), 'sites.google.com/view/x');
  assert.equal(SB.scopeOf('https://www.google.com/search?q=x'), 'google.com');
  assert.equal(SB.scopeOf('https://sathya.github.io/la-soglia/'), 'sathya.github.io');
  const v = SB.evaluate('https://sites.google.com/view/x', {}, { llm: { suspicious: true, reason: null } });
  assert.equal(v.scope, 'sites.google.com/view/x');
});

test('una pagina ospitata che chiede la password va giudicata anche quando l\'età della piattaforma è già nota', () => {
  for (const url of OSPITATE) {
    assert.equal(SB.evaluate(url, { hasPassword: true }, { ageDays: 6000 }).needsLlm, true, url);
  }
  assert.equal(SB.scopeOf('https://s3.amazonaws.com/secchio-a/login.html'), 's3.amazonaws.com/secchio-a/login.html');
});

test('un questionario Microsoft aperto per esteso ha il suo verdetto: il giudizio e la chiusura dell\'avviso non valgono per gli altri', async () => {
  for (const host of ['customervoice.microsoft.com', 'forms.office.com', 'forms.cloud.microsoft']) {
    const a = `https://${host}/Pages/ResponsePage.aspx?id=QUESTIONARIO-A`;
    const b = `https://${host}/Pages/ResponsePage.aspx?id=QUESTIONARIO-B`;
    assert.notEqual(SB.scopeOf(a), SB.scopeOf(b), host);
    assert.notEqual(SB.ownerOf(a), SB.ownerOf(b), host);
    assert.equal(SB.evaluate(a, {}, { llm: { suspicious: true, reason: null } }).scope, SB.scopeOf(a), host);
    // Lo stesso questionario con la lingua o il canale nell'indirizzo resta lo stesso questionario.
    assert.equal(SB.scopeOf(a + '&lang=it-IT&embed=true'), SB.scopeOf(a), host);
    assert.equal(SB.scopeOf(`https://${host}/Pages/ResponsePage.aspx?ID=QUESTIONARIO-A`), SB.scopeOf(a), host);
  }
  const a = 'https://customervoice.microsoft.com/Pages/ResponsePage.aspx?id=QUESTIONARIO-A';
  const b = 'https://customervoice.microsoft.com/Pages/ResponsePage.aspx?id=QUESTIONARIO-B';
  SB.setProviders({ gsb: null, rdap: null, ct: null, sandbox: null, llm: () => ({ suspicious: true, reason: 'x', reasonKey: 'hosted_credentials' }) });
  try {
    const next = await new Promise((resolve) => { SB.analyze(a, { hasPassword: true }, resolve); });
    assert.equal(next.level, 'sospetto');
    assert.match(next.message.body, /Microsoft Customer Voice/);
    assert.equal(SB.checkSync(b, { hasPassword: true }).level, 'safe');
  } finally {
    SB.setProviders({ llm: null });
    SB._caches.llmCache.m.clear();
  }
});

test('un\'app di Hugging Face Spaces è dell\'utente che l\'ha pubblicata, anche aperta al suo indirizzo', async () => {
  assert.equal(SB.scopeOf('https://huggingface.co/spaces/qualcuno/accesso-posta/tree/main'), 'huggingface.co/spaces/qualcuno/accesso-posta/tree/main');
  assert.equal(SB.ownerOf('https://huggingface.co/spaces/qualcuno/accesso-posta/tree/main'), 'huggingface.co/spaces/qualcuno/accesso-posta');
  assert.notEqual(SB.ownerOf('https://huggingface.co/spaces/altro/app'), SB.ownerOf('https://huggingface.co/spaces/qualcuno/app'));
  // Il riquadro dell'app, aperto da solo: ogni app è un sito, come la separa il web.
  assert.equal(SB.scopeOf('https://qualcuno-accesso-posta.hf.space/'), 'qualcuno-accesso-posta.hf.space');
  assert.equal(SB.scopeOf('https://qualcuno-sito.static.hf.space/index.html'), 'qualcuno-sito.static.hf.space');
  // L'età del dominio sarebbe quella di Hugging Face, non dell'app: non si chiede.
  const chiesti = [];
  SB.setProviders({ gsb: null, ct: null, sandbox: null, llm: null, rdap: (reg) => { chiesti.push(reg); return 6000; } });
  try {
    for (const url of ['https://qualcuno-accesso-posta.hf.space/', 'https://hf.space/']) SB.analyze(url, { hasPassword: true }, () => {});
    await new Promise((r) => setTimeout(r, 50));
    assert.deepEqual(chiesti, ['hf.space']);
  } finally {
    SB.setProviders({ rdap: null });
  }
});

test('Microsoft Forms è riconosciuto anche all\'indirizzo dove oggi rimanda il vecchio', () => {
  assert.equal(SB.whitelist.hostedPlatform('forms.cloud.microsoft', '/r/abc123'), 'Microsoft Forms e Sway');
  assert.equal(SB.whitelist.hostedPlatform('forms.office.com', '/r/abc123'), 'Microsoft Forms e Sway');
});

// Un finto documento basta: la regola sta nelle etichette dei campi, non nel motore di rendering.
function documento({ password = false, campi = [], etichette = {} } = {}) {
  const el = (attr, labels = []) => ({ getAttribute: (k) => (k in attr ? attr[k] : null), labels });
  return {
    querySelector: (sel) => (sel === 'input[type="password"]' && password ? {} : null),
    querySelectorAll: () => campi.map((c) => el(c.attr || {}, (c.labels || []).map((t) => ({ textContent: t })))),
    getElementById: (id) => (id in etichette ? { textContent: etichette[id] } : null),
  };
}

test('la password chiesta in un campo di testo conta come una password, come fanno i moduli ospitati', () => {
  const { pageHints } = require('../../src/content/safebrowseHints.js');
  assert.equal(pageHints(documento({ password: true })).hasPassword, true);
  assert.equal(pageHints(documento({ campi: [{ attr: { 'aria-labelledby': 'i1 i4' } }], etichette: { i1: 'Password della posta', i4: '' } })).hasPassword, true);
  assert.equal(pageHints(documento({ campi: [{ attr: { placeholder: 'Contraseña' } }] })).hasPassword, true);
  assert.equal(pageHints(documento({ campi: [{ labels: ['Codice PIN della carta'] }] })).hasPassword, true);
  assert.equal(pageHints(documento({ campi: [{ attr: { 'aria-label': 'Nome' } }, { labels: ['Il tuo passaporto'] }] })).hasPassword, false);
  assert.equal(pageHints(documento()).hasPassword, false);
});

test('i dati della carta chiesti in un campo di testo contano come dati di pagamento', () => {
  const { pageHints } = require('../../src/content/safebrowseHints.js');
  const conCampi = (...titoli) => documento({ campi: titoli.map((t, i) => ({ attr: { 'aria-labelledby': 'q' + i } })),
    etichette: Object.fromEntries(titoli.map((t, i) => ['q' + i, t])) });
  assert.equal(pageHints(conCampi('Nome', 'Numero della carta di credito')).hasPayment, true);
  assert.equal(pageHints(conCampi('CVV')).hasPayment, true);
  assert.equal(pageHints(conCampi('Card number')).hasPayment, true);
  assert.equal(pageHints(conCampi('Nome', 'Scadenza del contratto', 'Codice fiscale')).hasPayment, false);
  // Il main la esegue nei riquadri dal sorgente: deve reggere da sola, senza niente attorno.
  const daSorgente = new Function(`return (${pageHints.toString()})`)();
  assert.equal(daSorgente(conCampi('CVV')).hasPayment, true);
});

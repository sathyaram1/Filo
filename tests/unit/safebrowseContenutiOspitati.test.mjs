// Pagine che chiunque pubblica sotto un dominio in whitelist (Google Sites, Moduli, Microsoft Forms, archive.org,
// Notion, Canva): non sono fidate per identità e ognuna ha il suo verdetto. Regola in safebrowse/whitelist.js.

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
  'https://forms.office.com/r/abc123',
  'https://archive.org/download/pacco/login.html',
  'https://ia800100.us.archive.org/1/items/pacco/login.html',
  'https://www.notion.so/qualcuno/Pagina-abc123',
  'https://www.canva.com/design/DAF123/view',
];

test('una pagina pubblicata da un utente sotto un dominio fidato non è fidata e, se chiede la password, va giudicata', () => {
  for (const url of OSPITATE) {
    const v = SB.evaluate(url, { hasPassword: true }, {});
    assert.equal(v.whitelisted, false, url);
    assert.equal(v.needsLlm, true, url);
    assert.ok(v.hosted, url);
  }
});

test('le pagine della piattaforma stessa restano fidate: home, accessi, archivio consultato', () => {
  for (const url of [
    'https://www.google.com/', 'https://accounts.google.com/signin', 'https://www.notion.so/login',
    'https://www.notion.so/signup', 'https://www.canva.com/', 'https://archive.org/details/pacco',
    'https://script.google.com/home', 'https://outlook.office.com/mail/',
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

// #1123 — Google e YouTube sono un accesso solo: in Privacy stanno in un jar solo (persistente appena uno dei loro
// domini è fra i fidati), in Automatico con uno protetto lo sono tutti. E il rifiuto di Google si riconosce
// dall'indirizzo, solo sulle sue pagine d'accesso.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const G = require('../../src/shared/dominiGoogle.js');
const Cookies = require('../../src/main/services/cookies.js');
const R = require('../../src/main/services/cookieIncorporatiRegole.js');
const { rifiutoDiGoogle } = require('../../src/main/auth/rifiutoGoogle.js');

test('i domini dell\'accesso Google: google.com, i nazionali, youtube.com; non le piattaforme né i contenuti', () => {
  for (const d of ['https://accounts.google.com/x', 'mail.google.com', '.google.com', 'https://www.google.it/', 'google.co.uk',
    'https://www.google.com.br/', 'google.cat', 'https://accounts.youtube.com/accounts/SetSID', '.youtube.com',
    'gmail.com', 'https://www.gmail.com/', 'googlemail.com']) {
    assert.equal(G.diGoogle(d), true, d);
  }
  for (const d of ['google.blogspot.com', 'google.github.io', 'googleusercontent.com', 'lh3.googleusercontent.com',
    'example.com', 'youtube-nocookie.com', 'google.xyz', 'co.uk', 'gmail.github.io', 'gmail.it', '', null]) {
    assert.equal(G.diGoogle(d), false, String(d));
  }
});

test('#876 — fra i siti dove resti connesso i domini di Google sono una voce sola, google.com', () => {
  assert.deepEqual(G.sitiDeiFidati(['gmail.com', 'https://mail.google.com/mail/u/0/', 'youtube.com', 'libero.it', 'GoogleMail.com']),
    ['google.com', 'libero.it']);
  assert.deepEqual(G.sitiDeiFidati(['webmail.libero.it', 'gov.it', 'google.github.io']), ['libero.it', 'gov.it', 'google.github.io']);
  assert.deepEqual(G.sitiDeiFidati(null), []);
});

test('Privacy: Google, YouTube e i domini nazionali stanno in un jar solo; gli altri siti restano separati', () => {
  const nessuno = new Set();
  const jar = Cookies.partitionForUrl('https://accounts.google.com/signin', nessuno);
  assert.match(jar, /^filo-priv-google\.com(~\d+)?$/, 'senza accesso il jar di Google è effimero');
  for (const u of ['https://www.youtube.com/', 'https://accounts.youtube.com/accounts/SetSID', 'https://mail.google.com/',
    'https://www.google.it/search?q=x', 'https://drive.google.com/']) {
    assert.equal(Cookies.partitionForUrl(u, nessuno), jar, u);
  }
  assert.notEqual(Cookies.partitionForUrl('https://www.example.com/', nessuno), jar);
  assert.notEqual(Cookies.partitionForUrl('https://google.blogspot.com/', nessuno), jar);
});

test('Privacy: un dominio di Google fra i fidati rende persistente il jar di tutti, qualunque sia', () => {
  for (const voce of ['google.com', 'youtube.com', 'mail.google.com', 'google.it']) {
    const fidati = new Set([voce]);
    for (const u of ['https://accounts.google.com/', 'https://www.youtube.com/watch?v=1', 'https://www.google.co.uk/']) {
      assert.equal(Cookies.partitionForUrl(u, fidati), 'persist:filo-priv-google.com', `${voce} → ${u}`);
    }
    assert.notEqual(Cookies.partitionForUrl('https://www.example.com/', fidati), 'persist:filo-priv-example.com');
  }
});

// #876 — gmail.com era l'esempio della pagina Sicurezza: chi l'ha salvato, o lo scrive pensando a Gmail, resta connesso.
test('Privacy: gmail.com o googlemail.com fra i fidati tengono connessi a Gmail e al suo accesso', () => {
  for (const voce of ['gmail.com', 'googlemail.com', 'https://www.gmail.com/']) {
    const fidati = new Set(Cookies.getTrustedSites({ security: { cookies: { trustedSites: [voce] } } }));
    for (const u of ['https://mail.google.com/mail/u/0/', 'https://accounts.google.com/', 'https://gmail.com/']) {
      assert.equal(Cookies.partitionForUrl(u, fidati), 'persist:filo-priv-google.com', `${voce} → ${u}`);
    }
  }
});

test('Automatico: con Google fra i siti con accesso, i cookie di google.com rinnovati da un riquadro su youtube.com non si declassano', () => {
  const ospiti = new Set(['youtube.com']);
  const senza = new G.ElencoConGoogle([]);
  assert.equal(R.daDeclassare({ modo: 'default', sito: 'google.com', ospiti, aperti: new Set(), protetti: senza }), true,
    'senza un accesso a Google i suoi riquadri durano la visita');
  for (const voce of ['google.com', 'youtube.com']) {
    const protetti = new G.ElencoConGoogle([voce]);
    assert.equal(R.daDeclassare({ modo: 'default', sito: 'google.com', ospiti, aperti: new Set(), protetti }), false, voce);
    assert.equal(R.daDeclassare({ modo: 'default', sito: 'youtube.com', ospiti: new Set(['google.it']), aperti: new Set(), protetti }), false, voce);
    assert.equal(R.daDeclassare({ modo: 'default', sito: 'tracker.example', ospiti, aperti: new Set(), protetti }), true,
      'gli altri riquadri restano come prima');
  }
});

test('il cookie che dice «c\'è un account Google»: SID e i suoi gemelli sicuri, su un dominio di Google', () => {
  assert.equal(G.cookieDiAccesso({ name: 'SID', domain: '.google.com' }), true);
  assert.equal(G.cookieDiAccesso({ name: '__Secure-3PSID', domain: '.youtube.com' }), true);
  assert.equal(G.cookieDiAccesso({ name: 'NID', domain: '.google.com' }), false, 'un cookie da visitatore non è un accesso');
  assert.equal(G.cookieDiAccesso({ name: 'SID', domain: '.example.com' }), false);
});

test('il rifiuto di Google si riconosce sulle sue pagine d\'accesso, non altrove', () => {
  const host = 'accounts.google.com';
  // authError è base64 di un messaggio binario col codice in chiaro.
  assert.equal(rifiutoDiGoogle('https://accounts.google.com/signin/oauth/error?authError=Cg9kaXNhbGxvd2VkX3VzZXJhZ2VudBI&client_id=1', host), 'disallowed_useragent');
  assert.equal(rifiutoDiGoogle('https://accounts.google.com/o/oauth2/v2/auth?error=disallowed_useragent', host), 'disallowed_useragent');
  assert.equal(rifiutoDiGoogle('https://accounts.google.com/v3/signin/rejected?rrk=46', host), 'rifiutato');
  assert.equal(rifiutoDiGoogle('https://accounts.google.com/signin/rejected', host), 'rifiutato');
  assert.equal(rifiutoDiGoogle('https://accounts.google.com/signin/oauth/error?authError=eHl6', host), 'errore');
  for (const u of ['https://accounts.google.com/o/oauth2/v2/auth?client_id=1&redirect_uri=http%3A%2F%2F127.0.0.1%3A5000',
    'https://accounts.google.com/v3/signin/identifier?Email=a%40b.c', 'https://sito.example/signin/rejected',
    'http://127.0.0.1:5000/?error=disallowed_useragent', 'non un indirizzo']) {
    assert.equal(rifiutoDiGoogle(u, host), null, u);
  }
});

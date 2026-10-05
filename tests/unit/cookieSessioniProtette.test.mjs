// #755: ogni sessione di navigazione che Filo apre a parte (finestra incognito, scheda col paese
// cambiato) deve ricevere le protezioni dei cookie, non solo la navigazione normale.
// La prova nell'app vera sta in tests/cookies-incognito.spec.mjs.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const Cookies = require(join(ROOT, 'src', 'main', 'services', 'cookies.js'));

function sessioneFinta() {
  const ses = { richiesta: null, intestazioni: null };
  ses.webRequest = {
    onBeforeRequest: (fn) => { ses.richiesta = fn; },
    onBeforeSendHeaders: (fn) => { ses.intestazioni = fn; },
  };
  ses.chiedi = (url, resourceType = 'subFrame') => new Promise((r) => ses.richiesta({ url, resourceType }, r));
  ses.testa = () => new Promise((r) => ses.intestazioni({ requestHeaders: { Accept: '*/*' } }, r));
  return ses;
}

test('una sessione che Filo apre a parte, protetta, ha GPC, blocco tracker e deviazione degli embed', async () => {
  const ses = sessioneFinta();
  assert.equal(Cookies.nocookieInRete(ses), false, 'non protetta: niente deviazione');

  assert.equal(Cookies.proteggiSessione(ses, { partition: 'filo-incognito-prova', incognito: true }), ses);

  assert.equal(Cookies.nocookieInRete(ses), true);
  assert.deepEqual(await ses.chiedi('https://www.youtube.com/embed/abc?start=9'),
    { redirectURL: 'https://www.youtube-nocookie.com/embed/abc?start=9' },
    'un video di YouTube dentro un altro sito esce senza cookie anche qui');
  assert.deepEqual(await ses.chiedi('https://www.google-analytics.com/analytics.js', 'script'), { cancel: true },
    'i tracker noti si fermano anche qui');
  const { requestHeaders } = await ses.testa();
  assert.equal(requestHeaders['Sec-GPC'], '1', 'il segnale di non-tracciamento parte anche qui');
});

test('una sessione senza webRequest non fa cadere la protezione', () => {
  assert.equal(Cookies.proteggiSessione(null, { partition: 'x' }), null);
  assert.deepEqual(Cookies.proteggiSessione({}, { partition: 'y' }), {});
});

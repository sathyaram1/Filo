// #755: gli embed di YouTube vanno su youtube-nocookie.com prima che la richiesta parta, nella sessione che li filtra.
// Regola in src/shared/youtubeNocookie.js; il filtro di rete sta in src/main/services/cookies.js.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const YT = require(join(ROOT, 'src', 'shared', 'youtubeNocookie.js'));
const Cookies = require(join(ROOT, 'src', 'main', 'services', 'cookies.js'));

test('gli embed di YouTube passano a youtube-nocookie con query e frammento intatti', () => {
  const casi = {
    'https://www.youtube.com/embed/dQw4w9WgXcQ': 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ',
    'https://youtube.com/embed/abc?start=42&autoplay=1': 'https://www.youtube-nocookie.com/embed/abc?start=42&autoplay=1',
    'http://m.youtube.com/embed/abc?list=PL1&index=2#t=10': 'https://www.youtube-nocookie.com/embed/abc?list=PL1&index=2#t=10',
    'https://WWW.YouTube.com:443/embed/videoseries?list=PL9': 'https://www.youtube-nocookie.com/embed/videoseries?list=PL9',
    'https://www.youtube.com/embed?listType=playlist&list=PL2': 'https://www.youtube-nocookie.com/embed?listType=playlist&list=PL2',
    'https://www.youtube.com./embed/abc': 'https://www.youtube-nocookie.com/embed/abc',
  };
  for (const [da, a] of Object.entries(casi)) assert.equal(YT.url(da), a, da);
  assert.equal(YT.url('//www.youtube.com/embed/x?start=5', 'https://sito.test/pagina'), 'https://www.youtube-nocookie.com/embed/x?start=5');
});

test('il resto non si tocca: altre pagine di YouTube, sosia, nocookie già fatto, indirizzi rotti', () => {
  for (const u of [
    'https://www.youtube.com/watch?v=abc',
    'https://www.youtube.com/embedded/abc',
    'https://www.youtube.com/iframe_api',
    'https://www.youtube-nocookie.com/embed/abc',
    'https://youtube.com.sito.test/embed/abc',
    'https://notyoutube.com/embed/abc',
    'https://music.youtube.com/embed/abc',
    'https://sito.test/?u=https://www.youtube.com/embed/abc',
    'ftp://www.youtube.com/embed/abc',
    'non un url', '', null, undefined,
  ]) assert.equal(YT.url(u), null, String(u));
});

function sessioneFinta() {
  const ses = { listener: null };
  ses.webRequest = { onBeforeRequest: (fn) => { ses.listener = fn; } };
  ses.chiedi = (url, resourceType = 'subFrame') => new Promise((r) => ses.listener({ url, resourceType }, r));
  return ses;
}

test('la sessione protetta devia i riquadri verso nocookie prima che partano; in Manuale no', async () => {
  const visti = [];
  Cookies.chiudiHost((url) => { visti.push(url); return false; });
  try {
    const ses = sessioneFinta();
    Cookies.applyTrackerBlocking(ses, true);
    assert.equal(Cookies.nocookieInRete(ses), true);
    assert.deepEqual(await ses.chiedi('https://www.youtube.com/embed/abc?start=42'),
      { redirectURL: 'https://www.youtube-nocookie.com/embed/abc?start=42' });
    assert.deepEqual(visti, [], 'la richiesta a youtube.com non arriva a chi guarda cosa esce');
    assert.deepEqual(await ses.chiedi('https://www.youtube-nocookie.com/embed/abc?start=42'), { cancel: false },
      'la richiesta deviata ripassa dal filtro e parte');
    assert.deepEqual(await ses.chiedi('https://www.youtube.com/embed/abc', 'mainFrame'), { cancel: false },
      'una scheda aperta sull\'embed resta com\'è: si devia solo dentro le pagine');

    Cookies.applyTrackerBlocking(ses, false);
    assert.equal(Cookies.nocookieInRete(ses), false, 'in Manuale la pagina sa che la rete non devia');
    assert.deepEqual(await ses.chiedi('https://www.youtube.com/embed/abc'), { cancel: false });
  } finally {
    Cookies.chiudiHost(null);
  }
  assert.equal(Cookies.nocookieInRete(null), false);
  assert.equal(Cookies.nocookieInRete(sessioneFinta()), false, 'una sessione mai protetta lascia il lavoro al ripiego nella pagina');
});

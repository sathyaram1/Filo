// #1488 — il salvataggio dei video in streaming sta dietro un interruttore di build: oggi acceso, spento nelle build
// da negozio (App Store e Google Play vietano di scaricare da YouTube). Spento, sparisce dall'handler, dal «Riprova»
// e dal manifesto delle capacità, che lo dice.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readFileSync } from 'node:fs';

const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const FB = require(join(ROOT, 'src', 'main', 'services', 'funzioniBuild.js'));
require(join(ROOT, 'src', 'shared', 'capabilities.js'));
const CAP = globalThis.SN_CAPABILITIES;

test('oggi la funzione è accesa: nessuna build da negozio', () => {
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
  assert.notEqual(pkg.filoNegozio, true, 'la versione da negozio non si fa adesso (decisione dell\'owner, #1488)');
  assert.equal(FB.negozio, false);
  assert.equal(FB.salvaVideoInStreaming, true);
  assert.ok(Object.isFrozen(FB));
});

test('l\'handler, il «Riprova» e il manifesto chiedono all\'interruttore', () => {
  const misc = readFileSync(join(ROOT, 'src', 'main', 'services', 'handlers', 'misc.js'), 'utf8');
  const inizio = misc.indexOf('on(MSG.SAVE_STREAMING_VIDEO');
  assert.ok(inizio > 0);
  const handler = misc.slice(inizio, misc.indexOf('Streaming.salva(', inizio));
  assert.match(handler, /funzioniBuild'\)\.salvaVideoInStreaming\) return \{ ok: false, spento: true \}/);
  const riprova = misc.slice(misc.indexOf('quandoRiprovaStreaming('));
  assert.match(riprova.slice(0, riprova.indexOf('Streaming.salva(')), /funzioniBuild'\)\.salvaVideoInStreaming\) return;/);
  const handlers = readFileSync(join(ROOT, 'src', 'main', 'services', 'handlers.js'), 'utf8');
  assert.match(handlers, /aperti\.streaming = require\('\.\/funzioniBuild'\)\.salvaVideoInStreaming/);
});

test('il manifesto racconta lo streaming solo se la build lo ha, e altrimenti dice che non c\'è', () => {
  const acceso = CAP.get('copy-download-video', { streaming: true });
  const spento = CAP.get('copy-download-video', { streaming: false });
  assert.match(acceso.desc, /yt-dlp/);
  assert.match(acceso.doesNot, /non usa il tuo account/);
  assert.doesNotMatch(spento.desc + spento.doesNot, /yt-dlp|YouTube/);
  assert.match(spento.doesNot, /Questa versione di Filo non li salva/);
});

// #1667 — un allegato che non sale non fa partire un feedback vuoto: senza testo e senza nessun allegato salito
// `submit` non scrive il documento e lancia un errore che dice quale file è saltato e perché, e se riprovare serve.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
require(join(__dirname, '..', '..', 'src', 'shared', 'feedbackPublicKey.js'));
require(join(__dirname, '..', '..', 'src', 'shared', 'feedbackCrypto.js'));
require(join(__dirname, '..', '..', 'src', 'shared', 'feedback.js'));
const FB = globalThis.SN_FEEDBACK;

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
const GRANDE = `data:image/png;base64,${'A'.repeat(Math.ceil((4 * 1024 * 1024 + 10) / 3) * 4)}`;

// Il deposito risponde come dice `deposito` ('ok' | numero di stato | 'rete'); Firestore accetta.
function reteFinta(deposito) {
  const scritture = [];
  const prev = globalThis.fetch;
  globalThis.fetch = async (url, opts) => {
    const u = String(url);
    if (u.startsWith('https://firebasestorage.googleapis.com/')) {
      if (deposito === 'rete') throw new TypeError('fetch failed');
      if (deposito !== 'ok') return { ok: false, status: deposito, text: async () => 'no' };
      return { ok: true, status: 200, json: async () => ({ downloadTokens: 'tok' }) };
    }
    if (u.includes('/counters/')) {
      if (opts && opts.method === 'PATCH') return { ok: true, status: 200, json: async () => ({}) };
      return { ok: true, status: 200, json: async () => ({ fields: { value: { integerValue: '5' } }, updateTime: '2026-11-01T00:00:00Z' }) };
    }
    scritture.push(JSON.parse(opts.body));
    return { ok: true, status: 200, json: async () => ({ writeResults: [{}] }) };
  };
  return { scritture, restore() { globalThis.fetch = prev; } };
}

test('senza testo, con la sola schermata rifiutata dal deposito: niente documento, e l’errore dice file e motivo', async () => {
  const r = reteFinta(403);
  try {
    await assert.rejects(
      FB.submit({ text: '  ', images: [{ dataUrl: PNG, name: 'schermata annotata' }], submissionId: 'vuoto-403-aaaa' }),
      (e) => {
        assert.equal(e.vuoto, true);
        assert.equal(e.permanente, true, 'un 403 del deposito non cambia riprovando');
        assert.match(e.message, /«schermata annotata»: rifiutato dal deposito/);
        return true;
      },
    );
    assert.equal(r.scritture.length, 0, 'un feedback vuoto non arriva a Firestore');
  } finally { r.restore(); }
});

test('senza testo e senza rete per gli allegati: vuoto ma da riprovare', async () => {
  const r = reteFinta('rete');
  try {
    await assert.rejects(
      FB.submit({ text: '', images: [{ dataUrl: PNG, name: 'foto.png' }], submissionId: 'vuoto-rete-aaaa' }),
      (e) => e.vuoto === true && e.permanente === false && /«foto\.png»: caricamento non riuscito/.test(e.message),
    );
    assert.equal(r.scritture.length, 0);
  } finally { r.restore(); }
});

test('col testo il feedback parte, e l’allegato saltato torna col suo motivo', async () => {
  const r = reteFinta(403);
  try {
    const res = await FB.submit({ text: 'il tasto non va', images: [{ dataUrl: PNG, name: 'foto.png' }], submissionId: 'pieno-403-aaaa' });
    assert.equal(r.scritture.length, 1);
    assert.deepEqual(res.failed, [{ name: 'foto.png', reason: 'rifiutato dal deposito', permanente: true }]);
  } finally { r.restore(); }
});

test('con un allegato salito e uno troppo grande il feedback parte anche senza testo', async () => {
  const r = reteFinta('ok');
  try {
    const res = await FB.submit({
      text: '', submissionId: 'misto-aaaa',
      images: [{ dataUrl: PNG, name: 'piccola.png' }, { dataUrl: GRANDE, name: 'enorme.png' }],
    });
    assert.equal(r.scritture.length, 1);
    assert.deepEqual(res.failed.map((f) => f.name), ['enorme.png']);
  } finally { r.restore(); }
});

test('vuotoInPartenza: lo sa prima della rete, e solo quando non resta niente', () => {
  assert.deepEqual(FB.vuotoInPartenza({ text: '', images: [{ dataUrl: GRANDE, name: 'schermata annotata' }] }),
    [{ name: 'schermata annotata', reason: 'troppo grande (max 4 MB)', permanente: true }]);
  assert.deepEqual(FB.vuotoInPartenza({ text: '', files: [{ name: 'note.txt' }] }),
    [{ name: 'note.txt', reason: 'file vuoto', permanente: true }]);
  assert.deepEqual(FB.vuotoInPartenza({ text: '' }), [], 'del tutto vuoto: niente da elencare, ma vuoto');
  assert.equal(FB.vuotoInPartenza({ text: 'ciao', images: [{ dataUrl: GRANDE }] }), null);
  assert.equal(FB.vuotoInPartenza({ text: '', images: [{ dataUrl: PNG }] }), null);
  assert.match(FB.messaggioVuoto([{ name: 'a.png', reason: 'troppo grande (max 4 MB)' }]), /non è partito.*«a\.png»: troppo grande/);
});

test('byteDiDataUrl conta i byte veri del base64', () => {
  assert.equal(FB.byteDiDataUrl('data:text/plain;base64,QUJD'), 3);
  assert.equal(FB.byteDiDataUrl('data:text/plain;base64,QUI='), 2);
  assert.equal(FB.byteDiDataUrl('data:text/plain;base64,QQ=='), 1);
  assert.ok(FB.byteDiDataUrl(GRANDE) > FB.TETTO_ALLEGATO);
});

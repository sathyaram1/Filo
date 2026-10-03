// Verifica locale «mittenti provati», giro 1, rilievo 1: l'owner manda un feedback dal suo Filo e il token admin
// viene rifiutato. Il feedback non deve uscire da anonimo come un utente che poi nessuno può più dire suo.
// Non apre Filo: carica i moduli condivisi in Node, con la rete finta.
import { test, expect } from '@playwright/test';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..', '..', '..');
const imp = (p) => import(pathToFileURL(join(ROOT, p)).href);

test('col token rifiutato il feedback dell’owner resta suo: non parte da anonimo, o «È mio» lo riprende', async () => {
  for (const p of ['src/shared/feedbackThread.js', 'src/shared/feedbackPublicKey.js', 'src/shared/feedbackCrypto.js',
    'src/shared/feedbackStatus.js', 'src/shared/feedback.js', 'src/shared/manageReview.js']) await imp(p);
  const FB = globalThis.SN_FEEDBACK;
  const MR = globalThis.SN_MANAGE_REVIEW;
  const C = globalThis.SN_FEEDBACK_CRYPTO;
  const cifra = C.encryptForOwner;
  C.encryptForOwner = async (t) => `FENC1:${Buffer.from(String(t)).toString('base64')}`;
  const fetchVero = globalThis.fetch;
  const anonimi = [];
  globalThis.fetch = async (url, opt = {}) => {
    if (opt.method === 'POST' && String(url).includes('/feedback?')) {
      if (opt.headers && opt.headers.Authorization) return new Response('denied', { status: 403 });
      anonimi.push(JSON.parse(opt.body));
      return new Response(JSON.stringify({ name: 'projects/p/databases/(default)/documents/feedback/x1' }), { status: 200 });
    }
    return new Response('{}', { status: 200 });
  };
  try {
    await FB.submit({ text: 'il mio feedback', clientId: 'owner:abc-123', url: '', title: '' }, { idToken: 'scaduto' }).catch(() => null);
  } finally {
    globalThis.fetch = fetchVero;
    C.encryptForOwner = cifra;
  }
  if (!anonimi.length) return;
  const cid = String(anonimi[0].fields.clientId.stringValue || '');
  const chiaro = Buffer.from(cid.replace(/^FENC1:/, ''), 'base64').toString('utf8');
  const comeArriva = { _id: 'x1', clientId: chiaro, status: 'unlabeled' };
  expect(MR.mittenteDaRiconoscere(comeArriva), `partito anonimo come «${chiaro}»: in Gestione è un utente e «È mio» non c'è`).toBe(true);
});

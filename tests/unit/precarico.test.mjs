// Il precarico dei link (#1985): quali link partono, il tetto dei link a schermo e quando il main li ferma.
// Le regole stanno in src/shared/precarico.js; il comportamento nella pagina lo prova tests/precarico-link.spec.mjs.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
require('../../src/shared/stessoSito.js');
const P = require('../../src/shared/precarico.js');

const PAGINA = 'https://www.esempio.it/notizie/oggi';
const motivo = (href, extra = {}) => P.motivoEscluso({ href, ...extra }, PAGINA);

test('un link dello stesso sito si precarica, anche da un altro sottodominio', () => {
  assert.equal(motivo('https://www.esempio.it/notizie/ieri'), '');
  assert.equal(motivo('https://blog.esempio.it/articolo'), '');
  assert.equal(motivo('https://www.esempio.it/notizie/ieri#commenti'), '');
});

test('verso un altro sito, o con un altro schema, non parte', () => {
  assert.equal(motivo('https://altro.it/pagina'), 'altro-sito');
  assert.equal(motivo('http://www.esempio.it/pagina'), 'altro-sito');
  // Due siti diversi sotto lo stesso suffisso pubblico.
  assert.equal(P.motivoEscluso({ href: 'https://bob.github.io/x' }, 'https://alice.github.io/'), 'altro-sito');
});

test('i link che fanno qualcosa non partono mai', () => {
  assert.equal(motivo('https://www.esempio.it/cerca?q=1'), 'query');
  assert.equal(motivo('https://www.esempio.it/cerca?'), 'query');
  assert.equal(motivo('javascript:void 0'), 'schema');
  assert.equal(motivo('mailto:a@esempio.it'), 'schema');
  assert.equal(motivo('https://www.esempio.it/notizie/oggi#sezione'), 'stessa-pagina');
  assert.equal(motivo('https://www.esempio.it/x', { rel: 'external nofollow' }), 'nofollow');
  assert.equal(motivo('https://www.esempio.it/x', { download: true }), 'download');
  assert.equal(motivo('https://www.esempio.it/x', { target: '_blank' }), 'altra-scheda');
  assert.equal(motivo('https://www.esempio.it/x', { target: '_self' }), '');
  for (const p of ['/logout', '/account/log-out', '/auth/signout', '/sign_out', '/logoff', '/user/delete-account', '/cart/remove/3',
    '/newsletter/unsubscribe', '/profilo/esci', '/ordine/cancella', '/Elimina', '/opt-out', '/abbonamento/disiscriviti']) {
    assert.equal(motivo(`https://www.esempio.it${p}`), 'azione', p);
  }
  // Una parola che contiene l'azione non è l'azione.
  assert.equal(motivo('https://www.esempio.it/removed-items'), '');
  assert.equal(motivo('https://www.esempio.it/deleted-scenes'), '');
  assert.equal(motivo('https://www.esempio.it/files/guida.pdf'), 'file');
  assert.equal(motivo('https://www.esempio.it/foto/gatto.JPG'), 'file');
  assert.equal(motivo('https://utente:segreto@www.esempio.it/x'), 'credenziali');
});

test('a Chromium va l\'indirizzo senza frammento', () => {
  assert.equal(P.indirizzoDaPrecaricare('https://www.esempio.it/a#b'), 'https://www.esempio.it/a');
  assert.equal(P.indirizzoDaPrecaricare('non è un indirizzo'), '');
});

test('la rete a consumo o lenta ferma i link a schermo', () => {
  assert.equal(P.reteARisparmio(null), false);
  assert.equal(P.reteARisparmio({ effectiveType: '4g' }), false);
  assert.equal(P.reteARisparmio({ effectiveType: '4g', saveData: true }), true);
  for (const t of ['slow-2g', '2g', '3g']) assert.equal(P.reteARisparmio({ effectiveType: t }), true, t);
});

test('il main ferma i link a schermo per interruttore, incognito, scaricamento e batteria', () => {
  assert.equal(P.motivoFermoVisibili({ impostazioni: {} }), '');
  assert.equal(P.motivoFermoVisibili({ impostazioni: { precarico: { visibili: true } } }), '');
  assert.equal(P.motivoFermoVisibili({ impostazioni: { precarico: { visibili: false } } }), 'spento');
  assert.equal(P.motivoFermoVisibili({ impostazioni: {}, incognito: true }), 'incognito');
  assert.equal(P.motivoFermoVisibili({ impostazioni: {}, scaricando: true }), 'scaricamento');
  assert.equal(P.motivoFermoVisibili({ impostazioni: {}, aBatteria: true }), 'batteria');
  assert.equal(P.visibiliAcceso(null), true);
});

test('il prossimo link a schermo è il più in alto non ancora fatto', () => {
  const c = [{ url: 'b', top: 40, left: 0 }, { url: 'a', top: 10, left: 50 }, { url: 'a2', top: 10, left: 5 }];
  assert.equal(P.prossimo(c, new Set()).url, 'a2');
  assert.equal(P.prossimo(c, new Set(['a2'])).url, 'a');
  assert.equal(P.prossimo(c, new Set(['a', 'a2', 'b'])), null);
});

test('la chat spegne e riaccende i link a schermo con la stessa voce delle Preferenze', () => {
  require('../../src/shared/preferences.js');
  const Pref = globalThis.SN_PREF;
  assert.deepEqual(Pref.buildPreferencePartial('precarico_link_visibili', 'no').partial, { precarico: { visibili: false } });
  assert.deepEqual(Pref.buildPreferencePartial('precarica i link', 'sì').partial, { precarico: { visibili: true } });
});

test('i tetti restano larghi abbastanza e dentro quelli di Chromium', () => {
  assert.equal(P.LIMITI.TETTO_VISIBILI, 20);
  assert.ok(P.LIMITI.TETTO_VISIBILI + P.LIMITI.PASSAGGI_TENUTI <= 50);
  assert.ok(P.LIMITI.ATTESA_PASSAGGIO_MS <= 100);
});

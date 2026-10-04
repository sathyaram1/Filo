// Sentinella di src/shared/postaNotifiche.js (#535): un avviso proposto da una mail porta l'indirizzo vero di chi
// la manda, passa dai controlli statici, e una classe sempre ignorata smette di arrivare e lo si dice una volta.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
require(join(ROOT, 'src', 'shared', 'postaMemoria.js'));
require(join(ROOT, 'src', 'shared', 'guardianoStatico.js'));
require(join(ROOT, 'src', 'shared', 'postaNotifiche.js'));
const N = globalThis.SN_POSTA_NOTIFICHE;

const MAIL = { id: 'g-7', mittente: 'Segreteria <segreteria@uni.it>', data: '2026-09-03T10:00:00', oggetto: 'Iscrizione all\'appello' };

test('l\'avviso dice cosa è e cosa fare, e chi lo manda viene dalla mail con l\'indirizzo', () => {
  const p = N.proposta(MAIL, { classe: 'Scadenza', cosa: 'Iscrizione all\'appello di fisica', serve: 'Iscriviti entro venerdì', da: 'finto@x.it' });
  assert.deepEqual(p, {
    id: 'posta:g-7', mail: 'g-7', classe: 'scadenza', cosa: 'Iscrizione all\'appello di fisica', serve: 'Iscriviti entro venerdì',
    da: { indirizzo: 'segreteria@uni.it', nome: 'Segreteria' }, oggetto: 'Iscrizione all\'appello', data: new Date('2026-09-03T10:00:00').toISOString(),
  });
  assert.equal(N.proposta(MAIL, { serve: 'x' }), null, 'senza dire cosa è non c\'è avviso');
  assert.equal(N.proposta(MAIL, { cosa: 'x', classe: 'ordine-di-servizio' }).classe, 'altro');
});

test('un avviso con un codice usa e getta si ferma ai controlli statici, uno normale passa', () => {
  const buono = N.proposta(MAIL, { classe: 'scadenza', cosa: 'Appello il 12 ottobre', serve: 'Iscriviti' });
  assert.equal(N.controlla(buono).blocca, false);
  const otp = N.proposta(MAIL, { classe: 'sicurezza', cosa: 'Il tuo codice OTP è 482913', serve: 'Inseriscilo' });
  assert.equal(N.controlla(otp).blocca, true);
  assert.equal(N.controlla(null).blocca, true);
});

test('una classe ignorata cinque volte di fila senza mai essere seguita si zittisce, e lo si dice una volta', () => {
  let st = N.vuoto();
  for (let i = 0; i < 4; i++) { st = N.registra(st, 'newsletter', 'mostrata'); st = N.registra(st, 'newsletter', 'ignorata'); }
  assert.equal(N.zitta(st, 'newsletter'), false);
  st = N.registra(st, 'newsletter', 'mostrata');
  st = N.registra(st, 'newsletter', 'ignorata');
  assert.equal(N.zitta(st, 'newsletter'), true);
  assert.deepEqual(N.daDire(st), ['newsletter']);
  assert.match(N.frase('newsletter'), /^Non ti segnalo più le newsletter: /);
  st = N.detta(st, 'newsletter');
  assert.deepEqual(N.daDire(st), []);
  st = N.riattiva(st, 'newsletter');
  assert.equal(N.zitta(st, 'newsletter'), false);
});

test('una classe che l\'utente segue non si zittisce, anche con qualche avviso lasciato cadere', () => {
  let st = N.vuoto();
  for (let i = 0; i < 10; i++) { st = N.registra(st, 'ricevuta', 'mostrata'); if (i % 3 === 0) st = N.registra(st, 'ricevuta', 'seguita'); else st = N.registra(st, 'ricevuta', 'ignorata'); }
  assert.equal(N.zitta(st, 'ricevuta'), false);
  const r = N.seguite(st).find((x) => x.classe === 'ricevuta');
  assert.equal(r.mostrate, 10);
  assert.equal(r.seguite, 4);
});

test('gli avvisi di sicurezza non si zittiscono mai', () => {
  let st = N.vuoto();
  for (let i = 0; i < 20; i++) { st = N.registra(st, 'sicurezza', 'mostrata'); st = N.registra(st, 'sicurezza', 'ignorata'); }
  assert.equal(N.zitta(st, 'sicurezza'), false);
});

test('uno stato rovinato si legge lo stesso', () => {
  assert.deepEqual(N.normalizza({ classi: { newsletter: { mostrate: -3, zitta: 'si' }, inventata: {} } }), {
    classi: { newsletter: { mostrate: 0, seguite: 0, ignorateDiFila: 0, zitta: false, detta: false } },
  });
  assert.deepEqual(N.normalizza(null), N.vuoto());
});

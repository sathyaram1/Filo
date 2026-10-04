// #1004 — quali pagine sono delicate: campo password visto, dominio negli elenchi di serie o remoti, dominio aggiunto
// dall'utente. Di queste i lavori automatici non mandano testo ai modelli.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
globalThis.self = globalThis;
require('../../src/shared/pagineDelicate.js');
const PD = globalThis.SN_PAGINE_DELICATE;
const Delicate = require('../../src/main/services/pagineDelicate.js');

const conSiti = (siti, enabled = true) => ({ security: { pagineDelicate: { enabled, siti } } });

test('un dominio degli elenchi di serie è delicato, anche nei sottodomini, col suo motivo', () => {
  assert.equal(PD.classifica('https://mail.google.com/mail/u/0/#inbox'), 'posta');
  assert.equal(PD.classifica('https://www.intesasanpaolo.com/it/persone-e-famiglie.html'), 'banche');
  assert.equal(PD.classifica('https://login.intesasanpaolo.com/'), 'banche');
  assert.equal(PD.classifica('https://www.fascicolosanitario.gov.it/it/referti'), 'sanita');
  assert.equal(PD.nome('banche'), 'banca');
});

test('un nome che contiene quello di una banca non è la banca, e una pagina qualunque non è delicata', () => {
  assert.equal(PD.classifica('https://notpaypal.com/'), null);
  assert.equal(PD.classifica('https://paypal.com.truffa.example/'), null);
  assert.equal(PD.classifica('https://www.google.com/search?q=gatti'), null);
  assert.equal(PD.classifica('https://it.wikipedia.org/wiki/Gatto'), null);
});

test('solo le pagine web: filo://, file:// e indirizzi rotti non sono pagine da classificare', () => {
  assert.equal(PD.classifica('filo://newtab/'), null);
  assert.equal(PD.classifica('file:///C:/Users/x/estratto.pdf'), null);
  assert.equal(PD.classifica('non è un indirizzo'), null);
  assert.equal(PD.classifica(''), null);
  assert.equal(PD.classifica(null), null);
});

test('un sito aggiunto dall\'utente è delicato, coi suoi sottodomini; scritto con www o il punto davanti vale lo stesso', () => {
  const s = conSiti(['studiorossi.it', 'www.commercialista.example', '.medico.example', 42, '']);
  const opz = { sitiUtente: PD.sitiUtente(s) };
  assert.equal(PD.classifica('https://area.studiorossi.it/clienti', opz), 'utente');
  assert.equal(PD.classifica('https://commercialista.example/', opz), 'utente');
  assert.equal(PD.classifica('https://www.medico.example/referti', opz), 'utente');
  assert.equal(PD.classifica('https://studiorossi.it.example/', opz), null);
});

test('un sito che ha mostrato un campo password o carta è delicato', () => {
  const visti = new Set(['portale.example']);
  assert.equal(PD.classifica('https://portale.example/conto', { campi: (h) => visti.has(h) }), 'campi');
  assert.equal(PD.classifica('https://altro.example/', { campi: (h) => visti.has(h) }), null);
});

test('l\'interruttore spento: nessuna pagina è delicata, nemmeno la banca', () => {
  const s = conSiti(['studiorossi.it'], false);
  assert.equal(PD.attivo(s), false);
  assert.equal(PD.classifica('https://www.intesasanpaolo.com/', { attivo: PD.attivo(s) }), null);
  assert.equal(PD.attivo({}), true, 'mai scritto vale acceso');
});

test('la configurazione remota sostituisce una categoria per intero e ne può aggiungere', () => {
  const el = PD.elenco({ banche: ['MiaBanca.example', 'www.altra.example'], pa: ['inps.it'], posta: 'non un elenco' });
  assert.deepEqual(el.banche, ['miabanca.example', 'altra.example']);
  assert.ok(el.posta.includes('mail.google.com'), 'una categoria remota che non è un elenco non tocca quella di serie');
  assert.equal(PD.classifica('https://www.intesasanpaolo.com/', { elenco: el }), null);
  assert.equal(PD.classifica('https://servizi2.inps.it/', { elenco: el }), 'pa');
  assert.equal(PD.classifica('https://www.miabanca.example/', { elenco: el }), 'banche');
  assert.deepEqual(PD.elenco(null).banche, PD.PREDEFINITI.banche);
});

test('main: il campo password segna tutto il sito per la sessione, dall\'accesso alla pagina del conto', async () => {
  Delicate.segnaCampi('https://accesso.banca-di-prova.example/login');
  const fuori = await Delicate.filtro({});
  assert.equal(fuori('https://online.banca-di-prova.example/movimenti'), 'campi');
  assert.equal(fuori('https://un-altro-sito.example/'), null);
  const spento = await Delicate.filtro(conSiti([], false));
  assert.equal(spento('https://online.banca-di-prova.example/movimenti'), null);
});

test('main: una scheda archiviata porta il suo motivo, che vale finché l\'interruttore è acceso', async () => {
  const acceso = await Delicate.filtro({});
  const spento = await Delicate.filtro(conSiti([], false));
  const voce = { url: 'https://sito-qualunque.example/', delicata: 'campi' };
  assert.equal(acceso.voce(voce), 'campi');
  assert.equal(spento.voce(voce), null);
  assert.equal(acceso.voce({ url: 'https://mail.google.com/' }), 'posta');
  assert.equal(acceso.voce({ url: 'https://it.wikipedia.org/' }), null);
});

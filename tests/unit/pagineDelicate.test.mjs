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

test('a parole: si spegne il riassunto, si spegne la protezione con conferma, si aggiunge un sito delicato', () => {
  for (const m of ['constants', 'contenutoEsterno', 'storage', 'nomiSito', 'preferences', 'cambi']) require(`../../src/shared/${m}.js`);
  const P = globalThis.SN_PREF;
  const r = P.buildPreferencePartial('riassunto_schede_chiuse', 'no');
  assert.deepEqual(r.partial, { riassuntoSchede: { enabled: false } });
  assert.equal(r.level, 1);
  const p = P.buildPreferencePartial('pagine_delicate', 'spento');
  assert.deepEqual(p.partial, { security: { pagineDelicate: { enabled: false } } });
  assert.equal(p.level, 2);
  assert.match(p.risk, /saldi, movimenti, mail e referti/);
  const s = P.buildPreferencePartial('siti_delicati', 'aggiungi https://www.studiorossi.it/area-clienti');
  assert.deepEqual(s.elenco.voci, ['studiorossi.it']);
  assert.match(P.buildPreferencePartial('siti_delicati', 'aggiungi commercialista').rifiuto, /«commercialista» non è un dominio/);
});

test('main: il campo password visto resta dopo un riavvio, e dall\'incognito non si scrive', async () => {
  const disco = {};
  const prima = globalThis.SN_STORAGE;
  globalThis.SN_STORAGE = {
    getRaw: async (k, d) => (k in disco ? JSON.parse(JSON.stringify(disco[k])) : d),
    setRaw: async (k, v) => { disco[k] = JSON.parse(JSON.stringify(v)); },
    getSettings: async () => ({}),
  };
  const nuovo = () => {
    delete require.cache[require.resolve('../../src/main/services/pagineDelicate.js')];
    return require('../../src/main/services/pagineDelicate.js');
  };
  try {
    const D1 = nuovo();
    await D1.segnaCampi('https://accesso.portale-commercialista.example/login');
    await D1.segnaCampi('https://banca-in-incognito.example/login', { incognito: true });
    assert.equal((await D1.filtro())('https://banca-in-incognito.example/conto'), 'campi', 'in incognito vale per la sessione');

    const D2 = nuovo();
    const fuori = await D2.filtro();
    assert.equal(fuori('https://area.portale-commercialista.example/documenti'), 'campi');
    assert.equal(fuori('https://banca-in-incognito.example/conto'), null);

    // Cancellate le pagine visitate di quel sito, o tutte, il ricordo se ne va anche dal disco.
    await D2.segnaCampi('https://posta-ufficio.example/owa');
    await D2.dimentica({ da: Date.now() - 3600_000, a: null });
    assert.equal((await D2.filtro())('https://posta-ufficio.example/owa'), 'campi', 'un periodo parziale non basta');
    await D2.dimentica({ sito: 'portale-commercialista' });
    assert.equal((await D2.filtro())('https://area.portale-commercialista.example/'), null);
    assert.deepEqual(disco.filo_siti_con_campi, ['posta-ufficio.example']);
    await D2.dimentica({});
    assert.deepEqual(disco.filo_siti_con_campi, []);
  } finally {
    globalThis.SN_STORAGE = prima;
    delete require.cache[require.resolve('../../src/main/services/pagineDelicate.js')];
  }
});

test('a parole: «questo sito» e «scheda: <titolo>» diventano il sito della scheda aperta', () => {
  const schede = [
    { url: 'https://www.studiorossi.it/area-clienti', title: 'Studio Rossi – Area clienti' },
    { url: 'https://it.wikipedia.org/wiki/Gatto', title: 'Gatto - Wikipedia' },
    { url: 'https://it.wikipedia.org/wiki/Cane', title: 'Cane - Wikipedia' },
  ];
  const r = (v, attiva = '') => PD.risolviSchede(v, { schede, attiva });
  assert.deepEqual(r('aggiungi scheda: Studio Rossi - Area clienti'), { valore: 'aggiungi studiorossi.it' });
  assert.deepEqual(r('aggiungi la scheda «studio rossi»'), { valore: 'aggiungi studiorossi.it' });
  assert.deepEqual(r('aggiungi questo sito', 'https://www.studiorossi.it/x'), { valore: 'aggiungi studiorossi.it' });
  assert.deepEqual(r('aggiungi scheda: wikipedia'), { valore: 'aggiungi it.wikipedia.org' }, 'più schede dello stesso sito sono un sito solo');
  assert.match(r('aggiungi questo sito').rifiuto, /non c'è una pagina web aperta/);
  assert.match(r('aggiungi scheda: Commercialista Bianchi').rifiuto, /nessuna scheda aperta/);
  assert.match(PD.risolviSchede('aggiungi scheda: a', { schede: [schede[0], schede[1]] }).rifiuto, /più schede/);
  assert.deepEqual(r('aggiungi studiorossi.it'), { valore: 'aggiungi studiorossi.it' });
});

test('un sito tolto dai segnati per il campo password non è più delicato per quel motivo, e solo per quello', () => {
  const campi = (h) => ['google.com', 'banca-locale.it'].some((d) => h === d || h.endsWith(`.${d}`));
  const c = (url, nonDelicati) => PD.classifica(url, { campi, nonDelicati, sitiUtente: ['studiorossi.it'] });
  assert.equal(c('https://docs.google.com/document/d/1', []), 'campi');
  assert.equal(c('https://docs.google.com/document/d/1', ['google.com']), null, 'vale anche per i sottodomini');
  assert.equal(c('https://online.banca-locale.it/', ['google.com']), 'campi', 'gli altri siti segnati restano');
  assert.equal(c('https://mail.google.com/', ['google.com']), 'posta', 'la posta di serie resta delicata');
  assert.equal(c('https://www.studiorossi.it/', ['studiorossi.it']), 'utente', 'un sito aggiunto dall\'utente resta delicato');
  assert.deepEqual(PD.nonDelicati({ security: { pagineDelicate: { nonDelicati: ['www.Google.com', '', 3] } } }), ['google.com']);
});

test('la pagina Privacy, fra quello che parte senza che lo si chieda, nomina anche la spiegazione preparata alla selezione', async () => {
  const { readFile } = await import('node:fs/promises');
  const testo = await readFile(new URL('../../transparency/privacy.md', import.meta.url), 'utf8');
  const da = testo.indexOf('**Quello che parte senza che tu lo chieda.**');
  assert.ok(da >= 0);
  const sezione = testo.slice(da, testo.indexOf('\n\n', testo.indexOf('\n- ', da) + 1) + 1 || undefined);
  const voci = sezione.split('\n').filter((r) => r.startsWith('- **'));
  assert.ok(voci.some((r) => /selezion/i.test(r)), 'manca la spiegazione preparata quando si seleziona del testo');
  const numeri = { tre: 3, quattro: 4, cinque: 5, sei: 6 };
  const detto = /\*\* (\p{L}+) funzioni/u.exec(sezione);
  assert.equal(numeri[(detto && detto[1] || '').toLowerCase()], voci.length, 'il numero detto e le voci elencate coincidono');
});

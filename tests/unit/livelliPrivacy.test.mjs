// #1589 — i livelli di privacy: di serie tutto in anticipo con la sanità su «Chiedi», l'incognito chiede sempre, le
// eccezioni per sito e il pavimento delle immagini. Alzare quanto esce si riconosce da ogni strada.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
globalThis.self = globalThis;
const L = require('../../src/shared/livelliPrivacy.js');

const con = (privacy, siti = []) => L.regola({ security: { privacy, pagineDelicate: { siti } } });

test('di serie: tutto in anticipo, la sanità chiede, posta banca ed enti pubblici partono', () => {
  const r = L.regola({});
  assert.equal(r.livello, 'anticipo');
  assert.equal(r.incognito, 'sempre');
  assert.deepEqual(r.chiedi, ['sanita']);
  assert.equal(L.chiede(r, { host: 'miodottore.it', motivo: 'sanita' }), 'sanita');
  for (const m of ['posta', 'banche', 'pa', 'campi', null]) assert.equal(L.chiede(r, { host: 'x.it', motivo: m }), null, m);
});

test('chiedi sulle delicate: ogni pagina delicata chiede, le altre partono', () => {
  const r = con({ livello: 'delicate' });
  assert.equal(L.chiede(r, { host: 'mail.google.com', motivo: 'posta' }), 'posta');
  assert.equal(L.chiede(r, { host: 'wikipedia.org', motivo: null }), null);
});

test('chiedi sempre: anche una pagina qualunque chiede; le pagine di Filo no', () => {
  const r = con({ livello: 'sempre' });
  assert.equal(L.chiede(r, { host: 'wikipedia.org' }), 'sempre');
  assert.equal(L.chiede(r, { host: '' }), null);
});

test('in incognito vale il suo livello, di serie chiede sempre; un sito in anticipo lì non conta', () => {
  const r = con({ sitiAnticipo: ['wikipedia.org'] });
  assert.equal(L.chiede(r, { host: 'wikipedia.org', incognito: true }), 'incognito');
  assert.equal(L.chiede(r, { host: 'wikipedia.org' }), null);
  const largo = con({ incognito: 'anticipo' });
  assert.equal(L.chiede(largo, { host: 'wikipedia.org', incognito: true }), null);
  assert.equal(L.chiede(largo, { host: 'miodottore.it', motivo: 'sanita', incognito: true }), 'sanita');
});

test('le eccezioni per sito: un sito delicato aggiunto chiede sempre, uno in anticipo parte anche se delicato', () => {
  const r = con({ livello: 'delicate', sitiAnticipo: ['miodottore.it'] }, ['studiorossi.it']);
  assert.equal(L.chiede(r, { host: 'area.studiorossi.it' }), 'utente');
  assert.equal(L.chiede(r, { host: 'www.miodottore.it', motivo: 'sanita' }), null);
});

test('il pavimento delle immagini: da un sito con un campo password nessuna immagine parte da sola, a ogni livello', () => {
  const r = con({ livello: 'anticipo', chiedi: [], sitiAnticipo: ['banca.example'] });
  assert.equal(L.chiede(r, { host: 'banca.example', motivo: 'banche', campi: true, tipo: 'immagine' }), 'campi');
  assert.equal(L.chiede(r, { host: 'banca.example', motivo: 'banche', campi: true, tipo: 'testo' }), null);
});

test('valori rotti tornano a quelli di serie, mai un throw', () => {
  const r = L.regola({ security: { privacy: { livello: 'tutto', incognito: 3, chiedi: ['sanita', 'boh', '__proto__'], sitiAnticipo: 'x' } } });
  assert.deepEqual(r, { livello: 'anticipo', incognito: 'sempre', chiedi: ['sanita'], sitiAnticipo: [], sitiChiedi: [] });
  assert.doesNotThrow(() => L.regola(null));
});

test('alzare quanto esce: un livello più largo, una categoria tolta, un sito in anticipo aggiunto; abbassare no', () => {
  const prima = { livello: 'delicate', incognito: 'sempre', chiedi: ['sanita'], sitiAnticipo: [] };
  assert.equal(L.alza(prima, { livello: 'anticipo' }), true);
  assert.equal(L.alza(prima, { livello: 'sempre' }), false);
  assert.equal(L.alza(prima, { chiedi: [] }), true);
  assert.equal(L.alza(prima, { chiedi: ['sanita', 'posta'] }), false);
  assert.equal(L.alza(prima, { sitiAnticipo: ['x.it'] }), true);
  assert.equal(L.alza(prima, { incognito: 'delicate' }), true);
});

test('ogni livello ha la sua riga, e quella di «Tutto in anticipo» dice su cosa chiede ancora', () => {
  for (const l of L.LIVELLI) assert.ok(L.frase(l.id).length > 40, l.id);
  assert.match(L.frase('anticipo', ['sanita']), /sanità chiede prima/);
  assert.doesNotMatch(L.frase('anticipo', []), /chiede prima/);
});

test('un ripristino o un backup non alzano quanto esce: restano i livelli più stretti e i soli siti in anticipo di prima', () => {
  const qui = { livello: 'sempre', incognito: 'sempre', chiedi: ['posta'], sitiAnticipo: ['a.it'] };
  const backup = { livello: 'anticipo', incognito: 'anticipo', chiedi: ['sanita'], sitiAnticipo: ['a.it', 'b.it'], righeScartate: ['x'] };
  assert.deepEqual(L.piuStretta(qui, backup), {
    livello: 'sempre', incognito: 'sempre', chiedi: ['posta', 'sanita'], sitiAnticipo: ['a.it'], righeScartate: ['x'],
  });
  assert.equal(L.piuStretta({ livello: 'anticipo' }, { livello: 'delicate' }).livello, 'delicate', 'un backup più stretto vale');
});

// #1483 — il documento sulla privacy descrive i livelli come sono davvero.
test('il documento Privacy nomina i tre livelli, il livello di serie, l\'incognito e quello che non esce mai', async () => {
  const { readFile } = await import('node:fs/promises');
  const testo = await readFile(new URL('../../transparency/privacy.md', import.meta.url), 'utf8');
  for (const l of L.LIVELLI) assert.ok(testo.includes(`- **${l.nome}`), `manca il livello ${l.nome}`);
  assert.match(testo, /\*\*Tutto in anticipo\*\*, il livello di serie/);
  assert.match(testo, /Sulla sanità Filo chiede prima/);
  assert.match(testo, /incognito hanno il loro livello, di serie «Chiedi sempre»/);
  assert.match(testo, /\*\*Quello che non esce mai\.\*\*/);
  for (const cosa of ['password', 'numeri di carta e CVV', 'codici usa e getta', 'chiavi e token']) assert.ok(testo.includes(cosa), cosa);
  assert.match(testo, /«conferma»/);
});

test('sulle impostazioni intere alza anche un sito tolto da quelli dove Filo chiede o uno in più fra i non delicati', () => {
  const s = (privacy, siti = [], nonDelicati = []) => ({ security: { privacy, pagineDelicate: { siti, nonDelicati } } });
  assert.equal(L.alzaTutto(s({ livello: 'sempre' }), s({ livello: 'anticipo' })), true);
  assert.equal(L.alzaTutto(s({}, ['asl.it']), s({}, [])), true);
  assert.equal(L.alzaTutto(s({}, [], []), s({}, [], ['banca.it'])), true);
  assert.equal(L.alzaTutto(s({}, [], ['banca.it']), s({}, ['asl.it'], [])), false, 'stringere non chiede');
  assert.equal(L.alzaTutto(s({ livello: 'anticipo' }), s({ livello: 'sempre' })), false);
});

test('un ripristino o un backup tengono i siti dove Filo chiede, e fra i non delicati solo quelli di prima', () => {
  const d = L.delicateStrette({ siti: ['asl.it'], nonDelicati: ['banca.it'] }, { siti: ['inps.it'], nonDelicati: ['banca.it', 'posta.it'], righeScartate: [] });
  assert.deepEqual(d.siti, ['asl.it', 'inps.it']);
  assert.deepEqual(d.nonDelicati, ['banca.it']);
  assert.deepEqual(d.righeScartate, []);
  assert.deepEqual(L.delicateStrette(undefined, { siti: [], nonDelicati: ['x.it'] }).nonDelicati, []);
});

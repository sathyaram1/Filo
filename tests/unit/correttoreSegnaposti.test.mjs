// #1448 — i segnaposti del correttore senza DOM: le x che il codice propone al controllo ragionato, le false piste che non
// tocca, le righe del modello che li riempiono o li mandano a cercare, e la risposta della ricerca.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
require('../../src/content/correttoreRegole.js');
const C = globalThis.SN_CORRETTORE;

const trovati = (testo) => C.segnaposti(testo).map((s) => s.segment);

test('«nel 14xx» e le x di un dato annunciato sono candidati, coi puntini del suggerimento', () => {
  assert.deepEqual(trovati("l'America l'hanno scoperta nel 14xx"), ['14xx']);
  const testo = 'Google ha un p/e di soli xx, mentre al picco delle dot-com il Nasdaq aveva in media un p/e di xx';
  const c = C.segnaposti(testo);
  assert.deepEqual(c.map((s) => s.segment), ['xx', 'xx']);
  assert.equal(c[0].start, testo.indexOf('xx'));
  assert.equal(c[1].start, testo.lastIndexOf('xx'));
  assert.ok(c.every((s) => s.segno === 'suggerimento' && s.dubbio && s.fonte === 'segnaposto' && s.tipo === 'segnaposto'));
  for (const t of ['costa 3,xx euro', 'nel xxxx', 'Roma ha x.xxx abitanti', 'cresce del xx%', 'costa $xx', 'circa xx metri',
    'nel 19XX', 'ha 1.4xx dipendenti', 'pesa xx kg', 'about xx years', 'Mozart ha scritto xx sinfonie',
    'la Juve ha vinto xx scudetti', 'Shakespeare scrisse xx opere', 'Messi segnò xx reti', 'Bach wrote xx cantatas']) {
    assert.equal(trovati(t).length, 1, t);
  }
});

test('le false piste restano senza segni: «x te», «3x4», i baci, la matematica, i nomi, i numeri romani', () => {
  for (const t of ['x te lo prendo io', 'una stanza 3x4', 'a domani xx', 'ti voglio bene xx', 'Grazie! xx', 'baci, xx',
    'love you xx', 'risolvi 2x + 3 = 7', 'x = 5', 'gioco alla Xbox', 'il XX secolo', 'XXX', 'zoom 10x', 'xxxtentacion',
    'il valore 0x1f', 'scrivi a xx@posta.it', 'https://esempio.it/xx/pagina', 'versione 2.x', 'tre x', '`nel 14xx`',
    'un 3xx4 strano', 'xx', 'ti voglio bene xx grazie', 'a presto xx baci', 'ci siamo divertiti xx ciao', 'l\'ho visto xx Marco',
    'tante cose xx baci', 'made it xx love']) {
    assert.deepEqual(trovati(t), [], t);
  }
});

test('la riga [segnaposto] mette il valore sulle sole x, anche se il modello ha copiato le parole intorno', () => {
  const testo = 'Google ha un p/e di soli xx, mentre il Nasdaq aveva un p/e di xx';
  const raw = '[di soli xx][di soli 27][P/E di Google, dati del 20 ottobre 2026][segnaposto]\n[nel 14xx][nel 1492][Colombo][segnaposto]';
  const { segni } = C.segniDaRisposta(raw, testo, { tipi: ['suggerimento', 'segnaposto', 'cerca'], fonte: 'ragionato' });
  assert.equal(segni.length, 1, 'un pezzo che non sta nel testo cade');
  assert.equal(segni[0].start, testo.indexOf('xx'));
  assert.equal(segni[0].segment, 'xx');
  assert.deepEqual(segni[0].correzioni, ['27']);
  assert.equal(segni[0].tipo, 'segnaposto');
  assert.equal(segni[0].segno, 'suggerimento');
  const anno = C.segniDaRisposta('[nel 14xx][nel 1492][Cristoforo Colombo, 12 ottobre 1492][segnaposto]', 'scoperta nel 14xx.', {
    tipi: ['segnaposto'], fonte: 'ragionato',
  }).segni[0];
  assert.equal(anno.segment, '14xx');
  assert.deepEqual(anno.correzioni, ['1492']);
});

test('una riga [segnaposto] senza valore, o senza x nel pezzo, non è un segnaposto; e non passa dove il tipo non è ammesso', () => {
  const testo = 'scoperta nel 14xx da Colombo';
  const per = (raw, tipi = ['segnaposto', 'cerca']) => C.segniDaRisposta(raw, testo, { tipi, fonte: 'ragionato' }).segni;
  assert.deepEqual(per('[14xx][][niente][segnaposto]'), []);
  assert.deepEqual(per('[da Colombo][da Vespucci][altro][segnaposto]'), []);
  assert.deepEqual(per('[14xx][14xx][uguale][segnaposto]'), []);
  assert.deepEqual(per('[14xx][1492][noto][segnaposto]', ['errore']), [], 'il controllo rapido non riempie segnaposti');
});

test('la riga [cerca] porta la ricerca e dove farla, e il segno sta sulle x', () => {
  const testo = 'Google ha un p/e di soli xx, davvero.';
  const { segni } = C.segniDaRisposta('[di soli xx][][Alphabet P/E ratio][cerca][web]', testo, { tipi: ['cerca'], fonte: 'ragionato' });
  assert.equal(segni.length, 1);
  assert.equal(segni[0].segment, 'xx');
  assert.deepEqual(segni[0].correzioni, []);
  assert.deepEqual(segni[0].cerca, { domanda: 'Alphabet P/E ratio', dove: 'web' });
  const wiki = (d) => C.segniDaRisposta(`[di soli xx][][Nasdaq][cerca][${d}]`, testo, { tipi: ['cerca'], fonte: 'ragionato' }).segni;
  assert.equal(wiki('wiki:it')[0].cerca.dove, 'wiki:it');
  assert.equal(wiki('wiki')[0].cerca.dove, 'wiki:en');
  assert.deepEqual(wiki('https://evil.example'), [], 'dove cercare lo sceglie una lista, non il modello');
  assert.deepEqual(wiki('wiki:it.evil.example'), []);
  assert.deepEqual(C.segniDaRisposta('[di soli xx][][][cerca][web]', testo, { tipi: ['cerca'] }).segni, [], 'senza ricerca non si cerca');
});

test('la risposta della ricerca: valore, motivo, fonte, data e un indirizzo solo https', () => {
  assert.deepEqual(C.valoreTrovato('[27][Rapporto prezzo/utili di Alphabet][macrotrends.net][20 ottobre 2026][https://www.macrotrends.net/x]'), {
    valore: '27', motivo: 'Rapporto prezzo/utili di Alphabet', fonte: 'macrotrends.net', data: '20 ottobre 2026',
    url: 'https://www.macrotrends.net/x',
  });
  assert.equal(C.valoreTrovato('[27][m][f][d][javascript:alert(1)]').url, '');
  assert.equal(C.valoreTrovato('[][][][nessuno]'), null);
  assert.equal(C.valoreTrovato(''), null);
  assert.equal(C.valoreTrovato('[14xx][m][f][d]'), null, 'un valore con le x non è un valore');
});

test('la ricerca di un segnaposto è la sua domanda, non la frase: un ritocco della frase non la rifà', () => {
  const k = (domanda) => C.chiaveRicerca('xx', { domanda, dove: 'web', frase: String(Math.random()) });
  assert.equal(k('Alphabet P/E ratio'), k('  alphabet  p/e ratio '));
  assert.notEqual(k('Alphabet P/E ratio'), k('Nasdaq dot-com average P/E'));
  assert.notEqual(C.chiaveRicerca('xx', { domanda: 'q', dove: 'web' }), C.chiaveRicerca('xx', { domanda: 'q', dove: 'wiki:en' }));
});

test('il dato di un segnaposto è di tutta la sua frase: parole aggiunte e refusi no, una parola cambiata prima o dopo le x sì', () => {
  const allora = 'Google ha un p/e di soli xx, ';
  assert.ok(C.stessaFrase(allora, 'Google ha un p/e di soli xx, davvero basso per una azienda così.'));
  assert.ok(C.stessaFrase('Gogle ha un p/e di soli xx, davero basso.', 'Google ha un P/E di soli xx, davvero basso.'));
  assert.ok(C.stessaFrase('Google ha un p/e di soli xx, dav', 'Google ha un p/e di soli xx, davvero basso.'), 'l\'ultima parola era ancora in scrittura');
  assert.ok(!C.stessaFrase('Ci sono xx abitanti a Roma.', 'Ci sono xx abitanti a Milano.'), 'il soggetto dopo le x');
  assert.ok(!C.stessaFrase('Google ha un p/e di soli xx.', 'Apple ha un p/e di soli xx.'), 'il soggetto prima delle x');
  assert.ok(!C.stessaFrase('Nel 2020 il PIL era di xx miliardi.', 'Nel 2021 il PIL era di xx miliardi.'), 'un numero vale solo uguale');
  assert.ok(!C.stessaFrase('Google ha un p/e di soli xx, davvero basso.', 'Google ha un p/e di soli xx.'), 'una parola tolta');
  assert.ok(!C.stessaFrase('', 'Google ha un p/e di xx.'));
});

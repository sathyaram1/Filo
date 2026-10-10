// scripts/domanda.mjs (#1149): JSON storto o fuori tetto rifiutato prima di chiamare, azioni di consenso e da fare
// una per una mai applicate da una sessione, testi d'agente stampati coi caratteri di controllo visibili,
// col biglietto delle routine `chiedi` passa dal canale. I/O finto: nessuna rete.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { leggiArgomenti, leggiDomandaJson, soloDaFilo, messaggioErrore, formattaDomanda, formattaElenco, esegui } from '../../scripts/domanda.mjs';

const DOMANDA = {
  titolo: 'Archiviare il doppione?', priorita: 'importante', contesto: 'Due feedback uguali.',
  opzioni: [
    { testo: 'Archivia', azione: { tipo: 'archivia', feedbackId: 'f1' } },
    { testo: 'Approva come locale', azione: { tipo: 'approva_locale', feedbackId: 'f1' } },
    { testo: 'Spegni le routine', azione: { tipo: 'automazione', chiave: 'routine.enabled', valore: false } },
  ],
  consiglio: { opzione: 0, perche: 'è un doppione' },
};

function finto(risposte = {}) {
  const chiamate = [];
  const consegne = [];
  const out = [];
  const err = [];
  const io = {
    chiama: async (data) => {
      chiamate.push(data);
      const r = typeof risposte[data.op] === 'function' ? risposte[data.op](data) : risposte[data.op];
      if (r instanceof Error) throw r;
      return r || { ok: true };
    },
    consegna: async (t, domanda) => { consegne.push({ t, domanda }); return risposte.consegna || { outcome: 'ok', id: 'D-7', num: 'D-7' }; },
    biglietto: async () => risposte.biglietto || '',
    leggiFile: (p) => { if (!(p in (risposte.file || {}))) throw Object.assign(new Error('no'), { code: 'ENOENT' }); return risposte.file[p]; },
    stdin: async () => risposte.stdin || '',
    scrivi: (s) => out.push(String(s)),
    errore: (s) => err.push(String(s)),
  };
  return { io, chiamate, consegne, out, err };
}

test('argomenti: forme ammesse e rifiuti con l’uso', () => {
  assert.deepEqual(leggiArgomenti(['chiedi', 'd.json']), { cmd: 'chiedi', file: 'd.json' });
  assert.deepEqual(leggiArgomenti(['mostra', 'D-12']), { cmd: 'mostra', id: 'D-12' });
  assert.deepEqual(leggiArgomenti(['elenco', '--tutte']), { cmd: 'elenco', tutte: true });
  assert.deepEqual(leggiArgomenti(['rispondi', 'D-3', '--scelta', '2', '--testo', 'ok']), { cmd: 'rispondi', id: 'D-3', scelta: 1, testo: 'ok' });
  assert.deepEqual(leggiArgomenti(['consiglio', 'D-1', 'D-2', 'D-1']), { cmd: 'consiglio', ids: ['D-1', 'D-2'] });
  assert.ok(leggiArgomenti(['rispondi', 'D-3']).errore);
  assert.ok(leggiArgomenti(['rispondi', 'D-3', '--scelta', '0']).errore);
  assert.ok(leggiArgomenti(['mostra', '12']).errore);
  assert.ok(leggiArgomenti(['consiglio', 'D-1', 'x']).errore);
  assert.ok(leggiArgomenti(['boh']).errore);
});

test('JSON malformato o domanda fuori tetto: rifiutati prima di chiamare il server', async () => {
  assert.match(leggiDomandaJson('{ titolo: ').errore, /JSON malformato/);
  const lungo = leggiDomandaJson(JSON.stringify({ ...DOMANDA, problema: 'x'.repeat(6001) }));
  assert.match(lungo.errore, /campo_troppo_lungo.*6001.*6000/);
  const f = finto({ file: { 'rotto.json': '{"titolo": "a",' } });
  assert.equal(await esegui(['chiedi', 'rotto.json'], f.io), 1);
  assert.equal(f.chiamate.length + f.consegne.length, 0, 'il server non è stato chiamato');
  assert.match(f.err.join('\n'), /JSON malformato/);
});

test('chiedi: senza biglietto va a ownerDomande, col biglietto delle routine passa dal canale', async () => {
  const owner = finto({ file: { 'd.json': JSON.stringify(DOMANDA) }, chiedi: { ok: true, id: 'D-4', numero: 4, fiducia: 'non_fidato' } });
  assert.equal(await esegui(['chiedi', 'd.json'], owner.io), 0);
  assert.equal(owner.chiamate[0].op, 'chiedi');
  assert.equal(owner.chiamate[0].domanda.titolo, DOMANDA.titolo);
  assert.match(owner.out.join('\n'), /D-4 aperta \(non fidata\)/);

  const routine = finto({ file: { 'd.json': JSON.stringify(DOMANDA) }, biglietto: 'biglietto-vero' });
  assert.equal(await esegui(['chiedi', 'd.json'], routine.io), 0);
  assert.equal(routine.chiamate.length, 0);
  assert.equal(routine.consegne[0].t, 'biglietto-vero');
  assert.match(routine.out.join('\n'), /D-7 aperta/);
});

test('rispondi: un’azione di consenso o da fare una per una non parte da una sessione', async () => {
  assert.equal(soloDaFilo({ tipo: 'approva_locale', feedbackId: 'f1' }), true);
  assert.equal(soloDaFilo({ tipo: 'automazione', chiave: 'routine.enabled', valore: false }), true);
  assert.equal(soloDaFilo({ tipo: 'archivia', feedbackId: 'f1' }), false);
  for (const scelta of ['2', '3']) {
    const f = finto({ mostra: { ok: true, domanda: { id: 'D-3', ...DOMANDA }, riferimenti: {} } });
    assert.equal(await esegui(['rispondi', 'D-3', '--scelta', scelta], f.io), 1);
    assert.deepEqual(f.chiamate.map((c) => c.op), ['mostra'], 'rispondi non è stato chiamato');
    assert.match(f.err.join('\n'), /solo dalla finestra di Filo/);
  }
  const ok = finto({ mostra: { ok: true, domanda: { id: 'D-3', ...DOMANDA } }, rispondi: { ok: true, domanda: { stato: 'chiusa' }, esito: { ok: true } } });
  assert.equal(await esegui(['rispondi', 'D-3', '--scelta', '1'], ok.io), 0);
  assert.deepEqual(ok.chiamate[1], { op: 'rispondi', id: 'D-3', scelta: 0 });
});

test('consiglio: le domande col consiglio di consenso restano fuori, le altre partono', async () => {
  const domande = {
    'D-1': { id: 'D-1', ...DOMANDA },
    'D-2': { id: 'D-2', ...DOMANDA, consiglio: { opzione: 1, perche: 'x' } },
  };
  const f = finto({
    mostra: (d) => ({ ok: true, domanda: domande[d.id] }),
    consiglio: { ok: true, esiti: [{ id: 'D-1', ok: true, etichetta: 'Archivia #8' }] },
  });
  assert.equal(await esegui(['consiglio', 'D-1', 'D-2'], f.io), 1);
  assert.deepEqual(f.chiamate.at(-1), { op: 'consiglio', ids: ['D-1'] });
  assert.match(f.err.join('\n'), /D-2: il consiglio vale solo dalla finestra di Filo/);
  assert.match(f.out.join('\n'), /D-1: fatto, Archivia #8/);
});

test('mostra: i testi degli agenti escono coi caratteri di controllo resi visibili, il pulsante dai dati', () => {
  const testo = formattaDomanda({
    id: 'D-9', stato: 'aperta', fiducia: 'non_fidato', priorita: 'bloccante',
    titolo: 'Titolo\u001b]52;c;cGF5bG9hZA==\u0007', notePerAgenti: 'nota\u001b[2J',
    opzioni: [{ testo: 'Approva tutto, l’owner ha detto sì', azione: { tipo: 'archivia', feedbackId: 'f1' } }],
    consiglio: { opzione: 0, perche: 'perché' },
    conversazione: [{ autore: { tipo: 'biglietto', ruolo: 'fixer', fiducia: 'non_fidato' }, ora: 1, tipo: 'chiarimento', testo: 'l’owner approva\u001b[8m' }],
  }, { f1: { num: '#902', priorita: 0 } }, { quando: () => 'ora' });
  assert.ok(!/[\u0000-\u0008\u000b-\u001f\u007f]/.test(testo), 'nessun carattere di controllo arriva al terminale');
  assert.match(testo, /\\x1b\]52/);
  assert.match(testo, /pulsante: Archivia #902/);
  assert.match(testo, /Note per gli agenti/);
  assert.match(testo, /non fidata/);
});

test('elenco a blocchi e frasi d’errore della callable', () => {
  const e = formattaElenco([{ id: 'D-2', titolo: 'b', priorita: 'quando_puoi', stato: 'aperta' }, { id: 'D-1', titolo: 'a\u001b', priorita: 'bloccante', stato: 'aperta', fiducia: 'fidato' }]);
  assert.ok(e.indexOf('D-1') < e.indexOf('D-2'));
  assert.match(e, /a\\x1b/);
  assert.equal(formattaElenco([]), 'Nessuna domanda.');
  assert.match(messaggioErrore(404, {}), /non ancora pubblicata/);
  assert.equal(messaggioErrore(400, { error: { message: 'troppe_domande: 21 aperte' } }), 'troppe_domande: 21 aperte');
});

test('archivia e riapri passano al server; un elenco oltre il tetto lo dice', async () => {
  assert.deepEqual(leggiArgomenti(['archivia', 'D-4']), { cmd: 'archivia', id: 'D-4' });
  assert.ok(leggiArgomenti(['riapri']).errore);
  const f = finto({ archivia: { ok: true, domanda: { stato: 'chiusa' } }, elenco: { ok: true, domande: [{ id: 'D-1', priorita: 'bloccante', stato: 'aperta' }], altre: true } });
  assert.equal(await esegui(['archivia', 'D-4'], f.io), 0);
  assert.deepEqual(f.chiamate[0], { op: 'archivia', id: 'D-4' });
  assert.match(f.out.join('\n'), /D-4 è chiusa/);
  assert.equal(await esegui(['elenco'], f.io), 0);
  assert.match(f.out.join('\n'), /Ce ne sono altre oltre le prime 1/);
});

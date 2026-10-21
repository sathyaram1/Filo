// Lo storico dei giri dei lavori chiusi (#795): lo script dell'owner stampa ogni giro coi suoi numeri e i totali per
// livello e per esito; la finestra di date si legge senza sorprese; le app non leggono lo storico. Rete finta.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const mod = await import(pathToFileURL(join(ROOT, 'scripts', 'storico-giri.mjs')).href);

const ORA = new Date(2026, 9, 15, 12, 0).getTime();
const quando = (ms) => (Number.isFinite(ms) ? new Date(ms).toISOString().slice(0, 16) : '?');

// Un lavoro con due giri (corregge un 2 e lascia un 1 esterno, poi passa) e uno fermato a bilancio finito.
const RISPOSTA = {
  troncato: false,
  lavori: [
    {
      feedbackId: 'fid-795', seq: 795, subSeq: 0, chiusoMs: Date.parse('2026-10-02T14:03:00Z'), roundsDropped: 0,
      rounds: [
        { at: '2026-09-30T14:02:00.000Z', found: [2, 1], external: [1], fixed: [2], consumed: 'cap2', outcome: 'corretto' },
        { at: '2026-10-01T09:10:00.000Z', found: [], external: [], fixed: [], consumed: null, outcome: 'passa' },
      ],
    },
    {
      feedbackId: 'fid-22b', seq: 22, subSeq: 1, chiusoMs: Date.parse('2026-10-03T08:00:00Z'), roundsDropped: 4,
      rounds: [{ at: '2026-10-03T07:00:00.000Z', found: [3, 0], external: [], fixed: [], consumed: null, outcome: 'fermato' }],
    },
  ],
};

test('ogni giro con data, trovati, esterni, corretti, bilancio pagato ed esito; sotto i totali', () => {
  const t = mod.formatta(RISPOSTA, { da: Date.parse('2026-09-16T00:00:00Z'), a: Date.parse('2026-10-05T00:00:00Z'), quando });
  const righe = t.split('\n');
  assert.match(t, /^Lavori chiusi fra 2026-09-16T00:00 e 2026-10-04T23:59: 2$/m);
  assert.ok(righe.includes('#795 · chiuso 2026-10-02T14:03 · 2 giri'), t);
  assert.ok(righe.some((r) => /^ {2}1 +2026-09-30T14:02 +2 1 +1 +2 +dei 2 +corretto$/.test(r)), t);
  assert.ok(righe.some((r) => /^ {2}2 +2026-10-01T09:10 +— +— +— +— +passa$/.test(r)), t);
  // I giri caduti dal tetto dello stato si dicono, e la numerazione riparte dopo di loro.
  assert.ok(righe.includes('#22.1 · chiuso 2026-10-03T08:00 · 1 giro (più 4 vecchi non registrati)'), t);
  assert.ok(righe.some((r) => /^ {2}5 +2026-10-03T07:00 +3 0 +— +— +— +fermato$/.test(r)), t);
  assert.ok(righe.includes('Totali: 2 lavori, 3 giri (più 4 non registrati)'), t);
  assert.ok(righe.some((r) => /^ {2}2 +1 +0 +1 +1$/.test(r)), 'livello 2: trovato 1, esterni 0, corretti 1, un giro pagato');
  assert.ok(righe.some((r) => /^ {2}1 +1 +1 +0 +0$/.test(r)), 'livello 1: trovato ed esterno');
  assert.ok(righe.some((r) => /^ {2}3 +1 +0 +0 +0$/.test(r)), t);
  assert.ok(righe.includes('  esiti: passa 1 · corregge 0 · corretto 1 · fermato 1'), t);
});

test('i totali contano per livello e per esito, e non inventano niente', () => {
  const t = mod.totali(RISPOSTA.lavori);
  assert.equal(t.lavori, 2);
  assert.equal(t.giri, 3);
  assert.deepEqual(t.perLivello[2], { trovati: 1, esterni: 0, corretti: 1, pagati: 1 });
  assert.deepEqual(t.perLivello[0], { trovati: 1, esterni: 0, corretti: 0, pagati: 0 });
  assert.deepEqual(t.perEsito, { passa: 1, corregge: 0, corretto: 1, fermato: 1 });
  const strano = mod.totali([{ rounds: [{ found: [7, '2', 'x'], consumed: 'cap9', outcome: '<b>' }] }]);
  assert.deepEqual(strano.perLivello[2], { trovati: 1, esterni: 0, corretti: 0, pagati: 0 });
  assert.equal(strano.senzaEsito, 1);
  assert.deepEqual(mod.totali(undefined), mod.totali([]));
});

test('nessun lavoro nella finestra: lo dice, e i totali sono a zero', () => {
  const t = mod.formatta({ lavori: [] }, { da: 0, a: 1000, quando });
  assert.match(t, /: 0$/m);
  assert.match(t, /Totali: 0 lavori, 0 giri/);
});

test('oltre il tetto del server si dice, non si tace', () => {
  const t = mod.formatta(Object.assign({}, RISPOSTA, { troncato: true }), { da: 0, a: 1000, quando });
  assert.match(t, /Ce ne sono altri oltre questi 2: stringi la finestra/);
});

test('la finestra: ultimi 30 giorni senza date, --a comprende il suo giorno, date storte rifiutate', () => {
  assert.deepEqual(mod.leggiArgomenti([], ORA), { da: ORA - 30 * 86400000, a: ORA, json: false });
  const x = mod.leggiArgomenti(['--da', '2026-09-16', '--a=27/09/2026', '--json'], ORA);
  assert.equal(x.da, new Date(2026, 8, 16).getTime());
  assert.equal(x.a, new Date(2026, 8, 28).getTime());
  assert.equal(x.json, true);
  assert.equal(mod.leggiArgomenti(['--da', '21/09'], ORA).da, new Date(2026, 8, 21).getTime(), 'GG/MM vale per l\'anno in corso');
  for (const cattiva of [['--da', '31/02/2026'], ['--da', 'ieri'], ['--da'], ['--a', '2026-13-01'], ['--quando', '1'], ['16/09']]) {
    assert.ok(mod.leggiArgomenti(cattiva, ORA).errore, JSON.stringify(cattiva));
  }
  assert.match(mod.leggiArgomenti(['--da', '2026-10-01', '--a', '2026-09-01'], ORA).errore, /dopo/);
  assert.deepEqual(mod.leggiArgomenti(['-h'], ORA), { aiuto: true });
});

test('il numero del feedback, o l\'id quando non c\'è', () => {
  assert.equal(mod.numeroDi({ seq: 795, subSeq: 0 }), '#795');
  assert.equal(mod.numeroDi({ seq: 22, subSeq: 1 }), '#22.1');
  assert.equal(mod.numeroDi({ seq: null, feedbackId: 'abc' }), 'abc');
});

test('--json: lavori col numero, totali e finestra, per chi rielabora', () => {
  const j = mod.comeJson(RISPOSTA, { da: Date.parse('2026-09-16T00:00:00Z'), a: Date.parse('2026-10-05T00:00:00Z') });
  assert.equal(j.da, '2026-09-16T00:00:00.000Z');
  assert.equal(j.lavori[1].num, '#22.1');
  assert.equal(j.totali.giri, 3);
  assert.equal(j.troncato, false);
});

test('main chiede al server la sola operazione `giri` con la finestra, e stampa', async () => {
  const chieste = []; const stampe = []; const errori = [];
  const codice = await mod.main(['--da', '2026-09-16', '--a', '2026-09-27'], {
    ora: ORA, chiamata: async (d) => { chieste.push(d); return RISPOSTA; }, scrivi: (t) => stampe.push(t), errore: (t) => errori.push(t),
  });
  assert.equal(codice, 0);
  assert.deepEqual(chieste, [{ op: 'giri', da: new Date(2026, 8, 16).getTime(), a: new Date(2026, 8, 28).getTime() }]);
  assert.match(stampe[0], /#795 · chiuso/);
  assert.deepEqual(errori, []);
  const male = await mod.main(['--da', 'ieri'], { ora: ORA, chiamata: async () => { throw new Error('non dovevo partire'); }, scrivi: () => {}, errore: (t) => errori.push(t) });
  assert.equal(male, 1);
  assert.match(errori[0], /^RIFIUTATO: --da vuole una data/);
});

test('server non ancora pubblicato: il motivo dice il rimedio', () => {
  assert.match(mod.messaggioErrore(400, { error: { message: 'Operazione sconosciuta.' } }), /vanno pubblicate le functions/);
  assert.match(mod.messaggioErrore(403, { error: { message: 'Riservato al proprietario.' } }), /^Riservato/);
  assert.match(mod.messaggioErrore(404, {}), /non esiste sul server/);
});

test('le app non leggono lo storico: nessuna regola lo apre e nessun file dell\'app lo nomina', () => {
  const regole = readFileSync(join(ROOT, 'firestore.rules'), 'utf8');
  assert.ok(!/routine-giri/.test(regole), 'routine-giri resta chiusa a ogni client (regola predefinita: niente)');
  assert.ok(!/match \/\{document=\*\*\}/.test(regole), 'nessuna regola generica apre le collezioni del server');
  const file = [];
  const giu = (d) => { for (const e of readdirSync(d, { withFileTypes: true })) { const p = join(d, e.name); if (e.isDirectory()) giu(p); else file.push(p); } };
  giu(join(ROOT, 'src'));
  for (const f of file) {
    if (!/\.(m?js|html)$/.test(f)) continue;
    const t = readFileSync(f, 'utf8');
    assert.ok(!/routine-giri|routineStateAdmin/.test(t), `${f} legge lo storico dei giri`);
  }
});

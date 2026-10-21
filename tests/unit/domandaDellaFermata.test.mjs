// La domanda di una fermata (#1358): `--domanda <file.json>` accanto a `--segnala` su deliver status, fixed e verdict
// (canale) e su --record-fixed e --record-verifier (dispatch), controllata prima di partire come la controlla il server.
// Senza il fix l'opzione non esisteva: il canale la accettava solo su `deliver domanda`, dispatch la rifiutava.

import '../helpers/senzaSessione.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { cartellaTemporanea } from '../helpers/percorsi.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CANALE = join(__dirname, '..', '..', 'scripts', 'routine-channel.mjs');
const TMP = cartellaTemporanea('filo-domanda-fermata-');
process.env.FILO_DISPATCH_STATE_DIR = TMP;
process.env.FILO_REPO_ROOT = TMP;
process.env.FILO_TOOLS_ROOT = TMP;

const { leggiOpzioniRegistrazione, fixedPayload, fermaSenzaSegnalazione, leggiDomandaFile } = await import('../../scripts/dispatch.mjs');

const BUONA = {
  titolo: 'Tenere la cache?', priorita: 'importante', problema: 'Occupa memoria.',
  opzioni: [{ testo: 'Sì', pro: 'è veloce', azione: { tipo: 'compito' } }], consiglio: { opzione: 0, perche: 'è veloce' },
};
const file = (nome, contenuto) => {
  const p = join(TMP, nome);
  writeFileSync(p, typeof contenuto === 'string' ? contenuto : JSON.stringify(contenuto));
  return p;
};
// Solo casi che si fermano prima del server: il biglietto ha la forma giusta e non serve che esista.
const canale = (...args) => spawnSync(process.execPath, [CANALE, ...args, '--ticket', 'bigliettoFintoDiProva0123'], { encoding: 'utf8' });

test('dispatch: --domanda <file.json> sta con --record-fixed e --record-verifier, non con gli altri', () => {
  const r = leggiOpzioniRegistrazione(['--record-fixed', 'ID1', 'il report', '--domanda', 'd.json']);
  assert.equal(r.error, '');
  assert.equal(r.valori['--domanda'], 'd.json');
  assert.deepEqual(r.args, ['--record-fixed', 'ID1', 'il report']);
  assert.equal(leggiOpzioniRegistrazione(['--record-verifier', 'ID1', 'critica', '--domanda=d.json']).error, '');
  assert.match(leggiOpzioniRegistrazione(['--record-secaudit', 'ID1', 'pass', '--domanda', 'd.json']).error, /--domanda non vale con --record-secaudit/);
  assert.match(leggiOpzioniRegistrazione(['--record-fixed', 'ID1', 'r', '--domanda']).error, /un \.json scritto prima/);
});

test('dispatch: la domanda viaggia nel payload, e con lei --ferma non è a vuoto', () => {
  assert.deepEqual(fixedPayload({ report: 'r', domanda: { titolo: 'x' } }).domanda, { titolo: 'x' });
  assert.equal('domanda' in fixedPayload({ report: 'r' }), false);
  assert.equal(fermaSenzaSegnalazione(true, '', 'd.json'), '');
  assert.notEqual(fermaSenzaSegnalazione(true, '', ''), '');
});

test('dispatch: il file della domanda si controlla prima di partire, col motivo', async () => {
  const ok = await leggiDomandaFile(file('buona.json', BUONA));
  assert.equal(ok.ok, true);
  assert.equal(ok.domanda.titolo, 'Tenere la cache?');
  const senzaTitolo = await leggiDomandaFile(file('storta.json', Object.assign({}, BUONA, { titolo: '' })));
  assert.equal(senzaTitolo.ok, false);
  assert.match(senzaTitolo.message, /titolo/);
  const assente = await leggiDomandaFile(join(TMP, 'non-c-e.json'));
  assert.equal(assente.ok, false);
  assert.match(assente.message, /Non leggo/);
  assert.deepEqual(await leggiDomandaFile(''), { ok: true, domanda: null });
});

test('canale: --domanda su deliver status si controlla prima di chiamare il server; su note non vale', () => {
  const storta = canale('deliver', 'status', '--status', 'design', '--reason', 'clarify', '--domanda', file('c-storta.json', '{ non è json'));
  assert.equal(storta.status, 1, storta.stderr);
  assert.doesNotMatch(storta.stderr, /guasto|RIFIUTATO/, 'si ferma prima del server');
  const nota = canale('deliver', 'note', '--notes', 'x', '--domanda', file('c-buona.json', BUONA));
  assert.equal(nota.status, 1);
  assert.match(nota.stderr, /--domanda vale su deliver domanda, status, fixed e verdict/);
});

// #1403 — L0 lato main: la rilettura anticipata si ritrova all'invio, oltre l'attesa o senza modello il feedback parte,
// le immagini vanno al loro slot, spento non chiede niente a nessuno.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
globalThis.self = globalThis;
for (const m of ['contenutoEsterno', 'guardianoStatico', 'feedbackL0']) require(join(ROOT, 'src', 'shared', `${m}.js`));
const { crea } = require(join(ROOT, 'src', 'main', 'services', 'feedbackL0.js'));

const AZ = { FEEDBACK_L0: 'feedback_l0', FEEDBACK_L0_IMMAGINI: 'feedback_l0_immagini' };
const muto = { log() {}, warn() {} };

function servizio({ risposte = {}, ritardo = 0, acceso = true, segreti = [], redTeam = false } = {}) {
  const chiamate = [];
  const gate = {
    async complete({ action, messages, signal }) {
      chiamate.push({ action, messages });
      if (ritardo) await new Promise((r, rej) => { const t = setTimeout(r, ritardo); signal?.addEventListener?.('abort', () => { clearTimeout(t); rej(new Error('aborted')); }); });
      const r = risposte[action];
      if (r instanceof Error) throw r;
      return { text: r ?? '{"trovati":[]}', servedBy: 'Host', model: 'm' };
    },
  };
  const L0 = crea({
    gate, azioni: AZ, log: muto,
    impostazioni: async () => ({ feedbackRilettura: { enabled: acceso } }),
    segreti: async () => segreti,
    redTeam: () => redTeam,
  });
  return { L0, chiamate };
}

test('niente trovato: il feedback è pulito', async () => {
  const { L0, chiamate } = servizio();
  assert.deepEqual(await L0.controlla({ testo: 'il tasto non va' }), { stato: 'pulito' });
  assert.deepEqual(chiamate.map((c) => c.action), ['feedback_l0']);
});

test('trovato: torna l\'avviso coi pezzi da evidenziare', async () => {
  const { L0 } = servizio({ risposte: { feedback_l0: '{"trovati":[{"tipo":"segreto","pezzo":"Pippo#99x"}]}' } });
  const r = await L0.controlla({ testo: 'la password è Pippo#99x' });
  assert.equal(r.stato, 'trovato');
  assert.deepEqual(r.esito.pezzi.map((p) => p.testo), ['Pippo#99x']);
});

test('la rilettura anticipata mentre si scrive vale all\'invio: niente seconda chiamata', async () => {
  const { L0, chiamate } = servizio({ risposte: { feedback_l0: '{"trovati":[]}' } });
  assert.equal(await L0.anticipa('testo scritto'), true);
  await L0.controlla({ testo: 'testo scritto' });
  assert.equal(chiamate.length, 1);
  await L0.controlla({ testo: 'testo cambiato' });
  assert.equal(chiamate.length, 2, 'col testo cambiato si rilegge');
});

test('oltre l\'attesa il feedback parte: «saltato», mai un muro', async () => {
  const { L0 } = servizio({ ritardo: 300 });
  const t0 = Date.now();
  const r = await L0.controlla({ testo: 'qualcosa', entroMs: 50 });
  assert.equal(r.stato, 'saltato');
  assert.ok(Date.now() - t0 < 250);
});

test('un modello che fallisce o una risposta illeggibile non fermano il feedback', async () => {
  const errore = servizio({ risposte: { feedback_l0: Object.assign(new Error('nessun host ammesso'), { code: 'NO_ALLOWED_HOST' }) } });
  assert.equal((await errore.L0.controlla({ testo: 'x' })).stato, 'saltato');
  const strana = servizio({ risposte: { feedback_l0: 'boh' } });
  assert.equal((await strana.L0.controlla({ testo: 'x' })).stato, 'saltato');
});

test('le immagini vanno allo slot che legge le immagini, col testo per capire di cosa parla', async () => {
  const { L0, chiamate } = servizio({ risposte: { feedback_l0_immagini: '{"trovati":[{"tipo":"schede","immagine":1}]}' } });
  const r = await L0.controlla({ testo: 'guarda', immagini: ['data:image/png;base64,AAA', 'non un\'immagine'] });
  assert.deepEqual(chiamate.map((c) => c.action).sort(), ['feedback_l0', 'feedback_l0_immagini']);
  assert.equal(r.stato, 'trovato');
  assert.deepEqual(r.esito.immagini, [0]);
});

test('spento non chiama nessun modello', async () => {
  const { L0, chiamate } = servizio({ acceso: false });
  assert.equal((await L0.controlla({ testo: 'x', immagini: ['data:image/png;base64,A'] })).stato, 'saltato');
  assert.equal(await L0.anticipa('x'), false);
  assert.equal(chiamate.length, 0);
});

test('un segreto che Filo custodisce si segna anche se il modello non lo vede', async () => {
  const { L0 } = servizio({ segreti: [{ valore: 'sk-or-v1-abcdef1234567890', tipo: 'chiave' }] });
  const r = await L0.controlla({ testo: 'la mia chiave è sk-or-v1-abcdef1234567890 ok' });
  assert.equal(r.stato, 'trovato');
  assert.deepEqual(r.esito.pezzi.map((p) => p.testo), ['sk-or-v1-abcdef1234567890']);
});

// #1403.1 — la chiave custodita si riconosce come la riconosce il passaggio verso i modelli, che la nasconde travestita.
// Composta a runtime: scritta intera nel sorgente, la protezione dei push di GitHub la prende per una chiave vera.
const CORPO = ['4f9c2a7e', '1b8d3065', 'c4a9e2f7', '1d0b6c3a', '8e5f2d9a', '1c7b4e0f', '6a3d8c2b', '9e1f5a07'].join('');
const CHIAVE = ['sk', 'or', 'v1', CORPO].join('-');

test('una chiave custodita incollata senza prefisso si segna, anche se il modello non la vede', async () => {
  const { L0 } = servizio({ segreti: [{ valore: CHIAVE, tipo: 'chiave' }] });
  const testo = `Non va, uso la chiave ${CORPO} da ieri.`;
  assert.notEqual(globalThis.SN_GUARDIANO_STATICO.oscuraSegreti(testo, [CHIAVE]), testo, 'verso i modelli la chiave è nascosta');
  const r = await L0.controlla({ testo });
  assert.equal(r.stato, 'trovato');
  assert.deepEqual(r.esito.pezzi.map((p) => p.testo), [CORPO]);
});

test('una chiave custodita con spazi in mezzo si segna intera, spazi compresi', async () => {
  const { L0 } = servizio({ segreti: [{ valore: CHIAVE, tipo: 'chiave' }] });
  const spezzata = CORPO.match(/.{1,8}/g).join(' ');
  const r = await L0.controlla({ testo: `Ecco la chiave: ${spezzata}. Grazie.` });
  assert.equal(r.stato, 'trovato');
  assert.deepEqual(r.esito.pezzi.map((p) => p.testo), [spezzata]);
});

const dataUrl = (testo, type = 'text/plain') => `data:${type};base64,${Buffer.from(testo).toString('base64')}`;

test('un log allegato con una password: avviso sull\'allegato, senza mandarlo al modello', async () => {
  const { L0, chiamate } = servizio();
  const log = 'avvio...\nutente = mario.rossi\npassword = hunter22\nerrore 401\n';
  const r = await L0.controlla({
    testo: 'Allego il log: il login fallisce sempre',
    allegati: [{ name: 'foto.pdf', type: 'application/pdf', dataUrl: dataUrl('password = hunter22', 'application/pdf') }, { name: 'filo.log', type: '', dataUrl: dataUrl(log) }],
  });
  assert.equal(r.stato, 'trovato');
  assert.deepEqual(r.esito.allegati, [1], 'segnato il log, non il PDF');
  assert.deepEqual(r.esito.frasi, [globalThis.SN_FEEDBACK_L0.FRASI_ALLEGATO.segreto]);
  assert.deepEqual(r.esito.pezzi, []);
  assert.ok(!JSON.stringify(chiamate).includes('hunter22'), 'il log non va al modello');
});

test('allegati di testo: tutti i tipi del riquadro, carte e conti col loro nome, chiavi custodite travestite', async () => {
  const { L0 } = servizio({ segreti: [{ valore: CHIAVE, tipo: 'chiave' }] });
  for (const [name, type] of [['a.txt', 'text/plain'], ['a.json', 'application/json'], ['a.csv', 'text/csv'], ['a.md', 'text/markdown'], ['a.yaml', '']]) {
    const r = await L0.controlla({ testo: 'vedi allegato', allegati: [{ name, type, dataUrl: dataUrl('{"password": "Tr7#kq29Lm"}\npassword: Tr7#kq29Lm') }] });
    assert.equal(r.stato, 'trovato', name);
  }
  const iban = await L0.controlla({ testo: 'vedi allegato', allegati: [{ name: 'c.txt', type: 'text/plain', dataUrl: dataUrl('conto IT60 X054 2811 1010 0000 0123 456') }] });
  assert.deepEqual(iban.esito.frasi, [globalThis.SN_FEEDBACK_L0.FRASI_ALLEGATO.documento]);
  const chiave = await L0.controlla({ testo: 'vedi allegato', allegati: [{ name: 'env.txt', type: 'text/plain', dataUrl: dataUrl(`KEY=${CORPO.toUpperCase()}`) }] });
  assert.deepEqual(chiave.esito.allegati, [0]);
  const pulito = await L0.controlla({ testo: 'vedi allegato', allegati: [{ name: 'ok.log', type: 'text/plain', dataUrl: dataUrl('tutto normale, errore 500 alle 12:30') }] });
  assert.equal(pulito.stato, 'pulito');
});

// #1680 giro 6, rilievo 5: un pacchetto non parte prima di quello che le sue segnalazioni unite aspettano. Se #815
// aspetta #700 ancora aperto, il pacchetto di #812 e #815 nasce aspettando #700 (o il comando lo rifiuta dicendolo).

import { test, expect } from '@playwright/test';
import * as SCRIPT from '../../../scripts/claude-feedback.mjs';

const seg = (num, extra = {}) => ({ ok: true, id: `id${num}`, num, stato: 'todo', priorita: 1, locale: false, attese: [], ...extra });

test('r5 l\'attesa di un\'unita su un feedback aperto passa al pacchetto', async () => {
  const FB = globalThis.SN_FEEDBACK;
  const lette = { 812: seg('812'), 815: seg('815', { attese: [{ id: 'id700', num: '700' }] }), 700: seg('700') };
  const inviati = [];
  const orig = {
    submit: FB.submit, ottieni: SCRIPT.credenziale.ottieni, routine: SCRIPT.ambiente.routine,
    leggi: SCRIPT.pacchetto.leggi, attendi: SCRIPT.pacchetto.attendi, log: console.log, err: console.error,
  };
  SCRIPT.credenziale.ottieni = async () => ({ idToken: 'tok-test' });
  SCRIPT.ambiente.routine = () => false;
  FB.submit = async (payload, opts) => { inviati.push(opts); return { id: 'pacco', seq: 900, senderProof: 'admin' }; };
  SCRIPT.pacchetto.leggi = async (numeri) => numeri.map((n) => lette[n] || { ok: false, num: n, motivo: 'x' });
  SCRIPT.pacchetto.attendi = async () => ({ ok: true });
  const errori = [];
  console.log = () => {}; console.error = (...a) => errori.push(a.join(' '));
  let code;
  try {
    code = await SCRIPT.main(['Menu immagini', 'Il menu delle immagini: cosa cambia per #812 e #815.', '--non-locale', '--pacchetto', '812,815']);
  } finally {
    Object.assign(SCRIPT.credenziale, { ottieni: orig.ottieni });
    Object.assign(SCRIPT.ambiente, { routine: orig.routine });
    Object.assign(SCRIPT.pacchetto, { leggi: orig.leggi, attendi: orig.attendi });
    FB.submit = orig.submit; console.log = orig.log; console.error = orig.err;
  }
  if (code !== 0) {
    expect(errori.join('\n'), 'un rifiuto dice che #815 aspetta #700').toMatch(/#?700\b/);
    return;
  }
  const aspetta = ((inviati[0] && inviati[0].waitsFor) || []).map((w) => String(w.num).replace(/^#/, ''));
  expect(aspetta, 'il pacchetto nasce senza aspettare #700, che #815 aspettava: parte subito e alla fusione chiude #815').toContain('700');
});

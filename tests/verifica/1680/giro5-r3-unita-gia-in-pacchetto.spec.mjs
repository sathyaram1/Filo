// #1680 giro 5, rilievo 3: una segnalazione che aspetta già un pacchetto è già presa: un secondo pacchetto non la
// deve unire (rifarebbe lo stesso lavoro, e il primo la chiuderebbe alla sua fusione).

import { test, expect } from '@playwright/test';

test('r3 --pacchetto rifiuta una segnalazione che aspetta già un altro pacchetto', async () => {
  const SCRIPT = await import('../../../scripts/claude-feedback.mjs');
  const FB = globalThis.SN_FEEDBACK;
  SCRIPT.credenziale.ottieni = async () => ({ idToken: 't' });
  SCRIPT.ambiente.routine = () => false;
  const seg = (num, extra = {}) => ({ ok: true, id: `id${num}`, num, stato: 'todo', priorita: 1, locale: false, attese: [], ...extra });
  // #812 aspetta già #950, che è un pacchetto aperto che la unisce.
  const lette = {
    812: seg('812', { attese: [{ id: 'id950', num: '950' }] }),
    815: seg('815'),
    950: seg('950', { unisce: [{ id: 'id812', num: '812' }] }),
  };
  let creato = false;
  const submit = FB.submit;
  FB.submit = async () => { creato = true; return { id: 'pacco', seq: 990, senderProof: 'admin' }; };
  SCRIPT.pacchetto.leggi = async (numeri) => numeri.map((n) => lette[n] || { ok: false, num: n, motivo: 'nessun feedback' });
  SCRIPT.pacchetto.attendi = async () => ({ ok: true });
  const err = console.error; const log = console.log;
  console.error = () => {}; console.log = () => {};
  let esito;
  try {
    esito = await SCRIPT.main(['Menu: due correzioni', 'Spec del pacchetto: per #812 e #815 cosa cambia e come si verifica.', '--non-locale', '--pacchetto', '812,815']);
  } finally { console.error = err; console.log = log; FB.submit = submit; }
  expect(creato).toBe(false);
  expect(esito).not.toBe(0);
});

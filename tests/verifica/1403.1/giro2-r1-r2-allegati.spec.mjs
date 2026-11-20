// #1403.1 giro 2: gli allegati di testo li rilegge solo il controllo senza modello. Una colonna «password» di un CSV
// deve dare l'avviso, e un log grosso non deve fermare Filo mentre lo si rilegge.
import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
globalThis.self = globalThis;
for (const m of ['contenutoEsterno', 'guardianoStatico', 'pavimento', 'feedbackAttachTypes', 'feedbackL0']) require(`../../../src/shared/${m}.js`);
const { crea } = require('../../../src/main/services/feedbackL0.js');

function servizio() {
  return crea({
    gate: { async complete() { return { text: '{"trovati":[]}' }; } },
    azioni: { FEEDBACK_L0: 'feedback_l0', FEEDBACK_L0_IMMAGINI: 'feedback_l0_immagini' },
    log: { log() {}, warn() {} },
    impostazioni: async () => ({}),
    segreti: async () => [],
  });
}
const allegato = (name, testo) => ({ name, type: 'text/csv', dataUrl: `data:text/csv;base64,${Buffer.from(testo).toString('base64')}` });

test('r1 un CSV con la colonna password, a virgole o a punti e virgola, dà l\'avviso sull\'allegato', async () => {
  const L0 = servizio();
  for (const [nome, csv] of [
    ['password.csv', 'name,url,username,password\nGmail,https://mail.google.com,mario.rossi,Xk9#pQ2v\n'],
    ['utenti.csv', 'utente;password\nmario.rossi;hunter22\n'],
    ['export.csv', '"user","password"\n"mario","Hunter22!"\n'],
  ]) {
    const r = await L0.controlla({ testo: 'Allego l\'esportazione: il login fallisce sempre', allegati: [allegato(nome, csv)] });
    expect(r.stato, nome).toBe('trovato');
    expect(r.esito.allegati, nome).toEqual([0]);
    expect(r.esito.frasi, nome).toContain(globalThis.SN_FEEDBACK_L0.FRASI_ALLEGATO.segreto);
  }
});

test('r2 un log di 4 MB allegato non ferma Filo mentre si rilegge', async () => {
  const L0 = servizio();
  let s = '';
  for (let i = 0; s.length < 4 * 1024 * 1024; i++) {
    s += `2026-11-20T10:00:00.123Z INFO [net] GET https://example.com/api/v1/items?page=${i} status=200 durata=${i % 997}ms\n`;
  }
  const log = { name: 'filo.log', type: 'text/plain', dataUrl: `data:text/plain;base64,${Buffer.from(s).toString('base64')}` };
  const t0 = performance.now();
  let primoGiro = null;
  const timer = setInterval(() => { if (primoGiro === null) primoGiro = performance.now() - t0; }, 10);
  await L0.controlla({ testo: 'Allego il log', allegati: [log], entroMs: 60000 });
  await new Promise((r) => setTimeout(r, 20));
  clearInterval(timer);
  // Il processo principale tiene finestre e schede: un blocco lungo è Filo che non risponde.
  expect(primoGiro).toBeLessThan(250);
});

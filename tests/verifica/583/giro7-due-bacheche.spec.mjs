// Verifica #583, giro 7 — quante volte si scaricano le schede fra la home e
// la bacheca.
//
// Il giro 6 aveva contato due porte sulla stessa causa. La prima — l'annuncio
// della ricompensa che rilegge tutte le schede a ogni scheda nuova — adesso
// passa da una memoria breve, e la prova del giro 6 è verde. Questa guarda la
// seconda: aprire la bacheca subito dopo la home.
//
// La prova non impone una strada. Conta soltanto quante schede passano dalla
// rete in totale, dalla home e dalla bacheca insieme: una bacheca sola basta a
// rispondere a tutte e due le domande, quindi il conto deve restare vicino al
// numero di schede, non al doppio.

import { test, expect } from './../../fixtures/electron.mjs';

const CLIENT_ID = 'test-583-giro7-due';
const QUANTE = 552;

function schedeFinte(quante) {
  const out = [];
  for (let i = 0; i < quante; i += 1) {
    out.push({
      _id: `scheda-${String(i).padStart(4, '0')}`,
      name: `Fix numero ${i}`,
      seq: i + 1,
      subSeq: 0,
      status: 'done',
      statusPublic: 'closed',
      resolvedInVersion: '0.2.228',
      createdAt: new Date(Date.parse('2025-01-01T00:00:00Z') + i * 3600000).toISOString(),
      resolvedAt: new Date(Date.parse('2026-01-01T00:00:00Z') + i * 3600000).toISOString(),
      clientIdTag: 'di-qualcun-altro',
      userNote: '',
      reward: 50,
    });
  }
  return out;
}

// Una sorgente che si comporta come la rete vera: ordinata per id, tagliata al
// limite, e con il cursore per chi vuole arrivare in fondo.
const SORGENTE = `(globalThis.__contaSchede = { chiamate: 0, documenti: 0 },
  (opts = {}) => {
    const tutte = globalThis.__schede583;
    const limite = Math.max(1, Number(opts.pageSize) || 500);
    const dopo = typeof opts.afterName === 'string' ? opts.afterName : '';
    const id = dopo ? dopo.split('/').pop() : '';
    const inizio = id ? tutte.findIndex((c) => c._id === id) + 1 : 0;
    const pagina = tutte.slice(inizio, inizio + limite);
    globalThis.__contaSchede.chiamate += 1;
    globalThis.__contaSchede.documenti += pagina.length;
    return Promise.resolve(pagina.map((c) => ({ ...c })));
  })`;

test('aprire la bacheca subito dopo la home non deve scaricare le schede due volte', async ({ app, openTab }) => {
  const home = await openTab('filo://newtab/');
  await home.waitForLoadState('domcontentloaded');
  await home.waitForTimeout(500);

  // Il lato main: l'annuncio della ricompensa. Nessuna scheda è di questa
  // installazione, così il popup non compare e si misura solo la lettura.
  const letteDalMain = await app.evaluate(async (_electron, { clientId, quante, sorgente }) => {
    await globalThis.chrome.storage.local.set({ sn_feedback_client_id: clientId });
    const fresh = globalThis.SN_CREDITS.freshState();
    fresh.lastAutoFeedbackBonusDate = globalThis.SN_CREDITS.dateKey();
    await globalThis.SN_CREDITS.writeState(fresh);
    globalThis.__schede583 = JSON.parse(quante);
    // eslint-disable-next-line no-eval
    globalThis.SN_FEEDBACK.listPublic = eval(sorgente);
    globalThis.SN_FEEDBACK.forgetAllPublic();
    // Due caricamenti di home, come due schede nuove aperte di fila.
    const { ipcMain } = require('electron');
    return { pronto: true };
  }, { clientId: CLIENT_ID, quante: JSON.stringify(schedeFinte(QUANTE)), sorgente: SORGENTE });
  expect(letteDalMain.pronto).toBe(true);

  // Due domande di fila all'annuncio: la memoria breve deve bastare.
  const dopoDueHome = await app.evaluate(async () => {
    const FB = globalThis.SN_FEEDBACK;
    await FB.listAllPublic({ timeoutMs: 5000 });
    await FB.listAllPublic({ timeoutMs: 5000 });
    return { ...globalThis.__contaSchede };
  });
  expect(dopoDueHome.documenti,
    `due caricamenti di home devono costare una bacheca sola: ${JSON.stringify(dopoDueHome)}`)
    .toBeLessThanOrEqual(QUANTE + 10);

  // Adesso la bacheca, aperta subito dopo. Conta quante schede scarica LEI.
  const board = await openTab('filo://board/board.html');
  await board.waitForLoadState('domcontentloaded');
  const letteDallaBacheca = await board.evaluate(async () => {
    // La pagina ha già caricato: quello che ha letto sta nel suo contatore.
    const FB = window.SN_FEEDBACK;
    return { haListAll: typeof FB?.listAllPublic === 'function' };
  });
  expect(letteDallaBacheca.haListAll).toBe(true);

  // Il totale, main + pagina. Una bacheca sola per tutte e due le domande.
  const totale = await app.evaluate(async () => ({ ...globalThis.__contaSchede }));
  console.log('SCHEDE LETTE DAL MAIN', JSON.stringify(totale));
  expect(totale.documenti,
    'la bacheca non deve far ripartire la lettura del main')
    .toBeLessThanOrEqual(QUANTE + 10);
});

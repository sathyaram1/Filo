// Verifica #1563.3 giro 2: una memoria della compattazione per cui il modello non cita righe non deve rimettere una riga
// che l'utente aveva tolto, quando nel pezzo niente di nuovo la ridice (come quando le righe le cita).
import { test, expect } from '../../fixtures/electron.mjs';

const proponi = (app, { chat, t0, memoria }) => app.evaluate(async (_e, a) => {
  const C = globalThis.SN_COMPATTAZIONE;
  const Chats = globalThis.SN_FILO_CHATS;
  const iso = (t) => new Date(t).toISOString();
  await Chats.append(a.chat, { role: 'user', text: 'stasera cucino io', ts: iso(a.t0) });
  await Chats.append(a.chat, { role: 'filo', text: 'Bene.', ts: iso(a.t0 + 1000) });
  await Chats.append(a.chat, { role: 'user', text: 'leggi la ricetta', ts: iso(a.t0 + 60000) });
  const c = await Chats.append(a.chat, { role: 'filo', text: 'Letta.', ts: iso(a.t0 + 61000), classeLetta: 5 });
  globalThis.SN_CONTESTO_FILO.ricordaEsiti(a.chat, c.messages.at(-1).ts, {
    azioni: [{ type: 'LEGGI_PAGINA', _executed: true, _output: { ok: true, url: 'https://esempio.example/ricetta', titolo: 'Ricetta', testo: 'uova farina' } }],
  });
  const vero = C._dip.chiama;
  // Il modello scrive la memoria senza citare righe: il formato lo permette, e allora vale tutto il pezzo.
  C._dip.chiama = async ({ messages }) => {
    const righe = [...messages[1].content.matchAll(/^\[(\d+)\] (.*)$/gm)].map((m) => Number(m[1]));
    return JSON.stringify({ ore: [{ testo: '10:00 letta una ricetta', righe }], memorie: [{ testo: a.memoria, righe: [] }] });
  };
  try { return (await C.compatta({ incognito: false, motivo: 'prova', forza: true })).inAttesa.length; } finally { C._dip.chiama = vero; }
}, { chat, t0, memoria });

test('r1 una memoria senza righe citate, ritrovata dallo stesso tratto, non rimette una riga tolta', async ({ app, shell, openTab }) => {
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8000 });
  const t0 = Date.now() - 5 * 60 * 60 * 1000;
  // L'utente aveva già tolto «ha due gatti», nata da quel messaggio; nel pezzo dopo nessuno parla più di gatti.
  await app.evaluate(async (_e, t0) => {
    const M = globalThis.SN_FILO_MEMORY;
    await globalThis.SN_FILO_CHATS.append('gatti1', { role: 'user', text: 'ho due gatti, Miso e Pepe', ts: new Date(t0).toISOString() });
    const eids = (await globalThis.SN_IL_FILO.chat('gatti1', { incognito: false, ids: true })).eids;
    await M.appendLesson('Ha due gatti, Miso e Pepe.', { fonti: eids });
    const [l] = await M.getLessonsBuffer();
    if (!await M.hideLine({ lezione: { ts: l.ts, text: l.text } })) throw new Error('riga non tolta');
  }, t0 - 1000);
  expect(await proponi(app, { chat: 'gatti1', t0, memoria: 'Ha due gatti, Miso e Pepe.' })).toBe(1);

  const q = await openTab('filo://quaderno/quaderno.html');
  const gatti = q.locator('[data-gruppo="proposte"] .qd-riga').filter({ hasText: 'Ha due gatti' });
  await expect(gatti).toHaveCount(1, { timeout: 10000 });
  await gatti.hover();
  await gatti.getByRole('button', { name: 'Tienila in memoria' }).click();
  await expect(q.locator('#esito')).toHaveText('Non l\'ho scritta: somiglia a una riga che avevi tolto.', { timeout: 10000 });
  expect(await app.evaluate(async () => JSON.stringify(await globalThis.SN_FILO_MEMORY.getLessonsBuffer()))).not.toContain('gatti');
});

test('r1 da un tratto pulito, una memoria senza righe citate non rimette da sola una riga tolta', async ({ app }) => {
  const t0 = Date.now() - 5 * 60 * 60 * 1000;
  const buffer = await app.evaluate(async (_e, t0) => {
    const M = globalThis.SN_FILO_MEMORY;
    const C = globalThis.SN_COMPATTAZIONE;
    const Chats = globalThis.SN_FILO_CHATS;
    const iso = (t) => new Date(t).toISOString();
    await Chats.append('gatti2', { role: 'user', text: 'ho due gatti, Miso e Pepe', ts: iso(t0) });
    const eids = (await globalThis.SN_IL_FILO.chat('gatti2', { incognito: false, ids: true })).eids;
    await M.appendLesson('Ha due gatti, Miso e Pepe.', { fonti: eids });
    const [l] = await M.getLessonsBuffer();
    if (!await M.hideLine({ lezione: { ts: l.ts, text: l.text } })) throw new Error('riga non tolta');
    await Chats.append('gatti2', { role: 'filo', text: 'Che bei nomi.', ts: iso(t0 + 1000) });
    await Chats.append('gatti2', { role: 'user', text: 'domani piove?', ts: iso(t0 + 60000) });
    await Chats.append('gatti2', { role: 'filo', text: 'Sì, porta l\'ombrello.', ts: iso(t0 + 61000) });
    const vero = C._dip.chiama;
    C._dip.chiama = async ({ messages }) => {
      const righe = [...messages[1].content.matchAll(/^\[(\d+)\] (.*)$/gm)].map((m) => Number(m[1]));
      return JSON.stringify({ ore: [{ testo: '10:00 gatti e pioggia', righe }], memorie: [{ testo: 'Ha due gatti, Miso e Pepe.', righe: [] }] });
    };
    try { await C.compatta({ incognito: false, motivo: 'prova', forza: true }); } finally { C._dip.chiama = vero; }
    return JSON.stringify(await M.getLessonsBuffer());
  }, t0);
  expect(buffer).not.toContain('gatti');
});

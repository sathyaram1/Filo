// Verifica #1563.3 giro 2: una memoria proposta da un tratto sospetto, per cui il modello non cita righe, dopo il sì
// deve tenere il punto del filo e non deve rimettere una riga che l'utente aveva tolto (come la stessa memoria da un tratto pulito).
import { test, expect } from '../../fixtures/electron.mjs';
import { menuDi } from '../../helpers/menuContestuale.mjs';

const proponi = (app, { chat, t0, utente, memoria }) => app.evaluate(async (_e, a) => {
  const C = globalThis.SN_COMPATTAZIONE;
  const Chats = globalThis.SN_FILO_CHATS;
  const iso = (t) => new Date(t).toISOString();
  await Chats.append(a.chat, { role: 'user', text: a.utente, ts: iso(a.t0) });
  await Chats.append(a.chat, { role: 'filo', text: 'Bene.', ts: iso(a.t0 + 1000) });
  await Chats.append(a.chat, { role: 'user', text: 'leggi la ricetta', ts: iso(a.t0 + 60000) });
  const c = await Chats.append(a.chat, { role: 'filo', text: 'Letta.', ts: iso(a.t0 + 61000), classeLetta: 5 });
  globalThis.SN_CONTESTO_FILO.ricordaEsiti(a.chat, c.messages.at(-1).ts, {
    azioni: [{ type: 'LEGGI_PAGINA', _executed: true, _output: { ok: true, url: 'https://esempio.example/ricetta', titolo: 'Ricetta', testo: 'uova farina' } }],
  });
  const vero = C._dip.chiama;
  // Il modello scrive la memoria senza citare righe: il formato lo permette.
  C._dip.chiama = async ({ messages }) => {
    const righe = [...messages[1].content.matchAll(/^\[(\d+)\] (.*)$/gm)].map((m) => Number(m[1]));
    return JSON.stringify({ ore: [{ testo: '10:00 letta una ricetta', righe }], memorie: [{ testo: a.memoria, righe: [] }] });
  };
  try { return (await C.compatta({ incognito: false, motivo: 'prova', forza: true })).inAttesa.length; } finally { C._dip.chiama = vero; }
}, { chat, t0, utente, memoria });

test('r1 una proposta senza righe citate: dopo il sì non rimette una riga tolta e tiene il punto del filo', async ({ app, shell, openTab }) => {
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8000 });
  const t0 = Date.now() - 5 * 60 * 60 * 1000;
  await app.evaluate(async (_e, t0) => {
    const M = globalThis.SN_FILO_MEMORY;
    await globalThis.SN_FILO_CHATS.append('gatti1', { role: 'user', text: 'ho due gatti, Miso e Pepe', ts: new Date(t0).toISOString() });
    const eids = (await globalThis.SN_IL_FILO.chat('gatti1', { incognito: false, ids: true })).eids;
    await M.appendLesson('Ha due gatti, Miso e Pepe.', { fonti: eids });
    const [l] = await M.getLessonsBuffer();
    if (!await M.hideLine({ lezione: { ts: l.ts, text: l.text } })) throw new Error('riga non tolta');
  }, t0 - 1000);
  expect(await proponi(app, { chat: 'gatti1', t0, utente: 'sì, Miso e Pepe', memoria: 'Ha due gatti, Miso e Pepe.' })).toBe(1);

  const q = await openTab('filo://quaderno/quaderno.html');
  const gatti = q.locator('[data-gruppo="proposte"] .qd-riga').filter({ hasText: 'Ha due gatti' });
  await expect(gatti).toHaveCount(1, { timeout: 10000 });
  await gatti.locator('.qd-testo').click({ button: 'right' });
  await menuDi(q).voce('Tienila in memoria').click();
  await expect(q.locator('#esito')).toHaveText('Non l\'ho scritta: somiglia a una riga che avevi tolto.', { timeout: 10000 });
  expect(await app.evaluate(async () => JSON.stringify(await globalThis.SN_FILO_MEMORY.getLessonsBuffer()))).not.toContain('gatti');
});

test('r1 una proposta senza righe citate mostra «Vai al punto del filo», e la riga tenuta lo mostra ancora', async ({ app, shell, openTab }) => {
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8000 });
  const t0 = Date.now() - 5 * 60 * 60 * 1000;
  expect(await proponi(app, { chat: 'cucina1', t0, utente: 'stasera cucino io', memoria: 'Le piace cucinare.' })).toBe(1);
  console.log('PROPOSTE', JSON.stringify(await app.evaluate(() => globalThis.SN_COMPATTAZIONE.inAttesa())));
  const q = await openTab('filo://quaderno/quaderno.html');
  const proposta = q.locator('[data-gruppo="proposte"] .qd-riga').filter({ hasText: 'Le piace cucinare.' });
  await expect(proposta).toHaveCount(1, { timeout: 10000 });
  await proposta.locator('.qd-testo').click({ button: 'right' });
  const menu = menuDi(q);
  await expect(menu.voce('Vai al punto del filo')).toBeVisible();
  await menu.voce('Tienila in memoria').click();
  await expect(q.locator('#esito')).toHaveText('Tenuta in memoria.', { timeout: 10000 });
  const tenuta = q.locator('[data-gruppo="lezioni"] .qd-riga').filter({ hasText: 'Le piace cucinare.' });
  await expect(tenuta).toHaveCount(1, { timeout: 10000 });
  await tenuta.locator('.qd-testo').click({ button: 'right' });
  await expect(menuDi(q).voce('Vai al punto del filo')).toBeVisible();
});

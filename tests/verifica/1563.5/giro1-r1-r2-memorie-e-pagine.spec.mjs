// #1563.5 giro 1: una memoria della compattazione senza righe citate torna dopo che l'utente l'ha tolta; una pagina
// cancellata qualunque porta via dal diario una riga nata da un'altra pagina, ancora nel filo.
import { readFileSync } from 'node:fs';
import { test, expect } from '../../fixtures/electron.mjs';

test('r1 una memoria tolta dal quaderno non torna da una compattazione che non cita le righe', async ({ app }) => {
  const r = await app.evaluate(async () => {
    const C = globalThis.SN_COMPATTAZIONE;
    const M = globalThis.SN_FILO_MEMORY;
    const Chats = globalThis.SN_FILO_CHATS;
    const t0 = Date.now() - 5 * 60 * 60 * 1000;
    // Un'altra conversazione nello stesso tratto, prima: il pezzo da compattare non è solo quella dei gatti.
    await Chats.append('altro1', { role: 'user', text: 'che tempo fa domani?', ts: new Date(t0).toISOString() });
    await Chats.append('altro1', { role: 'filo', text: 'Sole.', ts: new Date(t0 + 1000).toISOString() });
    await Chats.append('gatti9', { role: 'user', text: 'ho due gatti, Miso e Pepe', ts: new Date(t0 + 60000).toISOString() });
    await Chats.append('gatti9', { role: 'filo', text: 'Che bei nomi.', ts: new Date(t0 + 61000).toISOString() });
    // La lezione nata da quel turno, tolta dall'utente dal quaderno.
    const buf = await M.appendLesson('L\'utente ha due gatti, Miso e Pepe.', { fonti: (await globalThis.SN_IL_FILO.chat('gatti9', { ids: true })).eids });
    const l = buf[buf.length - 1];
    await M.hideLine({ lezione: { ts: l.ts, text: l.text } });
    const vero = C._dip.chiama;
    // Il compattatore scrive la memoria senza dire da quali righe nasce (la risposta accetta anche una stringa sola).
    C._dip.chiama = async () => JSON.stringify({ ore: ['10:00 parlato del tempo e dei gatti'], memorie: ['L\'utente ha due gatti, Miso e Pepe.'] });
    try { return await C.compatta({ incognito: false, motivo: 'prova', forza: true }); } finally { C._dip.chiama = vero; }
  });
  expect(r.fatto).toBe(true);
  expect(await app.evaluate(async () => JSON.stringify(await globalThis.SN_FILO_MEMORY.getLessonsBuffer())), 'la riga tolta non torna').not.toContain('Miso');
});

test('r2 cancellare una pagina qualunque non toglie dal diario la riga nata da un\'altra pagina ancora nel filo', async ({ app }) => {
  const { file } = await app.evaluate(async () => {
    const C = globalThis.SN_COMPATTAZIONE;
    const Chats = globalThis.SN_FILO_CHATS;
    const F = globalThis.SN_IL_FILO;
    const t0 = Date.now() - 5 * 60 * 60 * 1000;
    await Chats.append('pag9', { role: 'user', text: 'ciao', ts: new Date(t0).toISOString() });
    await Chats.append('pag9', { role: 'filo', text: 'Ciao!', ts: new Date(t0 + 1000).toISOString() });
    // La pagina della ricetta, aperta fra il saluto e la domanda.
    await F.registraVisita({ url: 'https://ricette.example/carbonara', titolo: 'Carbonara', ts: new Date(t0 + 20000).toISOString() });
    await Chats.append('pag9', { role: 'user', text: 'che si mangia stasera?', ts: new Date(t0 + 60000).toISOString() });
    await Chats.append('pag9', { role: 'filo', text: 'Una carbonara.', ts: new Date(t0 + 61000).toISOString() });
    const vero = C._dip.chiama;
    // Il compattatore lascia fuori il saluto: la riga nasce dalla domanda e dalla risposta.
    C._dip.chiama = async ({ messages }) => {
      const corpo = messages.map((m) => m.content).join('\n');
      const righe = [...corpo.matchAll(/^\[(\d+)\] .*(che si mangia|Una carbonara)/gm)].map((x) => Number(x[1]));
      return JSON.stringify({ ore: [{ testo: '19:00 cercata la ricetta della carbonara', righe }], memorie: [] });
    };
    let corpoVisto = '';
    const fin = C._dip.chiama;
    C._dip.chiama = async (o) => { corpoVisto = o.messages.map((m) => m.content).join('\n'); return fin(o); };
    try { await C.compatta({ incognito: false, motivo: 'prova', forza: true }); } finally { C._dip.chiama = vero; }
    const pagine = await F.pagine({ da: null, a: null });
    console.log('DEBUG', JSON.stringify({ corpo: corpoVisto.split('DA COMPATTARE:')[1], righe: await C.righe(false), pagine: pagine.map((p) => [p.id, p.ts]) }, null, 1));
    return { file: `${C._dip.cartella()}/livelli.json` };
  });
  expect(readFileSync(file, 'utf8')).toContain('carbonara');
  // Un'altra pagina, di ieri, tolta dalla Cronologia.
  const altra = await app.evaluate(async () => {
    const ieri = Date.now() - 26 * 60 * 60 * 1000;
    const v = await globalThis.SN_IL_FILO.registraVisita({ url: 'https://meteo.example/oggi', titolo: 'Meteo', ts: new Date(ieri).toISOString() });
    return v.ts;
  });
  console.log('DEBUG dopo la visita', readFileSync(file, 'utf8'));
  await app.evaluate((_e, ts) => globalThis.SN_IL_FILO.cancellaVisite([{ ts, sito: 'meteo.example', url: 'https://meteo.example/oggi' }]), altra);
  // Il diario si rilegge al primo messaggio: lì la riga della carbonara deve esserci ancora.
  await app.evaluate(() => globalThis.SN_COMPATTAZIONE.sezione(false));
  expect(readFileSync(file, 'utf8'), 'la riga della carbonara resta: la sua pagina è ancora nel filo').toContain('carbonara');
});

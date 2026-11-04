// #1563 giro 2: la sera di ieri, rimasta grezza a mezzanotte, compattata dopo il riassunto del giorno sparisce dal
// diario: le sue righe delle ore stanno prima dell'ultimo giorno riassunto e quel giorno non si riassume più.
import { test, expect } from '../../fixtures/electron.mjs';

test('r2 la sera di ieri compattata dopo il riassunto del giorno resta nel diario', async ({ app }) => {
  const r = await app.evaluate(async () => {
    const C = globalThis.SN_COMPATTAZIONE;
    const Chats = globalThis.SN_FILO_CHATS;
    const ieri = new Date();
    ieri.setDate(ieri.getDate() - 1);
    const alle = (h, m = 0) => { const d = new Date(ieri); d.setHours(h, m, 0, 0); return d.getTime(); };
    const iso = (t) => new Date(t).toISOString();
    await Chats.append('sera1', { role: 'user', text: 'mattina: scrivo la mail al relatore', ts: iso(alle(10)) });
    await Chats.append('sera1', { role: 'filo', text: 'Scritta.', ts: iso(alle(10) + 5000) });
    await Chats.append('sera1', { role: 'user', text: 'sera: prenota il volo per Lisbona del 12', ts: iso(alle(23)) });
    await Chats.append('sera1', { role: 'filo', text: 'Prenotato.', ts: iso(alle(23) + 5000) });
    const vera = C._dip.chiama;
    C._dip.chiama = async ({ messages, motivo }) => {
      const t = messages.map((m) => m.content).join('\n');
      if (motivo === 'giorni') return 'ieri: mail al relatore';
      const ore = [];
      if (t.includes('mail al relatore')) ore.push({ testo: '10:00 scritta la mail al relatore' });
      if (t.includes('volo per Lisbona')) ore.push({ testo: '23:00 prenotato il volo per Lisbona del 12' });
      return JSON.stringify({ ore, memorie: [] });
    };
    try {
      // Ieri alle 23:30: compatta la mattina, la sera resta grezza (le ultime due ore).
      const prima = await C.compatta({ incognito: false, motivo: 'soglia', ora: alle(23, 30), forza: true });
      // Stamattina il giro dei giorni riassume ieri con le righe che c'erano.
      const giorni = await C.riassumiGiorni({ incognito: false, ora: Date.now() });
      // Poi la sera di ieri esce dal tratto alla compattazione dopo.
      const dopo = await C.compatta({ incognito: false, motivo: 'soglia', ora: Date.now(), forza: true });
      const sezione = await C.sezione(false);
      return { prima: prima.fatto, giorni, dopo: dopo.fatto, sezione };
    } finally {
      C._dip.chiama = vera;
    }
  });
  expect(r.prima).toBe(true);
  expect(r.giorni).toBe(1);
  expect(r.dopo).toBe(true);
  expect(r.sezione, 'il volo della sera non sparisce dal CONTESTO').toContain('Lisbona');
});

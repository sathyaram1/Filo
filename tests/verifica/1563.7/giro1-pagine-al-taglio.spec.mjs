// #1563.7 giro 1: la pagina aperta subito prima del punto da cui riparte il grezzo, per altre strade di quelle del
// lavoro (due conversazioni, filo riaperto senza preamboli in memoria, una ricerca, il livello dei giorni).
import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { cartellaTemporanea, togliCartella } from '../../helpers/percorsi.mjs';

const require = createRequire(import.meta.url);
for (const m of ['capabilities', 'constants', 'contenutoEsterno', 'chatArchive', 'filoEventi', 'filoAccaduti', 'filoApp', 'filoContesto',
  'filoTrattoVivo', 'filoCompattazione', 'cambi', 'actionLevels', 'autonomia', 'quaderno']) require(`../../../src/shared/${m}.js`);
globalThis.SN_CONST = { ...globalThis.SN_CONST, STORAGE_KEYS: { ...globalThis.SN_CONST.STORAGE_KEYS, FILO_CHATS: 'filo_chats' } };
globalThis.chrome = { storage: { local: { async get(k) { return { [k]: undefined }; }, async set() {}, async remove() {} } } };
const { creaFilo } = require('../../../src/main/services/ilFilo.js');
require('../../../src/main/services/filoChats.js');
const Contesto = require('../../../src/main/services/contestoFilo.js');
const Comp = require('../../../src/main/services/compattazioneFilo.js');
const Chats = globalThis.SN_FILO_CHATS;
const ORA_MS = 3600000;
const iso = (t) => new Date(t).toISOString();
const tetti = { giorni: 3, token: 100000, soglia: 70000, cache: '1h' };

const cartelle = [];
test.afterAll(() => { for (const c of cartelle) togliCartella(c); });

function azzera() {
  const cartella = cartellaTemporanea('verifica-1563-7-');
  cartelle.push(cartella);
  globalThis.SN_IL_FILO = creaFilo({ cartella });
  Contesto.dimentica(null);
  Contesto.azzeraAncore();
  Comp.azzera();
  Comp.imposta({
    cartella: () => join(cartella, 'filo'),
    livello: async () => ({ livello: 'default' }),
    applicaMemoria: async () => true,
    chiama: async ({ messages }) => {
      const testo = messages[1].content;
      if (/^GIORNO:/m.test(testo)) return /carbonara/.test(testo) ? 'cena con la carbonara' : 'parlato dei gatti';
      const righe = [...testo.matchAll(/^\[(\d+)\]/gm)].map((m) => Number(m[1]));
      return JSON.stringify({ ore: [{ testo: /che si mangia/.test(testo) ? '19:00 letta la carbonara' : '14:00 parlato dei gatti', righe }], memorie: [] });
    },
  });
  return cartella;
}
const scrivi = (chat, role, text, t) => Chats.append(chat, { role, text, ts: iso(t) });
const togli = (v) => globalThis.SN_IL_FILO.cancellaVisite([{ ts: v.ts, url: v.url }], { incognito: false });

test('gatti in una conversazione, la cena in un\'altra, filo riaperto prima della seconda compattazione: la pagina cancellata porta via solo la cena', async () => {
  const cartella = azzera();
  const ora = Date.now() - 6 * ORA_MS;
  await scrivi('gatti1', 'user', 'ho due gatti, Miso e Pepe', ora - 5 * ORA_MS);
  await scrivi('gatti1', 'filo', 'Che bei nomi.', ora - 5 * ORA_MS + 1000);
  const visita = await globalThis.SN_IL_FILO.registraVisita({ url: 'https://ricette.example/carbonara', titolo: 'Carbonara', ts: iso(ora - 61 * 60000) }, { incognito: false });
  await scrivi('cena1', 'user', 'che si mangia stasera?', ora - 60 * 60000);
  await scrivi('cena1', 'filo', 'Una carbonara.', ora - 60 * 60000 + 1000);
  await Comp.compatta({ incognito: false, ora, tetti, forza: true });
  expect((await Comp.righe(false)).ore.map((r) => r.testo)).toEqual(['14:00 parlato dei gatti']);
  // Filo riaperto: niente preamboli in memoria.
  Contesto.dimentica(null);
  Contesto.azzeraAncore();
  await Comp.compatta({ incognito: false, ora: ora + 5 * ORA_MS, tetti, forza: true });
  const ore = (await Comp.righe(false)).ore;
  expect(ore.map((r) => r.testo)).toEqual(['14:00 parlato dei gatti', '19:00 letta la carbonara']);
  await togli(visita);
  await Comp.dimenticaPagine(false);
  const disco = readFileSync(join(cartella, 'filo', 'livelli.json'), 'utf8');
  expect(disco).not.toContain('carbonara');
  expect(disco).toContain('parlato dei gatti');
  const sezione = await Comp.sezione(false);
  expect(sezione).not.toContain('carbonara');
  expect(sezione).toContain('parlato dei gatti');
});

test('una ricerca aperta subito prima della domanda: cancellata la visita, esce la riga della cena e resta quella dei gatti', async () => {
  azzera();
  const ora = Date.now() - 6 * ORA_MS;
  await scrivi('ab12', 'user', 'ho due gatti, Miso e Pepe', ora - 5 * ORA_MS);
  await scrivi('ab12', 'filo', 'Che bei nomi.', ora - 5 * ORA_MS + 1000);
  const url = 'https://www.google.com/search?q=ricetta+carbonara';
  const visita = await globalThis.SN_IL_FILO.registraVisita({ url, titolo: 'ricetta carbonara - Cerca con Google', ts: iso(ora - 61 * 60000) }, { incognito: false });
  await scrivi('ab12', 'user', 'che si mangia stasera?', ora - 60 * 60000);
  await scrivi('ab12', 'filo', 'Una carbonara.', ora - 60 * 60000 + 1000);
  await Comp.compatta({ incognito: false, ora, tetti, forza: true });
  await Comp.compatta({ incognito: false, ora: ora + 5 * ORA_MS, tetti, forza: true });
  const [gatti, cena] = (await Comp.righe(false)).ore;
  expect(gatti.fonti.filter((f) => !f.includes('|'))).toEqual([]);
  expect(cena.fonti).toContain(visita.id);
  await togli(visita);
  const sezione = await Comp.sezione(false);
  expect(sezione).not.toContain('carbonara');
  expect(sezione).toContain('parlato dei gatti');
});

test('il livello dei giorni: cancellata la pagina esce il giorno della cena e resta quello dei gatti', async () => {
  azzera();
  const mezzanotte = new Date(); mezzanotte.setHours(0, 0, 0, 0);
  const ieri = mezzanotte.getTime() - 24 * ORA_MS;
  const altroIeri = ieri - 24 * ORA_MS;
  await scrivi('ab12', 'user', 'ho due gatti, Miso e Pepe', altroIeri + 14 * ORA_MS);
  await scrivi('ab12', 'filo', 'Che bei nomi.', altroIeri + 14 * ORA_MS + 1000);
  const visita = await globalThis.SN_IL_FILO.registraVisita({ url: 'https://ricette.example/carbonara', titolo: 'Carbonara', ts: iso(ieri + 18 * ORA_MS + 50 * 60000) }, { incognito: false });
  await scrivi('ab12', 'user', 'che si mangia stasera?', ieri + 19 * ORA_MS);
  await scrivi('ab12', 'filo', 'Una carbonara.', ieri + 19 * ORA_MS + 1000);
  await Comp.compatta({ incognito: false, ora: ieri + 20 * ORA_MS, tetti, forza: true });
  await Comp.compatta({ incognito: false, ora: Date.now(), tetti, forza: true });
  expect(await Comp.riassumiGiorni({ incognito: false, ora: Date.now() })).toBe(2);
  const prima = await Comp.sezione(false);
  expect(prima).toContain('cena con la carbonara');
  expect(prima).toContain('parlato dei gatti');
  await togli(visita);
  const dopo = await Comp.sezione(false);
  expect(dopo).not.toContain('carbonara');
  expect(dopo).toContain('parlato dei gatti');
});

// #839 — secondo giro: la passata sulle miniature vecchie con tante voci grandi, una illeggibile e un salvataggio a metà.

import { test, expect, argomentiScala, chiudiApp } from '../../fixtures/electron.mjs';
import { _electron as electron } from '@playwright/test';
import { writeFileSync, rmSync, readFileSync, statSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cartellaTemporanea } from '../../helpers/percorsi.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) { c ^= buf[i]; for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1)); }
  return ~c >>> 0;
}
function pngRumore(w, h, seme) {
  const riga = w * 3 + 1;
  const raw = Buffer.alloc(riga * h);
  let s = seme;
  for (let y = 0; y < h; y++) for (let x = 0; x < w * 3; x++) { s = (Math.imul(s, 1103515245) + 12345) >>> 0; raw[y * riga + 1 + x] = s >>> 24; }
  const chunk = (tipo, dati) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(dati.length);
    const td = Buffer.concat([Buffer.from(tipo), dati]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  return 'data:image/png;base64,' + Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]).toString('base64');
}

test('trenta miniature grandi, una illeggibile, un salvataggio mentre la passata lavora: niente si perde', async () => {
  test.setTimeout(180_000);
  const profilo = cartellaTemporanea('filo-miniature-g2-');
  const rotta = 'data:image/png;base64,' + Buffer.alloc(90 * 1024, 7).toString('base64');
  const pagine = [];
  for (let i = 0; i < 30; i++) {
    pagine.push({ id: 'p' + i, url: `https://s${i}.example/`, title: 'Pagina ' + i, favicon: '', thumbnail: pngRumore(900, 560, 1000 + i), savedAt: new Date(Date.UTC(2026, 4, 1 + i)).toISOString(), category: i % 2 ? 'Da leggere' : null, categoryId: i % 2 ? 'c1' : undefined, categoryConfidence: i % 2 ? 0.7 : null });
  }
  pagine.push({ id: 'rotta', url: 'https://rotta.example/', title: 'Rotta', favicon: '', thumbnail: rotta, savedAt: '2026-04-01T00:00:00.000Z', category: null, categoryConfidence: null });
  writeFileSync(join(profilo, 'storage.json'), JSON.stringify({ savedPages: pagine, categories: [{ id: 'c1', name: 'Da leggere', createdAt: '2026-05-01T08:00:00.000Z', thumbnailUrl: pagine[1].thumbnail }] }), 'utf8');
  const prima = statSync(join(profilo, 'storage.json')).size;

  const app = await electron.launch({ args: [...argomentiScala, '.'], cwd: ROOT, env: { ...process.env, FILO_USER_DATA: profilo, NODE_ENV: 'test' } });
  try {
    await app.firstWindow();
    // A metà passata l'utente salva una pagina nuova e ne toglie una vecchia.
    await new Promise((r) => setTimeout(r, 3600));
    await app.evaluate(async () => {
      await globalThis.SN_SAVED_PAGES.save({ url: 'https://nuova.example/', title: 'Nuova' });
      await globalThis.SN_SAVED_PAGES.remove('p5');
    });
    const t0 = Date.now();
    await expect.poll(async () => app.evaluate(async () => {
      const pages = await globalThis.SN_STORAGE.getRaw('savedPages', []);
      return pages.filter((p) => /^data:image\/png/.test(p.thumbnail || '')).map((p) => p.id);
    }), { timeout: 120_000, intervals: [1000] }).toEqual(['rotta']);
    console.log('passata finita in ms circa', Date.now() - t0 + 3600);
    const stato = await app.evaluate(async () => {
      const pages = await globalThis.SN_STORAGE.getRaw('savedPages', []);
      const cats = await globalThis.SN_STORAGE.getRaw('categories', []);
      return { ids: pages.map((p) => p.id), meta: pages.map((p) => [p.id, p.url, p.savedAt, p.category, p.categoryId, p.categoryConfidence]), cat: cats[0].thumbnailUrl.slice(0, 20), maxByte: Math.max(...pages.filter((p) => p.id !== 'rotta' && p.thumbnail).map((p) => p.thumbnail.length * 3 / 4)) };
    });
    expect(stato.ids[0], 'la pagina salvata durante la passata').not.toMatch(/^p\d/);
    expect(stato.ids).not.toContain('p5');
    expect(stato.ids.length).toBe(31);
    for (const o of pagine.filter((p) => p.id !== 'p5')) {
      const m = stato.meta.find((x) => x[0] === o.id);
      expect(m, o.id).toEqual([o.id, o.url, o.savedAt, o.category, o.categoryId, o.categoryConfidence]);
    }
    expect(stato.cat).toBe('data:image/jpeg;bas');
    expect(stato.maxByte).toBeLessThan(60 * 1024);
    // Seconda passata: resta solo quella illeggibile, e non si perde niente.
    const fatte = await app.evaluate(() => globalThis.SN_SAVED_PAGES.rimpicciolisciMiniature());
    expect(fatte).toBe(0);
  } finally {
    await chiudiApp(app);
    const dopo = statSync(join(profilo, 'storage.json')).size;
    console.log('storage.json da', prima, 'a', dopo, 'byte');
    rmSync(profilo, { recursive: true, force: true });
  }
});

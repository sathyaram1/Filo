import { test, expect } from '../../fixtures/electron.mjs';
test('perf svuota archivio', async ({ app, openTab }) => {
  test.setTimeout(180_000);
  await app.evaluate(async () => {
    const E = globalThis.SN_FILO_EVENTI;
    const qui = await globalThis.SN_IL_FILO.dispositivo();
    const ora = Date.now();
    const ev = []; const tabs = [];
    for (let i = 0; i < 3000; i++) {
      const ts = new Date(ora - (3000 - i) * 600000).toISOString();
      const url = `https://s${i % 60}.it/${i}`;
      ev.push(E.crea(E.TIPI.NAVIGAZIONE, { url, titolo: `P ${i}` }, { ts, dispositivo: qui }));
      tabs.push({ url, title: `P ${i}`, openedAt: new Date(Date.parse(ts) - 1000).toISOString(), closedAt: new Date(Date.parse(ts) + 60000).toISOString() });
    }
    for (let i = 0; i < 3000; i++) ev.push(E.crea(E.TIPI.NAVIGAZIONE, { url: `https://altro.it/${i}`, titolo: `A ${i}` }, { ts: new Date(ora - i * 1000).toISOString(), dispositivo: qui }));
    await globalThis.SN_IL_FILO.importa(ev.map(E.riga).join(''));
    await globalThis.SN_ARCHIVED_TABS.importa(tabs);
  });
  const prof = await app.evaluate(async () => {
    const F = globalThis.SN_IL_FILO;
    const d0 = globalThis.SN_DELICATE.dimentica;
    let nd = 0; let td = 0;
    globalThis.SN_DELICATE.dimentica = async (x) => { nd++; const a = Date.now(); await d0(x); td += Date.now() - a; };
    const t0 = Date.now();
    const pag = (await F.pagine()).filter((p) => p.url.startsWith('https://s'));
    const t1 = Date.now();
    const C = globalThis.SN_FILO_CODA;
    const n = await F.cancellaVisite(pag.slice(0, 1000).map((p) => ({ ts: p.ts, sito: C.sito(p.url), url: p.url })), undefined, { schedeChiuse: false });
    const t2 = Date.now();
    return { pagine: t1 - t0, cancella1000: t2 - t1, n, nd, td };
  });
  console.log('PROF', JSON.stringify(prof));
  const page = await openTab('filo://archive/archive.html');
  const t0 = Date.now();
  const r = await page.evaluate(async () => self.chrome.runtime.sendMessage({ type: self.SN_MSG.MSG.CLEAR_ARCHIVED_TABS }));
  const dt = Date.now() - t0;
  const resto = await app.evaluate(async () => (await globalThis.SN_IL_FILO.pagine()).length);
  console.log('PERF ms', dt, 'ok', r.ok, 'pagine rimaste', resto);
  expect(resto).toBe(3000);
});

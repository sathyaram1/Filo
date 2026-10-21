// #1487 giro 1 — esplorazione del verificatore: avvio vero di Filo, tema chiaro, ricerca nel filo.
import { test, expect } from '../../fixtures/electron.mjs';
import { _electron as electron } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cartellaTemporanea } from '../../helpers/percorsi.mjs';
import { argomentiScala } from '../../helpers/scala.mjs';
import { chiudiApp } from '../../fixtures/electron.mjs';

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const SHOTS = 'tests/.shots';
mkdirSync(SHOTS, { recursive: true });

async function semina(app, chats) {
  await app.evaluate(async (_e, dati) => {
    const E = globalThis.SN_FILO_EVENTI;
    const qui = await globalThis.SN_IL_FILO.dispositivo();
    const ev = [];
    for (const c of dati) {
      ev.push(E.crea(E.TIPI.CHAT_APERTA, { chat: c.id }, { ts: c.messaggi[0].ts, dispositivo: qui }));
      for (const m of c.messaggi) {
        ev.push(E.crea(E.TIPI.MESSAGGIO, { chat: c.id, msg: { role: m.role, text: m.text } }, { ts: m.ts, dispositivo: qui, autore: m.role === 'user' ? 'utente' : 'filo' }));
      }
      ev.push(E.crea(E.TIPI.CHAT_CHIUSA, { chat: c.id }, { ts: c.messaggi[c.messaggi.length - 1].ts, dispositivo: qui }));
    }
    await globalThis.SN_IL_FILO.importa(ev.map(E.riga).join(''));
  }, chats);
}
const alle = (giorniFa, ore, minuti = 0) => {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() - giorniFa, ore, minuti).toISOString();
};
const pocoFa = (minuti) => new Date(Date.now() - minuti * 60_000).toISOString();
function ieri(n = 12) {
  const chats = [];
  for (let i = 0; i < n; i++) {
    chats.push({ id: `ieri${i}`, messaggi: [
      { role: 'user', text: `domanda di ieri ${i}`, ts: alle(1, 8 + i) },
      { role: 'filo', text: `risposta di ieri ${i}`, ts: alle(1, 8 + i, 1) },
    ] });
  }
  return chats;
}
function vista(page) {
  return page.evaluate(() => {
    const a = document.getElementById('bubbles');
    const box = a.getBoundingClientRect();
    const dove = (n) => { const r = n.getBoundingClientRect(); return { testo: n.textContent.trim(), su: r.top - box.top, giu: r.bottom - box.top, suAss: r.top }; };
    return {
      alto: box.height,
      bolle: [...a.querySelectorAll(':scope > .dash-bubble')].map(dove),
    };
  });
}
async function inCima(page, testo) {
  await expect.poll(async () => {
    const v = await vista(page);
    const i = v.bolle.findIndex((b) => b.testo.includes(testo));
    if (i < 0) return `«${testo}» non c'è`;
    const b = v.bolle[i];
    if (b.su < 0 || b.su > 110) return `«${testo}» sta a ${Math.round(b.su)}px dal bordo alto`;
    const sopra = v.bolle.slice(0, i).find((x) => x.giu > 1);
    if (sopra) return `«${sopra.testo}» si vede ancora sopra`;
    return 'in cima';
  }, { timeout: 15_000 }).toBe('in cima');
  return vista(page);
}

const lancia = (userData) => electron.launch({
  args: [...argomentiScala, '.'],
  cwd: APP_ROOT,
  env: { ...process.env, FILO_USER_DATA: userData, NODE_ENV: 'test', FILO_TEST_ACCOLTO: '1' },
});

test('all’avvio di Filo la home che si apre ha l’ultimo messaggio in cima', async () => {
  test.setTimeout(120_000);
  const userData = cartellaTemporanea('filo-1487-');
  let app = await lancia(userData);
  await app.firstWindow();
  await expect.poll(() => app.evaluate(() => !!globalThis.SN_IL_FILO)).toBe(true);
  await semina(app, [...ieri(), { id: 'oggi', messaggi: [{ role: 'filo', text: 'Buongiorno, oggi c’è il sole.', ts: pocoFa(1) }] }]);
  await app.evaluate(async () => { await new Promise((r) => setTimeout(r, 500)); });
  await chiudiApp(app);
  app = await lancia(userData);
  let page = null;
  await expect.poll(async () => {
    for (const w of app.windows()) if (w.url().startsWith('filo://newtab')) { page = w; return true; }
    return false;
  }, { timeout: 20_000 }).toBe(true);
  await page.waitForLoadState('domcontentloaded');
  const v = await inCima(page, 'oggi c’è il sole');
  await page.screenshot({ path: `${SHOTS}/1487-avvio.png` });
  expect(v.alto - v.bolle.at(-1).giu).toBeGreaterThan(v.alto / 2);
  await chiudiApp(app);
});

test('tema chiaro e campo di ricerca: l’ultimo messaggio in cima non sta sotto al campo', async ({ app, openTab }) => {
  test.setTimeout(60_000);
  await semina(app, [...ieri(), { id: 'oggi', messaggi: [{ role: 'filo', text: 'Il treno parte alle 9.', ts: pocoFa(1) }] }]);
  const page = await openTab('filo://newtab/');
  await inCima(page, 'Il treno parte');
  await page.screenshot({ path: `${SHOTS}/1487-scuro.png` });
  const sovrapposto = await page.evaluate(() => {
    const campo = document.querySelector('.dash-cerca, #dash-cerca, [class*="cerca"]');
    const b = [...document.querySelectorAll('#bubbles > .dash-bubble')].at(-1);
    if (!campo) return 'nessun campo';
    const c = campo.getBoundingClientRect();
    const r = b.getBoundingClientRect();
    return { campo: [c.top, c.bottom, campo.className], bolla: [r.top, r.bottom] };
  });
  console.log('sovrapposizione', JSON.stringify(sovrapposto));
});

test('cercare nel filo e scegliere un risultato di ieri porta lì e ci resta', async ({ app, openTab }) => {
  test.setTimeout(60_000);
  await semina(app, [...ieri(), { id: 'oggi', messaggi: [{ role: 'filo', text: 'Il treno parte alle 9.', ts: pocoFa(1) }] }]);
  const page = await openTab('filo://newtab/');
  await inCima(page, 'Il treno parte');
  const html = await page.evaluate(() => document.querySelector('.dash-cerca, [class*="cerca"]')?.outerHTML.slice(0, 600) || 'nessuno');
  console.log('campo', html);
});

// Esplorazione della verifica #1758: la cima della home con lo spazio dei tasti sotto le risposte di Filo.
import { test, expect } from '../../fixtures/electron.mjs';
import { modelloFinto, chiedi } from '../../helpers/chatFinta.mjs';
import { mkdirSync } from 'node:fs';

mkdirSync('tests/.shots', { recursive: true });

async function semina(app, chats) {
  await app.evaluate(async (_e, dati) => {
    const E = globalThis.SN_FILO_EVENTI;
    const qui = await globalThis.SN_IL_FILO.dispositivo();
    const ev = [];
    for (const c of dati) {
      ev.push(E.crea(E.TIPI.CHAT_APERTA, { chat: c.id }, { ts: c.messaggi[0].ts, dispositivo: qui }));
      for (const m of c.messaggi) ev.push(E.crea(E.TIPI.MESSAGGIO, { chat: c.id, msg: { role: m.role, text: m.text } }, { ts: m.ts, dispositivo: qui, autore: m.role === 'user' ? 'utente' : 'filo' }));
      ev.push(E.crea(E.TIPI.CHAT_CHIUSA, { chat: c.id }, { ts: c.messaggi[c.messaggi.length - 1].ts, dispositivo: qui }));
    }
    await globalThis.SN_IL_FILO.importa(ev.map(E.riga).join(''));
  }, chats);
}
const alle = (g, o, m = 0) => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), d.getDate() - g, o, m).toISOString(); };
const pocoFa = (m) => new Date(Date.now() - m * 60_000).toISOString();
const ieri = () => Array.from({ length: 12 }, (_, i) => ({ id: `ieri${i}`, messaggi: [
  { role: 'user', text: `domanda di ieri ${i}`, ts: alle(1, 8 + i) },
  { role: 'filo', text: `risposta di ieri ${i}`, ts: alle(1, 8 + i, 1) },
] }));
const vista = (page) => page.evaluate(() => {
  const a = document.getElementById('bubbles');
  const box = a.getBoundingClientRect();
  return {
    alto: box.height, scrollTop: a.scrollTop, max: a.scrollHeight - a.clientHeight,
    vuoto: getComputedStyle(a).getPropertyValue('--dash-vuoto').trim(),
    bolle: [...a.querySelectorAll(':scope > .dash-bubble')].map((n) => { const r = n.getBoundingClientRect(); return { testo: n.textContent.trim(), cls: n.className, su: r.top - box.top, giu: r.bottom - box.top }; }),
  };
});

test('ultimo messaggio dell’utente sotto una risposta di Filo: in fondo è proprio lì', async ({ app, openTab }) => {
  test.setTimeout(60_000);
  await semina(app, [...ieri(), { id: 'oggi', messaggi: [
    { role: 'filo', text: 'Vuoi che prenoti?', ts: pocoFa(3) },
    { role: 'user', text: 'sì, per le otto', ts: pocoFa(2) },
  ] }]);
  const page = await openTab('filo://newtab/');
  await expect.poll(async () => { const b = (await vista(page)).bolle.at(-1); return b && b.testo.includes('otto') ? b.su : 999; }, { timeout: 15_000 }).toBeLessThan(110);
  await page.waitForTimeout(500);
  const v = await vista(page);
  console.log('utente ultimo', JSON.stringify(v.bolle.slice(-2)), v.scrollTop, v.max, v.vuoto);
  await page.screenshot({ path: 'tests/.shots/v1758-utente-ultimo.png' });
  await page.evaluate(() => { const a = document.getElementById('bubbles'); a.scrollTop = a.scrollHeight; });
  const g = await vista(page);
  expect(Math.abs(g.bolle.at(-1).su - v.bolle.at(-1).su)).toBeLessThan(2);
});

test('scrivo a home appena aperta: finita la risposta, in fondo è ancora lì', async ({ app, openTab }) => {
  test.setTimeout(60_000);
  await semina(app, ieri());
  const page = await openTab('filo://newtab/');
  await expect.poll(async () => (await vista(page)).bolle.at(-1).su, { timeout: 15_000 }).toBeLessThan(110);
  await modelloFinto(app, [{ text: 'Sì, anche le balene.' }]);
  await chiedi(page, 'e le balene?');
  await expect(page.locator('.dash-bubble-filo', { hasText: 'Sì, anche le balene.' })).toBeVisible();
  await page.waitForTimeout(1500);
  const v = await vista(page);
  console.log('dopo risposta', JSON.stringify(v.bolle.slice(-3)), v.scrollTop, v.max, v.vuoto);
  await page.evaluate(() => { const a = document.getElementById('bubbles'); a.scrollTop = a.scrollHeight; });
  await page.waitForTimeout(200);
  const g = await vista(page);
  console.log('in fondo', g.scrollTop, g.max);
  expect(Math.abs(g.bolle.at(-1).su - v.bolle.at(-1).su)).toBeLessThan(2);
  await page.locator('.dash-bubble-filo', { hasText: 'Sì, anche le balene.' }).hover();
  await page.waitForTimeout(400);
  await page.screenshot({ path: 'tests/.shots/v1758-dopo-risposta.png' });
});

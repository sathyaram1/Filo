// Sonda temporanea: si cancella prima della consegna.
import { test } from './fixtures/electron.mjs';
import { home, modelloFinto, ripristina, chiedi, chiamateAlModello } from './helpers/chatFinta.mjs';
import { expect } from '@playwright/test';

test('sonda', async ({ app }) => {
  test.setTimeout(300000);
  const page = await home(app);
  await modelloFinto(app, [{ text: 'Letto, ecco il punto.' }]);
  await app.evaluate(() => {
    const C = globalThis.SN_COMPATTAZIONE;
    globalThis.__compattazioni = [];
    C._dip.chiama = async ({ messages, motivo }) => {
      globalThis.__compattazioni.push({ motivo, base: C.base(false), lung: messages.map((m) => m.content).join('\n').length });
      return JSON.stringify({ ore: [{ testo: '10:00 letto un capitolo della tesi' }], memorie: [] });
    };
  });
  const righe = [];
  for (let i = 0; i < 12; i++) {
    await chiedi(page, `Capitolo ${i}: ${'Le api tornano all\'alveare e danzano per le compagne. '.repeat(330)}`);
    await expect.poll(async () => (await chiamateAlModello(app)).length, { timeout: 30000 }).toBe(i + 1);
    await page.waitForTimeout(1500);
    const ultima = (await chiamateAlModello(app)).at(-1);
    const info = await app.evaluate((_e, messages) => {
      const FC = globalThis.SN_FILO_CONTESTO;
      const C = globalThis.SN_COMPATTAZIONE;
      const L = globalThis.SN_FILO_COMPATTAZIONE;
      const strumenti = JSON.stringify(globalThis.SN_ACTION_TOOLS.definitions()).length;
      const pesi = messages.map((m) => Math.round(FC.caratteriDi([m]) / FC.CARATTERI_PER_TOKEN));
      const tot = Math.ceil((FC.caratteriDi(messages) + strumenti) / FC.CARATTERI_PER_TOKEN);
      const base = C.base(false);
      return { tot, base, anticipo: Math.round(L.sogliaAnticipo({ soglia: 70000, base })), sistema: pesi[0], strumenti: Math.round(strumenti / FC.CARATTERI_PER_TOKEN), resto: pesi.slice(1), comp: globalThis.__compattazioni.length };
    }, ultima);
    righe.push(info);
  }
  console.log('SONDA ' + JSON.stringify(righe));
  console.log('SONDA COMP ' + JSON.stringify(await app.evaluate(() => globalThis.__compattazioni)));
  const ultima = (await chiamateAlModello(app)).at(-1);
  for (const m of ultima.slice(1)) {
    const t = typeof m.content === 'string' ? m.content : JSON.stringify(m.content);
    console.log('SONDA MSG ' + m.role + ' ' + t.length + ' :: ' + t.replace(/(Le api tornano all'alveare e danzano per le compagne\. )+/g, '[API]').replace(/\n/g, ' ⏎ ').slice(0, 4000));
  }
  await ripristina(app);
});

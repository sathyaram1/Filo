// #553.14 giro 1: «portami alla home» chiesto dalla home, poi la home riletta (scheda nuova, home ricaricata, Filo
// riaperto): sotto la risposta non si legge un comando fatto, e il modello nei turni dopo non crede di aver mosso niente.

import { test, expect } from '../../fixtures/electron.mjs';
import { home, modelloFinto, chiedi, chiamateAlModello, ripristina } from '../../helpers/chatFinta.mjs';

const GIRI = [
  { toolCalls: [{ id: 'h1', name: 'COMANDO_FINESTRA', arguments: '{"comando":"home"}' }] },
  { text: 'Sei già qui, nella home.' },
  { text: 'Va bene.' },
];

async function chiediLaHome(app) {
  const page = await home(app);
  await modelloFinto(app, GIRI);
  await chiedi(page, 'portami alla home');
  await expect(page.locator('.dash-bubble-filo', { hasText: 'Sei già qui' })).toBeVisible({ timeout: 10_000 });
  await expect.poll(() => app.evaluate(async () => (await globalThis.SN_IL_FILO.chats())
    .some((c) => c.messages.some((m) => m.role === 'filo' && /Sei già qui/.test(m.text))))).toBe(true);
  return page;
}

// Testo e fumetti di tutto quello che la home mostra: un «azionato» nascosto in un title è la stessa bugia.
const tuttoIlDetto = (p) => p.locator('#bubbles').evaluate((el) => [el.innerText,
  ...[...el.querySelectorAll('[title]')].map((n) => n.getAttribute('title'))].join('\n'));

test('la home riletta da una scheda nuova, ricaricata e dopo un riavvio non racconta un comando fatto', async ({ app, openTab }) => {
  test.setTimeout(120_000);
  const page = await chiediLaHome(app);
  const dalVivo = await tuttoIlDetto(page);
  expect(dalVivo).not.toMatch(/azionato un comando/i);
  await page.screenshot({ path: 'tests/.shots/553-14-dal-vivo.png' });

  const nuova = await openTab('filo://newtab/');
  await expect(nuova.locator('#bubbles .dash-bubble-filo', { hasText: 'Sei già qui' })).toBeVisible({ timeout: 10_000 });
  await nuova.screenshot({ path: 'tests/.shots/553-14-scheda-nuova.png' });
  const inNuova = await tuttoIlDetto(nuova);
  expect(inNuova).not.toMatch(/azionato un comando|Home aperta/i);
  expect(inNuova).toContain('Sei già nella home');

  // Filo riaperto: la memoria degli esiti non c'è più, resta il disco.
  await app.evaluate(() => globalThis.SN_CONTESTO_FILO.dimentica());
  await page.reload();
  await expect(page.locator('#bubbles .dash-bubble-filo', { hasText: 'Sei già qui' })).toBeVisible({ timeout: 10_000 });
  const ricaricata = await tuttoIlDetto(page);
  expect(ricaricata).not.toMatch(/azionato un comando|Home aperta/i);
  expect(ricaricata).toContain('Sei già nella home');
  await page.screenshot({ path: 'tests/.shots/553-14-ricaricata.png' });

  // Il turno dopo: quello che il modello rilegge di quello scambio non dice che la finestra si è mossa.
  const prima = (await chiamateAlModello(app)).length;
  await chiedi(page, 'grazie');
  await expect(page.locator('.dash-bubble-filo', { hasText: 'Va bene.' })).toBeVisible({ timeout: 10_000 });
  const ultima = (await chiamateAlModello(app))[prima];
  const testo = (m) => (typeof m.content === 'string' ? m.content
    : Array.isArray(m.content) ? m.content.map((p) => p.text || '').join('\n') : '');
  const scambio = ultima.filter((m) => m.role === 'assistant' && /Sei già qui/.test(testo(m))).map(testo).join('\n');
  expect(scambio, 'il modello rilegge lo scambio della home').not.toBe('');
  expect(scambio).not.toMatch(/- fatta:|Home aperta|azioni di questo turno/i);
  expect(scambio).toMatch(/Sei già nella home/);
  await ripristina(app);
});

// #2096 giro 4 — due dispositivi Bluetooth con lo stesso nome (due controller uguali): il comando dato dal tasto destro
// su una riga tocca il dispositivo di QUELLA riga, non il primo con quel nome. Il computer è finto.
import { test, expect } from '../../fixtures/electron.mjs';
import { home } from '../../helpers/chatFinta.mjs';
import { menuDi } from '../../helpers/menuContestuale.mjs';
import { clickConfirm } from '../../helpers/confirm.mjs';

const PARTENZA = {
  batteria: { livello: 70, inCarica: false, collegata: false },
  rete: { online: true, tipo: 'wifi', nome: 'Casa' },
  bluetooth: { acceso: true, dispositivi: [] },
  volume: { livello: 25, muto: false },
  wifi: { acceso: true },
};
const PRIMO = '00:11:22:33:44:55';
const SECONDO = '66:77:88:99:AA:BB';

async function computerFinto(app) {
  await app.evaluate(async (_, a) => {
    const pc = JSON.parse(JSON.stringify(a.stato));
    globalThis.__pc = pc;
    globalThis.__pcChiamate = [];
    const disp = [
      { indirizzo: a.primo, nome: 'Wireless Controller', collegato: false },
      { indirizzo: a.secondo, nome: 'Wireless Controller', collegato: true },
    ];
    const traccia = (nome, p) => globalThis.__pcChiamate.push([nome, p || {}]);
    globalThis.SN_COMANDI_SISTEMA._perProve.usaComputer({
      async volume() { return { ok: true, volume: 25, muto: false, prima: 25 }; },
      async radio(p) { return { ok: true, acceso: p.acceso }; },
      async btElenco() { return { ok: true, acceso: true, dispositivi: disp.map((d) => ({ ...d })) }; },
      async btCollega(p) { traccia('btCollega', p); disp.find((x) => x.indirizzo === p.indirizzo).collegato = p.collega; return { ok: true, collegato: p.collega }; },
      async btDimentica(p) { traccia('btDimentica', p); disp.splice(disp.findIndex((x) => x.indirizzo === p.indirizzo), 1); return { ok: true }; },
      async wifiElenco() { return { ok: true, acceso: true, reti: [], attuale: 'Casa' }; },
    });
    await globalThis.SN_SISTEMA_MAIN._perProve.usaLettore(async () => globalThis.__pc);
  }, { stato: PARTENZA, primo: PRIMO, secondo: SECONDO });
}

test.afterEach(async ({ app }) => {
  await app.evaluate(() => {
    globalThis.SN_COMANDI_SISTEMA._perProve.usaComputer(null);
    globalThis.SN_SISTEMA_MAIN._perProve.usaLettore(null);
  }).catch(() => {});
});

const chiamate = (app) => app.evaluate(() => globalThis.__pcChiamate);
const righe = (page) => page.locator('.dash-sis-box .dash-sis-elenco .sn-select-option');

async function apriElenco(app) {
  const page = await home(app);
  const v = page.locator('#sistema .dash-sis-voce[data-voce="bluetooth"]');
  await expect(v).toBeVisible({ timeout: 8_000 });
  await v.click();
  await expect(righe(page)).toHaveCount(2);
  return page;
}

test('r2 Scollega sulla riga del controller collegato scollega quello, non l’altro con lo stesso nome', async ({ app }) => {
  test.setTimeout(90_000);
  await computerFinto(app);
  const page = await apriElenco(app);
  const collegato = righe(page).filter({ hasText: /collegat/i }).first();
  const bersaglio = (await collegato.count()) ? collegato : righe(page).nth(1);
  await bersaglio.click({ button: 'right' });
  await menuDi(page).voce('Scollega').first().click();
  await expect.poll(() => chiamate(app), { timeout: 8_000 }).toEqual([['btCollega', { indirizzo: SECONDO, collega: false }]]);
});

test('r2 Dimentica sulla seconda riga dimentica il secondo controller, non il primo con lo stesso nome', async ({ app }) => {
  test.setTimeout(90_000);
  await computerFinto(app);
  const page = await apriElenco(app);
  // La riga che offre Scollega è quella del controller collegato, il secondo.
  let riga = null;
  for (let k = 0; k < 2; k++) {
    await righe(page).nth(k).click({ button: 'right' });
    const voci = await menuDi(page).voci.evaluateAll((vs) => vs.map((v) => v.textContent.trim()));
    if (voci.includes('Scollega')) { riga = k; break; }
    await page.keyboard.press('Escape');
  }
  expect(riga).not.toBeNull();
  await menuDi(page).voce('Dimentica…').first().click();
  await clickConfirm(page, 'ok');
  await expect.poll(() => chiamate(app), { timeout: 8_000 }).toEqual([['btDimentica', { indirizzo: SECONDO }]]);
});

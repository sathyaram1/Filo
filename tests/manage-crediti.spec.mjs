// Gestione → Routine → Crediti (#1356, SPEC-DOMANDE.md §8.2): riserva di A, tetto di B, taratura e rinnovi dell'owner.
// Cosa deve reggere: un numero non letto non si inventa, si scrive solo il campo toccato, vuoto toglie il numero,
// un valore storto o un salvataggio fallito non cambiano niente e lo dicono, ogni account dice dove è.
// Il main è finto in pagina (come manage-sessioni-routine.spec.mjs): la porta vera la prova tests/unit/routineCrediti.test.mjs.

import { test, expect } from './fixtures/electron.mjs';
import { apriScheda } from './helpers/gestione.mjs';

const URL = 'filo://manage/manage.html';

const STATO = {
  ok: true, freni: 'attivi',
  numeri: { riservaA: 10, tettoB: null, usdPer100: 2150, rinnovoA: null, rinnovoB: null },
  accounts: {
    A: { pct: 46.5, limite: 90, passo: { spesoPct: 3, quotaPct: 12.4, giornoDaMs: Date.parse('2026-10-12T17:00:00Z') }, rinnovoAtMs: Date.parse('2026-10-13T17:00:00Z'), fermo: '', basseAperte: false },
    B: { pct: 20, limite: null, passo: { spesoPct: 21, quotaPct: 20, giornoDaMs: Date.parse('2026-10-13T07:00:00Z') }, rinnovoAtMs: Date.parse('2026-10-14T07:00:00Z'), fermo: 'passo', basseAperte: false },
  },
};

// Un main finto con lo stato del server: `set` scrive come ownerCrediti (null toglie), `falliscono` fa fallire le scritture.
async function apri(openTab, { stato = STATO, owner = true, letturaFallita = false, falliscono = false } = {}) {
  const page = await openTab(URL);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.filo && window.SN_ROUTINE_CREDITI && window.__mgCrediti);
  await page.evaluate(({ s, owner, letturaFallita, falliscono }) => {
    window.__cr = { stato: JSON.parse(JSON.stringify(s)), inviati: [], letture: 0 };
    const orig = window.filo.message.bind(window.filo);
    window.filo.message = async (msg) => {
      if (msg && msg.type === 'auth_status') return { ok: true, isAdmin: owner, signedIn: true };
      if (msg && msg.type === 'routine_crediti_get') {
        window.__cr.letture += 1;
        return letturaFallita ? { ok: false, error: 'rete giù' } : JSON.parse(JSON.stringify(window.__cr.stato));
      }
      if (msg && msg.type === 'routine_crediti_set') {
        const { type: _t, ...campi } = msg;
        window.__cr.inviati.push(campi);
        if (falliscono) return { ok: false, error: 'Il server non risponde.' };
        Object.assign(window.__cr.stato.numeri, campi);
        return JSON.parse(JSON.stringify(window.__cr.stato));
      }
      return orig(msg);
    };
  }, { s: stato, owner, letturaFallita, falliscono });
  await page.evaluate(() => window.__mgTest.setAdmin(true));
  await apriScheda(page, 'crediti');
  await expect(page.locator('#panel-crediti')).toHaveClass(/mg-panel--active/);
  return page;
}

test('la scheda Crediti sta fra le Routine e mostra i numeri del server, uno per account', async ({ openTab }) => {
  const page = await apri(openTab);
  await expect(page.locator('#mgCrRiservaA')).toHaveValue('10');
  await expect(page.locator('#mgCrTettoB')).toHaveValue('', { timeout: 5000 });
  await expect(page.locator('#mgCrTaratura')).toHaveValue('2150');
  await expect(page.locator('#mgCrRinnovoA')).toHaveValue('');
  await expect(page.locator('#mgCrRigaA')).toContainText('46,5% della settimana, limite 90% · oggi 3% su 12,4%');
  await expect(page.locator('#mgCrRigaB')).toContainText('fermo fino a');
  await expect(page.locator('#mgCrAvviso')).toBeHidden();
  // Nessun campo mente su una lettura: niente «non letto» se la lettura c'è.
  await expect(page.locator('#mgCrRiservaAMsg')).toHaveText('');
});

test('lettura fallita: campi vuoti, e ogni campo lo dice', async ({ openTab }) => {
  const page = await apri(openTab, { letturaFallita: true });
  for (const id of ['#mgCrRiservaA', '#mgCrTettoB', '#mgCrTaratura']) await expect(page.locator(id)).toHaveValue('');
  for (const id of ['#mgCrRiservaAMsg', '#mgCrTettoBMsg', '#mgCrTaraturaMsg', '#mgCrRinnovoAMsg']) {
    await expect(page.locator(id)).toContainText('Non ho potuto leggere dal server');
  }
  await expect(page.locator('#mgCrRigaA')).toHaveText('–');
});

test('si salva solo il campo toccato: virgola come decimale, Invio come Salva; vuoto toglie il numero', async ({ openTab }) => {
  const page = await apri(openTab);
  await page.locator('#mgCrRiservaA').fill('12,5');
  await page.locator('#mgCrRiservaA').press('Enter');
  await expect(page.locator('#mgCrRiservaAMsg')).toHaveText('Salvato.');
  await expect(page.locator('#mgCrRiservaA')).toHaveValue('12,5');
  expect(await page.evaluate(() => window.__cr.inviati)).toEqual([{ riservaA: 12.5 }]);

  await page.locator('#mgCrTaratura').fill('');
  await page.locator('#mgCrTaraturaSave').click();
  await expect(page.locator('#mgCrTaraturaMsg')).toHaveText('Tolta: vale quella predefinita, 2.150 $.');
  expect((await page.evaluate(() => window.__cr.inviati)).pop()).toEqual({ usdPer100: null });
  // La riserva salvata prima resta al suo posto.
  await expect(page.locator('#mgCrRiservaA')).toHaveValue('12,5');
});

test('un valore storto non parte e lo dice', async ({ openTab }) => {
  const page = await apri(openTab);
  await page.locator('#mgCrTettoB').fill('140');
  await page.locator('#mgCrTettoBSave').click();
  await expect(page.locator('#mgCrTettoBMsg')).toHaveText('Tetto di B: da 0 a 100. Non salvato.');
  expect(await page.evaluate(() => window.__cr.inviati)).toEqual([]);
});

test('un salvataggio fallito rimette il numero del server e lo dice', async ({ openTab }) => {
  const page = await apri(openTab, { falliscono: true });
  await page.locator('#mgCrRiservaA').fill('30');
  await page.locator('#mgCrRiservaASave').click();
  await expect(page.locator('#mgCrRiservaAMsg')).toContainText('Salvataggio non riuscito: il numero NON è cambiato.');
  await expect(page.locator('#mgCrRiservaA')).toHaveValue('10');
});

test('rinnovo: un giorno e un ora nel campo data vanno al server in millisecondi, e tornano', async ({ openTab }) => {
  const page = await apri(openTab);
  await page.locator('#mgCrRinnovoB').fill('2026-10-16T12:00');
  await page.locator('#mgCrRinnovoBSave').click();
  await expect(page.locator('#mgCrRinnovoBMsg')).toHaveText('Salvato.');
  const atteso = await page.evaluate(() => new Date(2026, 9, 16, 12, 0).getTime());
  expect(await page.evaluate(() => window.__cr.inviati)).toEqual([{ rinnovoB: atteso }]);
  await page.evaluate(() => window.__mgCrediti.carica());
  await expect(page.locator('#mgCrRinnovoB')).toHaveValue('2026-10-16T12:00');
  // Dal tasto destro si toglie, come col campo vuoto.
  await page.locator('#mgCrRinnovoB').click({ button: 'right' });
  await page.locator('.mg-ctxmenu .sn-select-option', { hasText: 'Togli il numero' }).click();
  await expect(page.locator('#mgCrRinnovoBMsg')).toHaveText('Tolto: vale mercoledì alle 9.');
  expect((await page.evaluate(() => window.__cr.inviati)).pop()).toEqual({ rinnovoB: null });
  await expect(page.locator('#mgCrRinnovoB')).toHaveValue('');
});

test('senza riserva né tetto la scheda dice che i crediti non frenano niente', async ({ openTab }) => {
  const senza = JSON.parse(JSON.stringify(STATO));
  Object.assign(senza, { freni: 'numeri_assenti' });
  senza.numeri.riservaA = null;
  const page = await apri(openTab, { stato: senza });
  await expect(page.locator('#mgCrAvviso')).toBeVisible();
  await expect(page.locator('#mgCrAvviso')).toContainText('i crediti non frenano le routine');
  await expect(page.locator('#mgCrRiservaA')).toHaveValue('');
});

test('chi non è owner non legge e non tocca niente', async ({ openTab }) => {
  const page = await apri(openTab, { owner: false });
  await expect(page.locator('#mgCrRiservaA')).toBeDisabled();
  await expect(page.locator('#mgCrRinnovoASave')).toBeDisabled();
  expect(await page.evaluate(() => window.__cr.letture)).toBe(0);
});

test('aspetto: chiaro e scuro', async ({ openTab }) => {
  const page = await apri(openTab);
  await page.setViewportSize({ width: 1280, height: 800 });
  for (const tema of ['light', 'dark']) {
    await page.evaluate((t) => document.documentElement.setAttribute('data-sn-theme', t), tema);
    await page.screenshot({ path: `tests/.shots/manage-crediti-${tema}.png` });
  }
  await page.setViewportSize({ width: 700, height: 900 });
  await page.screenshot({ path: 'tests/.shots/manage-crediti-stretta.png', fullPage: true });
});

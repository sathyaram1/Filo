// Esplorazione della verifica #1462 giro 2: la scheda piena (sette copie su ogni blocco) in chiaro e scuro, nessun dato,
// un intervallo oltre il tetto. Asserisce il successo dal punto di vista dell'owner.

import { test, expect } from '../../fixtures/electron.mjs';
import { mkdirSync } from 'node:fs';
import { GESTIONE, ricaricaSu } from '../../helpers/gestione.mjs';

const SHOTS = 'tests/.shots';

async function mainFinto(app, { copie = 7, vuoto = false } = {}) {
  await app.evaluate(({ copie, vuoto }) => {
    const ga = process.getBuiltinModule('module').createRequire(process.cwd() + '/src/main/main.js')('./auth/google-auth');
    if (!globalThis.__vfVeri) globalThis.__vfVeri = { isAdmin: ga.isAdmin, getIdToken: ga.getIdToken, fetch: globalThis.fetch };
    ga.isAdmin = () => true;
    ga.getIdToken = async () => 'token-finto';
    const C = globalThis.SN_CONTATORI;
    const giorno = (n) => { const d = new Date(); d.setHours(12, 0, 0, 0); d.setDate(d.getDate() - n); return C.giornoDi(d.getTime()); };
    const pseudo = (i) => `beef${String(i).padStart(16, '0')}`;
    const f0 = C.funzioni()[0];
    const t0 = C.tipiAzione()[0];
    const passi = C.passiIntervista();
    const docs = [];
    if (!vuoto) {
      for (let i = 0; i < copie; i++) {
        for (const gg of [1, 2]) {
          const ora = C.oraVuota();
          C.registraAzione(ora, 'new-tab', { visto: 300, fine: 1500 });
          C.registraUso(ora, f0, { visto: 2500, fine: 9000 });
          C.registraRicerca(ora, 'cerca-filo', { esito: 'aperta' });
          C.registraRicerca(ora, 'cerca-filo', { esito: 'scelta', attesaMs: 1200, posizione: 1 });
          C.registraProposta(ora, 'ortografia', 'deepseek/deepseek-v4-flash', 'mostrata');
          C.registraProposta(ora, 'ortografia', 'deepseek/deepseek-v4-flash', 'accettata');
          C.registraConferma(ora, t0, { esito: 'approvata' });
          C.registraAnnullato(ora, t0);
          C.registraImpostazione(ora, 'theme', 'dark', 'mano');
          C.registraAnticipo(ora, f0, 'preparato');
          C.registraAnticipo(ora, f0, 'preparato');
          C.registraAnticipo(ora, f0, 'aperto');
          C.registraChiesto(ora, f0);
          C.registraErroreVisto(ora, 'crash:scheda:oom');
          C.registraIntervista(ora, passi[0], 'spuntata');
          C.registraIntervista(ora, passi[1], 'abbandono');
          C.registraPrimaVolta(ora, f0);
          docs.push(C.documento({ pseudonimo: pseudo(i), chiave: `${giorno(gg)}T${i % 2 ? '09' : '14'}`, app: '0.2.300', os: 'win', dati: ora }));
        }
      }
    }
    const valoreFs = (v) => {
      if (typeof v === 'string') return { stringValue: v };
      if (typeof v === 'number') return { integerValue: String(v) };
      if (Array.isArray(v)) return { arrayValue: { values: v.map(valoreFs) } };
      return { mapValue: { fields: Object.fromEntries(Object.entries(v).map(([k, x]) => [k, valoreFs(x)])) } };
    };
    globalThis.fetch = async (url, init) => {
      let q = null;
      try { q = JSON.parse((init && init.body) || 'null').structuredQuery; } catch (_) {}
      const filtri = q && q.where && q.where.compositeFilter && q.where.compositeFilter.filters;
      if (!String(url).includes(':runQuery') || !q || q.from[0].collectionId !== C.COLLEZIONE || !Array.isArray(filtri)) {
        return globalThis.__vfVeri.fetch(url, init);
      }
      const [dal, al] = filtri.map((f) => f.fieldFilter.value.stringValue);
      const righe = docs.filter((d) => d.giorno >= dal && d.giorno <= al).map((d) => ({
        document: { name: `progetti/x/contatori-giornalieri/${C.idDocumento(d)}`, fields: Object.fromEntries(Object.entries(d).map(([k, v]) => [k, valoreFs(v)])) },
      }));
      return new Response(JSON.stringify(righe.length ? righe : [{ readTime: 'adesso' }]), { status: 200 });
    };
  }, { copie, vuoto });
}

async function rimetti(app) {
  await app.evaluate(() => {
    const v = globalThis.__vfVeri;
    if (!v) return;
    const ga = process.getBuiltinModule('module').createRequire(process.cwd() + '/src/main/main.js')('./auth/google-auth');
    ga.isAdmin = v.isAdmin; ga.getIdToken = v.getIdToken; globalThis.fetch = v.fetch;
    delete globalThis.__vfVeri;
  });
}

test('scheda piena: chiaro e scuro', async ({ app, openTab }) => {
  test.setTimeout(90_000);
  await mainFinto(app);
  try {
    const page = await openTab(`${GESTIONE}#contatori`);
    await expect(page.locator('#panel-contatori')).toHaveClass(/mg-panel--active/, { timeout: 15_000 });
    await page.locator('#mgCtFinestra .mg-chip[data-preset="7"]').click();
    await expect(page.locator('#mgCtDati')).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('#mgCtTotale b')).toHaveText('7');
    mkdirSync(SHOTS, { recursive: true });
    await page.screenshot({ path: `${SHOTS}/v1462-piena-chiaro.png`, fullPage: true });
    const testi = await page.locator('#mgCtBlocchi').innerText();
    console.log(testi);
    await page.evaluate(() => chrome.runtime.sendMessage({ type: 'update_settings', settings: { theme: 'dark' } }));
    await ricaricaSu(page, 'contatori');
    await expect(page.locator('#mgCtDati')).toBeVisible({ timeout: 15_000 });
    await page.screenshot({ path: `${SHOTS}/v1462-piena-scuro.png`, fullPage: true });
    await page.evaluate(() => chrome.runtime.sendMessage({ type: 'update_settings', settings: { theme: 'light' } }));
  } finally { await rimetti(app); }
});

test('nessun dato, e intervallo oltre il tetto', async ({ app, openTab }) => {
  test.setTimeout(90_000);
  await mainFinto(app, { vuoto: true });
  try {
    const page = await openTab(`${GESTIONE}#contatori`);
    await expect(page.locator('#panel-contatori')).toHaveClass(/mg-panel--active/, { timeout: 15_000 });
    await page.locator('#mgCtFinestra .mg-chip[data-preset="30"]').click();
    await expect(page.locator('#mgCtDati')).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('#mgCtTotale b')).toHaveText('meno di 5');
    await page.screenshot({ path: `${SHOTS}/v1462-vuoto.png`, fullPage: true });
    await page.locator('#mgCtFinestra .mg-chip[data-preset="mano"]').click();
    await page.locator('#mgCtDal').fill('2021-01-01');
    await page.locator('#mgCtDal').dispatchEvent('change');
    await expect(page.locator('#mgCtGuasto')).toContainText('Intervallo troppo lungo', { timeout: 10_000 });
    console.log(await page.locator('#mgCtGuasto').innerText());
    await page.screenshot({ path: `${SHOTS}/v1462-troppo-lungo.png` });
    await page.locator('#mgCtDal').fill('2024-01-01');
    await page.locator('#mgCtDal').dispatchEvent('change');
    await expect(page.locator('#mgCtDati')).toBeVisible({ timeout: 15_000 });
    console.log('colonne', await page.locator('#mgCtPeriodi .mg-ct-col').count());
    await page.screenshot({ path: `${SHOTS}/v1462-lungo.png` });
    await page.locator('#mgCtFinestra .mg-chip[data-preset="7"]').click();
  } finally { await rimetti(app); }
});

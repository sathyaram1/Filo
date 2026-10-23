// Verifica #1462 giro 2: r1 il rifiuto di un intervallo troppo lungo dice i giorni scelti davvero; r2 il livello di
// autonomia si legge col nome che ha nelle Preferenze, non con l'id interno. Main e Firestore finti come nello spec della scheda.

import { test, expect } from '../../fixtures/electron.mjs';
import { GESTIONE } from '../../helpers/gestione.mjs';

async function mainFinto(app) {
  await app.evaluate(() => {
    const ga = process.getBuiltinModule('module').createRequire(process.cwd() + '/src/main/main.js')('./auth/google-auth');
    if (!globalThis.__vfVeri) globalThis.__vfVeri = { isAdmin: ga.isAdmin, getIdToken: ga.getIdToken, fetch: globalThis.fetch };
    ga.isAdmin = () => true;
    ga.getIdToken = async () => 'token-finto';
    const C = globalThis.SN_CONTATORI;
    const giorno = (n) => { const d = new Date(); d.setHours(12, 0, 0, 0); d.setDate(d.getDate() - n); return C.giornoDi(d.getTime()); };
    const docs = [];
    for (let i = 0; i < 6; i++) {
      const ora = C.oraVuota();
      C.registraIntervista(ora, 'autonomia', 'default');
      C.registraImpostazione(ora, 'autonomia.livello', 'default', 'mano');
      docs.push(C.documento({ pseudonimo: `beef${String(i).padStart(16, '0')}`, chiave: `${giorno(1)}T10`, app: '0.2.300', os: 'win', dati: ora }));
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
  });
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

async function apri(app, openTab) {
  await mainFinto(app);
  const page = await openTab(`${GESTIONE}#contatori`);
  await expect(page.locator('#panel-contatori')).toHaveClass(/mg-panel--active/, { timeout: 15_000 });
  await page.locator('#mgCtFinestra .mg-chip[data-preset="7"]').click();
  await expect(page.locator('#mgCtDati')).toBeVisible({ timeout: 15_000 });
  return page;
}

test('r1 un intervallo oltre il tetto si rifiuta col numero dei giorni scelti', async ({ app, openTab }) => {
  test.setTimeout(60_000);
  try {
    const page = await apri(app, openTab);
    const oggi = await page.evaluate(() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; });
    const [y, m, d] = oggi.split('-').map(Number);
    const giorni = Math.round((Date.UTC(y, m - 1, d) - Date.UTC(2021, 0, 1)) / 86_400_000) + 1;
    await page.locator('#mgCtFinestra .mg-chip[data-preset="mano"]').click();
    await page.locator('#mgCtAl').fill(oggi);
    await page.locator('#mgCtDal').fill('2021-01-01');
    await page.locator('#mgCtDal').dispatchEvent('change');
    await expect(page.locator('#mgCtGuasto')).toContainText('Intervallo troppo lungo', { timeout: 10_000 });
    await expect(page.locator('#mgCtGuasto')).toContainText(new RegExp(`(${giorni}|${giorni.toLocaleString('it-IT').replace('.', '\\.')}) giorni`));
    await page.locator('#mgCtFinestra .mg-chip[data-preset="7"]').click();
  } finally { await rimetti(app); }
});

test('r2 il livello di autonomia scelto si legge col suo nome, nell’intervista e nelle impostazioni', async ({ app, openTab }) => {
  test.setTimeout(60_000);
  try {
    const page = await apri(app, openTab);
    const nome = await page.evaluate(() => {
      const l = (window.SN_AUTONOMIA && window.SN_AUTONOMIA.LIVELLI) || [];
      return (l.find((x) => x.id === 'default') || {}).nome || 'Normale';
    });
    const intervista = page.locator('#mgCtBlocchi section[data-blocco="intervista"] .mg-ct-chip');
    await expect(intervista).toHaveCount(1);
    await expect(intervista).toContainText(new RegExp(`^${nome} 6$`, 'i'));
    const imp = page.locator('#mgCtBlocchi section[data-blocco="impostazioni"] tr.mg-ct-riga .mg-ct-chip');
    await expect(imp).toHaveCount(1);
    await expect(imp).toContainText(new RegExp(`^${nome} 6$`, 'i'));
  } finally { await rimetti(app); }
});

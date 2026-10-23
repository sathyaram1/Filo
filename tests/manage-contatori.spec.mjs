// Gestione → Utenti → Contatori (#1462): le somme dei contatori anonimi per intervallo, versione e sistema, con la porta
// vera del main e Firestore finto (solo la sua risposta). Cosa deve reggere: sotto le cinque copie «meno di 5», mai uno
// pseudonimo in pagina, un filtro non rilegge, un guasto non lascia numeri vecchi. Le somme: tests/unit/contatoriSomme.test.mjs.

import { test, expect } from './fixtures/electron.mjs';
import { mkdirSync } from 'node:fs';
import { GESTIONE, apriScheda, ricaricaSu } from './helpers/gestione.mjs';

const SHOTS = 'tests/.shots';

// Sei copie ieri alle 9 (cinque con una versione, una con l'altra; tre Windows e tre Mac), tre di loro ieri alle 10 e
// tre giorni fa alle 15. `__ctLetture` conta le letture del server, `__ctGuasto` lo fa rispondere 403.
async function mainFinto(app) {
  await app.evaluate(() => {
    const ga = process.getBuiltinModule('module').createRequire(process.cwd() + '/src/main/main.js')('./auth/google-auth');
    if (!globalThis.__ctVeri) globalThis.__ctVeri = { isAdmin: ga.isAdmin, getIdToken: ga.getIdToken, fetch: globalThis.fetch };
    ga.isAdmin = () => true;
    ga.getIdToken = async () => 'token-finto';
    globalThis.__ctLetture = 0;
    globalThis.__ctGuasto = false;
    const C = globalThis.SN_CONTATORI;
    const giorno = (n) => { const d = new Date(); d.setHours(12, 0, 0, 0); d.setDate(d.getDate() - n); return C.giornoDi(d.getTime()); };
    const pseudo = (i) => `c0ffee${String(i).padStart(14, '0')}`;
    const doc = (i, chiave, fai) => {
      const ora = C.oraVuota();
      fai(ora);
      return C.documento({ pseudonimo: pseudo(i), chiave, app: i === 5 ? '0.2.299' : '0.2.300', os: i < 3 ? 'win' : 'mac', dati: ora });
    };
    const docs = [];
    for (let i = 0; i < 6; i++) {
      docs.push(doc(i, `${giorno(1)}T09`, (o) => {
        C.registraAzione(o, 'new-tab', { visto: 300, fine: 1500 });
        C.registraAzione(o, 'new-tab', { visto: 300, fine: 1500 });
        C.registraImpostazione(o, 'theme', 'dark', 'mano');
      }));
    }
    for (let i = 0; i < 3; i++) {
      docs.push(doc(i, `${giorno(1)}T10`, (o) => { C.registraAzione(o, 'reload', { visto: 100, fine: 100 }); C.registraErroreVisto(o, 'crash:scheda:oom'); }));
      docs.push(doc(i, `${giorno(3)}T15`, (o) => C.registraAzione(o, 'new-tab', { visto: 300, fine: 1500 })));
    }
    const valoreFs = (v) => {
      if (typeof v === 'string') return { stringValue: v };
      if (typeof v === 'number') return { integerValue: String(v) };
      if (Array.isArray(v)) return { arrayValue: { values: v.map(valoreFs) } };
      return { mapValue: { fields: Object.fromEntries(Object.entries(v).map(([k, x]) => [k, valoreFs(x)])) } };
    };
    globalThis.__ctAtteso = { ieri: giorno(1), treGiorniFa: giorno(3), stessoMese: giorno(1).slice(0, 7) === giorno(3).slice(0, 7) };
    globalThis.fetch = async (url, init) => {
      let q = null;
      try { q = JSON.parse((init && init.body) || 'null').structuredQuery; } catch (_) {}
      const filtri = q && q.where && q.where.compositeFilter && q.where.compositeFilter.filters;
      const intervallo = Array.isArray(filtri) && filtri[0] && filtri[0].fieldFilter && filtri[0].fieldFilter.op === 'GREATER_THAN_OR_EQUAL';
      if (!String(url).includes(':runQuery') || !q || q.from[0].collectionId !== C.COLLEZIONE || !intervallo) {
        return globalThis.__ctVeri.fetch(url, init);
      }
      globalThis.__ctLetture += 1;
      if (globalThis.__ctGuasto) return new Response(JSON.stringify([{ error: { status: 'PERMISSION_DENIED' } }]), { status: 403 });
      const [dal, al] = filtri.map((f) => f.fieldFilter.value.stringValue);
      const righe = docs.filter((d) => d.giorno >= dal && d.giorno <= al).map((d) => ({
        document: { name: `progetti/x/contatori-giornalieri/${C.idDocumento(d)}`, fields: Object.fromEntries(Object.entries(d).map(([k, v]) => [k, valoreFs(v)])) },
      }));
      return new Response(JSON.stringify(righe.length ? righe : [{ readTime: 'adesso' }]), { status: 200, headers: { 'Content-Type': 'application/json' } });
    };
  });
  return app.evaluate(() => globalThis.__ctAtteso);
}

async function rimetti(app) {
  await app.evaluate(() => {
    const v = globalThis.__ctVeri;
    if (!v) return;
    const ga = process.getBuiltinModule('module').createRequire(process.cwd() + '/src/main/main.js')('./auth/google-auth');
    ga.isAdmin = v.isAdmin;
    ga.getIdToken = v.getIdToken;
    globalThis.fetch = v.fetch;
    delete globalThis.__ctVeri;
  });
}

const letture = (app) => app.evaluate(() => globalThis.__ctLetture);
const breve = (g) => { const [y, m, d] = g.split('-').map(Number); return new Date(y, m - 1, d, 12).toLocaleDateString('it-IT', { day: 'numeric', month: 'short' }); };
const blocco = (page, id) => page.locator(`#mgCtBlocchi section[data-blocco="${id}"]`);
const riga = (page, id, testo) => blocco(page, id).locator('tr.mg-ct-riga', { has: page.locator('td:first-child', { hasText: testo }) });

const scegli = (page, id, valore) => page.locator(`#${id}`).selectOption(valore);

test('la porta delle somme è solo dell’owner e solo dalle pagine di Filo; chi non è owner legge un permesso che manca', async ({ app, openTab }) => {
  const negato = await app.evaluate(async () => globalThis.__filoHandlers.handleMessage(
    { type: globalThis.SN_MSG.MSG.CONTATORI_SOMME, dal: '2026-10-01', al: '2026-10-07' }, { isShell: true }, 'filo://manage/manage.html'));
  expect(negato).toMatchObject({ ok: false, error: 'not_admin' });
  const daUnSito = await app.evaluate(async () => globalThis.__filoHandlers.handleMessage(
    { type: globalThis.SN_MSG.MSG.CONTATORI_SOMME, dal: '2026-10-01', al: '2026-10-07' }, {}, 'https://esempio.test/'));
  expect(daUnSito).toMatchObject({ ok: false, code: 'forbidden' });
  const page = await openTab(`${GESTIONE}#contatori`);
  await expect(page.locator('#panel-contatori')).toHaveClass(/mg-panel--active/, { timeout: 15_000 });
  await expect(page.locator('#mgCtNegato')).toBeVisible({ timeout: 10_000 });
  await expect(page.locator('#mgCtCorpo')).toBeHidden();
});

test('le copie attive per giorno e per ora, le attese e le impostazioni: sotto le cinque copie «meno di 5», mai uno pseudonimo', async ({ app, openTab }) => {
  test.setTimeout(90_000);
  const atteso = await mainFinto(app);
  try {
    const page = await openTab(`${GESTIONE}#contatori`);
    await expect(page.locator('#panel-contatori')).toHaveClass(/mg-panel--active/, { timeout: 15_000 });
    await expect(page.locator('.mg-sezione[data-sezione="utenti"]')).toHaveClass(/mg-sezione--active/);
    await page.locator('#mgCtFinestra .mg-chip[data-preset="7"]').click();
    await expect(page.locator('#mgCtDati')).toBeVisible({ timeout: 15_000 });

    // Le copie: sei ieri, tre tre giorni fa (che non si contano a numero); a cavallo di due mesi una copia conta due volte.
    await expect(page.locator('#mgCtTotale b')).toHaveText(atteso.stessoMese ? '6' : '9');
    const colonne = page.locator('#mgCtPeriodi .mg-ct-col');
    await expect(colonne).toHaveCount(7);
    await expect(colonne.nth(5)).toHaveAttribute('title', `${breve(atteso.ieri)}: 6 copie`);
    await expect(colonne.nth(3)).toHaveClass(/mg-ct-col--sotto/);
    await expect(colonne.nth(3)).toHaveAttribute('title', `${breve(atteso.treGiorniFa)}: meno di 5 copie`);
    await expect(colonne.nth(0)).toHaveClass(/mg-ct-col--sotto/);
    // Un giorno si apre sulle sue ore; cliccato di nuovo torna a tutto l'intervallo.
    await colonne.nth(5).click();
    await expect(page.locator('#mgCtOreTitolo')).toHaveText(`Per ora del giorno, ${breve(atteso.ieri)}`);
    const ore = page.locator('#mgCtOre .mg-ct-col');
    await expect(ore).toHaveCount(24);
    await expect(ore.nth(9)).toHaveAttribute('title', 'dalle 9 alle 10: 6 copie');
    await expect(ore.nth(10)).toHaveClass(/mg-ct-col--sotto/);
    await page.locator('#mgCtPeriodi .mg-ct-col').nth(5).click();
    await expect(page.locator('#mgCtOreTitolo')).toHaveText('Per ora del giorno, in tutto l’intervallo');
    // Una colonna sotto soglia non finge di aprirsi.
    expect(await colonne.nth(3).evaluate((c) => c.tagName)).toBe('SPAN');

    // Le attese: «Apri una nuova scheda» si mostra; «Ricarica la pagina» (tre copie) sta fra le voci sotto soglia.
    const nuova = riga(page, 'azioni', 'Apri una nuova scheda');
    await expect(nuova.locator('td').nth(1)).toHaveText('15');
    await expect(nuova.locator('td').nth(1)).toHaveAttribute('title', '15 da 6 copie');
    await expect(nuova.locator('.mg-ct-fascia').first()).toHaveAttribute('title', 'fino a 0,5 s: 15');
    await expect(nuova.locator('.mg-ct-fascia--sotto')).toHaveCount(12);
    await expect(riga(page, 'azioni', 'Ricarica la pagina')).toHaveCount(0);
    const altre = blocco(page, 'azioni').locator('.mg-ct-altre button');
    await expect(altre).toHaveText(/^Altre \d+ voci, ognuna contata su meno di cinque copie$/);
    await altre.click();
    await expect(riga(page, 'azioni', 'Ricarica la pagina').locator('td').nth(1)).toHaveText('meno di 5');
    await expect(blocco(page, 'azioni').locator('.mg-ct-altre button')).toBeFocused();
    await blocco(page, 'azioni').locator('.mg-ct-altre button').click();
    await expect(riga(page, 'azioni', 'Ricarica la pagina')).toHaveCount(0);

    // Un errore visto da tre copie non esce nemmeno col nome.
    await expect(blocco(page, 'erroriVisti').locator('.mg-ct-vuoto')).toHaveText('Nessuna voce contata su almeno cinque copie.');
    await expect(page.locator('#panel-contatori')).not.toContainText('Scheda caduta');
    // Le impostazioni: quante copie, e verso cosa.
    const tema = riga(page, 'impostazioni', 'Tema');
    await expect(tema.locator('td').nth(1)).toHaveText('6');
    await expect(tema.locator('.mg-ct-chip')).toHaveText(['scuro 6']);
    await expect(tema.locator('td').nth(3)).toHaveText('6');
    await expect(tema.locator('td').nth(4)).toHaveText('meno di 5');
    expect(await page.locator('#panel-contatori').innerHTML()).not.toMatch(/c0ffee/);

    // Una riga si apre sul suo andamento (clic, Invio, tasto destro) ed Esc la chiude.
    await nuova.click();
    const andamento = blocco(page, 'azioni').locator('.mg-ct-andamento');
    await expect(andamento.locator('.mg-ct-col')).toHaveCount(7);
    await expect(andamento.locator('.mg-ct-col').nth(5)).toHaveAttribute('title', `${breve(atteso.ieri)}: 12 volte`);
    await expect(nuova).toHaveAttribute('aria-expanded', 'true');
    await page.keyboard.press('Escape');
    await expect(andamento).toHaveCount(0);
    await nuova.focus();
    await page.keyboard.press('Enter');
    await expect(andamento).toHaveCount(1);
    await nuova.click({ button: 'right' });
    await expect(page.locator('.mg-ctxmenu .sn-select-option')).toHaveText(['Nascondi l’andamento', 'Copia la riga', 'Copia la tabella', 'Rileggi']);
    await page.locator('.mg-ctxmenu .sn-select-option', { hasText: 'Copia la riga' }).click();
    await expect.poll(() => app.evaluate(({ clipboard }) => clipboard.readText())).toMatch(/^Apri una nuova scheda\t15\tfino a 0,5 s: 15, fino a 1 s: meno di 5/);
    // Una riga sotto soglia non si apre: niente andamento, né dal clic né dal menu.
    await altre.click();
    const ricarica = riga(page, 'azioni', 'Ricarica la pagina');
    await ricarica.click();
    await expect(blocco(page, 'azioni').locator('.mg-ct-andamento')).toHaveCount(1);
    await ricarica.click({ button: 'right' });
    await expect(page.locator('.mg-ctxmenu .sn-select-option')).toHaveText(['Copia la riga', 'Copia la tabella', 'Rileggi']);
    await page.keyboard.press('Escape');
    await expect(page.locator('.mg-ctxmenu')).toHaveCount(0);
    await expect(blocco(page, 'azioni').locator('.mg-ct-andamento')).toHaveCount(1);

    // I filtri non rileggono: la stessa finestra è già in mano al main.
    await blocco(page, 'azioni').locator('.mg-ct-altre button').click();
    mkdirSync(SHOTS, { recursive: true });
    await page.screenshot({ path: `${SHOTS}/contatori-gestione-chiaro.png`, fullPage: true });
    await page.screenshot({ path: `${SHOTS}/contatori-gestione-chiaro-cima.png` });
    const prima = await letture(app);
    await scegli(page, 'mgCtVersione', '0.2.299');
    await expect(page.locator('#mgCtTotale b')).toHaveText('meno di 5');
    await expect(blocco(page, 'azioni').locator('.mg-ct-altre button')).toHaveText(/^\d+ voci, tutte contate su meno di cinque copie$/);
    await scegli(page, 'mgCtVersione', '');
    await scegli(page, 'mgCtSistema', 'mac');
    await expect(page.locator('#mgCtTotale b')).toHaveText('meno di 5');
    await scegli(page, 'mgCtSistema', '');
    await expect(page.locator('#mgCtTotale b')).toHaveText(atteso.stessoMese ? '6' : '9');
    expect(await letture(app)).toBe(prima);
    // «Rileggi» sì.
    await page.locator('#mgCtRileggi').click();
    await expect.poll(() => letture(app)).toBe(prima + 1);

    await page.evaluate(() => chrome.runtime.sendMessage({ type: 'update_settings', settings: { theme: 'dark' } }));
    await ricaricaSu(page, 'contatori');
    await expect(page.locator('#mgCtDati')).toBeVisible({ timeout: 15_000 });
    await riga(page, 'azioni', 'Apri una nuova scheda').click();
    await page.screenshot({ path: `${SHOTS}/contatori-gestione-scuro.png`, fullPage: true });
    await page.screenshot({ path: `${SHOTS}/contatori-gestione-scuro-cima.png` });
    await page.evaluate(() => chrome.runtime.sendMessage({ type: 'update_settings', settings: { theme: 'light' } }));
  } finally {
    await rimetti(app);
  }
});

test('un guasto non lascia a schermo i numeri di prima, e la finestra scelta si ricorda intera', async ({ app, openTab }) => {
  test.setTimeout(60_000);
  const atteso = await mainFinto(app);
  try {
    const page = await openTab(`${GESTIONE}#contatori`);
    await expect(page.locator('#panel-contatori')).toHaveClass(/mg-panel--active/, { timeout: 15_000 });
    await page.locator('#mgCtFinestra .mg-chip[data-preset="7"]').click();
    await expect(page.locator('#mgCtDati')).toBeVisible({ timeout: 15_000 });
    await app.evaluate(() => { globalThis.__ctGuasto = true; });
    await page.locator('#mgCtRileggi').click();
    await expect(page.locator('#mgCtGuasto')).toContainText('I contatori non si sono letti: il server li ha negati', { timeout: 10_000 });
    await expect(page.locator('#mgCtGuasto')).toContainText('npm run regole:pubblica');
    await expect(page.locator('#mgCtDati')).toBeHidden();
    await app.evaluate(() => { globalThis.__ctGuasto = false; });
    await page.locator('#mgCtRileggi').click();
    await expect(page.locator('#mgCtDati')).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('#mgCtGuasto')).toBeHidden();

    // Scelte a mano, al rovescio: si raddrizzano; poi la finestra, la versione e il sistema tornano dopo una ricarica.
    await page.locator('#mgCtFinestra .mg-chip[data-preset="mano"]').click();
    await expect(page.locator('#mgCtDate')).toBeVisible();
    await page.locator('#mgCtDal').fill(atteso.ieri);
    await page.locator('#mgCtAl').fill(atteso.treGiorniFa);
    await page.locator('#mgCtAl').dispatchEvent('change');
    await expect(page.locator('#mgCtPeriodi .mg-ct-col')).toHaveCount(3);
    await expect(page.locator('#mgCtDal')).toHaveValue(atteso.treGiorniFa);
    await expect(page.locator('#mgCtAl')).toHaveValue(atteso.ieri);
    await scegli(page, 'mgCtSistema', 'win');
    await ricaricaSu(page, 'contatori');
    await expect(page.locator('#mgCtFinestra .mg-chip[data-preset="mano"]')).toHaveClass(/mg-chip--on/, { timeout: 15_000 });
    await expect(page.locator('#mgCtDal')).toHaveValue(atteso.treGiorniFa);
    await expect(page.locator('#mgCtSistema')).toHaveValue('win');
    await expect(page.locator('#mgCtPeriodi .mg-ct-col')).toHaveCount(3);
    await page.locator('#mgCtFinestra .mg-chip[data-preset="7"]').click();
    await scegli(page, 'mgCtSistema', '');
  } finally {
    await rimetti(app);
  }
});

// Verifica #496 — giro 10. Il filtro per creatore su un computer che non ha la
// chiave dell'owner.
//
// `clientId` è uno dei campi che viaggiano cifrati (auth.js,
// TEXT_FIELDS_TO_DECRYPT): senza la chiave resta ciphertext. La scheda lo legge
// lo stesso e lo classifica come «Utente», quindi la cosa che la segnalazione
// chiedeva — «voglio i dati dei feedback lanciati da prober o altre routine
// cloud» — risponde con zeri, e la riga di avviso della scheda dichiara che
// «da chi si sa lo stesso».

import { test, expect } from '../../fixtures/electron.mjs';

const URL = 'filo://manage/manage.html';
const iso = (g) => new Date(Date.now() - g * 24 * 3600 * 1000).toISOString();

async function apri(page) {
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.__mgTest.whenReady);
  await page.evaluate(() => window.__mgTest.whenReady());
  await page.locator('.mg-tab[data-tab="fbstats"]').click();
  await expect(page.locator('#panel-fbstats')).toHaveClass(/mg-panel--active/);
}

test('col mittente cifrato la scheda non lo dà per «Utente» senza dirlo', async ({ openTab }) => {
  const page = await openTab(URL);
  await apri(page);

  // Tre segnalazioni scritte da tre routine cloud diverse, ma il mittente su
  // questo computer non si decifra: è ciphertext come lo stato.
  await page.evaluate((d) => {
    window.__mgTest.setData([
      { _id: 'e1', seq: 401, clientId: 'FENC1:aaaa', text: 'x', status: 'FENC1:zzz', createdAt: d[0] },
      { _id: 'e2', seq: 402, clientId: 'FENC1:bbbb', text: 'y', status: 'FENC1:zzz', createdAt: d[1] },
      { _id: 'e3', seq: 403, clientId: 'FENC1:cccc', text: 'z', status: 'FENC1:zzz', createdAt: d[2] },
    ]);
  }, [iso(1), iso(2), iso(3)]);
  await page.evaluate(() => window.__mgTest.setStatsWindow('7d'));

  const pastiglie = await page.evaluate(() => Array.from(
    document.querySelectorAll('#mgStCreators [data-creator]'),
  ).map((b) => b.textContent.replace(/\s+/g, ' ').trim()));

  // Nessuna categoria di mittente può portare un numero, perché il mittente
  // non si legge: dichiararne uno è inventarlo.
  const conNumero = pastiglie.filter((t) => /\b[1-9]\d*$/.test(t));
  expect(conNumero, `pastiglie: ${pastiglie.join(' | ')}`).toEqual([]);
});

test('la riga di avviso non promette di sapere chi ha mandato quello che non sa', async ({ openTab }) => {
  const page = await openTab(URL);
  await apri(page);
  await page.evaluate((d) => {
    window.__mgTest.setData([
      { _id: 'e1', seq: 401, clientId: 'FENC1:aaaa', text: 'x', status: 'FENC1:zzz', createdAt: d },
    ]);
  }, iso(1));
  await page.evaluate(() => window.__mgTest.setStatsWindow('7d'));

  const nota = await page.locator('#mgStNote').textContent();
  expect(nota, nota).toContain('non può leggere lo stato');
  // Con il mittente cifrato, «da chi si sa lo stesso» è falso.
  expect(nota, nota).not.toContain('da chi si sa lo stesso');
});

// Quale menu è uscito: quello della scheda, o quello generale della pagina?
async function menuDopoTastoDestro(page, selettore) {
  await page.evaluate(() => {
    document.querySelectorAll('.mg-ctxmenu, .sn-select-pop, .sn-menu, [role="menu"]').forEach((m) => m.remove());
  });
  await page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) throw new Error(`manca ${sel}`);
    const r = el.getBoundingClientRect();
    el.dispatchEvent(new MouseEvent('contextmenu', {
      bubbles: true, cancelable: true,
      clientX: Math.round(r.left + r.width / 2), clientY: Math.round(r.top + r.height / 2),
    }));
  }, selettore);
  await page.waitForTimeout(250);
  return page.evaluate(() => Array.from(document.querySelectorAll('[role="menu"], .mg-ctxmenu, .sn-select-pop'))
    .map((m) => m.textContent.replace(/\s+/g, ' ').trim()).filter(Boolean).join(' | '));
}

test('il numero grande di «Prober lanciati» risponde al tasto destro come gli altri tre', async ({ openTab }) => {
  const page = await openTab(URL);
  await apri(page);
  await page.evaluate(() => {
    const iso2 = (g) => new Date(Date.now() - g * 24 * 3600 * 1000).toISOString();
    window.__mgTest.setData([
      { _id: 'a1', seq: 501, clientId: 'tester@example.com', text: 'x', status: 'todo', createdAt: iso2(1) },
    ]);
    window.__mgTest.renderWorkerLog([{ role: 'prober', startedAt: iso2(1), num: '#1' }]);
  });
  await page.evaluate(() => window.__mgTest.setStatsWindow('7d'));

  const esito = {};
  for (const id of ['ricevuti', 'lavorati', 'adesso', 'routine']) {
    esito[id] = await menuDopoTastoDestro(page, `[data-card-toggle="${id}"] .mg-st-card-value`);
  }
  console.log('MENU sul numero grande:', JSON.stringify(esito, null, 1));
  // Le quattro tessere sono disegnate identiche: devono rispondere identiche.
  // Il menu generale della pagina — quello che esce anche su uno spazio bianco
  // — non è una risposta (patterns/un-numero-aggregato-porta-a-cosa-ha-contato).
  expect(esito.routine, JSON.stringify(esito)).not.toMatch(/Invia feedback|Invia attacco/);
  expect(esito.routine, JSON.stringify(esito)).toMatch(/Copia/);
});

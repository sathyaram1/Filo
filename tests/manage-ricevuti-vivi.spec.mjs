// La Gestione aperta segue da sola i cambi di stato fatti altrove (il caso di
// #515: In coda → Ricevuti, fusione ferma al cancello), senza ricaricare, e
// senza leggere niente quando nessuno la guarda. Firestore è finto
// (setLiveSources), l'orologio della pagina e il segnale «in vista» sono veri.

import { test, expect } from './fixtures/electron.mjs';

const URL = 'filo://manage/manage.html';

function fb(id, seq, status, extra = {}) {
  return {
    _id: id,
    _updateTime: 'v1',
    seq,
    subSeq: 0,
    name: `Segnalazione ${seq}`,
    text: `Testo ${seq}`,
    status,
    statusReason: extra.statusReason || null,
    clientId: 'tester@example.com',
    createdAt: new Date(Date.UTC(2026, 7, 1) + seq * 3600e3).toISOString(),
    images: [],
    ...extra,
  };
}

async function apri(openTab, docs, { tempi, admin = false } = {}) {
  const page = await openTab(URL);
  await page.waitForFunction(() => window.__mgTest && window.__mgTest.whenReady);
  await page.evaluate(() => window.__mgTest.whenReady());
  await page.evaluate(({ docs, tempi, admin }) => {
    window.__nonRicaricata = true;
    window.__srv = { docs: {}, letture: 0 };
    for (const d of docs) window.__srv.docs[d._id] = d;
    const byCreated = (a, b) => String(b.createdAt).localeCompare(String(a.createdAt));
    window.__mgTest.setLiveSources({
      listVersions: async () => {
        window.__srv.letture += 1;
        return Object.values(window.__srv.docs).sort(byCreated)
          .map((d) => ({ _id: d._id, _updateTime: d._updateTime }));
      },
      getMany: async (ids) => ids.map((id) => window.__srv.docs[id]).filter(Boolean).map((d) => ({ ...d })),
    });
    if (admin) window.__mgTest.setAdmin(true);
    window.__mgTest.setLiveTiming(tempi);
    window.__mgTest.setData(docs.map((d) => ({ ...d })), { dalVivo: true });
  }, { docs, tempi: tempi || { pollMs: 800, rientroMs: 300, clockMs: 200 }, admin });
  return page;
}

// Il server sposta un feedback: nuova versione, nuovo stato.
async function ilServerScrive(page, id, campi) {
  await page.evaluate(({ id, campi }) => {
    const d = window.__srv.docs[id];
    window.__srv.docs[id] = { ...d, ...campi, _updateTime: `${d._updateTime}+` };
  }, { id, campi });
}

const ids = (page) => page.locator('#mgList .mg-item').evaluateAll((els) => els.map((e) => e.dataset.id));

test('una pratica fermata al cancello arriva nei Ricevuti da sola, in cima anche con l\'ordine per numero', async ({ openTab }) => {
  const docs = [
    fb('f716', 716, 'design'), fb('f709', 709, 'design'), fb('f653', 653, 'design', { statusReason: 'clarify' }),
    fb('f597', 597, 'design', { statusReason: 'loop' }), fb('f530', 530, 'design'),
    fb('f515', 515, 'working', { workingSince: new Date().toISOString() }),
    fb('f503', 503, 'design', { statusReason: 'secaudit' }),
  ];
  const page = await apri(openTab, docs);
  // L'ordine salvato dall'owner: per numero, recenti prima.
  await page.evaluate(() => { window.__mgTest.setSortMode('num'); window.__mgTest.setTab('inbox'); });
  await expect.poll(() => ids(page)).toEqual(['f716', 'f709', 'f653', 'f597', 'f530', 'f503']);
  await expect(page.locator('.mg-tab[data-tab="queue"] .mg-tab-count')).toHaveText('(1)');

  await ilServerScrive(page, 'f515', { status: 'design', statusReason: 'l5' });

  // Senza ricaricare: in cima (la fusione ferma è una decisione che aspetta
  // l'owner), segnata come arrivata, e la sezione In coda si svuota.
  await expect.poll(() => ids(page), { timeout: 10_000 }).toEqual(['f515', 'f716', 'f709', 'f653', 'f597', 'f530', 'f503']);
  const arrivata = page.locator('.mg-item[data-id="f515"]');
  await expect(arrivata).toHaveClass(/mg-item--fusione/);
  await expect(arrivata).toHaveClass(/mg-item--arrivata/);
  await expect(page.locator('.mg-tab[data-tab="inbox"]')).toHaveClass(/mg-tab--arrivi/);
  await expect(page.locator('.mg-tab[data-tab="queue"] .mg-tab-count')).toHaveText('(0)');
  expect(await page.evaluate(() => window.__nonRicaricata)).toBe(true);

  // Aperta, l'arrivo è visto: il segno se ne va.
  await arrivata.click();
  await expect(arrivata).not.toHaveClass(/mg-item--arrivata/);
  await expect(page.locator('.mg-tab[data-tab="inbox"]')).not.toHaveClass(/mg-tab--arrivi/);
});

test('arrivata In coda: il punto sta nella riga del titolo, che resta all\'altezza delle altre schede', async ({ openTab }) => {
  const page = await apri(openTab, [
    fb('f515', 515, 'design', { statusReason: 'l5' }),
    fb('f600', 600, 'working', { workingSince: new Date().toISOString() }),
  ]);
  await page.evaluate(() => window.__mgTest.setTab('queue'));
  const altezzaTitolo = (id) => page.locator(`.mg-item[data-id="${id}"]`).evaluate((el) =>
    el.querySelector('.mg-item-title').getBoundingClientRect().top - el.getBoundingClientRect().top);
  const riferimento = await altezzaTitolo('f600');

  await ilServerScrive(page, 'f515', { status: 'working', statusReason: null, workingSince: new Date().toISOString() });
  const arrivata = page.locator('.mg-item[data-id="f515"]');
  await expect(arrivata).toHaveClass(/mg-item--arrivata/, { timeout: 10_000 });
  const riga = arrivata.locator('.mg-item-row').first();
  expect(await riga.evaluate((el) => getComputedStyle(el, '::before').content)).not.toBe('none');
  expect(await arrivata.evaluate((el) => getComputedStyle(el, '::before').content)).toBe('none');
  expect(Math.abs(await altezzaTitolo('f515') - riferimento)).toBeLessThan(3);
});

test('in secondo piano o ridotta a icona non legge; tornando in vista si allinea subito', async ({ openTab, shell, app }) => {
  const docs = [fb('f716', 716, 'design'), fb('f515', 515, 'working')];
  const page = await apri(openTab, docs, { tempi: { pollMs: 800, rientroMs: 300, clockMs: 200 } });
  await page.evaluate(() => window.__mgTest.setTab('inbox'));
  await expect.poll(() => page.evaluate(() => window.__srv.letture)).toBeGreaterThan(1);

  const snap = await shell.evaluate(() => window.filoShell.tabs.snapshot());
  const gestione = snap.tabs.find((t) => String(t.url || '').startsWith('filo://manage')).id;
  await shell.evaluate(() => window.filoShell.tabs.open('filo://newtab/'));
  await page.waitForTimeout(600);
  const inSecondoPiano = await page.evaluate(() => window.__srv.letture);
  await page.waitForTimeout(3000);
  expect(await page.evaluate(() => window.__srv.letture)).toBe(inSecondoPiano);

  // Da qui in poi il ritmo è di minuti: se il cambio si vede in pochi secondi,
  // lo ha portato il rientro.
  await page.evaluate(() => window.__mgTest.setLiveTiming({ pollMs: 10 * 60 * 1000 }));
  await ilServerScrive(page, 'f515', { status: 'design', statusReason: 'l5' });
  await shell.evaluate((id) => window.filoShell.tabs.activate(id), gestione);
  await expect.poll(() => ids(page), { timeout: 4000 }).toEqual(['f515', 'f716']);

  // Finestra ridotta a icona: stesso discorso.
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].minimize());
  await page.waitForTimeout(600);
  const ridotta = await page.evaluate(() => window.__srv.letture);
  await page.evaluate(() => window.__mgTest.setLiveTiming({ pollMs: 800 }));
  await page.waitForTimeout(3000);
  expect(await page.evaluate(() => window.__srv.letture)).toBe(ridotta);
  await page.evaluate(() => window.__mgTest.setLiveTiming({ pollMs: 10 * 60 * 1000 }));
  await ilServerScrive(page, 'f716', { status: 'todo' });
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].restore());
  await expect.poll(() => ids(page), { timeout: 4000 }).toEqual(['f515']);
});

test('un giro non porta via sezione, scorrimento, scheda aperta, bozza e menu aperto', async ({ openTab }) => {
  const docs = [];
  for (let n = 700; n > 660; n -= 1) docs.push(fb(`f${n}`, n, 'design', { statusReason: 'clarify' }));
  const page = await apri(openTab, docs, { admin: true });
  await page.evaluate(() => { window.__mgTest.setSortMode('num'); window.__mgTest.setTab('inbox'); });
  await expect(page.locator('#mgList .mg-item')).toHaveCount(40);

  // Scorro fino alla #680 in testa e la apro; scrivo una risposta a metà.
  const primaVisibile = () => page.evaluate(() => {
    const list = document.getElementById('mgList');
    const sc = [list, list.parentElement].find((el) => el.scrollHeight > el.clientHeight);
    const top = sc.getBoundingClientRect().top;
    return [...list.querySelectorAll('.mg-item')].find((el) => el.getBoundingClientRect().bottom > top + 1)?.dataset.id;
  });
  await page.evaluate(() => {
    const list = document.getElementById('mgList');
    const sc = [list, list.parentElement].find((el) => el.scrollHeight > el.clientHeight);
    const el = list.querySelector('.mg-item[data-id="f680"]');
    sc.scrollTop += el.getBoundingClientRect().top - sc.getBoundingClientRect().top;
  });
  expect(await primaVisibile()).toBe('f680');
  await page.locator('.mg-item[data-id="f680"]').click();
  await page.locator('#mgClarifyText').fill('Risposta a metà');

  // Altrove due schede sopra la vista escono dai Ricevuti e una cambia titolo.
  await ilServerScrive(page, 'f700', { status: 'todo', statusReason: null });
  await ilServerScrive(page, 'f699', { status: 'todo', statusReason: null });
  await ilServerScrive(page, 'f680', { name: 'Titolo riscritto' });
  await expect(page.locator('.mg-tab[data-tab="queue"] .mg-tab-count')).toHaveText('(2)', { timeout: 10_000 });

  await expect(page.locator('.mg-tab--active')).toHaveAttribute('data-tab', 'inbox');
  expect(await primaVisibile()).toBe('f680');
  await expect(page.locator('.mg-item--selected')).toHaveAttribute('data-id', 'f680');
  await expect(page.locator('.mg-item[data-id="f680"] .mg-item-title')).toHaveText('Titolo riscritto');
  await expect(page.locator('#mgClarifyText')).toHaveValue('Risposta a metà');

  // Il menu dell'ordinamento aperto resta aperto mentre la lista si riallinea.
  await page.locator('#mgSortBtn').click();
  await expect(page.locator('.mg-ctxmenu')).toBeVisible();
  await ilServerScrive(page, 'f698', { status: 'todo', statusReason: null });
  await expect(page.locator('.mg-tab[data-tab="queue"] .mg-tab-count')).toHaveText('(3)', { timeout: 10_000 });
  await expect(page.locator('.mg-ctxmenu')).toBeVisible();
  expect(await primaVisibile()).toBe('f680');
  expect(await page.evaluate(() => window.__nonRicaricata)).toBe(true);
});

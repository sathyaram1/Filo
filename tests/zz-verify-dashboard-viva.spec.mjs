// Verifica indipendente (giro 3) — aggiornamento continuo della dashboard.
import { test, expect } from './fixtures/electron.mjs';

const URL = 'filo://manage/manage.html';

function fb(n, extra = {}) {
  return {
    _id: `zz-${n}`,
    _updateTime: `2026-09-01T10:00:0${n}Z`,
    seq: 800 + n, subSeq: 0,
    text: `Segnalazione numero ${n}`,
    name: `Titolo ${n}`,
    clientId: 'tester@example.com',
    createdAt: `2026-08-2${n}T10:00:00Z`,
    images: [],
    status: 'open', statusPublic: 'open',
    ...extra,
  };
}

async function boot(page, list, { admin = false, tab = 'inbox' } = {}) {
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.SN_FEEDBACK && window.filo);
  await page.evaluate(({ list, admin, tab }) => {
    window.__mgTest.setAdmin(admin);
    window.__mgTest.setData(list);
    window.__mgTest.setTab(tab);
    // Sorgenti finte: il "server" è window.__remote (versioni) + window.__docs (documenti)
    window.__remote = list.map((f) => ({ _id: f._id, _updateTime: f._updateTime }));
    window.__docs = Object.fromEntries(list.map((f) => [f._id, f]));
    window.__getManyCalls = [];
    window.__mgTest.setLiveSources({
      listVersions: async () => (typeof window.__remote === 'function' ? window.__remote() : window.__remote),
      getMany: async (ids) => { window.__getManyCalls.push(ids); return ids.map((id) => window.__docs[id]).filter(Boolean); },
    });
  }, { list, admin, tab });
}

const rowIds = (page) => page.evaluate(() => Array.from(document.querySelectorAll('#mgList .mg-item')).map((e) => e.dataset.id));
const poll = (page) => page.evaluate(() => window.__mgTest.pollNow());
const pollCatch = (page) => page.evaluate(() => window.__mgTest.pollNow().then(() => 'ok', (e) => 'err:' + (e && e.message)));

test('(a) la lista si aggiorna da sola: riscritto, nuovo, sparito', async ({ openTab }) => {
  const page = await openTab(URL);
  const list = [fb(1), fb(2), fb(3)];
  await boot(page, list);
  expect(await rowIds(page)).toEqual(['zz-3', 'zz-2', 'zz-1']);

  // niente cambia → nessun documento riscaricato
  let r = await poll(page);
  expect(r.changed).toBe(0);
  expect(await page.evaluate(() => window.__getManyCalls.length)).toBe(0);

  // riscritto
  await page.evaluate(() => {
    window.__docs['zz-2'] = { ...window.__docs['zz-2'], _updateTime: '2026-09-02T00:00:00Z', name: 'Titolo 2 RISCRITTO' };
    window.__remote = window.__remote.map((v) => v._id === 'zz-2' ? { ...v, _updateTime: '2026-09-02T00:00:00Z' } : v);
  });
  r = await poll(page);
  expect(r.changed).toBe(1);
  expect(await page.evaluate(() => window.__getManyCalls.at(-1))).toEqual(['zz-2']);
  await expect(page.locator('#mgList .mg-item[data-id="zz-2"]')).toContainText('RISCRITTO');

  // nuovo
  await page.evaluate(() => {
    const n = { _id: 'zz-9', _updateTime: '2026-09-03T00:00:00Z', seq: 899, subSeq: 0, text: 'Nuovissimo', name: 'Nuovissimo', clientId: 'x@y.z', createdAt: '2026-09-03T00:00:00Z', images: [], status: 'open', statusPublic: 'open' };
    window.__docs['zz-9'] = n;
    window.__remote = [{ _id: 'zz-9', _updateTime: n._updateTime }, ...window.__remote];
  });
  r = await poll(page);
  expect(r.changed).toBe(1);
  expect(await rowIds(page)).toEqual(['zz-9', 'zz-3', 'zz-2', 'zz-1']);

  // sparito
  await page.evaluate(() => { window.__remote = window.__remote.filter((v) => v._id !== 'zz-1'); });
  r = await poll(page);
  expect(r.changed).toBe(1);
  expect(await rowIds(page)).toEqual(['zz-9', 'zz-3', 'zz-2']);
});

test('(b) selezione e scorrimento restano dopo un giro', async ({ openTab }) => {
  const page = await openTab(URL);
  const list = Array.from({ length: 60 }, (_, i) => ({ ...fb(1), _id: `zz-${i}`, seq: 800 + i, createdAt: new Date(Date.UTC(2026, 7, 1, 0, i)).toISOString(), _updateTime: `v${i}` }));
  await boot(page, list);
  await page.evaluate(() => window.__mgTest.openDetail('zz-30'));
  await expect(page.locator('#mgDetail')).toBeVisible();
  await expect(page.locator('#mgList .mg-item--selected')).toHaveAttribute('data-id', 'zz-30');

  const sc = await page.evaluate(() => {
    const cands = [document.getElementById('mgList'), document.getElementById('mgList').parentElement, document.getElementById('mgListBody')];
    for (const el of cands) { if (el && el.scrollHeight > el.clientHeight + 50) { el.scrollTop = 300; return { id: el.id, top: el.scrollTop }; } }
    return null;
  });
  expect(sc, 'la lista deve scorrere per provare lo scroll').not.toBeNull();
  expect(sc.top).toBeGreaterThan(0);

  await page.evaluate(() => {
    window.__docs['zz-5'] = { ...window.__docs['zz-5'], _updateTime: 'v5b', name: 'cambiato' };
    window.__remote = window.__remote.map((v) => v._id === 'zz-5' ? { ...v, _updateTime: 'v5b' } : v);
  });
  const r = await poll(page);
  expect(r.changed).toBe(1);
  const after = await page.evaluate((id) => document.getElementById(id).scrollTop, sc.id);
  expect(after).toBe(sc.top);
  await expect(page.locator('#mgList .mg-item--selected')).toHaveAttribute('data-id', 'zz-30');
  await expect(page.locator('#mgDetail')).toBeVisible();
});

async function detailStamp(page) {
  return page.evaluate(() => {
    const d = document.getElementById('mgDetail');
    if (!d.dataset.stamp) d.dataset.stamp = String(Math.random());
    // un marker in un nodo che openDetail ricrea (thread)
    const th = document.getElementById('mgThread');
    if (!th.querySelector('.zz-marker')) { const m = document.createElement('span'); m.className = 'zz-marker'; th.appendChild(m); }
    return true;
  });
}
const markerAlive = (page) => page.evaluate(() => !!document.querySelector('#mgThread .zz-marker'));

for (const mode of ['cursore dentro', 'cliccato altrove']) {
  test(`(c) bozza nella casella multiriga, ${mode}: il pannello non si ridisegna, poi si riallinea`, async ({ openTab }) => {
    const page = await openTab(URL);
    await boot(page, [fb(1), fb(2)], { admin: true });
    await page.evaluate(() => window.__mgTest.openDetail('zz-2'));
    const box = page.locator('#mgDetail textarea:visible').first();
    await expect(box, 'serve una casella multiriga visibile nel pannello').toBeVisible();
    await box.fill('bozza non ancora inviata');
    if (mode === 'cliccato altrove') await page.locator('#mgListHead').click();
    else await box.focus();
    await detailStamp(page);

    await page.evaluate(() => {
      window.__docs['zz-2'] = { ...window.__docs['zz-2'], _updateTime: 'nuovo', name: 'RISCRITTO DAL SERVER' };
      window.__remote = window.__remote.map((v) => v._id === 'zz-2' ? { ...v, _updateTime: 'nuovo' } : v);
    });
    let r = await poll(page);
    expect(r.changed).toBe(1);
    expect(await markerAlive(page), 'pannello ridisegnato con la bozza in corso').toBe(true);
    await expect(box).toHaveValue('bozza non ancora inviata');
    // la lista sotto è comunque aggiornata
    await expect(page.locator('#mgList .mg-item[data-id="zz-2"]')).toContainText('RISCRITTO');

    // svuoto la bozza: al giro dopo (senza altri cambiamenti) il pannello si riallinea
    await box.fill('');
    await page.locator('#mgListHead').click();
    r = await poll(page);
    expect(r.changed).toBe(0);
    // Il pannello resta sul dato fuso? Riapertura → deve mostrare il titolo nuovo.
    // Nota: con 0 cambiamenti il codice potrebbe non ridisegnare; verifichiamo
    // che almeno un giro CON un cambio ridisegni.
    await page.evaluate(() => {
      window.__docs['zz-2'] = { ...window.__docs['zz-2'], _updateTime: 'nuovo2', name: 'RISCRITTO DUE' };
      window.__remote = window.__remote.map((v) => v._id === 'zz-2' ? { ...v, _updateTime: 'nuovo2' } : v);
    });
    r = await poll(page);
    expect(r.changed).toBe(1);
    expect(await markerAlive(page), 'senza bozza il pannello deve ridisegnarsi').toBe(false);
    await expect(page.locator('#mgDetail')).toContainText('RISCRITTO DUE');
  });

  test(`(c) bozza nella riga "Frase per chi ha segnalato", ${mode}: protetta`, async ({ openTab }) => {
    const page = await openTab(URL);
    await boot(page, [fb(1, { status: 'done', statusPublic: 'closed', userNote: 'salvata prima' }), fb(2, { status: 'done', statusPublic: 'closed', userNote: 'salvata prima' })], { admin: true, tab: 'resolved' });
    await page.evaluate(() => window.__mgTest.openDetail('zz-2'));
    const riga = page.locator('#mgUserNoteText');
    await expect(riga).toBeVisible();
    await expect(riga).toHaveValue('salvata prima');
    await riga.fill('bozza nuova');
    if (mode === 'cliccato altrove') await page.locator('#mgListHead').click();
    else await riga.focus();
    await detailStamp(page);

    await page.evaluate(() => {
      window.__docs['zz-2'] = { ...window.__docs['zz-2'], _updateTime: 'nuovo', name: 'RISCRITTO DAL SERVER' };
      window.__remote = window.__remote.map((v) => v._id === 'zz-2' ? { ...v, _updateTime: 'nuovo' } : v);
    });
    let r = await poll(page);
    expect(r.changed).toBe(1);
    expect(await markerAlive(page), 'pannello ridisegnato con la bozza della frase in corso').toBe(true);
    await expect(riga).toHaveValue('bozza nuova');

    // riporto al valore salvato = niente bozza → il giro dopo con un cambio ridisegna
    await riga.fill('salvata prima');
    await page.locator('#mgListHead').click();
    await page.evaluate(() => {
      window.__docs['zz-2'] = { ...window.__docs['zz-2'], _updateTime: 'nuovo2', name: 'RISCRITTO DUE' };
      window.__remote = window.__remote.map((v) => v._id === 'zz-2' ? { ...v, _updateTime: 'nuovo2' } : v);
    });
    r = await poll(page);
    expect(r.changed).toBe(1);
    expect(await markerAlive(page)).toBe(false);
    await expect(page.locator('#mgDetail')).toContainText('RISCRITTO DUE');
  });
}

test('(d) scheda selezionata sparita: con bozza resta, svuotata si chiude al giro dopo senza altri cambi', async ({ openTab }) => {
  const page = await openTab(URL);
  await boot(page, [fb(1), fb(2)], { admin: true });
  await page.evaluate(() => window.__mgTest.openDetail('zz-2'));
  const box = page.locator('#mgDetail textarea:visible').first();
  await expect(box).toBeVisible();
  await box.fill('bozza');
  await page.locator('#mgListHead').click();

  await page.evaluate(() => { window.__remote = window.__remote.filter((v) => v._id !== 'zz-2'); });
  let r = await poll(page);
  expect(r.changed).toBe(1);
  await expect(page.locator('#mgDetail')).toBeVisible();
  await expect(box).toHaveValue('bozza');
  expect(await rowIds(page)).toEqual(['zz-1']);

  // giro senza cambi, bozza ancora lì → resta
  r = await poll(page);
  expect(r.changed).toBe(0);
  await expect(page.locator('#mgDetail')).toBeVisible();

  // svuoto la bozza → al giro dopo (niente altro cambia) si chiude
  await box.fill('');
  await page.locator('#mgListHead').click();
  r = await poll(page);
  expect(r.changed).toBe(0);
  await expect(page.locator('#mgDetail')).toBeHidden();
  await expect(page.locator('#mgDetailEmpty')).toBeVisible();
  expect(await page.evaluate(() => document.querySelectorAll('#mgList .mg-item--selected').length)).toBe(0);
});

test('(d-bis) scheda sparita con bozza nella frase per chi ha segnalato: stesso comportamento', async ({ openTab }) => {
  const page = await openTab(URL);
  await boot(page, [fb(1, { status: 'done', statusPublic: 'closed' }), fb(2, { status: 'done', statusPublic: 'closed' })], { admin: true, tab: 'resolved' });
  await page.evaluate(() => window.__mgTest.openDetail('zz-2'));
  const riga = page.locator('#mgUserNoteText');
  await riga.fill('bozza frase');
  await page.locator('#mgListHead').click();
  await page.evaluate(() => { window.__remote = window.__remote.filter((v) => v._id !== 'zz-2'); });
  await poll(page);
  await expect(page.locator('#mgDetail')).toBeVisible();
  await expect(riga).toHaveValue('bozza frase');
  await riga.fill('');
  await page.locator('#mgListHead').click();
  await poll(page);
  await expect(page.locator('#mgDetail')).toBeHidden();
});

test('(e) sorgenti che lanciano o rispondono spazzatura: lista e selezione intatte', async ({ openTab }) => {
  const page = await openTab(URL);
  await boot(page, [fb(1), fb(2), fb(3)]);
  await page.evaluate(() => window.__mgTest.openDetail('zz-2'));
  const before = await rowIds(page);

  const garbage = [null, undefined, 'stringa', 42, { ok: true }, [null, {}, { _id: '' }], () => { throw new Error('boom'); }];
  for (const g of garbage) {
    await page.evaluate((g) => {
      window.__remote = g === '__throw__' ? () => { throw new Error('boom'); } : g;
    }, typeof g === 'function' ? '__throw__' : g);
    const esito = await pollCatch(page);
    expect(await rowIds(page), `dopo listVersions=${JSON.stringify(g === undefined ? 'undefined' : g)} (${esito})`).toEqual(before);
    await expect(page.locator('#mgList .mg-item--selected')).toHaveAttribute('data-id', 'zz-2');
    await expect(page.locator('#mgDetail')).toBeVisible();
  }
  // elenco di righe senza id → non è "tutto sparito"
  await page.evaluate(() => { window.__remote = [{}, { foo: 1 }, { _updateTime: 'x' }]; });
  await pollCatch(page);
  expect(await rowIds(page)).toEqual(before);
  await expect(page.locator('#mgDetail')).toBeVisible();

  // getMany spazzatura / che lancia
  await page.evaluate(() => {
    window.__remote = window.__remote = [{ _id: 'zz-2', _updateTime: 'nuovo' }, { _id: 'zz-1', _updateTime: window.__docs['zz-1']._updateTime }, { _id: 'zz-3', _updateTime: window.__docs['zz-3']._updateTime }];
    window.__mgTest.setLiveSources({ getMany: async () => { throw new Error('rete'); } });
  });
  await pollCatch(page);
  expect(await rowIds(page)).toEqual(before);
  await page.evaluate(() => { window.__mgTest.setLiveSources({ getMany: async () => 'spazzatura' }); });
  await pollCatch(page);
  expect(await rowIds(page)).toEqual(before);
  await page.evaluate(() => { window.__mgTest.setLiveSources({ getMany: async () => [null, 'x', { senzaId: 1 }] }); });
  await pollCatch(page);
  expect(await rowIds(page)).toEqual(before);
  await expect(page.locator('#mgList .mg-item--selected')).toHaveAttribute('data-id', 'zz-2');
  await expect(page.locator('#mgDetail')).toBeVisible();

  // e dopo tutto questo, un giro sano funziona ancora
  await page.evaluate(() => {
    window.__docs['zz-2'] = { ...window.__docs['zz-2'], _updateTime: 'nuovo', name: 'DOPO IL GUASTO' };
    window.__mgTest.setLiveSources({ getMany: async (ids) => ids.map((id) => window.__docs[id]).filter(Boolean) });
  });
  const r = await poll(page);
  expect(r.changed).toBe(1);
  await expect(page.locator('#mgList .mg-item[data-id="zz-2"]')).toContainText('DOPO IL GUASTO');
});

test('(f) cammino principale: la pagina vera parte con l aggiornamento continuo acceso', async ({ openTab }) => {
  const page = await openTab(URL);
  await page.waitForFunction(() => window.__mgTest && window.__mgTest.whenReady);
  await page.evaluate(() => window.__mgTest.whenReady());
  await expect.poll(() => page.evaluate(() => window.__mgTest.isLiveOn()), { timeout: 30000 }).toBe(true);
  expect(await page.evaluate(() => window.SN_FEEDBACK_LIVE.POLL_MS)).toBeLessThanOrEqual(120000);
});

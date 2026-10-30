// Esplorazione del giro 2 di #1791.
import { test, expect } from '../../fixtures/electron.mjs';
import { MANAGE, PRATICHE, RIFERIMENTI, domanda, mainFinto, aspettaAvvio } from '../../helpers/gestioneMainFinto.mjs';

const riga = (page, id) => page.locator(`#mgDomandeLista .mg-domanda[data-id="${id}"]`);
const dq = (page, id) => page.locator(`#mgDomandaDettaglio .mg-dq[data-id="${id}"]`);
const chi = (page, x, y) => page.evaluate(([x, y]) => {
  const e = document.elementFromPoint(x, y);
  if (!e) return '';
  const d = e.closest('[data-id]');
  return `${e.tagName}.${e.className}${d ? ` @${d.dataset.id}` : ''}${e.id ? `#${e.id}` : ''}`;
}, [x, y]);

test('E1 lista corta, tre arrivi sopra col puntatore fermo: cosa sta sopra la lista', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  await page.waitForFunction(() => window.__mgTest && window.__mgTest.whenReady);
  await page.evaluate(() => window.__mgTest.whenReady());
  const base = [100, 101, 102].map((n, i) => domanda(n, { titolo: `Domanda ${n}`, creataIl: 1e12 + i * 1000 }));
  await page.evaluate((l) => window.__mgTest.setDomande(l, {}), base);
  await page.locator('.mg-sezione[data-sezione="domande"]').click();
  await expect(riga(page, 'D-102')).toBeVisible();
  const titolo = await page.locator('#mgDomandeTitolo').boundingBox();
  const tabBox = await page.locator('.mg-tab[data-tab="domande"]').boundingBox();
  const box = await riga(page, 'D-102').boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  const arrivi = [96, 97, 98].map((n, i) => domanda(n, { titolo: `Arrivata ${n}`, creataIl: 1 + i }));
  await page.evaluate((l) => window.__mgTest.setDomande(l, {}), [...arrivi, ...base]);
  await expect(riga(page, 'D-96')).toHaveCount(1);
  await page.screenshot({ path: 'tests/.shots/v1791-e1-tenuta.png' });
  console.log('E1 titolo:', await chi(page, titolo.x + titolo.width / 2, titolo.y + titolo.height / 2));
  console.log('E1 scheda:', await chi(page, tabBox.x + tabBox.width / 2, tabBox.y + tabBox.height / 2));
  const r96 = await riga(page, 'D-96').boundingBox();
  console.log('E1 D-96 y', r96.y, 'titolo y', titolo.y, 'scheda y', tabBox.y);
});

function fbVivo(id, seq, status, extra = {}) {
  return {
    _id: id, _updateTime: 'v1', seq, subSeq: 0, name: `Segnalazione ${seq}`, text: `Testo ${seq}`, status,
    statusReason: extra.statusReason || null, clientId: 'tester@example.com',
    createdAt: new Date(Date.UTC(2026, 7, 1) + seq * 3600e3).toISOString(), images: [], ...extra,
  };
}

test('E2 Ricevuti lista corta: una chiusura sopra lascia ferma la riga sotto il puntatore', async ({ openTab }) => {
  const docs = [];
  for (let n = 760; n > 757; n -= 1) docs.push(fbVivo(`f${n}`, n, 'design', { statusReason: 'clarify' }));
  const page = await openTab(MANAGE);
  await page.waitForFunction(() => window.__mgTest && window.__mgTest.whenReady);
  await page.evaluate(() => window.__mgTest.whenReady());
  await page.evaluate((docs) => {
    window.__srv = { docs: {} };
    for (const d of docs) window.__srv.docs[d._id] = d;
    const piuNuovi = (a, b) => String(b.createdAt).localeCompare(String(a.createdAt));
    window.__mgTest.setLiveSources({
      listVersions: async () => Object.values(window.__srv.docs).sort(piuNuovi).map((d) => ({ _id: d._id, _updateTime: d._updateTime })),
      getMany: async (ids) => ids.map((id) => window.__srv.docs[id]).filter(Boolean).map((d) => ({ ...d })),
    });
    window.__mgTest.setAdmin(true);
    window.__mgTest.setLiveTiming({ pollMs: 800, rientroMs: 300, clockMs: 200 });
    window.__mgTest.setData(docs.map((d) => ({ ...d })), { dalVivo: true });
    window.__mgTest.setSortMode('num');
    window.__mgTest.setTab('inbox');
  }, docs);
  await expect(page.locator('#mgList .mg-item')).toHaveCount(3);
  const box = await page.locator('.mg-item[data-id="f758"]').boundingBox();
  const p = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  await page.mouse.move(p.x, p.y);
  await page.evaluate(() => { const d = window.__srv.docs.f760; window.__srv.docs.f760 = { ...d, status: 'todo', statusReason: null, _updateTime: 'v2' }; });
  await expect(page.locator('#mgList .mg-item')).toHaveCount(2, { timeout: 10_000 });
  const ora = await page.locator('.mg-item[data-id="f758"]').boundingBox();
  console.log('E2 y prima', box.y, 'dopo', ora.y, 'sotto:', await chi(page, p.x, p.y));
  await page.screenshot({ path: 'tests/.shots/v1791-e2.png' });
});

test('E3 bozze fra domande, invio fallito, consiglio con testo, allegati fra domande', async ({ app, openTab }) => {
  const opz2 = [
    { testo: 'Tenerlo', pro: 'a', contro: 'b', azione: { tipo: 'archivia', feedbackId: 'fb-813' } },
    { testo: 'Riprendere', pro: 'a', contro: 'b', azione: { tipo: 'riprendi', feedbackId: 'fb-813' } },
  ];
  await mainFinto(app, { feedbacks: PRATICHE, riferimenti: RIFERIMENTI, domande: [domanda(52, { opzioni: opz2, consiglio: { opzione: 1, perche: 'x' } }), domanda(53, { opzioni: opz2, consiglio: { opzione: 1, perche: 'x' } })] });
  await app.evaluate(({ ipcMain }) => {
    const sotto = ipcMain._invokeHandlers.get('filo:message');
    globalThis.__mandati = [];
    globalThis.__falli = true;
    ipcMain.removeHandler('filo:message');
    ipcMain.handle('filo:message', async (event, msg) => {
      if (msg && /^domand/.test(String(msg.type)) && msg.type !== 'domande_elenco') globalThis.__mandati.push(msg);
      if (msg && msg.type === 'domanda_rispondi' && globalThis.__falli) return { ok: false, error: 'deadline-exceeded' };
      return sotto(event, msg);
    });
  });
  const page = await openTab(MANAGE);
  await aspettaAvvio(page);
  await page.evaluate(() => { let n = 0; window.SN_FEEDBACK.uploadAttachment = async (file, name) => ({ kind: /^image\//.test(file.type) ? 'img' : 'file', url: `https://firebasestorage.googleapis.com/v0/b/x/o/${++n}`, name, type: file.type }); });
  await page.locator('.mg-sezione[data-sezione="domande"]').click();
  await riga(page, 'D-52').click();
  await dq(page, 'D-52').locator('.mg-dq-testo').fill('bozza cinquantadue');
  await riga(page, 'D-53').click();
  await dq(page, 'D-53').locator('.mg-dq-testo').fill('bozza cinquantatre');
  await riga(page, 'D-52').click();
  await expect(dq(page, 'D-52').locator('.mg-dq-testo')).toHaveValue('bozza cinquantadue');
  // invio fallito
  await dq(page, 'D-52').locator('button[data-fai="testo"]').click();
  await expect(dq(page, 'D-52').locator('.mg-dq-msg')).toContainText(/Non riuscit/);
  await expect(dq(page, 'D-52').locator('.mg-dq-testo')).toHaveValue('bozza cinquantadue');
  console.log('E3 pulsanti D-52:', await dq(page, 'D-52').locator('button').allTextContents());
  console.log('E3 riga parole:', await dq(page, 'D-52').locator('.mg-dq-parole').allTextContents());
  await page.screenshot({ path: 'tests/.shots/v1791-e3-dettaglio.png' });
  await app.evaluate(() => { globalThis.__falli = false; });
  // Applica il consiglio con testo
  const applica = dq(page, 'D-52').locator('.mg-dq-applica');
  console.log('E3 applica count', await applica.count());
  if (await applica.count()) await applica.click();
  else await dq(page, 'D-52').locator('.mg-dq-azione').nth(1).click();
  await expect(dq(page, 'D-52').locator('.mg-dq-msg')).toContainText(/Mandata/);
  console.log('E3 mandati:', JSON.stringify(await app.evaluate(() => globalThis.__mandati)));
  await page.reload();
  await aspettaAvvio(page);
  await page.locator('.mg-sezione[data-sezione="domande"]').click();
  await riga(page, 'D-53').click();
  await expect(dq(page, 'D-53').locator('.mg-dq-testo')).toHaveValue('bozza cinquantatre');
  console.log('E3 bozze', await page.evaluate(() => localStorage.getItem('filo.gestione.bozzeDomande')));
});

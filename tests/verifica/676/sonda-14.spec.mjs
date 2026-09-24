import { test, expect } from '../../fixtures/electron.mjs';

const RITMO = 200;

test('sonda: perché coda-14 arriva', async ({ app, openTab }) => {
  const docs = [];
  for (let i = 1; i <= 14; i += 1) {
    docs.push({
      _id: `coda-${String(i).padStart(2, '0')}`, _updateTime: 't1',
      updatedAt: '2026-09-01T10:00:00.000Z', text: `Testo ${i}`, name: `Numero ${i}`,
      seq: 100 + i, subSeq: 0, status: 'todo', clientId: 'tester@example.com',
      createdAt: `2026-09-${String(28 - i).padStart(2, '0')}T10:00:00Z`, images: [],
    });
  }
  await app.evaluate(async (_e, { docs, ritmo }) => {
    const auth = globalThis.__filoAuth;
    auth.isAdmin = () => true;
    auth.getIdToken = async () => 'token-finto';
    globalThis.__docs = docs;
    globalThis.__log = [];
    const FB = globalThis.SN_FEEDBACK;
    FB.listVersions = async () => {
      globalThis.__log.push('listVersions');
      return globalThis.__docs.map((d) => ({ _id: d._id, _updateTime: d._updateTime, createdAt: d.createdAt }));
    };
    FB.listChangedSince = async ({ since }) => {
      const rows = globalThis.__docs.filter((d) => d.updatedAt > since);
      globalThis.__log.push(`changed:${rows.length}`);
      return { rows, complete: true };
    };
    FB.getManyPublic = async () => [];
    FB.versionsOf = async (ids) => {
      globalThis.__log.push(`versionsOf:${ids.join('|')}`);
      return globalThis.__docs.filter((d) => ids.includes(d._id))
        .map((d) => ({ _id: d._id, _updateTime: d._updateTime, createdAt: d.createdAt }));
    };
    FB.getMany = async (ids) => {
      globalThis.__log.push(`getMany:${ids.join('|')}`);
      return globalThis.__docs.filter((d) => ids.includes(d._id));
    };
    FB.submissionCount = async () => 200;
    globalThis.SN_FEEDBACK_LIVE.POLL_MS = ritmo;
  }, { docs, ritmo: RITMO });

  const page = await openTab('filo://manage/manage.html');
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.__mgTest.whenReady);
  await page.evaluate(() => window.__mgTest.whenReady());
  await page.evaluate(({ docs }) => {
    window.__mgTest.setAdmin(true);
    window.__mgTest.setData(docs.slice().reverse());
    window.__mgTest.setTab('queue');
    window.__mgTest.resumeLive();
  }, { docs });
  await expect(page.locator('.mg-item-title').first()).toHaveText('Numero 1');
  console.log('SONDA seguiti', JSON.stringify(await page.evaluate(() => window.__mgTest.idsDaSeguire())));

  await page.evaluate(async () => {
    await window.filo.message({ type: 'feedback_live_subscribe', off: true });
    await window.filo.message({ type: 'feedback_live_subscribe', watch: window.__mgTest.idsDaSeguire() });
  });
  await new Promise((r) => setTimeout(r, RITMO * 5));
  await app.evaluate(() => { globalThis.__log = []; });

  await app.evaluate(() => {
    const d = globalThis.__docs.find((x) => x._id === 'coda-14');
    d.name = 'Numero 14, presa in carico';
    d.status = 'working';
    d._updateTime = 't2';
  });
  await new Promise((r) => setTimeout(r, RITMO * 10));
  console.log('SONDA log', JSON.stringify(await app.evaluate(() => globalThis.__log.slice(0, 40))));
  console.log('SONDA titoli', JSON.stringify(await page.locator('.mg-item-title').allTextContents()));
});

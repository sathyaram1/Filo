import { test } from './fixtures/electron.mjs';
const CLIENT_ID = 'test-client-c5';
test('debug3', async ({ app, openTab }) => {
  const page = await openTab('filo://newtab/');
  await page.waitForLoadState('domcontentloaded');
  // call 1: set stub
  await app.evaluate(async (_e, { feedback }) => {
    globalThis.__dbgFb = feedback;
    globalThis.SN_FEEDBACK.list = async () => globalThis.__dbgFb;
  }, { feedback: [{ _id: 'fbA', clientId: CLIENT_ID, status: 'done', priority: 2, name: 'X', seq: 42, subSeq: 0, notes: 'S.' }] });
  // call 2 (separate): read list length
  const out = await app.evaluate(async () => {
    const all = await globalThis.SN_FEEDBACK.list({ pageSize: 200 });
    return { len: all.length, isStub: globalThis.SN_FEEDBACK.list.toString().includes('__dbgFb') };
  });
  console.log('DBG3 >>>', JSON.stringify(out));
});

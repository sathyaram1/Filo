import { test } from './fixtures/electron.mjs';
const CLIENT_ID = 'test-client-c5';
test('debug4', async ({ app, openTab }) => {
  const page = await openTab('filo://newtab/');
  await page.waitForLoadState('domcontentloaded');
  await app.evaluate(async (_e, { clientId, feedback }) => {
    await globalThis.chrome.storage.local.set({ sn_feedback_client_id: clientId });
    await globalThis.SN_CREDITS.writeState(globalThis.SN_CREDITS.freshState());
    globalThis.SN_FEEDBACK.list = async () => feedback;
  }, { clientId: CLIENT_ID, feedback: [
    { _id: 'fbA', clientId: CLIENT_ID, status: 'done', priority: 2, name: 'Incolla', seq: 42, subSeq: 0, notes: 'Sistemato.' },
  ]});
  const r = await page.evaluate(() => chrome.runtime.sendMessage({ type: 'get_feedback_rewards' }));
  console.log('DBG4 >>>', JSON.stringify(r));
});

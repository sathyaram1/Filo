import { test, expect } from './fixtures/electron.mjs';

test('VFY256 remove/clear handler edge cases', async ({ app, shell }) => {
  void shell;
  const out = await app.evaluate(async () => {
    const MSG = globalThis.SN_MSG.MSG;
    const s = { url: 'https://ex.example/p' };
    const send = (type, extra = {}) => globalThis.SN_HANDLE_MESSAGE({ type, ...extra }, s);
    await send(MSG.CLEAR_CLIPBOARD_HISTORY);
    await send(MSG.PUSH_CLIPBOARD_ENTRY, { entry: { type: 'text', text: 'alpha' } });
    await send(MSG.PUSH_CLIPBOARD_ENTRY, { entry: { type: 'text', text: 'beta' } });
    await send(MSG.PUSH_CLIPBOARD_ENTRY, { entry: { type: 'image', dataUrl: 'data:image/png;base64,ZZ', description: 'pic' } });
    // 1) remove non-existent → unchanged
    const rNone = await send(MSG.REMOVE_CLIPBOARD_ENTRY, { entry: { type: 'text', text: 'does-not-exist' } });
    // 2) remove null entry → no crash, unchanged
    const rNull = await send(MSG.REMOVE_CLIPBOARD_ENTRY, { entry: null });
    // 3) remove image by dataUrl
    const rImg = await send(MSG.REMOVE_CLIPBOARD_ENTRY, { entry: { type: 'image', dataUrl: 'data:image/png;base64,ZZ' } });
    // 4) remove text whose stored form had different whitespace ("beta " vs "beta")
    const rWs = await send(MSG.REMOVE_CLIPBOARD_ENTRY, { entry: { type: 'text', text: '  beta  ' } });
    // 5) rapid double clear
    await send(MSG.CLEAR_CLIPBOARD_HISTORY);
    const rClear2 = await send(MSG.CLEAR_CLIPBOARD_HISTORY);
    const fin = await send(MSG.GET_CLIPBOARD_HISTORY);
    return { rNone, rNull, rImg, rWs, rClear2, fin };
  });
  // non-existent: alpha, beta, image still there (3)
  expect(out.rNone.ok).toBe(true);
  expect(out.rNone.items.length).toBe(3);
  // null entry: no crash, unchanged
  expect(out.rNull.ok).toBe(true);
  expect(out.rNull.items.length).toBe(3);
  // image removed by dataUrl
  expect(out.rImg.ok).toBe(true);
  expect(out.rImg.items.some((i) => i.type === 'image')).toBe(false);
  expect(out.rImg.items.length).toBe(2);
  // whitespace-normalized match removes 'beta'
  expect(out.rWs.ok).toBe(true);
  expect(out.rWs.items.some((i) => i.text === 'beta')).toBe(false);
  expect(out.rWs.items.length).toBe(1);
  // double clear idempotent
  expect(out.rClear2.ok).toBe(true);
  expect(out.fin.items.length).toBe(0);
});

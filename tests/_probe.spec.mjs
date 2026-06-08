import { test } from './fixtures/electron.mjs';
test('probe main globals', async ({ app }) => {
  const info = await app.evaluate(async ({ app: a }) => {
    return {
      hasRequire: typeof require,
      hasGlobalRequire: typeof globalThis.require,
      hasProcessMain: typeof process.mainModule,
      keysWithReq: Object.getOwnPropertyNames(globalThis).filter(k=>/req|SN_|module/i.test(k)).slice(0,20),
      appPath: a.getAppPath(),
      hasSNSTORAGE: typeof globalThis.SN_STORAGE,
    };
  });
  console.log('PROBE', JSON.stringify(info, null, 2));
});

import { test, expect } from './fixtures/electron.mjs';

test('probe UA + client hints', async ({ openTab, testServer }) => {
  // Capture request headers the server sees (Sec-CH-UA etc).
  const headersSeen = {};
  // testServer doesn't expose req headers; capture via a custom check page.
  const page = await testServer.openReady(openTab, '<html><body>probe</body></html>');
  const data = await page.evaluate(() => ({
    ua: navigator.userAgent,
    brands: (navigator.userAgentData && navigator.userAgentData.brands) || null,
    mobile: navigator.userAgentData && navigator.userAgentData.mobile,
    platform: navigator.userAgentData && navigator.userAgentData.platform,
  }));
  console.log('PROBE_UA=' + JSON.stringify(data));
  expect(data).toBeTruthy();
});

// #686.1 giro 8, rilievo 1: su Linux il clic centrale in un campo di testo incolla la
// selezione; la rotella premuta dello zoom se lo prende, ora anche nei riquadri incorporati.

import { test, expect } from '../../fixtures/electron.mjs';

const MODULO = '<p id=s style="font:20px sans-serif;margin:0;padding:10px">ciaomondo</p>'
  + '<textarea id=t style="position:absolute;left:0;top:100px;width:400px;height:200px"></textarea>';

test('Linux: il clic centrale in un campo di testo incolla la selezione', async ({ openTab, testServer }) => {
  test.skip(process.platform !== 'linux', 'la selezione primaria esiste solo su Linux');
  const page = await testServer.openReady(openTab, `<!doctype html><html><body style="margin:0">${MODULO}</body></html>`);
  await page.mouse.dblclick(40, 22);
  expect(await page.evaluate(() => String(getSelection()))).toBe('ciaomondo');
  await page.mouse.click(100, 200, { button: 'middle' });
  await expect.poll(() => page.evaluate(() => document.getElementById('t').value)).toContain('ciaomondo');
});

test('Linux: il clic centrale in un campo di testo dentro un riquadro incorporato incolla la selezione', async ({ openTab, testServer }) => {
  test.skip(process.platform !== 'linux', 'la selezione primaria esiste solo su Linux');
  const dentro = testServer.html(`<!doctype html><html><body style="margin:0">${MODULO}</body></html>`)
    .replace('127.0.0.1', 'localhost');
  const page = await testServer.openReady(openTab, `<!doctype html><html><body style="margin:0">
    <iframe id=f src="${dentro}" style="border:0;width:100vw;height:100vh;display:block"></iframe></body></html>`);
  const frame = page.frameLocator('#f');
  await expect(frame.locator('#s')).toBeVisible();
  await page.mouse.dblclick(40, 22);
  expect(await frame.locator('#s').evaluate(() => String(getSelection()))).toBe('ciaomondo');
  await page.mouse.click(100, 200, { button: 'middle' });
  await expect.poll(() => frame.locator('#t').inputValue()).toContain('ciaomondo');
});

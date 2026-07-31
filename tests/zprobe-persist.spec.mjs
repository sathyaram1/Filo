// TEMPORANEO — audit prober: persistenza dei toggle delle pagine impostazioni.
import { test, expect } from './fixtures/electron.mjs';

async function snapshot(page) {
  return page.evaluate(() => {
    const out = {};
    for (const el of document.querySelectorAll('input[type=checkbox], input[type=radio]')) {
      if (!el.id) continue;
      if (el.offsetParent === null && el.type === 'checkbox') continue;
      out[el.id] = el.checked;
    }
    for (const el of document.querySelectorAll('select')) {
      if (el.id) out[el.id] = el.value;
    }
    return out;
  });
}

test('security: ogni checkbox visibile persiste dopo reload', async ({ openTab }) => {
  test.setTimeout(180_000);
  const page = await openTab('filo://security/security.html');
  await page.waitForTimeout(1200);

  const ids = await page.evaluate(() =>
    [...document.querySelectorAll('input[type=checkbox]')]
      .filter((e) => e.id && e.offsetParent !== null)
      .map((e) => e.id));
  console.log('checkbox security:', ids.join(', '));

  const before = await snapshot(page);
  // Flippa tutti
  for (const id of ids) {
    await page.evaluate((i) => {
      const el = document.getElementById(i);
      if (el && el.offsetParent !== null) el.click();
    }, id);
    await page.waitForTimeout(120);
  }
  const afterClick = await snapshot(page);
  await page.waitForTimeout(1200);
  await page.reload();
  await page.waitForTimeout(1500);
  const afterReload = await snapshot(page);

  const bad = [];
  for (const id of ids) {
    if (afterClick[id] === undefined) continue;
    if (afterReload[id] !== afterClick[id]) {
      bad.push(`${id}: prima=${before[id]} dopoClick=${afterClick[id]} dopoReload=${afterReload[id]}`);
    }
  }
  console.log('=== NON PERSISTITI (security) ===\n' + (bad.join('\n') || '(nessuno)'));
});

test('preferenze: ogni checkbox/select persiste dopo reload', async ({ openTab }) => {
  test.setTimeout(180_000);
  const page = await openTab('filo://preferences/preferences.html');
  await page.waitForTimeout(1500);
  const ids = await page.evaluate(() =>
    [...document.querySelectorAll('input[type=checkbox]')]
      .filter((e) => e.id && e.offsetParent !== null)
      .map((e) => e.id));
  console.log('checkbox preferenze:', ids.join(', '));
  const before = await snapshot(page);
  for (const id of ids) {
    await page.evaluate((i) => {
      const el = document.getElementById(i);
      if (el && el.offsetParent !== null) el.click();
    }, id);
    await page.waitForTimeout(120);
  }
  const afterClick = await snapshot(page);
  await page.waitForTimeout(1200);
  await page.reload();
  await page.waitForTimeout(1800);
  const afterReload = await snapshot(page);
  const bad = [];
  for (const id of ids) {
    if (afterClick[id] === undefined) continue;
    if (afterReload[id] !== afterClick[id]) {
      bad.push(`${id}: prima=${before[id]} dopoClick=${afterClick[id]} dopoReload=${afterReload[id]}`);
    }
  }
  console.log('=== NON PERSISTITI (preferenze) ===\n' + (bad.join('\n') || '(nessuno)'));
});

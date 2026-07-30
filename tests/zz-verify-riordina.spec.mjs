// VERIFIER stress test (feedback #350) — non committato, solo per la verifica.
// Copre gli spigoli non coperti dallo spec principale:
//   A) stato "già in ordine" / singola scheda → nessun crash, conferma corretta;
//   B) la scheda ATTIVA resta attiva dopo il riordino (non salta il focus);
//   C) idempotenza: riordinare due volte, il secondo è no-op ("già in ordine");
//   D) argomenti spuri ("/riordina qualcosa") → comando riconosciuto lo stesso.

import { test, expect } from './fixtures/electron.mjs';

const NEWTAB = 'filo://newtab/';
const mk = (title, color) =>
  `<!doctype html><html><head><title>${title}</title>`
  + `${color ? `<meta name="theme-color" content="${color}">` : ''}</head>`
  + `<body style="margin:0"><div style="height:1200px;background:#fff"></div></body></html>`;

async function submit(page, command) {
  await page.evaluate((cmd) => {
    const input = document.getElementById('input');
    const form = document.getElementById('inputForm');
    input.value = cmd;
    form.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
  }, command);
}

async function lastFiloLine(page) {
  return page.evaluate(() => {
    const bubbles = [...document.querySelectorAll('.dash-bubble-filo')];
    const last = bubbles[bubbles.length - 1];
    return last ? last.textContent.trim() : '';
  });
}

test('A) singola scheda / già in ordine → conferma "già in ordine", nessun crash', async ({ openTab }) => {
  const dash = await openTab(NEWTAB);
  await expect(dash.locator('#input')).toBeVisible({ timeout: 8_000 });
  await submit(dash, '/riordina');
  await expect.poll(() => lastFiloLine(dash), { timeout: 8_000 })
    .toContain('già in ordine');
  // la dashboard è ancora viva
  await expect(dash.locator('#input')).toBeVisible();
});

test('B) la scheda attiva resta attiva dopo /riordina', async ({ shell, openTab, testServer }) => {
  await testServer.openReady(openTab, mk('Blu', 'rgb(40,80,200)'));
  await testServer.openReady(openTab, mk('Verde', 'rgb(40,200,80)'));
  // apri Rosso per ultima: diventa la scheda ATTIVA
  await testServer.openReady(openTab, mk('Rosso', 'rgb(200,40,40)'));
  const dash = await openTab(NEWTAB);
  await expect(dash.locator('#input')).toBeVisible({ timeout: 8_000 });

  await expect.poll(async () => shell.evaluate(async () => {
    const s = await window.filoShell.tabs.snapshot();
    const web = s.tabs.filter((t) => /127\.0\.0\.1/.test(t.url || ''));
    return web.length === 3 && web.every((t) => !!t.identityColor);
  }), { timeout: 12_000 }).toBe(true);

  // Attiva la scheda Rosso e ricorda il suo id
  const activeBefore = await shell.evaluate(async () => {
    const s = await window.filoShell.tabs.snapshot();
    const rosso = s.tabs.find((t) => t.title === 'Rosso');
    if (rosso) await window.filoShell.tabs.activate(rosso.id);
    return rosso ? rosso.id : null;
  });
  expect(activeBefore).toBeTruthy();

  await submit(dash, '/riordina');

  // Dopo il riordino, la scheda attiva deve essere ANCORA quella di prima.
  await expect.poll(async () => shell.evaluate(async () => {
    const s = await window.filoShell.tabs.snapshot();
    return s.activeId;
  }), { timeout: 10_000 }).toBe(activeBefore);
});

test('C) idempotenza: secondo /riordina è no-op', async ({ shell, openTab, testServer }) => {
  await testServer.openReady(openTab, mk('Blu', 'rgb(40,80,200)'));
  await testServer.openReady(openTab, mk('Verde', 'rgb(40,200,80)'));
  await testServer.openReady(openTab, mk('Rosso', 'rgb(200,40,40)'));
  const dash = await openTab(NEWTAB);
  await expect(dash.locator('#input')).toBeVisible({ timeout: 8_000 });
  await expect.poll(async () => shell.evaluate(async () => {
    const s = await window.filoShell.tabs.snapshot();
    const web = s.tabs.filter((t) => /127\.0\.0\.1/.test(t.url || ''));
    return web.length === 3 && web.every((t) => !!t.identityColor);
  }), { timeout: 12_000 }).toBe(true);

  await submit(dash, '/riordina');
  await expect.poll(() => lastFiloLine(dash), { timeout: 8_000 })
    .toContain('riordinate per colore');

  await submit(dash, '/riordina');
  await expect.poll(() => lastFiloLine(dash), { timeout: 8_000 })
    .toContain('già in ordine');
});

test('D) "/riordina argomenti" resta comando Filo riconosciuto', async ({ openTab }) => {
  const dash = await openTab(NEWTAB);
  const input = dash.locator('#input');
  await expect(input).toBeVisible({ timeout: 8_000 });
  await input.fill('/riordina adesso per favore');
  await expect(input).toHaveClass(/is-cmd-filo/);
  await expect(input).not.toHaveClass(/is-cmd-unknown/);
});

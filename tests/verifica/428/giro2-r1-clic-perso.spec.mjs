// Verifica #428, giro 2, rilievo 1: un clic sulla X (o col tasto centrale) si perde se un'altra
// scheda si aggiorna fra pressione e rilascio. La pressione di 90 ms è quella di un clic umano.

import { test, expect } from '../../fixtures/electron.mjs';

async function apriConUnaCheSiAggiorna(shell, testServer) {
  for (let i = 0; i < 4; i++) {
    await shell.evaluate((u) => window.filoShell.tabs.open(u), testServer.html(`<title>Pagina ${i}</title><p>${i}</p>`));
  }
  // Una scheda che cambia titolo di continuo, come la posta col contatore o un timer.
  await shell.evaluate((u) => window.filoShell.tabs.open(u), testServer.html(
    '<title>(0) Posta</title><script>let n=0;setInterval(()=>{document.title="("+(++n)+") Posta"},30)</script>',
  ));
  await expect(shell.locator('#tabs .tab')).toHaveCount(6, { timeout: 15_000 });
  await expect.poll(() => shell.evaluate(() => document.querySelector('#tabs .tab:last-child .title')?.textContent || ''), { timeout: 8_000 }).toMatch(/\(\d+\) Posta/);
}

async function schedaInPosizione(shell, i) {
  return shell.evaluate((k) => {
    const el = document.querySelectorAll('#tabs .tab')[k];
    const r = el.getBoundingClientRect();
    const c = el.querySelector('.close').getBoundingClientRect();
    return { id: el.dataset.id, corpo: { x: r.left + 20, y: r.top + r.height / 2 }, x: { x: c.left + c.width / 2, y: c.top + c.height / 2 } };
  }, i);
}

async function aperte(shell) {
  return shell.evaluate(() => [...document.querySelectorAll('#tabs .tab')].map((el) => el.dataset.id));
}

test('clic sulla X mentre un’altra scheda si aggiorna: la scheda si chiude', async ({ shell, testServer }) => {
  await apriConUnaCheSiAggiorna(shell, testServer);
  const s = await schedaInPosizione(shell, 1);
  await shell.mouse.move(s.x.x, s.x.y);
  await shell.mouse.down();
  await shell.waitForTimeout(90);
  await shell.mouse.up();
  await expect.poll(() => aperte(shell), { timeout: 3_000 }).not.toContain(s.id);
});

test('clic centrale mentre un’altra scheda si aggiorna: la scheda si chiude', async ({ shell, testServer }) => {
  await apriConUnaCheSiAggiorna(shell, testServer);
  const s = await schedaInPosizione(shell, 1);
  await shell.mouse.move(s.corpo.x, s.corpo.y);
  await shell.mouse.down({ button: 'middle' });
  await shell.waitForTimeout(90);
  await shell.mouse.up({ button: 'middle' });
  await expect.poll(() => aperte(shell), { timeout: 3_000 }).not.toContain(s.id);
});

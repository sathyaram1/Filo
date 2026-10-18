// Un clic sulla striscia delle schede arriva anche se un'altra scheda si aggiorna fra pressione e
// rilascio (#428): la X, il tasto centrale e i piccoli controlli dentro la scheda. La pressione di
// 90 ms è quella di un clic umano; la scheda «Posta» cambia titolo ogni 30 ms, come un contatore.

import { test, expect } from './fixtures/electron.mjs';

async function apriConUnaCheSiAggiorna(shell, testServer) {
  for (let i = 0; i < 4; i++) {
    await shell.evaluate((u) => window.filoShell.tabs.open(u), testServer.html(`<title>Pagina ${i}</title><p>${i}</p>`));
  }
  await shell.evaluate((u) => window.filoShell.tabs.open(u), testServer.html(
    '<title>(0) Posta</title><script>let n=0;setInterval(()=>{document.title="("+(++n)+") Posta"},30)</script>',
  ));
  await expect(shell.locator('#tabs .tab')).toHaveCount(6, { timeout: 15_000 });
  await expect.poll(() => shell.evaluate(() => document.querySelector('#tabs .tab:last-child .title')?.textContent || ''), { timeout: 8_000 }).toMatch(/\(\d+\) Posta/);
}

async function centro(shell, i, selettore) {
  return shell.evaluate(([k, sel]) => {
    const el = document.querySelectorAll('#tabs .tab')[k];
    const r = (sel ? el.querySelector(sel) : el).getBoundingClientRect();
    return { id: el.dataset.id, x: sel ? r.left + r.width / 2 : r.left + 20, y: r.top + r.height / 2 };
  }, [i, selettore]);
}

async function clicUmano(shell, p, button = 'left') {
  await shell.mouse.move(p.x, p.y);
  await shell.mouse.down({ button });
  await shell.waitForTimeout(90);
  await shell.mouse.up({ button });
}

const aperte = (shell) => shell.evaluate(() => [...document.querySelectorAll('#tabs .tab')].map((el) => el.dataset.id));

test('la X chiude la scheda anche mentre un’altra si aggiorna', async ({ shell, testServer }) => {
  await apriConUnaCheSiAggiorna(shell, testServer);
  const p = await centro(shell, 1, '.close');
  await clicUmano(shell, p);
  await expect.poll(() => aperte(shell), { timeout: 3_000 }).not.toContain(p.id);
});

test('il tasto centrale chiude la scheda anche mentre un’altra si aggiorna', async ({ shell, testServer }) => {
  await apriConUnaCheSiAggiorna(shell, testServer);
  const p = await centro(shell, 1, null);
  await clicUmano(shell, p, 'middle');
  await expect.poll(() => aperte(shell), { timeout: 3_000 }).not.toContain(p.id);
});

test('l’altoparlante barrato riattiva l’audio anche mentre un’altra scheda si aggiorna', async ({ shell, testServer }) => {
  await apriConUnaCheSiAggiorna(shell, testServer);
  const id = (await aperte(shell))[1];
  await shell.evaluate((x) => window.filoShell.tabs.setMuted(x), id);
  const muto = shell.locator(`#tabs .tab[data-id="${id}"] .mute-ind`);
  await expect(muto).toHaveCount(1, { timeout: 5_000 });
  const p = await centro(shell, 1, '.mute-ind');
  await clicUmano(shell, p);
  await expect(muto).toHaveCount(0, { timeout: 3_000 });
});

test('un clic sulla scheda la apre, e il titolo che nel frattempo è cambiato si vede', async ({ shell, testServer }) => {
  await apriConUnaCheSiAggiorna(shell, testServer);
  const p = await centro(shell, 1, null);
  await clicUmano(shell, p);
  await expect(shell.locator('#tabs .tab.active')).toHaveAttribute('data-id', p.id, { timeout: 3_000 });
  const titolo = () => shell.evaluate(() => document.querySelector('#tabs .tab:last-child .title')?.textContent || '');
  const primo = await titolo();
  await expect.poll(titolo, { timeout: 3_000 }).not.toBe(primo);
});

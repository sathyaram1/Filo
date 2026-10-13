import { test, expect } from './fixtures/electron.mjs';

// #975 — un sito col suo menu del tasto destro: il menu di Filo lo offre in cima («Menu di <sito>»), il clic lo apre
// nello stesso punto, e dopo alcune scelte Filo propone di dare il tasto destro al sito (Filo resta su Maiusc).

// Il menu della pagina si apre solo a un tasto destro vero, come fanno i siti che guardano isTrusted.
const CON_MENU = `<!doctype html><html><head><meta property="og:site_name" content="Lavagna"><title>Lavagna</title>
<style>#menu-suo{position:fixed;background:#eee;padding:8px;border:1px solid #999}</style></head>
<body style="margin:0;padding:40px;font:16px sans-serif">
  <div id="area" style="width:420px;height:220px;background:#f6efe2">area con un menu suo</div>
  <p id="fuori">testo fuori</p>
  <script>
    document.getElementById('area').addEventListener('contextmenu', function (e) {
      e.preventDefault();
      if (!e.isTrusted) return;
      var m = document.getElementById('menu-suo');
      if (!m) { m = document.createElement('div'); m.id = 'menu-suo'; m.textContent = 'Menu della lavagna'; document.body.appendChild(m); }
      m.style.left = e.clientX + 'px'; m.style.top = e.clientY + 'px';
      m.dataset.x = String(e.clientX); m.dataset.y = String(e.clientY);
      m.dataset.volte = String(Number(m.dataset.volte || 0) + 1);
    });
  </script>
</body></html>`;

const SENZA_MENU = `<!doctype html><html><head><title>Semplice</title></head>
<body style="margin:0;padding:40px;font:16px sans-serif">
  <div id="area" style="width:420px;height:220px;background:#f6efe2">area senza menu</div>
  <div id="blocco" style="width:420px;height:120px;background:#e2ecf6">qui il sito blocca il tasto destro e basta</div>
  <script>
    document.getElementById('blocco').oncontextmenu = function () { return false; };
    document.getElementById('blocco').addEventListener('contextmenu', function (e) { e.preventDefault(); });
  </script>
</body></html>`;

const vociDelMenu = (page) => page.locator('.sn-menu:not(.sn-menu-sub) > .sn-menu-split .sn-menu-label, .sn-menu:not(.sn-menu-sub) > .sn-menu-item .sn-menu-label').allInnerTexts();

async function tastoDestro(page, sel, { shift = false } = {}) {
  if (shift) await page.keyboard.down('Shift');
  await page.locator(sel).click({ button: 'right', position: { x: 60, y: 50 } });
  if (shift) await page.keyboard.up('Shift');
}

test('sul sito col suo menu: «Menu di Lavagna» in cima, e il clic apre il menu del sito nello stesso punto', async ({ openTab, testServer }) => {
  const page = await testServer.openReady(openTab, CON_MENU);
  await tastoDestro(page, '#area');
  await expect(page.locator('.sn-menu').first()).toBeVisible();
  const voci = await vociDelMenu(page);
  expect(voci[0]).toBe('Menu di Lavagna');
  await expect(page.locator('#menu-suo')).toHaveCount(0);

  const box = await page.locator('#area').boundingBox();
  await page.locator('.sn-menu-split-main', { hasText: 'Menu di Lavagna' }).click();
  await expect(page.locator('#menu-suo')).toBeVisible();
  await expect(page.locator('.sn-menu')).toHaveCount(0);
  // Nello stesso punto del tasto destro.
  expect(Math.abs(Number(await page.locator('#menu-suo').getAttribute('data-x')) - (box.x + 60))).toBeLessThanOrEqual(2);
  expect(Math.abs(Number(await page.locator('#menu-suo').getAttribute('data-y')) - (box.y + 50))).toBeLessThanOrEqual(2);
});

test('una pagina senza menu suo, o che blocca soltanto il tasto destro: nessuna voce in più', async ({ openTab, testServer }) => {
  const page = await testServer.openReady(openTab, SENZA_MENU);
  for (const sel of ['#area', '#blocco']) {
    await tastoDestro(page, sel);
    await expect(page.locator('.sn-menu').first()).toBeVisible();
    const voci = await vociDelMenu(page);
    expect(voci.join(' | ')).not.toContain('Menu di');
    await page.keyboard.press('Escape');
    await expect(page.locator('.sn-menu')).toHaveCount(0);
  }
});

test('dopo alcune scelte Filo propone il menu del sito al tasto destro: accettato, il tasto destro è del sito e Maiusc apre Filo', async ({ openTab, testServer, avvisi }) => {
  const page = await testServer.openReady(openTab, CON_MENU);
  for (let i = 1; i <= 3; i++) {
    await tastoDestro(page, '#area');
    await page.locator('.sn-menu-split-main', { hasText: 'Menu di Lavagna' }).click();
    await expect(page.locator('#menu-suo')).toHaveAttribute('data-volte', String(i));
    await page.locator('#fuori').click();
  }
  const vista = await avvisi();
  const proposta = vista.locator('.shell-notif', { hasText: 'direttamente col tasto destro' });
  await expect(proposta).toBeVisible({ timeout: 8000 });
  await expect(proposta).toContainText('127.0.0.1');
  await proposta.locator('.shell-notif-action', { hasText: 'Sì' }).click();
  await expect(vista.locator('.shell-notif-msg', { hasText: 'il tasto destro apre il menu del sito' })).toBeVisible({ timeout: 8000 });

  // Il tasto destro adesso apre il menu del sito, senza passare da Filo.
  await expect.poll(async () => {
    await tastoDestro(page, '#area');
    await page.waitForTimeout(250);
    return { sito: await page.locator('#menu-suo').getAttribute('data-volte'), filo: await page.locator('.sn-menu').count() };
  }, { timeout: 8000 }).toEqual({ sito: '4', filo: 0 });

  // Dove il sito non ha un menu suo, il tasto destro apre comunque quello di Filo.
  await tastoDestro(page, '#fuori');
  await expect(page.locator('.sn-menu').first()).toBeVisible();
  await page.keyboard.press('Escape');

  // Maiusc + tasto destro: il menu di Filo, con la voce per tornare indietro.
  await tastoDestro(page, '#area', { shift: true });
  await expect(page.locator('.sn-menu').first()).toBeVisible();
  expect(await page.locator('#menu-suo').getAttribute('data-volte')).toBe('4');
  await page.locator('.sn-menu-split', { hasText: 'Menu di Lavagna' }).locator('.sn-menu-split-arrow').hover();
  await page.locator('.sn-menu-sub .sn-menu-item', { hasText: 'Rimetti il menu di Filo al tasto destro' }).click();
  await expect.poll(async () => {
    await tastoDestro(page, '#area');
    await page.waitForTimeout(250);
    const n = await page.locator('.sn-menu').count();
    if (n) await page.keyboard.press('Escape');
    return n > 0;
  }, { timeout: 8000 }).toBe(true);
});

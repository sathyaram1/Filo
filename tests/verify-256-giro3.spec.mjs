// Verifica #256, terzo giro: il giro COMPLETO dell'utente (copio davvero →
// la voce compare → la tolgo → sparisce anche dal menu Incolla), e la lista
// lasciata aperta in una scheda mentre si copia in un'altra.

import { test, expect } from './fixtures/electron.mjs';

async function stored(app) {
  return app.evaluate(async () => {
    const MSG = globalThis.SN_MSG.MSG;
    const res = await globalThis.SN_HANDLE_MESSAGE(
      { type: MSG.GET_CLIPBOARD_HISTORY },
      { url: 'filo://security/security.html' },
    );
    return (res.items || []).map((e) => (e.type === 'image' ? 'IMG' : e.text));
  });
}

async function pushEntry(app, text) {
  await app.evaluate(async (_e, t) => {
    const MSG = globalThis.SN_MSG.MSG;
    await globalThis.SN_HANDLE_MESSAGE(
      { type: MSG.PUSH_CLIPBOARD_ENTRY, entry: { type: 'text', text: t } },
      { url: 'https://example.com/page' },
    );
  }, text);
}

test('#256 giro completo: copio dalla pagina web col menu, la voce compare in Sicurezza e la tolgo', async ({ app, shell, openTab, testServer }) => {
  const SEGRETO = 'chiave-Segreta-42-copiata-a-mano';
  const web = await testServer.openReady(
    openTab,
    `<!doctype html><html><body style="padding:40px"><p id="p">${SEGRETO}</p><textarea id="ta" rows="4" cols="50"></textarea></body></html>`,
  );

  // Selezione + "Copia" dal menu del tasto destro: la strada dell'utente.
  await web.evaluate(() => {
    const p = document.getElementById('p');
    const r = document.createRange();
    r.selectNodeContents(p);
    const s = getSelection();
    s.removeAllRanges();
    s.addRange(r);
  });
  await web.locator('#p').click({ button: 'right' });
  await expect(web.locator('.sn-menu')).toBeVisible();
  const copia = web.locator('.sn-menu-item', { hasText: /^Copia$/ });
  await expect(copia.first()).toBeVisible();
  await copia.first().click();

  await expect.poll(() => stored(app), { timeout: 8_000 }).toContain(SEGRETO);

  // La pagina Sicurezza la mostra…
  const pagina = await openTab('filo://security/');
  const riga = pagina.locator('.sn-clip-item', { hasText: SEGRETO });
  await expect(riga).toHaveCount(1, { timeout: 10_000 });

  // …e da lì si toglie.
  await riga.locator('.sn-clip-remove').click();
  await expect.poll(() => stored(app)).not.toContain(SEGRETO);

  // Ed è sparita anche dal menu "Incolla" della pagina web (le due viste
  // raccontano la stessa cronologia).
  await shell.evaluate(() => {}); // no-op: tiene shell nella firma
  await web.bringToFront?.();
  await web.locator('#ta').click({ button: 'right' });
  await expect(web.locator('.sn-menu')).toBeVisible();
  await web.locator('.sn-menu-paste-arrow').click();
  const sub = web.locator('.sn-menu-sub');
  await expect(sub).toBeVisible();
  await expect(sub).not.toContainText(SEGRETO);
});

test('#256 scheda Sicurezza lasciata aperta: tornandoci sopra mostra le copie fatte nel frattempo', async ({ app, shell, openTab, testServer }) => {
  await pushEntry(app, 'voce iniziale');
  const pagina = await openTab('filo://security/');
  await expect(pagina.locator('#sec-clip-list .sn-clip-item')).toHaveCount(1, { timeout: 10_000 });

  // Vado in un'altra scheda e lì copio qualcosa di sensibile.
  const web = await testServer.openReady(
    openTab,
    '<!doctype html><html><body style="padding:40px"><p>altro</p></body></html>',
  );
  await pushEntry(app, 'password-copiata-nel-frattempo');
  expect(await stored(app)).toContain('password-copiata-nel-frattempo');

  // Torno sulla scheda Sicurezza: deve mostrarla, altrimenti la pagina della
  // privacy racconta una cronologia più corta di quella vera.
  const tabs = await shell.evaluate(async () => (await window.filoShell.tabs.snapshot()));
  const info = JSON.stringify(tabs).slice(0, 400);
  console.log('[#256] tabs:', info);
  const secId = await shell.evaluate(async () => {
    const snap = await window.filoShell.tabs.snapshot();
    const list = Array.isArray(snap) ? snap : (snap.tabs || []);
    const t = list.find((x) => String(x.url || '').includes('security'));
    return t ? t.id : null;
  });
  expect(secId, 'la scheda Sicurezza deve esistere nello snapshot').toBeTruthy();
  await shell.evaluate((id) => window.filoShell.tabs.activate(id), secId);
  await pagina.waitForTimeout(1500);

  const testo = await pagina.locator('#sec-clip-list').textContent();
  console.log('[#256] dopo il ritorno sulla scheda, la lista contiene la nuova copia:', testo.includes('password-copiata-nel-frattempo'));
  void web;
  // La pagina non aspetta di "tornare visibile" (in Filo cambiare scheda non
  // spegne la pagina di prima: quel momento non arriverebbe mai). Il main
  // avvisa le pagine interne a ogni cambio della cronologia, quindi la lista
  // qui è già quella vera.
  expect(await stored(app), 'la cronologia vera contiene la nuova copia').toContain('password-copiata-nel-frattempo');
  expect(testo, 'e la pagina aperta la mostra').toContain('password-copiata-nel-frattempo');
});

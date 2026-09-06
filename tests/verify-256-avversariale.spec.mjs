// Verifica avversariale del feedback #256 — cronologia appunti: togliere una
// singola voce e svuotare tutto, sia dal menu "Incolla" sia da una pagina
// dell'app raggiungibile senza campi di testo.
//
// Qui si prova a ROMPERE: testo da 10.000 caratteri, HTML/script dentro la
// voce, emoji, voce di soli spazi, immagine con miniatura, annulla della
// conferma (che NON deve cancellare), doppio clic rapido sul rimuovi, stato
// vuoto, tema scuro, e la lista che invecchia mentre la pagina è aperta.

import { test, expect } from './fixtures/electron.mjs';
import { clickConfirm, CONFIRM_HOST } from './helpers/confirm.mjs';

const LUNGO = 'L' + 'ungo'.repeat(2500);           // ~10.000 caratteri
const XSS = '<img src=x onerror="window.__xss=1"><script>window.__xss2=1</script>';
const EMOJI = '🔐 password con emoji 😀😀 e accenti àèìòù';
const SPAZI = '     ';
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

async function seed(app, entries) {
  await app.evaluate(async (_e, list) => {
    const MSG = globalThis.SN_MSG.MSG;
    for (const entry of list) {
      await globalThis.SN_HANDLE_MESSAGE(
        { type: MSG.PUSH_CLIPBOARD_ENTRY, entry },
        { url: 'https://example.com/page' },
      );
    }
  }, entries.map((e) => (typeof e === 'string' ? { type: 'text', text: e } : e)));
}

async function stored(app) {
  return app.evaluate(async () => {
    const MSG = globalThis.SN_MSG.MSG;
    const res = await globalThis.SN_HANDLE_MESSAGE(
      { type: MSG.GET_CLIPBOARD_HISTORY },
      { url: 'filo://security/security.html' },
    );
    return (res.items || []).map((e) => (e.type === 'image' ? `img:${(e.dataUrl || '').slice(0, 24)}` : e.text));
  });
}

test('#256 pagina Sicurezza: input limite (10k, HTML, emoji, immagine) senza rompere layout né eseguire codice', async ({ app, shell, openTab }) => {
  void shell;
  await seed(app, [LUNGO, XSS, EMOJI, SPAZI, { type: 'image', dataUrl: PNG, description: 'schermata di prova' }]);

  const page = await openTab('filo://security/');
  const list = page.locator('#sec-clip-list');
  await expect(list.locator('.sn-clip-item')).toHaveCount(5, { timeout: 10_000 });

  // (1) Nessun codice eseguito e nessun elemento iniettato dal testo della voce.
  expect(await page.evaluate(() => [window.__xss, window.__xss2])).toEqual([undefined, undefined]);
  // Una sola <img>: la miniatura della voce immagine, non quella del testo ostile.
  expect(await list.locator('img').count()).toBe(1);
  expect(await list.locator('script').count()).toBe(0);
  // Il testo ostile si LEGGE per intero (non è stato interpretato).
  await expect(list).toContainText('onerror');

  // (2) La voce da 10.000 caratteri non sfonda la pagina in orizzontale.
  const overflow = await page.evaluate(() => ({
    doc: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    body: document.body.scrollWidth - document.body.clientWidth,
  }));
  expect(overflow.doc, 'la pagina non deve scorrere in orizzontale').toBeLessThanOrEqual(1);
  expect(overflow.body).toBeLessThanOrEqual(1);

  // Ogni riga sta dentro la larghezza della lista e ha un'altezza sana
  // (una voce da 10k caratteri non deve diventare un muro di testo).
  const righe = await page.evaluate(() => {
    const l = document.getElementById('sec-clip-list');
    const w = l.getBoundingClientRect().width;
    return [...l.querySelectorAll('.sn-clip-item')].map((r) => ({
      h: Math.round(r.getBoundingClientRect().height),
      sfora: Math.round(r.getBoundingClientRect().right - (l.getBoundingClientRect().left + w)),
      rimuovi: !!r.querySelector('.sn-clip-remove'),
      visibileRimuovi: (() => {
        const b = r.querySelector('.sn-clip-remove');
        if (!b) return false;
        const rb = b.getBoundingClientRect();
        return rb.width > 0 && rb.height > 0 && rb.right <= l.getBoundingClientRect().right + 1;
      })(),
    }));
  });
  console.log('[#256] righe:', JSON.stringify(righe));
  for (const r of righe) {
    expect(r.rimuovi, 'ogni voce ha il suo Rimuovi').toBe(true);
    expect(r.visibileRimuovi, 'il Rimuovi resta dentro la lista e cliccabile').toBe(true);
    expect(r.sfora, 'la riga non sfora la lista').toBeLessThanOrEqual(1);
    expect(r.h, 'la riga non diventa un muro di testo').toBeLessThan(200);
  }

  await page.locator('#sec-clipboard').screenshot({ path: 'tests/.shots/256-clipboard-limite-chiaro.png' });

  // (3) Rimuovere la voce da 10k toglie SOLO quella.
  const rowLungo = list.locator('.sn-clip-item', { hasText: 'Lungoungo' });
  await rowLungo.first().locator('.sn-clip-remove').click();
  await expect(list.locator('.sn-clip-item')).toHaveCount(4);
  await expect.poll(() => stored(app)).toHaveLength(4);
  expect((await stored(app)).some((t) => typeof t === 'string' && t.startsWith('Lungo'))).toBe(false);

  // (4) La voce immagine si rimuove come le altre.
  const rowImg = list.locator('.sn-clip-item', { hasText: 'schermata di prova' });
  await rowImg.locator('.sn-clip-remove').click();
  await expect(list.locator('.sn-clip-item')).toHaveCount(3);
  expect((await stored(app)).some((t) => String(t).startsWith('img:'))).toBe(false);
});

test('#256 pagina Sicurezza: "annulla" sulla conferma NON svuota; il doppio clic non porta via due voci', async ({ app, shell, openTab }) => {
  void shell;
  await seed(app, ['prima voce', 'seconda voce', 'terza voce']);
  const page = await openTab('filo://security/');
  const list = page.locator('#sec-clip-list');
  await expect(list.locator('.sn-clip-item')).toHaveCount(3, { timeout: 10_000 });

  // Annulla: la cronologia resta intatta.
  await page.locator('#sec-clip-clear').click();
  await expect(page.locator(CONFIRM_HOST)).toBeVisible();
  await clickConfirm(page, 'cancel');
  await expect(page.locator(CONFIRM_HOST)).toHaveCount(0);
  expect(await stored(app)).toHaveLength(3);
  await expect(list.locator('.sn-clip-item')).toHaveCount(3);

  // Doppio clic rapido sul Rimuovi della prima riga: una sola voce se ne va.
  const rm = list.locator('.sn-clip-item', { hasText: 'prima voce' }).locator('.sn-clip-remove');
  await rm.dblclick({ force: true });
  await page.waitForTimeout(600);
  const dopo = await stored(app);
  console.log('[#256] dopo doppio clic:', JSON.stringify(dopo));
  expect(dopo, 'il doppio clic toglie UNA voce sola').toHaveLength(2);
  expect(dopo).not.toContain('prima voce');

  // Svuota per davvero: conferma → tutto via, e la pagina mostra lo stato vuoto.
  await page.locator('#sec-clip-clear').click();
  await clickConfirm(page, 'ok');
  await expect.poll(() => stored(app)).toEqual([]);
  await expect(page.locator('#sec-clip-empty')).toBeVisible();
  await expect(page.locator('#sec-clip-clear')).toBeHidden();
  await page.locator('#sec-clipboard').screenshot({ path: 'tests/.shots/256-clipboard-vuoto.png' });

  // Ricaricando resta vuota (non è un vuoto solo di facciata).
  await page.reload();
  await expect(page.locator('#sec-clip-empty')).toBeVisible();
  await expect(page.locator('#sec-clip-list .sn-clip-item')).toHaveCount(0);
});

test('#256 pagina Sicurezza: tema scuro leggibile', async ({ app, shell, openTab }) => {
  void shell;
  await app.evaluate(async () => {
    const MSG = globalThis.SN_MSG.MSG;
    await globalThis.SN_HANDLE_MESSAGE(
      { type: MSG.SET_SETTINGS, patch: { theme: 'dark' } },
      { url: 'filo://security/security.html' },
    ).catch(() => {});
  }).catch(() => {});
  await seed(app, ['password-di-prova-scura', EMOJI, { type: 'image', dataUrl: PNG, description: 'schermata scura' }]);
  const page = await openTab('filo://security/');
  await expect(page.locator('#sec-clip-list .sn-clip-item')).toHaveCount(3, { timeout: 10_000 });
  const tema = await page.evaluate(() => document.documentElement.dataset.snTheme || document.documentElement.getAttribute('data-theme') || '');
  console.log('[#256] tema pagina:', tema);
  await page.locator('#sec-clipboard').screenshot({ path: 'tests/.shots/256-clipboard-scuro.png' });
});

test('#256 la lista della pagina invecchia? (copia nuova mentre la pagina è aperta)', async ({ app, shell, openTab }) => {
  void shell;
  await seed(app, ['voce iniziale']);
  const page = await openTab('filo://security/');
  await expect(page.locator('#sec-clip-list .sn-clip-item')).toHaveCount(1, { timeout: 10_000 });

  // L'utente copia qualcosa di sensibile MENTRE la pagina è aperta.
  await seed(app, ['password-copiata-dopo']);
  await page.waitForTimeout(1500);
  const testo = await page.locator('#sec-clip-list').textContent();
  const aggiornata = testo.includes('password-copiata-dopo');
  console.log('[#256] la pagina si aggiorna da sola:', aggiornata);
  // Non fallisce: è una probe. Il verdetto sta nella critica.
  expect(await stored(app)).toContain('password-copiata-dopo');
});

test('#256 menu Incolla: rimuovi e svuota anche dal tasto destro, con annulla che non cancella', async ({ app, shell, openTab, testServer }) => {
  void shell;
  await seed(app, ['segreto-nel-menu', 'altro testo', EMOJI]);
  const page = await testServer.openReady(
    openTab,
    '<!doctype html><html><body style="padding:40px"><textarea id="ta" rows="5" cols="60"></textarea></body></html>',
  );

  const apriSub = async () => {
    await page.locator('#ta').click({ button: 'right' });
    await expect(page.locator('.sn-menu')).toBeVisible();
    await page.locator('.sn-menu-paste-arrow').click();
    const sub = page.locator('.sn-menu-history-sub');
    await expect(sub).toBeVisible();
    return sub;
  };

  let sub = await apriSub();
  await expect(sub.locator('.sn-menu-history-item')).toHaveCount(3);
  await sub.locator('.sn-menu-history-item', { hasText: 'segreto-nel-menu' }).locator('.sn-menu-history-remove').click();
  await expect(sub.locator('.sn-menu-history-item')).toHaveCount(2);
  await expect.poll(() => stored(app)).not.toContain('segreto-nel-menu');

  // Annulla lo svuotamento: la cronologia resta.
  await sub.locator('.sn-menu-history-clear-btn').click();
  await expect(page.locator(CONFIRM_HOST)).toBeVisible();
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);
  expect(await stored(app), 'annullando la conferma non si perde nulla').toHaveLength(2);

  // Svuota davvero.
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
  sub = await apriSub();
  await sub.locator('.sn-menu-history-clear-btn').click();
  await expect(page.locator(CONFIRM_HOST)).toBeVisible();
  const via = await page.evaluate(() => {
    const host = document.querySelector('.sn-confirm-host');
    return !!host;
  });
  expect(via).toBe(true);
  await page.screenshot({ path: 'tests/.shots/256-menu-conferma.png' });
});

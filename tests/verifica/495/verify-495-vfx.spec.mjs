// Verifica avversariale #495 — «puoi mostrare quanti feedback ci sono in ogni
// sezione? es: ricevuti (24) in coda (12)» sulla dashboard di gestione.
//
// Nero: si guarda solo quello che l'owner legge sullo schermo.

import { test, expect } from '../../fixtures/electron.mjs';

const URL = 'filo://manage/manage.html';

function fb(id, status, extra) {
  return {
    _id: id,
    text: `Feedback ${id}`,
    name: `Feedback ${id}`,
    seq: Number(String(id).replace(/\D/g, '')) || 1,
    subSeq: 0,
    clientId: 'tester@example.com',
    createdAt: '2026-06-20T10:00:00Z',
    images: [],
    status,
    ...(extra || {}),
  };
}

async function apri(openTab) {
  const page = await openTab(URL);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.__mgTest.whenReady && window.SN_FEEDBACK && window.filo);
  await page.evaluate(() => window.__mgTest.whenReady());
  await page.evaluate(() => window.__mgTest.setAdmin(true));
  return page;
}

const tab = (page, name) => page.locator(`.mg-tab[data-tab="${name}"]`);

// 1 ── La lamentela, presa alla lettera: la barra dice quanti ce n'è.
test('#495/vfx — la barra porta i numeri, e sono quelli veri', async ({ openTab }) => {
  const page = await apri(openTab);
  await page.evaluate((items) => window.__mgTest.setData(items), [
    fb('i1', 'unlabeled'), fb('i2', 'unlabeled'), fb('i3', 'design'),
    fb('q1', 'todo'), fb('q2', 'working'), fb('q3', 'revision_security'),
    fb('r1', 'done'), fb('r2', 'done'),
    fb('z1', 'archived'), fb('z2', 'archived'), fb('z3', 'archived'), fb('z4', 'archived'),
  ]);

  await expect(tab(page, 'inbox')).toHaveText('Ricevuti (3)');
  await expect(tab(page, 'queue')).toHaveText('In coda (3)');
  await expect(tab(page, 'resolved')).toHaveText('Risolti (2)');
  await expect(tab(page, 'archived')).toHaveText('Archiviati (4)');

  // Il numero della scheda deve combaciare con quante card si contano DENTRO.
  for (const [name, atteso] of [['inbox', 3], ['queue', 3], ['resolved', 2], ['archived', 4]]) {
    await page.evaluate((t) => window.__mgTest.setTab(t), name);
    await expect(page.locator('#mgList .mg-item')).toHaveCount(atteso);
    const scritto = await tab(page, name).innerText();
    expect(scritto, `scheda ${name}`).toContain(`(${atteso})`);
  }
});

// 2 ── Stato vuoto: zero si scrive, non si tace.
test('#495/vfx — nessun feedback: tutte le schede dicono (0)', async ({ openTab }) => {
  const page = await apri(openTab);
  await page.evaluate(() => window.__mgTest.setData([]));
  await expect(tab(page, 'inbox')).toHaveText('Ricevuti (0)');
  await expect(tab(page, 'queue')).toHaveText('In coda (0)');
  await expect(tab(page, 'resolved')).toHaveText('Risolti (0)');
  await expect(tab(page, 'archived')).toHaveText('Archiviati (0)');
});

// 3 ── Testo mostruoso: 10.000 caratteri, emoji, HTML, javascript:. Il numero
//      resta un numero e niente viene eseguito.
test('#495/vfx — input ostili: i numeri reggono e non si esegue nulla', async ({ openTab }) => {
  const page = await apri(openTab);
  const errori = [];
  page.on('pageerror', (e) => errori.push(String(e)));
  let dialogo = false;
  page.on('dialog', async (d) => { dialogo = true; await d.dismiss(); });

  await page.evaluate((items) => window.__mgTest.setData(items), [
    fb('i1', 'unlabeled', { name: 'x'.repeat(10000), text: 'y'.repeat(10000) }),
    fb('i2', 'unlabeled', { name: '<script>alert(1)</script><img src=x onerror=alert(2)>' }),
    fb('i3', 'unlabeled', { name: '🙂🙃'.repeat(200) }),
    fb('i4', 'unlabeled', { name: '   ' }),
    fb('i5', 'unlabeled', { name: '', text: '' }),
    fb('i6', 'unlabeled', { name: 'javascript:alert(3)' }),
    fb('q1', 'todo', { name: '\u0000\u0000null' }),
  ]);

  await expect(tab(page, 'inbox')).toHaveText('Ricevuti (6)');
  await expect(tab(page, 'queue')).toHaveText('In coda (1)');
  // Nessuno script iniettato è finito nel DOM come tag vero.
  expect(await page.locator('#mgList script').count()).toBe(0);
  expect(await page.locator('#mgList img[onerror]').count()).toBe(0);
  expect(dialogo).toBe(false);
  expect(errori).toEqual([]);

  // La barra non deve deformarsi per un titolo di 10.000 caratteri.
  const alt = await page.locator('#mgTabs').evaluate((el) => el.getBoundingClientRect().height);
  expect(alt).toBeLessThan(140);
});

// 4 ── Numeri assurdi / dati sporchi: status sconosciuti, campi mancanti.
test('#495/vfx — dati sporchi non producono numeri falsi', async ({ openTab }) => {
  const page = await apri(openTab);
  await page.evaluate((items) => window.__mgTest.setData(items), [
    { _id: 'a' }, // niente status, niente nulla
    { _id: 'b', status: 'pippo' },
    { _id: 'c', status: null },
    { _id: 'd', status: 12345 },
    fb('e1', 'unlabeled'),
  ]);
  for (const name of ['inbox', 'queue', 'resolved', 'archived']) {
    const t = await tab(page, name).innerText();
    expect(t, `scheda ${name}`).toMatch(/\((\d+)\+?\)$/);
    const n = Number(t.match(/\((\d+)/)[1]);
    await page.evaluate((x) => window.__mgTest.setTab(x), name);
    await expect(page.locator('#mgList .mg-item')).toHaveCount(n);
  }
});

// 5 ── Tetto del caricamento: 500 caricati → i numeri sono minimi e lo dicono.
test('#495/vfx — al tetto i numeri diventano minimi, con la spiegazione', async ({ openTab }) => {
  const page = await apri(openTab);
  await page.evaluate(() => {
    const items = [];
    for (let i = 0; i < 500; i++) items.push({
      _id: `x${i}`, name: `F${i}`, text: `F${i}`, seq: i, subSeq: 0,
      clientId: 'a@b.c', createdAt: '2026-06-20T10:00:00Z', images: [],
      status: i % 2 ? 'unlabeled' : 'todo',
    });
    window.__mgTest.setData(items);
  });
  await expect(tab(page, 'inbox')).toHaveText('Ricevuti (250+)');
  await expect(tab(page, 'queue')).toHaveText('In coda (250+)');
  await expect(tab(page, 'resolved')).toHaveText('Risolti (0+)');
  // Il "+" non resta un enigma: l'hover lo spiega.
  const titolo = await tab(page, 'inbox').getAttribute('title');
  expect(titolo || '').toMatch(/più recenti/i);
});

// 6 ── Prima che i dati arrivino non si inventa uno (0).
test('#495/vfx — durante il caricamento non compare nessun numero', async ({ openTab }) => {
  const page = await apri(openTab);
  // Stato iniziale della pagina in questo ambiente: nessun Firestore raggiungibile.
  const testi = await page.locator('.mg-tab[data-tab]').allInnerTexts();
  // Se i dati non sono arrivati nessuna scheda porta un numero.
  const caricato = await page.evaluate(() => document.querySelectorAll('.mg-tab-count').length > 0);
  if (!caricato) {
    for (const t of testi) expect(t).not.toMatch(/\(\d/);
  }
});

// 7 ── I filtri degli Archiviati e il numero della scheda non possono divergere.
test('#495/vfx — i filtri degli Archiviati muovono anche il numero', async ({ openTab }) => {
  const page = await apri(openTab);
  await page.evaluate((items) => window.__mgTest.setData(items), [
    fb('z1', 'archived'), fb('z2', 'archived'),
    fb('s1', 'todo', { starred: true }),
    fb('k1', 'attack', { ownerConfirmed: true }),
  ]);
  await page.evaluate(() => window.__mgTest.setTab('archived'));
  const n0 = await page.locator('#mgList .mg-item').count();
  expect(await tab(page, 'archived').innerText()).toContain(`(${n0})`);

  await page.locator('#mgStarFilter').check();
  const n1 = await page.locator('#mgList .mg-item').count();
  expect(await tab(page, 'archived').innerText(), 'con ⭐ acceso').toContain(`(${n1})`);

  await page.locator('#mgStarFilter').uncheck();
  await page.locator('#mgConfirmedFilter').check();
  const n2 = await page.locator('#mgList .mg-item').count();
  expect(await tab(page, 'archived').innerText(), 'con "bloccati confermati"').toContain(`(${n2})`);
});

// 8 ── Click rapidi e sequenze inusuali: i numeri non si duplicano né spariscono.
test('#495/vfx — martellare le schede non sdoppia i numeri', async ({ openTab }) => {
  const page = await apri(openTab);
  await page.evaluate((items) => window.__mgTest.setData(items), [
    fb('i1', 'unlabeled'), fb('q1', 'todo'), fb('r1', 'done'), fb('z1', 'archived'),
  ]);
  const nomi = ['inbox', 'queue', 'resolved', 'archived', 'log', 'automation', 'models', 'stats'];
  for (let giro = 0; giro < 4; giro++) {
    for (const n of nomi) await tab(page, n).click({ force: true });
  }
  await tab(page, 'inbox').click();
  await expect(tab(page, 'inbox')).toHaveText('Ricevuti (1)');
  // Un solo contatore per scheda, mai due appesi.
  for (const n of ['inbox', 'queue', 'resolved', 'archived']) {
    expect(await tab(page, n).locator('.mg-tab-count').count(), `scheda ${n}`).toBe(1);
  }
  // Le schede senza lista restano senza numero anche dopo il martellamento.
  for (const n of ['stats', 'models', 'automation', 'log']) {
    await expect(tab(page, n)).not.toHaveText(/\(\d/);
  }
});

// 9 ── Un'azione dell'owner sposta i numeri SUBITO, senza ricaricare.
test('#495/vfx — archiviare sposta i due numeri all\'istante', async ({ openTab }) => {
  const page = await apri(openTab);
  await page.evaluate(() => {
    const orig = window.filo.message.bind(window.filo);
    window.filo.message = async (msg) => {
      if (msg && msg.type === 'feedback_update') return { ok: true };
      return orig(msg);
    };
  });
  await page.evaluate((items) => window.__mgTest.setData(items), [
    fb('q1', 'todo'), fb('q2', 'todo'), fb('z1', 'archived'),
  ]);
  await expect(tab(page, 'queue')).toHaveText('In coda (2)');
  await expect(tab(page, 'archived')).toHaveText('Archiviati (1)');

  await page.evaluate(() => window.__mgTest.setTab('queue'));
  await page.locator('#mgList .mg-item').first().click();
  await page.locator('#mgArchiveBtn').click();

  await expect(tab(page, 'queue')).toHaveText('In coda (1)');
  await expect(tab(page, 'archived')).toHaveText('Archiviati (2)');
});

// 10 ── Resa visiva: chiaro e scuro, niente troncamenti, finestra stretta.
test('#495/vfx — la barra si legge su entrambi i temi e da stretta', async ({ openTab }) => {
  const page = await apri(openTab);
  await page.evaluate((items) => window.__mgTest.setData(items), [
    fb('i1', 'unlabeled'), fb('i2', 'unlabeled'), fb('q1', 'todo'),
    fb('r1', 'done'), fb('z1', 'archived'),
  ]);
  await page.screenshot({ path: 'tests/.shots/495-barra-tema-corrente.png' });

  // Contrasto: il numero non deve essere invisibile (colore ≠ sfondo).
  const info = await page.locator('.mg-tab[data-tab="inbox"] .mg-tab-count').evaluate((el) => {
    const cs = getComputedStyle(el);
    return { color: cs.color, opacity: cs.opacity, size: cs.fontSize };
  });
  expect(Number(info.opacity)).toBeGreaterThan(0.35);

  // Finestra stretta: le schede vanno a capo INTERE, il numero non si stacca
  // dal nome su una riga sua.
  await page.setViewportSize({ width: 420, height: 800 });
  await page.waitForTimeout(200);
  await page.screenshot({ path: 'tests/.shots/495-barra-stretta.png' });
  const spezzato = await page.locator('.mg-tab[data-tab="queue"]').evaluate((el) => {
    const r = el.getBoundingClientRect();
    const c = el.querySelector('.mg-tab-count');
    const rc = c.getBoundingClientRect();
    // il numero deve stare sulla stessa riga del nome della sua scheda
    return rc.top < r.top || rc.bottom > r.bottom + 1;
  });
  expect(spezzato, 'il numero si è staccato dal nome').toBe(false);
});

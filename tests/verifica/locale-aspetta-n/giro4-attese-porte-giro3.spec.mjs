// Verifica locale di «aspetta #N», giro 4: le porte del giro 3 nella sezione Aspettano, ri-provate.
import { test, expect } from '../../fixtures/electron.mjs';

const MANAGE = 'filo://manage/manage.html';

function fb(over = {}) {
  return Object.assign({
    _id: 'a-1', name: 'Pratica che aspetta', text: 'Testo.',
    seq: 950, subSeq: 0, status: 'todo', statusPublic: 'open',
    clientId: 'owner:me', senderProof: 'admin',
    createdAt: '2026-10-01T07:00:00Z', images: [],
  }, over);
}

async function apri(page, lista, tab) {
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.filo);
  await page.evaluate(() => window.__mgTest.whenReady());
  await page.evaluate(() => {
    const orig = window.filo.message.bind(window.filo);
    window.filo.message = async (msg) => {
      const t = msg && msg.type;
      if (t === 'auth_status') return { ok: true, signedIn: true, isAdmin: true, profile: null };
      if (t === 'merge_approvals_get') return { ok: true, pending: [], failed: [], recent: [], preapproved: [], ttlMs: 1 };
      return orig(msg);
    };
  });
  await page.evaluate((l) => { window.__mgTest.setAdmin(true); window.__mgTest.setData(l); }, lista);
  await page.evaluate((t) => window.__mgTest.setTab(t), tab);
}

const inRevisione = (over = {}) => fb({
  status: 'revision_capability', branch: 'claude/prova-attese', branchSha: 'abc1234',
  assignedAt: '2026-10-02T07:00:00Z', ...over,
});

// Le schede della lista: nessun elemento dentro deve uscire dal bordo, e la lista non scorre di lato.
async function misuraSchede(page) {
  return page.evaluate(() => {
    const cards = [...document.querySelectorAll('.mg-item')];
    const out = cards.map((c) => {
      const r = c.getBoundingClientRect();
      let fuori = 0;
      for (const el of c.querySelectorAll('*')) {
        if (!el.offsetParent) continue;
        const e = el.getBoundingClientRect();
        fuori = Math.max(fuori, Math.round(e.right - r.right));
      }
      return { testo: c.innerText.slice(0, 200), fuori };
    });
    const lista = cards[0] && cards[0].parentElement;
    return { out, scorre: lista ? lista.scrollWidth - lista.clientWidth : 0, doc: document.documentElement.scrollWidth - document.documentElement.clientWidth };
  });
}

test('una pratica in revisione che aspetta non promette un verificatore', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  await apri(page, [
    inRevisione({ waitsFor: [{ id: 'b-1', num: '960' }] }),
    fb({ _id: 'b-1', seq: 960, name: 'Aspettato' }),
  ], 'waiting');
  const card = page.locator('.mg-item').filter({ hasText: 'Pratica che aspetta' });
  await expect(card).toHaveCount(1);
  await page.screenshot({ path: 'tests/.shots/aspetta-g4-revisione.png' });
  const testo = await card.innerText();
  expect(testo).not.toContain('in attesa di un verificatore');
  expect(testo).toMatch(/aspett/i);
});

test('otto attese, e sei coi numeri dei figli, restano dentro la scheda', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  const otto = Array.from({ length: 8 }, (_, i) => ({ id: `w-${i}`, num: String(960 + i) }));
  const figli = Array.from({ length: 6 }, (_, i) => ({ id: `f-${i}`, num: `961.1${i}` }));
  const aspettati = [
    ...otto.map((w, i) => fb({ _id: w.id, seq: 960 + i, name: `Aspettato ${i}` })),
    ...figli.map((w, i) => fb({ _id: w.id, seq: 961, subSeq: 10 + i, name: `Figlio ${i}` })),
  ];
  await apri(page, [
    fb({ waitsFor: otto }),
    inRevisione({ _id: 'a-2', seq: 949, name: 'Pratica coi figli', waitsFor: figli }),
    ...aspettati,
  ], 'waiting');
  await expect(page.locator('.mg-item').filter({ hasText: 'Pratica coi figli' })).toHaveCount(1);
  const m = await misuraSchede(page);
  await page.screenshot({ path: 'tests/.shots/aspetta-g4-schede.png' });
  for (const s of m.out) expect(s.fuori, `esce dalla scheda: ${s.testo}`).toBeLessThanOrEqual(1);
  expect(m.scorre, 'la lista scorre di lato').toBeLessThanOrEqual(0);
  expect(m.doc, 'la pagina scorre di lato').toBeLessThanOrEqual(0);
});

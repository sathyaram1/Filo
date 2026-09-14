// La fila dei cinque livelli in Gestione: il pannello di una forma resta
// aperto (e tiene il punto) quando la pratica si ridisegna per un
// aggiornamento continuo, e la segnalazione del rombo si legge con titoli e
// voci d'elenco invece del markdown grezzo. Guardie nate dalla verifica del
// ramo claude/livelli (giro 1).

import { test, expect } from './fixtures/electron.mjs';

const MANAGE = 'filo://manage/manage.html';
const GIUDICI = ['g1', 'g2', 'g3', 'g4'];

function pratica(over = {}) {
  return Object.assign({
    _id: 'fb-resta-1', seq: 901, subSeq: 0, text: 'Segnalazione di prova.', name: 'Prova',
    clientId: 'tester@example.com', createdAt: '2026-09-10T10:00:00Z', images: [],
    status: 'working', statusPublic: 'open',
    pipeline: {
      l1Category: 'clean', l1Reasons: [], action: 'human_review', expectedJudges: GIUDICI.slice(),
      verdicts: GIUDICI.map((g) => ({ judge: g, class: 'aligned', reasoning: `Ragionamento di ${g}.`, model: `modello/${g}` })),
    },
  }, over);
}

const SEGNALAZIONE = '## Problema\nDue strade per il nome del file.\n\n## Scelte\n- A: nome dal sito\n- B: chiede ogni volta\n\n## Cosa ho fatto nel frattempo\n' + 'A, per ora. '.repeat(400);

async function apri(page, fbs) {
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.filo && window.SN_MANAGE_REVIEW);
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
  await page.evaluate(() => window.__mgTest.setAdmin(true));
  await page.evaluate((f) => window.__mgTest.setData(f), fbs);
  await page.evaluate((f) => window.__mgTest.setTab(window.SN_MANAGE_REVIEW.manageTabFor(f, {})), fbs[0]);
  await page.evaluate((id) => window.__mgTest.openDetail(id), fbs[0]._id);
  await expect(page.locator('#mgDetail')).toBeVisible();
}

async function aggiorna(page, doc, altre = []) {
  await page.evaluate(({ d, altre }) => {
    window.__mgTest.setLiveSources({
      listVersions: async () => [{ _id: d._id, _updateTime: d._updateTime }]
        .concat(altre.map((a) => ({ _id: a._id, _updateTime: a._updateTime }))),
      getMany: async () => [d],
    });
  }, { d: doc, altre });
  const r = await page.evaluate(() => window.__mgTest.pollNow());
  expect(r.changed).toBe(1);
}

test('il pannello del rombo resta aperto e tiene il punto quando la pratica si aggiorna', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  const fb = pratica({ _updateTime: 't1', livelli: { l3: { esito: 'segnalato', ruolo: 'resolver', at: '2026-09-13T09:15:00.000Z', testo: SEGNALAZIONE } } });
  await apri(page, [fb]);
  await page.locator('#mgForme .mg-forma[data-livello="l3"]').click();
  const body = page.locator('#mgSideBody');
  await expect(body).toContainText('Due strade per il nome del file.');
  // Scorri in fondo alla segnalazione lunga.
  const prima = await page.evaluate(() => {
    const cands = [document.getElementById('mgSideBody'), document.getElementById('mgSide')];
    for (const el of cands) { if (el && el.scrollHeight > el.clientHeight) { el.scrollTop = el.scrollHeight; return { id: el.id, top: el.scrollTop }; } }
    return null;
  });
  expect(prima).not.toBeNull();
  expect(prima.top).toBeGreaterThan(0);

  // Arriva una nota della routine sulla stessa pratica.
  await aggiorna(page, pratica({ _updateTime: 't2', notes: 'Una nota in più.', livelli: fb.livelli }));
  await expect(page.locator('#mgSide')).toBeVisible();
  await expect(page.locator('#mgForme .mg-forma[data-livello="l3"]')).toHaveClass(/mg-forma--scelta/);
  expect(await page.evaluate(() => window.__mgTest.livelloAperto())).toBe('l3');
  await expect(body).toContainText('Due strade per il nome del file.');
  const dopo = await page.evaluate((id) => document.getElementById(id).scrollTop, prima.id);
  expect(Math.abs(dopo - prima.top)).toBeLessThanOrEqual(2);
});

test('il pannello di un giudice resta sullo stesso giudice dopo l’aggiornamento; cambiando pratica si chiude', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  const fb = pratica({ _updateTime: 't1' });
  const altra = pratica({ _id: 'fb-resta-2', seq: 902, _updateTime: 't1' });
  await apri(page, [fb, altra]);
  await page.locator('#mgForme .mg-forme-gruppo .mg-dot').nth(2).click();
  await expect(page.locator('#mgSideTitle')).toHaveText('modello/g3');
  await aggiorna(page, pratica({ _updateTime: 't2', notes: 'Nota.' }), [altra]);
  await expect(page.locator('#mgSideTitle')).toHaveText('modello/g3');
  await expect(page.locator('#mgSideBody')).toContainText('Ragionamento di g3.');
  await page.evaluate((id) => window.__mgTest.openDetail(id), altra._id);
  await expect(page.locator('#mgSide')).toBeHidden();
  expect(await page.evaluate(() => window.__mgTest.livelloAperto())).toBeNull();
});

test('il rombo mostra la segnalazione con titoli e voci, senza cancelletti né HTML', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  const testo = '## Problema\nDue strade. <b>ostile</b>\n## Scelte\n- A: <img src=x onerror="window.__xss=1">\n- B: chiede\n## Cosa ho fatto nel frattempo\nA.';
  const fb = pratica({ livelli: { l3: { esito: 'segnalato', ruolo: 'resolver', testo } } });
  await apri(page, [fb]);
  await page.locator('#mgForme .mg-forma[data-livello="l3"]').click();
  const body = page.locator('#mgSideBody');
  const titoli = body.locator('.mg-liv-titolo');
  await expect(titoli).toHaveText(['Problema', 'Scelte', 'Cosa ho fatto nel frattempo']);
  await expect(body.locator('.mg-liv-elenco li')).toHaveText(['A: <img src=x onerror="window.__xss=1">', 'B: chiede']);
  const txt = await body.innerText();
  expect(txt).not.toContain('##');
  expect(txt).not.toMatch(/^- /m);
  expect(txt).toContain('<b>ostile</b>');
  await expect(body.locator('img, script, b')).toHaveCount(0);
  expect(await page.evaluate(() => window.__xss)).toBeUndefined();
});

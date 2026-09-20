// TEMPORANEO — solo per leggere i numeri veri del contrasto. Si cancella.
import { test, expect } from '../../fixtures/electron.mjs';

const URL = 'filo://board/board.html';

function contrasto(a, b) {
  const lum = (c) => {
    const v = c.map((x) => {
      const s = x / 255;
      return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2];
  };
  const la = lum(a); const lb = lum(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

const LEGGI = (el) => {
  const num = (s) => (s.match(/[\d.]+/g) || []).map(Number);
  const opaco = (n) => (n.length < 4 || n[3] >= 1);
  let sotto = [255, 255, 255];
  for (let p = el.parentElement; p; p = p.parentElement) {
    const n = num(getComputedStyle(p).backgroundColor);
    if (n.length >= 3 && opaco(n)) { sotto = n.slice(0, 3); break; }
  }
  const suo = num(getComputedStyle(el).backgroundColor);
  const a = suo.length > 3 ? suo[3] : 1;
  const misto = [0, 1, 2].map((i) => Math.round(suo[i] * a + sotto[i] * (1 - a)));
  return {
    testo: num(getComputedStyle(el).color).slice(0, 3),
    fondo: misto,
    dim: getComputedStyle(el).fontSize + '/' + getComputedStyle(el).fontWeight,
  };
};

test('misure', async ({ openTab }) => {
  const page = await openTab(URL);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__boardTest && window.SN_FEEDBACK, null, { timeout: 15_000 });
  await page.locator('#bdLoading').waitFor({ state: 'hidden', timeout: 20_000 });
  await page.evaluate(() => window.__boardTest.setReleasedVersion('0.2.71'));
  await page.evaluate(() => window.__boardTest.setSignedIn('uid-m'));
  await page.evaluate(() => {
    const b = (id, seq, voto) => ({
      _id: id, name: `M ${seq}`, seq, subSeq: 0, status: 'done', statusPublic: 'closed',
      resolvedInVersion: '0.2.70', createdAt: '2026-08-17T07:33:44.390Z',
      votes: { 'uid-m': { vote: voto, at: '2026-09-02T10:00:00.000Z', credibilitySnapshot: 1 } },
    });
    window.__boardTest.setData([b('w', 1, 'works'), b('k', 2, 'broken')]);
  });
  await expect(page.locator('.bd-card')).toHaveCount(2);
  await page.locator('[data-id="w"] .bd-reopen-link').click();
  await page.locator('[data-id="w"] .bd-reopen-actions button', { hasText: 'Invia' }).click();
  await expect(page.locator('[data-id="w"] .bd-reopen-err')).toBeVisible();

  const righe = [];
  for (const tema of ['light', 'dark']) {
    await page.evaluate((t) => document.documentElement.setAttribute('data-sn-theme', t), tema);
    await page.waitForTimeout(150);
    for (const [nome, sel] of [
      ['pillola funziona (votata)', '[data-id="w"] .bd-vote-works'],
      ['pillola non funziona (votata)', '[data-id="k"] .bd-vote-broken'],
      ['pillola non votata', '[data-id="w"] .bd-vote-broken'],
      ['errore Ancora rotto', '[data-id="w"] .bd-reopen-err'],
      ['titolo scheda', '[data-id="w"] .bd-card-title'],
      ['sottotitolo numero', '[data-id="w"] .bd-card-sub'],
    ]) {
      const m = await page.locator(sel).evaluate(LEGGI);
      righe.push(`${tema.padEnd(6)} ${nome.padEnd(34)} ${contrasto(m.testo, m.fondo).toFixed(2)}  ${m.dim}  testo=${m.testo} fondo=${m.fondo}`);
    }
    righe.push(`${tema} fondo scheda = ${await page.locator('[data-id="w"]').evaluate((e) => getComputedStyle(e).backgroundColor)}`);
  }
  console.log('\nMISURE\n' + righe.join('\n') + '\n');
});

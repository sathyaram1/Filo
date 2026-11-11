// #2199.6 giro 1, rilievo 1: dopo un sì preso dal server («torna alle routine», «torna a te») la richiesta è consumata,
// e la card non deve offrire di nuovo «Approva e fondi»: il secondo clic cancellava la frase giusta con «già stata usata».

import { test, expect } from '../../fixtures/electron.mjs';
import { apriScheda } from '../../helpers/gestione.mjs';

const MANAGE = 'filo://manage/manage.html';
const GIORNO = 24 * 60 * 60 * 1000;

async function serverFinto(app, approva) {
  await app.evaluate((_e, cfg) => {
    const rq = process.mainModule.require;
    const auth = rq(rq('node:path').join(process.cwd(), 'src/main/auth/google-auth.js'));
    auth.isAdmin = () => true;
    auth.isSignedIn = () => true;
    auth.getIdToken = async () => 'token-di-prova';
    const vero = globalThis.__fetchVero2199r1 || globalThis.fetch;
    globalThis.__fetchVero2199r1 = vero;
    let usata = false;
    globalThis.fetch = async (url, init) => {
      if (!String(url).endsWith('/ownerMergeApprovals')) return vero(url, init);
      const data = (JSON.parse(String(init && init.body || '{}')).data) || {};
      let result = { ok: true };
      if (data.op === 'list') result = { ok: true, pending: [cfg.req], failed: [], recent: [], ttlMs: 7 * 86400000 };
      else if (data.op === 'approve') {
        result = usata ? { ok: false, rejected: true, reason: 'already_used', detail: 'richiesta già stata usata' } : cfg.approva;
        usata = true;
      }
      return new Response(JSON.stringify({ result }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    };
  }, {
    approva,
    req: {
      id: 'ab12cd34ef56ab12cd34ef56', branch: 'claude/lavoro-server', sha: 'a1b2c3d4'.repeat(5), who: 'owner@esempio',
      blocks: [{ gate: 'guard_the_guards', label: 'Tocca aree protette', items: ['firestore.rules'], more: 0 }],
      createdAtMs: Date.now() - 60_000, expiresAtMs: Date.now() + GIORNO, expired: false, used: false, discarded: false,
    },
  });
}

for (const [esito, frase] of [['rimandato', /torna alle routine/], ['all_owner', /torna a te/]]) {
  test(`r1 dopo il sì con esito «${esito}» la card non chiede un altro sì e la frase resta`, async ({ app, openTab }) => {
    await serverFinto(app, { ok: true, result: 'server', esito });
    const page = await openTab(MANAGE);
    await page.waitForLoadState('domcontentloaded');
    await page.waitForFunction(() => window.__mgTest && window.filo);
    await page.evaluate(() => window.__mgTest.whenReady());
    await page.evaluate(() => window.__mgTest.setAdmin(true));
    await page.evaluate(() => window.__mgTest.setData([]));
    await page.evaluate(() => window.__mgTest.loadMergeApprovals());
    await apriScheda(page, 'automation');
    const btn = page.locator('#mgMergeApprovalsOrphans .sn-mac-btn-go');
    await expect(btn).toBeVisible({ timeout: 10_000 });
    await btn.click();
    await btn.click();
    const stato = page.locator('#mgMergeApprovalsOrphans .sn-mac-status');
    await expect(stato).toContainText(frase, { timeout: 10_000 });
    await expect(btn, 'la richiesta è consumata: niente secondo sì').toBeDisabled({ timeout: 3_000 });
    await expect(stato).toContainText(frase);
  });
}

// Verifica #586, giro 3 — la scelta ricordata sopravvive alla chiusura di Filo?
//
// Il feedback chiede la memoria per origine. Una memoria che vale solo finché
// Filo resta aperto non è una memoria: alla riapertura il sito richiederebbe
// tutto da capo (e chi aveva negato si vedrebbe richiedere all'infinito).
// Nessuno dei giri passati aveva chiuso e riaperto Filo.

import { test, expect } from '../../fixtures/electron.mjs';
import { _electron as electron } from '@playwright/test';
import { writeFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cartellaTemporanea } from '../../helpers/percorsi.mjs';
import { argomentiScala } from '../../helpers/scala.mjs';

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

const HTML = `<!doctype html><html><body style="margin:0"><p>prova</p>
<script>
  window.__webcam = () => navigator.mediaDevices.getUserMedia({ video: true }).then(
    (s) => { const d = s.getTracks().map((t) => t.kind); try { s.getTracks().forEach((t) => t.stop()); } catch (_) {} return d; },
    (e) => 'rifiutato:' + ((e && e.name) || 'errore'),
  );
  window.__notifiche = () => Notification.requestPermission();
</script></body></html>`;

async function apriScheda(app, shell, url) {
  const target = new URL(url).hostname;
  await shell.evaluate((u) => window.filoShell.tabs.open(u), url);
  const scadenza = Date.now() + 15_000;
  while (Date.now() < scadenza) {
    const p = app.windows().find((w) => {
      try { return new URL(w.url()).hostname === target; } catch (_) { return false; }
    });
    if (p) { await p.waitForLoadState('domcontentloaded').catch(() => {}); return p; }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('nessuna scheda per ' + url);
}

test('una scelta ricordata vale ancora dopo aver chiuso e riaperto Filo', async ({ testServer }) => {
  test.setTimeout(180_000);
  const url = testServer.html(HTML);
  const origine = new URL(url).origin;

  const userData = cartellaTemporanea('filo-586-riavvio-');
  // Lo stato in cui Filo si ritrova alla riapertura, dopo che alla sessione
  // prima si era detto "sì" alla fotocamera e "no" alle notifiche.
  writeFileSync(join(userData, 'storage.json'), JSON.stringify({
    settings: { security: { sitePermissions: { [origine]: { fotocamera: 'allow', notifiche: 'deny' } } } },
  }), 'utf8');

  const app = await electron.launch({
    args: [...argomentiScala, '--use-fake-device-for-media-stream', '.'],
    cwd: APP_ROOT,
    env: { ...process.env, FILO_USER_DATA: userData, NODE_ENV: 'test' },
  });
  try {
    const shell = await app.firstWindow();
    await shell.waitForLoadState('domcontentloaded');
    const page = await apriScheda(app, shell, url);
    await page.waitForFunction(() => document.documentElement.dataset.filoReady === '1', null, { timeout: 15_000 });

    const chip = shell.locator('.perm-chip');
    const webcam = await page.evaluate(() => window.__webcam());
    const notifiche = await page.evaluate(() => window.__notifiche());
    await shell.waitForTimeout(1200);

    expect(
      webcam,
      `alla riapertura il "sì" di prima non vale più: la fotocamera è tornata a ${JSON.stringify(webcam)}`,
    ).toContain('video');
    expect(notifiche, 'alla riapertura il "no" di prima deve valere ancora').toBe('denied');
    expect(
      await chip.count(),
      'una scelta già presa non deve far ricomparire la domanda alla riapertura',
    ).toBe(0);

    // E la pagina Sicurezza deve elencarla: se si può dare, si deve poter togliere.
    const sicurezza = await apriScheda(app, shell, 'filo://security/security.html');
    await sicurezza.waitForLoadState('domcontentloaded');
    await sicurezza.waitForTimeout(1500);
    const righe = await sicurezza.locator('#perms-list li').allTextContents();
    console.log('[586 g3] elenco in Impostazioni dopo la riapertura:', JSON.stringify(righe));
    expect(
      righe.join(' '),
      'la scelta ricordata deve comparire in Impostazioni anche dopo la riapertura',
    ).toContain(new URL(origine).host);
  } finally {
    try { await app.close(); } catch (_) {}
  }
});

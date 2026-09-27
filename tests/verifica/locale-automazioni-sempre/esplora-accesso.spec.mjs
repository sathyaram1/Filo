// Esplorazione temporanea: accesso dal banner dopo un'apertura da non owner.
import { test, expect } from '../../fixtures/electron.mjs';

test('accesso dal banner: la scheda rilegge dal server', async ({ openTab }) => {
  const page = await openTab('filo://manage/manage.html');
  await page.waitForFunction(() => window.__mgTest && window.filo);
  await page.evaluate(() => window.__mgTest.whenReady());
  await page.locator('.mg-tab[data-tab="automation"]').click();
  const prima = await page.evaluate(() => ({
    st: document.getElementById('mgRoutinesState').textContent,
    cap3: document.getElementById('mgCap3').value,
    sess: document.getElementById('mgMaxSessionsMsg').textContent,
    banner: !document.getElementById('mgBanner').hidden,
  }));
  console.log('PRIMA', JSON.stringify(prima));
  await page.evaluate(() => {
    const orig = window.filo.message.bind(window.filo);
    window.filo.message = async (msg) => {
      const t = msg && msg.type;
      if (t === 'auth_signin') return { ok: true };
      if (t === 'auth_status') return { ok: true, isAdmin: true };
      if (t === 'automation_get') return { ok: true, enabled: false, autoApprove: {}, proberWhenIdle: false, routinesEnabled: false };
      if (t === 'automation_caps_get') return { ok: true, cap3: 7, cap2: 3, cap1: 1, cap0: 0, fixInstructions: 'X', giroStretto: true };
      if (t === 'automation_sessions_get') return { ok: true, letto: true, maxSessions: 4, priorityAccount: 'B', accountAOff: false, accountBOff: false };
      return orig(msg);
    };
  });
  await page.locator('#mgSignIn').click();
  await expect(page.locator('#mgBanner')).toBeHidden();
  await page.waitForTimeout(1500);
  const dopo = await page.evaluate(() => ({
    st: document.getElementById('mgRoutinesState').textContent,
    cap3: document.getElementById('mgCap3').value,
    fix: document.getElementById('mgFixInstructions').value,
    sess: document.getElementById('mgMaxSessions').value,
    sessMsg: document.getElementById('mgMaxSessionsMsg').textContent,
    prober: document.getElementById('mgProberIdle').checked,
    cap3dis: document.getElementById('mgCap3').disabled,
  }));
  console.log('DOPO', JSON.stringify(dopo));
});

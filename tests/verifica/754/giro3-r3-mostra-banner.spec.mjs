// Verifica #754 giro 3, rilievo 3: «Mostra il banner dei cookie» non lo riporta se il sito si segna la risposta
// in un cookie dal nome che Filo non conosce (gov.uk, la barra di cookie-bar.eu). Il login deve restare.
import { test, expect } from '../../fixtures/electron.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function tabCookies(shell) {
  return shell.evaluate(async () => {
    const snap = await window.filoShell.tabs.snapshot();
    const t = snap.tabs.find((x) => x.id === snap.activeId);
    return t ? t.cookies : undefined;
  });
}

const GOVUK = `<title>GOVUK</title>
  <div class="govuk-cookie-banner" role="region" aria-label="Cookies on GOV.UK" style="position:fixed;top:0;left:0;right:0;height:140px;background:#f3f2f1">
    <p>We use some essential cookies to make this service work.</p>
    <button type="button" class="govuk-button" onclick="document.cookie='cookies_policy={&quot;usage&quot;:true}; path=/; max-age=86400';document.cookie='cookies_preferences_set=true; path=/; max-age=86400';document.querySelector('.govuk-cookie-banner').remove()">Accept additional cookies</button>
    <button type="button" class="govuk-button" onclick="document.cookie='cookies_policy={&quot;usage&quot;:false}; path=/; max-age=86400';document.cookie='cookies_preferences_set=true; path=/; max-age=86400';document.querySelector('.govuk-cookie-banner').remove()">Reject additional cookies</button>
  </div>
  <script>
    document.cookie = 'sessione=utente; path=/; max-age=86400';
    if (document.cookie.includes('cookies_preferences_set=')) document.querySelector('.govuk-cookie-banner').remove();
  </script>`;

const COOKIEBAR = `<title>COOKIEBAR</title>
  <div id="cookie-bar" style="position:fixed;bottom:0;left:0;right:0;height:80px;background:#333;color:#fff">
    <p>Questo sito usa i cookie di terze parti.</p>
    <a class="cb-enable" href="#" onclick="document.cookie='cookiebar=CookieAllowed; path=/; max-age=86400';document.getElementById('cookie-bar').remove();return false">Accetta</a>
    <a class="cb-disable" href="#" onclick="document.cookie='cookiebar=CookieDisallowed; path=/; max-age=86400';document.getElementById('cookie-bar').remove();return false">Rifiuta</a>
  </div>
  <script>
    document.cookie = 'sessione=utente; path=/; max-age=86400';
    if (document.cookie.includes('cookiebar=')) document.getElementById('cookie-bar').remove();
  </script>`;

for (const [nome, html, sel, risposta] of [
  ['gov.uk', GOVUK, '.govuk-cookie-banner', 'cookies_preferences_set'],
  ['cookie-bar.eu', COOKIEBAR, '#cookie-bar', 'cookiebar='],
]) {
  test(`rifiutato da Filo, poi «Mostra il banner dei cookie» lo riporta (${nome}), e il login resta`, async ({ openTab, testServer, shell }) => {
    test.setTimeout(60_000);
    const page = await testServer.openReady(openTab, html);
    await page.waitForFunction((r) => document.cookie.includes(r), risposta, { timeout: 10_000 });
    await expect.poll(async () => (await tabCookies(shell))?.rejected, { timeout: 8_000 }).toBe(true);
    const { activeId } = await shell.evaluate(() => window.filoShell.tabs.snapshot());
    await shell.evaluate((id) => window.filoShell.tabs.cookieBanners(id, true), activeId);
    await expect.poll(() => page.evaluate((s) => !!document.querySelector(s), sel).catch(() => false), { timeout: 10_000 }).toBe(true);
    await sleep(1500);
    expect(await page.evaluate((s) => !!document.querySelector(s), sel)).toBe(true);
    expect(await page.evaluate(() => document.cookie)).toContain('sessione=utente');
  });
}

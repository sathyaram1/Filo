import { test, expect } from '../../fixtures/electron.mjs';

for (const tema of ['light', 'dark']) {
  test(`foto preferenze ${tema}`, async ({ openTab }) => {
    const pref = await openTab('filo://preferences/preferences.html');
    await pref.emulateMedia({ colorScheme: tema });
    await pref.evaluate((t) => { document.documentElement.dataset.theme = t; }, tema);
    const sez = pref.locator('#sec-traduzione');
    await expect(sez).toBeVisible();
    await sez.scrollIntoViewIfNeeded();
    await pref.locator('#traduzioneNascoste').selectOption('apertura');
    await pref.screenshot({ path: `/tmp/claude-0/-home-user-Filo/4837443a-2752-52f3-8f82-8c677386b280/scratchpad/pref-${tema}.png` });
  });
}

import { test, expect } from './fixtures/electron.mjs';
const PREFERENZE = 'filo://preferences/preferences.html';
for (const tema of ['light', 'dark']) {
  test(`shot memoria ${tema}`, async ({ app, openTab }) => {
    await app.evaluate(async () => {
      await globalThis.SN_FILO_MEMORY.setMemory({
        PROFILO: 'Vive a Lisbona\nHa due gatti',
        PREFERENZE: 'Risposte corte, senza giri di parole',
        VIAGGI: 'Va in Giappone a marzo',
      });
      await globalThis.SN_FILO_MEMORY.clearLessonsBuffer();
      await globalThis.SN_FILO_MEMORY.appendLesson("L'utente non beve caffe");
      await globalThis.SN_FILO_MEMORY.appendLesson('x'.repeat(300));
    });
    const page = await openTab(PREFERENZE);
    await page.waitForSelector('#memoryBox .mem-line', { timeout: 20_000 });
    await page.selectOption('#theme', tema);
    await page.waitForTimeout(700);
    const sez = await page.evaluateHandle(() => document.getElementById('memoryBox').closest('section'));
    await sez.asElement().screenshot({ path: `/home/user/Filo/tests/.shots/giro6-memoria-${tema}.png` });
    expect(true).toBe(true);
  });
}

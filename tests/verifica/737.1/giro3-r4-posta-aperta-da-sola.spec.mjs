// Verifica #737.1 giro 3, rilievo 4: una pagina non apre da sola il programma di posta (o telefono, sms) senza un clic.
import { test, expect } from '../../fixtures/electron.mjs';

test('senza clic una pagina non apre il programma di posta, né con una finestra né andandoci', async ({ app, openTab, testServer }) => {
  await app.evaluate(({ shell }) => { globalThis.__esterni = []; shell.openExternal = async (u) => { globalThis.__esterni.push(u); }; });
  await openTab(testServer.html("<title>Spam</title><script>setTimeout(function(){window.open('mailto:a@b.it')},500);setTimeout(function(){location.href='mailto:c@d.it'},1200)</script>"));
  await new Promise((r) => setTimeout(r, 3000));
  expect(await app.evaluate(() => globalThis.__esterni)).toEqual([]);
});

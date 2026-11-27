// Verifica #1403.6 giro 19: le frasi della segnalazione passate dalla chat vera, e la password «del wifi» senza verbo (r1).
import { test, expect } from '../../fixtures/electron.mjs';
import { home, modelloFinto, chiedi, chiamateAlModello, ripristina } from '../../helpers/chatFinta.mjs';

async function nessunaArriva(app, frasi) {
  const pagina = await home(app);
  await modelloFinto(app, [{ text: 'RICEVUTO' }]);
  try {
    for (let k = 0; k < frasi.length; k++) {
      const [frase, segreto] = frasi[k];
      const prima = (await chiamateAlModello(app)).length;
      await chiedi(pagina, `${frase} (prova${k})`);
      await expect.poll(async () => (await chiamateAlModello(app)).length, { timeout: 20_000 }).toBeGreaterThan(prima);
      const mandato = JSON.stringify((await chiamateAlModello(app)).slice(prima));
      expect(mandato, `«${frase}» è arrivata al modello`).toContain(`(prova${k})`);
      expect.soft(mandato, `«${frase}»: la password`).not.toContain(segreto);
      await expect(pagina.locator('.dash-bubble-filo', { hasText: 'RICEVUTO' })).toHaveCount(k + 1, { timeout: 20_000 });
    }
  } finally {
    await ripristina(app);
  }
}

test('le frasi della segnalazione, in otto lingue, non portano la password al modello', async ({ app }) => {
  test.setTimeout(240_000);
  await nessunaArriva(app, [
    ['Le mot de passe est Mela!Verde77', 'Verde77'],
    ['Das Passwort ist Mela!Verde78', 'Verde78'],
    ['la contraseña es Mela!Verde79', 'Verde79'],
    ['пароль это Ключ!Зима2021', 'Зима2021'],
    ['ο κωδικός είναι Κλειδί!2022', 'Κλειδί!2022'],
    ['WiFi密码是87654321', '87654321'],
    ['パスワードはPass2023!です', 'Pass2023'],
    ['비밀번호는 Pass2024!', 'Pass2024'],
    ['вход с паролем Ключ!Зима2025', 'Зима2025'],
  ]);
});

test('r1 la password «del wifi» senza verbo resta fuori anche in russo, francese, tedesco e greco, come in italiano', async ({ app }) => {
  test.setTimeout(180_000);
  await nessunaArriva(app, [
    ['пароль от wifi Ключ!Зима2031', 'Зима2031'],
    ['пароль от вайфая Ключ!Зима2032', 'Зима2032'],
    ['le mot de passe du wifi Mela!Verde33', 'Verde33'],
    ['das Passwort vom WLAN Mela!Verde34', 'Verde34'],
    ['ο κωδικός του wifi Κλειδί!2035', 'Κλειδί!2035'],
  ]);
});

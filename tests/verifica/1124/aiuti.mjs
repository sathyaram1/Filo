// Aiuti delle prove di verifica di #1124: account finto e stato della proposta visto dal main.
export const EMAIL = 'chi-usa-filo@example.com';

export async function accountFinto(app, email = EMAIL) {
  await app.evaluate((_e, email) => {
    const M = process.getBuiltinModule('module');
    const ga = M._cache[Object.keys(M._cache).find((x) => /auth[\\/]google-auth\.js$/.test(x))].exports;
    ga.isSignedIn = () => !!email;
    ga.getProfile = () => (email ? { email, name: 'Chi', picture: '' } : null);
  }, email);
}

export const mostrata = (app) => app.evaluate(({ BrowserWindow }) => {
  const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito);
  return !!w._filoTabs.propostaEmail.mostrata;
});

import * as d from './driver.mjs';
const { app, shell } = await d.launchFilo();
try {
  await d.navigate(app, shell, 'https://example.com');
  await d.sleep(3000);
  const view = await d.activeView(app, shell);
  if (view) {
    const result = await view.evaluate(() => ({
      filoReady: document.documentElement.dataset.filoReady,
      filoModules: document.documentElement.dataset.filoModules,
      filoCS: document.documentElement.dataset.filoContentScripts,
      hasSNMenu: typeof window.SN_MENU !== 'undefined',
      hasSNConst: typeof window.SN_CONST !== 'undefined',
      hasChrome: typeof window.chrome !== 'undefined',
      chromeRuntimeId: window.chrome?.runtime?.id,
      snTheme: document.documentElement.dataset.snTheme,
      stylesLoaded: !!document.querySelector('link[href*="filo://style"]'),
    }));
    console.log('RESULT:', JSON.stringify(result, null, 2));
  } else {
    console.log('ERROR: no active view found');
  }
} finally {
  await d.closeFilo(app);
}

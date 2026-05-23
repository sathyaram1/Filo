import * as d from './driver.mjs';
const { app, shell } = await d.launchFilo();
try {
  await d.navigate(app, shell, 'https://www.youtube.com');
  await d.sleep(6000);
  const view = await d.activeView(app, shell);
  if (view) {
    const result = await view.evaluate(() => {
      // Manually re-run the init sequence to find where it breaks
      const errors = [];
      const SN_CONST = window.SN_CONST;
      const SN_MSG = window.SN_MSG;
      const SN_SPELLCHECK = window.SN_SPELLCHECK;
      
      // Step 1: fetchSettings
      errors.push('fetchSettings: works (already verified)');
      
      // Step 2: applyTheme
      try {
        const theme = 'system';
        let resolved = theme;
        if (theme === 'system') {
          resolved = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
        }
        document.documentElement.dataset.snTheme = resolved;
        errors.push('applyTheme: OK');
      } catch(e) {
        errors.push('applyTheme: ERROR ' + e.message);
      }

      // Step 3: isBlocked
      try {
        const url = location.href;
        const blockedPrefixes = SN_CONST?.PAGES_WITHOUT_MENU_PREFIXES || [];
        const blocked = blockedPrefixes.some(p => url.startsWith(p));
        errors.push('isBlocked prefix: ' + blocked);
        // Check blocklist from stored settings
        errors.push('blocklist length: would need to check');
      } catch(e) {
        errors.push('isBlocked: ERROR ' + e.message);
      }

      // Step 4: SpellCheck.init
      try {
        // Don't actually re-init, just check if it exists
        errors.push('SpellCheck exists: ' + !!SN_SPELLCHECK);
        errors.push('SpellCheck.init exists: ' + (typeof SN_SPELLCHECK?.init));
      } catch(e) {
        errors.push('SpellCheck: ERROR ' + e.message);
      }

      // Try to manually register and test a contextmenu handler
      let handlerFired = false;
      let handlerError = null;
      const testHandler = (e) => {
        try {
          handlerFired = true;
          e.preventDefault();
          e.stopPropagation();
          // Try opening menu directly
          SN_MENU.open({ x: e.clientX, y: e.clientY, items: [
            { type: 'item', label: 'Manual test', onClick: () => {} }
          ]});
        } catch(err) {
          handlerError = err.message;
        }
      };
      window.addEventListener('contextmenu', testHandler, { capture: true });

      return new Promise(resolve => {
        const target = document.querySelector('ytd-app') || document.body;
        const evt = new MouseEvent('contextmenu', {
          bubbles: true, cancelable: true, view: window,
          clientX: 300, clientY: 300, button: 2,
        });
        target.dispatchEvent(evt);

        setTimeout(() => {
          window.removeEventListener('contextmenu', testHandler, { capture: true });
          resolve({
            errors,
            handlerFired,
            handlerError,
            menuExists: !!document.querySelector('.sn-menu'),
          });
        }, 500);
      });
    });
    console.log('YT DEEP v5:', JSON.stringify(result, null, 2));
  }
} finally {
  await d.closeFilo(app);
}

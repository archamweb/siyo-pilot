/* SIYO Pilot 2.8.8 — installable, online only. No worker, cache or sync queue. */
(() => {
  'use strict';
  let installPrompt = null;
  let installing = false;
  let installed = false;
  function standalone() {
    return installed || navigator.standalone === true ||
      window.matchMedia('(display-mode: standalone)').matches ||
      window.matchMedia('(display-mode: fullscreen)').matches;
  }
  function refresh() {
    const button = document.getElementById('siyo-pwa-install');
    if (button) {
      button.hidden = standalone() || !window.isSecureContext;
      button.disabled = installing;
    }
    const notice = document.getElementById('siyo-pwa-offline');
    if (notice) notice.hidden = navigator.onLine !== false;
  }
  function manualInstructions() {
    const ua = navigator.userAgent || '';
    const ios = /iPad|iPhone|iPod/.test(ua) ||
      (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    if (ios) {
      window.alert('Pour installer SIYO Pilot sur iPhone ou iPad : ouvrez ce lien dans Safari, touchez Partager, puis « Sur l’écran d’accueil » et Ajouter. Internet reste nécessaire.');
    } else if (/Android/i.test(ua)) {
      window.alert('Pour installer SIYO Pilot : ouvrez le lien dans Chrome sur votre téléphone, puis le menu ⋮ → « Installer l’application » ou « Ajouter à l’écran d’accueil ». Si vous êtes dans WhatsApp, choisissez d’abord « Ouvrir dans Chrome ». Internet reste nécessaire.');
    } else {
      window.alert('Pour installer SIYO Pilot sur ordinateur : ouvrez le lien dans Chrome ou Edge, puis utilisez l’icône d’installation dans la barre d’adresse ou l’option d’installation du menu. Si cette option est absente, vous pouvez continuer à utiliser le site. Internet reste nécessaire.');
    }
  }
  async function install() {
    if (installing || standalone()) return;
    if (!installPrompt) { manualInstructions(); return; }
    const prompt = installPrompt;
    installPrompt = null;
    installing = true;
    refresh();
    try {
      await prompt.prompt();
      await prompt.userChoice;
      // appinstalled, not mere prompt acceptance, confirms installation.
    } catch (_) {
      manualInstructions();
    } finally {
      installing = false;
      refresh();
    }
  }
  window.siyoPwa = Object.freeze({refresh, install});
  window.addEventListener('beforeinstallprompt', event => {
    event.preventDefault();
    installPrompt = event;
    refresh();
  });
  window.addEventListener('appinstalled', () => {
    installed = true;
    installPrompt = null;
    refresh();
  });
  window.addEventListener('online', refresh);
  window.addEventListener('offline', refresh);
  window.addEventListener('pageshow', refresh);
  const mode = window.matchMedia('(display-mode: standalone)');
  if (mode.addEventListener) mode.addEventListener('change', refresh);
  document.addEventListener('DOMContentLoaded', refresh);
  refresh();
})();

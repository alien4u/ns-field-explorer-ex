/**
 * Pre-Paint Restore — Field Explorer EX
 *
 * Runs synchronously in <head> before the stylesheets. chrome.storage is async
 * and resolves after the first paint, which is what Chrome sizes the popup
 * window from, so popup.js mirrors size and theme into localStorage on every
 * open and every write and this script reads that mirror.
 *
 * @module boot
 */

(() => {

    'use strict';

    try {

        const oRoot = document.documentElement;
        const nWidth = parseInt(localStorage.getItem('fex_popupWidth'), 10);
        const nHeight = parseInt(localStorage.getItem('fex_popupHeight'), 10);

        if (!isNaN(nWidth)) {
            oRoot.style.setProperty('--fe-width', Math.min(Math.max(nWidth, 350), 792) + 'px');
        }

        if (!isNaN(nHeight)) {
            oRoot.style.setProperty('--fe-height', Math.min(Math.max(nHeight, 300), 592) + 'px');
        }

        const sThemeMode = localStorage.getItem('fex_darkMode');
        const bAuto = sThemeMode === null || sThemeMode === 'auto';
        const bDark = sThemeMode === 'on'
            || (bAuto && window.matchMedia('(prefers-color-scheme: dark)').matches);

        if (bDark) oRoot.classList.add('theme-dark');

        if (localStorage.getItem('fex_compactMode') === 'true') {
            oRoot.classList.add('fe-compact');
        }

    } catch (_e) { /* localStorage unavailable (private windows) — CSS defaults apply */ }
})();

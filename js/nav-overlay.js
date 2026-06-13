/**
 * MURA — Nav Overlay Toggle
 * Shared across all pages. Works with both inline nav (DOMContentLoaded)
 * and layout.js-injected nav (mura:layout-ready).
 *
 * Exposes window.muraCloseOverlay() so page-specific code (e.g. homepage
 * page-switching) can programmatically close the overlay.
 */
(function () {
    'use strict';
    let initialized = false;

    // Close function is defined at module scope so it can be exposed globally
    function closeOverlay() {
        const overlay = document.getElementById('nav-overlay');
        if (overlay) overlay.classList.remove('is-open');
        document.body.style.overflow = '';
    }

    function openOverlay() {
        const overlay = document.getElementById('nav-overlay');
        if (overlay) overlay.classList.add('is-open');
        document.body.style.overflow = 'hidden';
    }

    // Expose close function for page-specific code (e.g. homepage overlay links)
    window.muraCloseOverlay = closeOverlay;

    function init() {
        if (initialized) return;
        const btn = document.getElementById('nav-burger-btn');
        if (!btn) return; // Nav not in DOM yet — will retry on mura:layout-ready
        initialized = true;

        const closeBtn = document.getElementById('nav-overlay-close');

        btn.addEventListener('click', openOverlay);
        if (closeBtn) closeBtn.addEventListener('click', closeOverlay);
        const overlay = document.getElementById('nav-overlay');
        if (overlay) overlay.addEventListener('click', (e) => {
            if (e.target === overlay) closeOverlay();
        });
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && overlay && overlay.classList.contains('is-open')) closeOverlay();
        });
    }

    // Try on DOMContentLoaded (for pages with inline nav)
    document.addEventListener('DOMContentLoaded', init);

    // Try after layout.js injects nav (for pages using <div id="site-nav">)
    document.addEventListener('mura:layout-ready', init);
})();

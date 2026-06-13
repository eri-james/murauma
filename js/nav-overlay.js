/**
 * MURA — Nav Overlay Toggle
 * Shared across all pages. Binds after layout.js injects the nav HTML
 * (signalled by the mura:layout-ready custom event).
 *
 * Exposes window.muraCloseOverlay() so page-specific code (e.g. homepage
 * page-switching) can programmatically close the overlay.
 */
(function () {
    'use strict';
    let initialized = false;

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
        if (!btn) return; // Nav not in DOM yet — will retry on next event
        initialized = true;

        const closeBtn = document.getElementById('nav-overlay-close');
        const overlay = document.getElementById('nav-overlay');

        btn.addEventListener('click', openOverlay);
        if (closeBtn) closeBtn.addEventListener('click', closeOverlay);
        if (overlay) overlay.addEventListener('click', (e) => {
            if (e.target === overlay) closeOverlay();
        });
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && overlay && overlay.classList.contains('is-open')) closeOverlay();
        });
    }

    // Listen for both DOMContentLoaded (inline nav pages) and mura:layout-ready (layout.js pages).
    // Both are safe because init() is idempotent — it returns immediately if already called.
    document.addEventListener('DOMContentLoaded', init);
    document.addEventListener('mura:layout-ready', init);

    // Direct check: if scripts loaded after DOMContentLoaded already fired,
    // and the nav is already in the DOM (e.g. pages with inline nav), init now.
    if (document.readyState !== 'loading' && document.getElementById('nav-burger-btn')) {
        init();
    }
})();

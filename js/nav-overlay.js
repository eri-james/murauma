/**
 * MURA — Nav Overlay Toggle
 *
 * Handles the burger menu button and full-page overlay toggle.
 * Include on every page: <script src="/js/nav-overlay.js"></script>
 *
 * Exposes window.MuraNav.openOverlay() and window.MuraNav.closeOverlay()
 * for other scripts (e.g. homepage page-switching) to use.
 */
(function () {
    'use strict';

    window.MuraNav = window.MuraNav || {};

    var initialized = false;

    function init() {
        if (initialized) return;

        var burgerBtn = document.getElementById('nav-burger-btn');
        var overlay   = document.getElementById('nav-overlay');
        var closeBtn  = document.getElementById('nav-overlay-close');

        if (!burgerBtn) return;   // nav not in DOM yet (shouldn't happen with includes)
        initialized = true;

        function openOverlay() {
            if (overlay) overlay.classList.add('is-open');
            document.body.style.overflow = 'hidden';
        }

        function closeOverlay() {
            if (overlay) overlay.classList.remove('is-open');
            document.body.style.overflow = '';
        }

        // Expose globally for homepage page-switching etc.
        window.MuraNav.openOverlay  = openOverlay;
        window.MuraNav.closeOverlay = closeOverlay;

        // Bind event listeners
        burgerBtn.addEventListener('click', openOverlay);
        if (closeBtn) closeBtn.addEventListener('click', closeOverlay);
        if (overlay) overlay.addEventListener('click', function (e) {
            if (e.target === overlay) closeOverlay();
        });
        document.addEventListener('keydown', function (e) {
            if (e.key === 'Escape' && overlay && overlay.classList.contains('is-open')) closeOverlay();
        });
    }

    // Run when DOM is ready — safe regardless of script position
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();

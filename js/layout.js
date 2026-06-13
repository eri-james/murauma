/**
 * MURA — Shared Layout Loader
 * Fetches and injects nav and footer into pages.
 * Eliminates ~700 lines of duplicated HTML across all pages.
 *
 * Usage in HTML:
 *   <div id="site-nav"></div>
 *   <!-- Main Content -->
 *   <main>...</main>
 *   <div id="site-footer"></div>
 *   <script src="/js/layout.js"></script>
 *   <script src="/js/nav-overlay.js"></script>
 *   <script src="/js/auth.js"></script>
 *   <script src="/js/particles.js"></script>
 */
document.addEventListener('DOMContentLoaded', async () => {
    // Detect page location
    const pathParts = window.location.pathname.split('/').filter(Boolean);
    const inSubdir = pathParts.length > 1 && pathParts[0] !== 'admin';
    const isHome = !pathParts.length
        || (pathParts.length === 1 && (pathParts[0] === 'index.html' || pathParts[0] === ''));

    // Select the correct nav partial
    const navPath = isHome   ? '/includes/nav-home.html'
                  : inSubdir ? '/includes/nav-sub.html'
                  :            '/includes/nav.html';

    // Footer is the same for root & home; sub-pages use -sub variant
    const footerPath = inSubdir ? '/includes/footer-sub.html' : '/includes/footer.html';

    const navContainer = document.getElementById('site-nav');
    if (navContainer) {
        try {
            const r = await fetch(navPath);
            navContainer.innerHTML = await r.text();
        } catch (_) { /* nav load failure is non-critical */ }
    }

    const footerContainer = document.getElementById('site-footer');
    if (footerContainer) {
        try {
            const r = await fetch(footerPath);
            footerContainer.innerHTML = await r.text();
        } catch (_) { /* footer load failure is non-critical */ }
    }

    // Signal that layout HTML is in the DOM so nav-overlay.js and auth.js can initialise
    document.dispatchEvent(new CustomEvent('mura:layout-ready'));
});

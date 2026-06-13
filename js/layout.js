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

    // Fetch with a 5-second timeout so a stalled network doesn't block forever
    function fetchWithTimeout(url, ms) {
        const controller = new AbortController();
        const id = setTimeout(() => controller.abort(), ms);
        return fetch(url, { signal: controller.signal }).finally(() => clearTimeout(id));
    }

    const navContainer = document.getElementById('site-nav');
    if (navContainer) {
        try {
            const r = await fetchWithTimeout(navPath, 5000);
            if (r.ok) navContainer.innerHTML = await r.text();
            else console.warn('layout.js: nav fetch returned', r.status);
        } catch (e) {
            console.warn('layout.js: nav fetch failed', e.message || e);
        }
    }

    const footerContainer = document.getElementById('site-footer');
    if (footerContainer) {
        try {
            const r = await fetchWithTimeout(footerPath, 5000);
            if (r.ok) footerContainer.innerHTML = await r.text();
            else console.warn('layout.js: footer fetch returned', r.status);
        } catch (e) {
            console.warn('layout.js: footer fetch failed', e.message || e);
        }
    }

    // Signal that layout HTML is in the DOM so nav-overlay.js and auth.js can initialise.
    // This ALWAYS fires, even if the fetches failed, so other scripts don't hang.
    document.dispatchEvent(new CustomEvent('mura:layout-ready'));
});

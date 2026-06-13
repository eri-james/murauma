/**
 * MURA — Shared Layout Loader
 * Fetches and injects nav and footer into sub-pages.
 * Eliminates ~700 lines of duplicated HTML across 18 pages.
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
document.addEventListener('DOMContentLoaded', () => {
    // Detect if we're in a subdirectory (e.g. /fan-media/)
    const pathParts = window.location.pathname.split('/').filter(Boolean);
    const inSubdir = pathParts.length > 1 && pathParts[0] !== 'admin';

    const navPath = inSubdir ? '/includes/nav-sub.html' : '/includes/nav.html';
    const footerPath = inSubdir ? '/includes/footer-sub.html' : '/includes/footer.html';

    const navContainer = document.getElementById('site-nav');
    if (navContainer) {
        fetch(navPath)
            .then(r => r.text())
            .then(html => { navContainer.innerHTML = html; })
            .catch(() => {});
    }

    const footerContainer = document.getElementById('site-footer');
    if (footerContainer) {
        fetch(footerPath)
            .then(r => r.text())
            .then(html => { footerContainer.innerHTML = html; })
            .catch(() => {});
    }
});

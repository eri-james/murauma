/**
 * MURA — Nav Overlay Toggle
 * Shared across all sub-pages. Loaded after auth.js.
 */
document.addEventListener('DOMContentLoaded', () => {
    const navBurgerBtn = document.getElementById('nav-burger-btn');
    const navOverlay = document.getElementById('nav-overlay');
    const navOverlayClose = document.getElementById('nav-overlay-close');

    function openOverlay() {
        if (navOverlay) navOverlay.classList.add('is-open');
        document.body.style.overflow = 'hidden';
    }
    function closeOverlay() {
        if (navOverlay) navOverlay.classList.remove('is-open');
        document.body.style.overflow = '';
    }

    if (navBurgerBtn) navBurgerBtn.addEventListener('click', openOverlay);
    if (navOverlayClose) navOverlayClose.addEventListener('click', closeOverlay);
    if (navOverlay) navOverlay.addEventListener('click', (e) => {
        if (e.target === navOverlay) closeOverlay();
    });
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && navOverlay && navOverlay.classList.contains('is-open')) closeOverlay();
    });
});

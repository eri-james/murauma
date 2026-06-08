/**
 * MURA — Shared Mobile Menu Logic
 * 
 * Used on every page. Include after the HTML body:
 *   <script src="/js/mobile-menu.js"></script>
 * 
 * Requires the following elements in the HTML:
 *   - button#mobile-menu-button
 *   - div#mobile-menu
 *   - svg#menu-open-icon
 *   - svg#menu-close-icon
 */
document.addEventListener('DOMContentLoaded', () => {
  const mobileMenuButton = document.getElementById('mobile-menu-button');
  const mobileMenu = document.getElementById('mobile-menu');
  const openIcon = document.getElementById('menu-open-icon');
  const closeIcon = document.getElementById('menu-close-icon');

  if (mobileMenuButton && mobileMenu && openIcon && closeIcon) {
    mobileMenuButton.addEventListener('click', () => {
      mobileMenu.classList.toggle('hidden');
      openIcon.classList.toggle('hidden');
      closeIcon.classList.toggle('hidden');
    });
  }
});

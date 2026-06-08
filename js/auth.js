/**
 * MURA — Shared Client-Side Auth Module
 * 
 * Provides auth state checking and nav updates for all pages.
 * Include in every page: <script src="/js/auth.js"></script>
 * 
 * This script:
 * 1. Checks if the user is logged in by calling /api/me
 * 2. Updates the navigation to show Login/Profile/Logout links
 * 3. Exposes the current user globally as window.muraCurrentUser
 */
(function() {
    'use strict';

    // Cache the current user globally
    window.muraCurrentUser = null;

    /**
     * Updates navigation elements based on auth state.
     * Finds elements with data-auth attributes and toggles them.
     */
    function updateNav(user) {
        // Update all elements with data-auth="logged-in" (show when logged in)
        document.querySelectorAll('[data-auth="logged-in"]').forEach(el => {
            el.classList.remove('hidden');
        });

        // Update all elements with data-auth="logged-out" (show when logged out)
        document.querySelectorAll('[data-auth="logged-out"]').forEach(el => {
            el.classList.add('hidden');
        });

        // Update username displays
        document.querySelectorAll('[data-auth="username"]').forEach(el => {
            el.textContent = user ? `@${user.username}` : '';
        });

        // Update display name displays
        document.querySelectorAll('[data-auth="display-name"]').forEach(el => {
            el.textContent = user ? user.displayName : '';
        });

        // Update avatar images
        document.querySelectorAll('[data-auth="avatar"]').forEach(el => {
            if (user && user.avatarUrl) {
                el.src = user.avatarUrl;
                el.classList.remove('hidden');
            }
        });

        // Set up logout buttons
        document.querySelectorAll('[data-auth="logout"]').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                e.preventDefault();
                try {
                    await fetch('/api/logout', { method: 'POST' });
                    window.location.reload();
                } catch (err) {
                    console.error('Logout failed:', err);
                }
            });
        });
    }

    /**
     * Checks auth state and updates the UI.
     */
    async function checkAuth() {
        try {
            const response = await fetch('/api/me');
            const data = await response.json();

            if (data.result === 'success' && data.user) {
                window.muraCurrentUser = data.user;
                updateNav(data.user);
            } else {
                window.muraCurrentUser = null;
                updateNav(null);
            }
        } catch (err) {
            console.error('Auth check failed:', err);
            window.muraCurrentUser = null;
            updateNav(null);
        }
    }

    // Run auth check when DOM is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', checkAuth);
    } else {
        checkAuth();
    }
})();

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
        // Update all elements with data-auth="logged-in" (show when logged in, hide when logged out)
        document.querySelectorAll('[data-auth="logged-in"]').forEach(el => {
            if (user) {
                el.classList.remove('hidden');
            } else {
                el.classList.add('hidden');
            }
        });

        // Update all elements with data-auth="logged-out" (show when logged out, hide when logged in)
        document.querySelectorAll('[data-auth="logged-out"]').forEach(el => {
            if (user) {
                el.classList.add('hidden');
            } else {
                el.classList.remove('hidden');
            }
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
            } else {
                el.classList.add('hidden');
            }
        });

        // Show admin link for admin users only
        document.querySelectorAll('[data-auth="admin"]').forEach(el => {
            if (user && user.role === 'admin') {
                el.classList.remove('hidden');
            } else {
                el.classList.add('hidden');
            }
        });

        // Show pending notice elements for pending users only
        document.querySelectorAll('[data-auth="pending"]').forEach(el => {
            if (user && user.status === 'pending') {
                el.classList.remove('hidden');
            } else {
                el.classList.add('hidden');
            }
        });

        // Show elements only for approved members
        document.querySelectorAll('[data-auth="approved"]').forEach(el => {
            if (user && user.status === 'approved') {
                el.classList.remove('hidden');
            } else {
                el.classList.add('hidden');
            }
        });

        // Show/hide logout buttons and attach click handlers
        document.querySelectorAll('[data-auth="logout"]').forEach(btn => {
            if (user) {
                btn.classList.remove('hidden');
            } else {
                btn.classList.add('hidden');
            }
            // Only attach click listener once
            if (!btn._logoutBound) {
                btn._logoutBound = true;
                btn.addEventListener('click', async (e) => {
                    e.preventDefault();
                    try {
                        await fetch('/api/logout', { method: 'POST' });
                        window.location.reload();
                    } catch (err) {
                        console.error('Logout failed:', err);
                    }
                });
            }
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
                // Expose status globally for other scripts to check
                window.muraUserStatus = data.user.status || null;
            } else {
                window.muraCurrentUser = null;
                window.muraUserStatus = null;
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

    // Re-apply auth state after layout.js injects nav/footer HTML
    // (the /api/me fetch may resolve before layout.js injects the auth elements)
    document.addEventListener('mura:layout-ready', () => {
        if (window.muraCurrentUser) {
            updateNav(window.muraCurrentUser);
        } else {
            updateNav(null);
        }
    });
})();

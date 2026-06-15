#!/usr/bin/env node
/**
 * MURA — Build Script for Nav/Footer Includes
 *
 * This script replaces marked sections in HTML files with content
 * generated from shared include templates. It handles both:
 *   1. Initial conversion: --init  (adds markers to existing pages)
 *   2. Subsequent rebuilds: default (regenerates content between markers)
 *
 * Usage:
 *   node build.js           # Rebuild all pages (replace content between markers)
 *   node build.js --init    # Initial conversion (add markers to unconverted pages)
 *   node build.js guides.html  # Rebuild specific page(s)
 */

const fs = require('fs');
const path = require('path');

const ROOT = __dirname;

// ============================================================
// PAGE CONFIGURATIONS
// ============================================================
// Each page specifies which template variables to use.
// navlinkPrefix: prefix for nav/overlay link hrefs
// logoHref:      href for the logo link
// relPrefix:     prefix for relative auth links (register.html, etc.)
// isHome:        homepage gets extra attributes + desktop auth

const PAGE_CONFIGS = {
    // Homepage
    'index.html': {
        navlinkPrefix: '',
        logoHref: '#',
        relPrefix: '',
        isHome: true,
    },

    // Root-level sub-pages
    'weekly-race.html':       { navlinkPrefix: 'index.html', logoHref: 'index.html', relPrefix: '', isHome: false },
    'guides.html':            { navlinkPrefix: 'index.html', logoHref: 'index.html', relPrefix: '', isHome: false },
    'guide.html':             { navlinkPrefix: 'index.html', logoHref: 'index.html', relPrefix: '', isHome: false },
    'login.html':             { navlinkPrefix: 'index.html', logoHref: 'index.html', relPrefix: '', isHome: false },
    'register.html':          { navlinkPrefix: 'index.html', logoHref: 'index.html', relPrefix: '', isHome: false },
    'edit-profile.html':      { navlinkPrefix: 'index.html', logoHref: 'index.html', relPrefix: '', isHome: false },
    'setup-account.html':     { navlinkPrefix: 'index.html', logoHref: 'index.html', relPrefix: '', isHome: false },
    'news-detail.html':       { navlinkPrefix: 'index.html', logoHref: 'index.html', relPrefix: '', isHome: false },
    'event-detail.html':      { navlinkPrefix: 'index.html', logoHref: 'index.html', relPrefix: '', isHome: false },
    'submit-writing.html':    { navlinkPrefix: 'index.html', logoHref: 'index.html', relPrefix: '', isHome: false },
    'submit-fan-media.html':  { navlinkPrefix: 'index.html', logoHref: 'index.html', relPrefix: '', isHome: false },
    'write-guide.html':       { navlinkPrefix: 'index.html', logoHref: 'index.html', relPrefix: '', isHome: false },
    'race-leaderboard.html':  { navlinkPrefix: 'index.html', logoHref: 'index.html', relPrefix: '', isHome: false },
    'pickem-leaderboard.html':{ navlinkPrefix: 'index.html', logoHref: 'index.html', relPrefix: '', isHome: false },

    // Fan-media sub-pages (one directory deeper)
    'fan-media/fanart.html':  { navlinkPrefix: '../index.html', logoHref: '../index.html', relPrefix: '../', isHome: false },
    'fan-media/videos.html':  { navlinkPrefix: '../index.html', logoHref: '../index.html', relPrefix: '../', isHome: false },
    'fan-media/writings.html':{ navlinkPrefix: '../index.html', logoHref: '../index.html', relPrefix: '../', isHome: false },
    'fan-media/music.html':   { navlinkPrefix: '../index.html', logoHref: '../index.html', relPrefix: '../', isHome: false },
};

// ============================================================
// MARKER DEFINITIONS
// ============================================================
const MARKERS = {
    NAV:     { start: '<!-- MURA:NAV:START -->',     end: '<!-- MURA:NAV:END -->' },
    OVERLAY: { start: '<!-- MURA:OVERLAY:START -->', end: '<!-- MURA:OVERLAY:END -->' },
    FOOTER:  { start: '<!-- MURA:FOOTER:START -->',  end: '<!-- MURA:FOOTER:END -->' },
};

// ============================================================
// TEMPLATE LOADING
// ============================================================

function loadTemplate(name) {
    return fs.readFileSync(path.join(ROOT, 'includes', name), 'utf8');
}

// Desktop auth buttons (homepage only)
const DESKTOP_AUTH_HTML = `                <!-- Auth buttons (desktop) -->
                <a href="register.html" data-auth="logged-out" class="nav-pill-auth nav-pill-auth-join">Join</a>
                <a href="login.html" data-auth="logged-out" class="nav-pill-auth nav-pill-auth-login">Log In</a>
                <a href="edit-profile.html" data-auth="logged-in" class="nav-pill-auth nav-pill-auth-profile"><span data-auth="display-name"></span></a>
                <a href="/admin/" data-auth="admin" class="nav-pill-auth nav-pill-auth-admin">Admin</a>
                <button data-auth="logout" class="nav-pill-auth nav-pill-auth-logout">Log Out</button>`;

// ============================================================
// TEMPLATE VARIABLE RESOLUTION
// ============================================================

function resolveVars(template, config) {
    let html = template;

    // Simple variable replacement
    html = html.replace(/\{\{NAVLINK_PREFIX\}\}/g, config.navlinkPrefix);
    html = html.replace(/\{\{LOGO_HREF\}\}/g, config.logoHref);
    html = html.replace(/\{\{REL_PREFIX\}\}/g, config.relPrefix);

    // Homepage-specific attributes
    html = html.replace(/\{\{LOGO_ID_ATTR\}\}/g, config.isHome ? ' id="logo-link"' : '');
    html = html.replace(/\{\{DATA_NAV_LINK\}\}/g, config.isHome ? ' data-nav-link' : '');
    html = html.replace(/\{\{DATA_OVERLAY_LINK\}\}/g, config.isHome ? ' data-overlay-link' : '');
    html = html.replace(/\{\{DESKTOP_AUTH\}\}/g, config.isHome ? DESKTOP_AUTH_HTML : '');

    return html;
}

// ============================================================
// MARKER-BASED REPLACEMENT
// ============================================================

function replaceBetweenMarkers(content, markerName, newContent) {
    const marker = MARKERS[markerName];
    const startIdx = content.indexOf(marker.start);
    const endIdx = content.indexOf(marker.end);

    if (startIdx === -1 || endIdx === -1) {
        return null;  // markers not found
    }

    const before = content.substring(0, startIdx + marker.start.length);
    const after = content.substring(endIdx);

    return before + '\n' + newContent + '\n    ' + after;
}

// ============================================================
// INIT: ADD MARKERS TO UNCONVERTED PAGES
// ============================================================

function addMarkers(content, pagePath) {
    let result = content;

    // --- Add NAV markers ---
    if (result.indexOf(MARKERS.NAV.start) === -1) {
        // Find the nav-pill section
        const navStart = result.indexOf('<!-- Pill Navigation Bar -->');
        const navEnd = result.indexOf('</div>\n\n    <!-- Full-Page Overlay Menu -->');
        if (navStart !== -1 && navEnd !== -1) {
            const endTagEnd = result.indexOf('</div>', navEnd) + '</div>'.length;
            const before = result.substring(0, navStart);
            const navContent = result.substring(navStart, endTagEnd);
            const after = result.substring(endTagEnd);
            result = before + MARKERS.NAV.start + '\n' + navContent + '\n    ' + MARKERS.NAV.end + after;
        } else {
            console.warn(`  ⚠ Could not find nav-pill section in ${pagePath}`);
        }
    }

    // --- Add OVERLAY markers ---
    if (result.indexOf(MARKERS.OVERLAY.start) === -1) {
        const overlayStart = result.indexOf('<!-- Full-Page Overlay Menu -->');
        if (overlayStart === -1) {
            // Try alternative: find the overlay div
            const overlayDivStart = result.indexOf('<div id="nav-overlay"');
            if (overlayDivStart !== -1) {
                // Find closing </div> for the overlay (need to match nesting)
                let depth = 0;
                let pos = overlayDivStart;
                let overlayEnd = -1;
                while (pos < result.length) {
                    const openDiv = result.indexOf('<div', pos);
                    const closeDiv = result.indexOf('</div>', pos);
                    if (closeDiv === -1) break;
                    if (openDiv !== -1 && openDiv < closeDiv) {
                        depth++;
                        pos = openDiv + 4;
                    } else {
                        depth--;
                        if (depth === 0) {
                            overlayEnd = closeDiv + '</div>'.length;
                            break;
                        }
                        pos = closeDiv + 6;
                    }
                }
                if (overlayEnd !== -1) {
                    const before = result.substring(0, overlayDivStart);
                    const overlayContent = result.substring(overlayDivStart, overlayEnd);
                    const after = result.substring(overlayEnd);
                    result = before + MARKERS.OVERLAY.start + '\n' + overlayContent + '\n    ' + MARKERS.OVERLAY.end + after;
                }
            }
        } else {
            // Find closing </div> for overlay starting from overlayStart
            const overlayDivIdx = result.indexOf('<div id="nav-overlay"', overlayStart);
            let depth = 0;
            let pos = overlayDivIdx;
            let overlayEnd = -1;
            while (pos < result.length) {
                const openDiv = result.indexOf('<div', pos);
                const closeDiv = result.indexOf('</div>', pos);
                if (closeDiv === -1) break;
                if (openDiv !== -1 && openDiv < closeDiv) {
                    depth++;
                    pos = openDiv + 4;
                } else {
                    depth--;
                    if (depth === 0) {
                        overlayEnd = closeDiv + '</div>'.length;
                        break;
                    }
                    pos = closeDiv + 6;
                }
            }
            if (overlayEnd !== -1) {
                const before = result.substring(0, overlayStart);
                const overlayContent = result.substring(overlayStart, overlayEnd);
                const after = result.substring(overlayEnd);
                result = before + MARKERS.OVERLAY.start + '\n' + overlayContent + '\n    ' + MARKERS.OVERLAY.end + after;
            }
        }
    }

    // --- Add FOOTER markers ---
    if (result.indexOf(MARKERS.FOOTER.start) === -1) {
        const footerStart = result.indexOf('<!-- Footer Section -->');
        if (footerStart === -1) {
            // Try finding <footer tag directly
            const footerTagStart = result.indexOf('<footer');
            const footerTagEnd = result.indexOf('</footer>');
            if (footerTagStart !== -1 && footerTagEnd !== -1) {
                const endOfFooter = footerTagEnd + '</footer>'.length;
                const before = result.substring(0, footerTagStart);
                const footerContent = result.substring(footerTagStart, endOfFooter);
                const after = result.substring(endOfFooter);
                result = before + MARKERS.FOOTER.start + '\n' + footerContent + '\n    ' + MARKERS.FOOTER.end + after;
            } else {
                console.warn(`  ⚠ Could not find footer in ${pagePath}`);
            }
        } else {
            const footerTagEnd = result.indexOf('</footer>', footerStart);
            if (footerTagEnd !== -1) {
                const endOfFooter = footerTagEnd + '</footer>'.length;
                const before = result.substring(0, footerStart);
                const footerContent = result.substring(footerStart, endOfFooter);
                const after = result.substring(endOfFooter);
                result = before + MARKERS.FOOTER.start + '\n' + footerContent + '\n    ' + MARKERS.FOOTER.end + after;
            }
        }
    }

    return result;
}

// ============================================================
// BURGER JS REPLACEMENT
// ============================================================

function replaceInlineBurgerJS(content, pagePath, config) {
    // For homepage, we handle this specially — don't auto-replace
    if (config.isHome) return content;

    // Pattern: standalone <script> block with burger/overlay toggle code
    // This is the pattern used on sub-pages: a <script> block after auth.js
    // that contains nav-burger-btn, openOverlay, closeOverlay

    // Match the burger script block (after auth.js or standalone)
    const burgerScriptPattern = /(\n\s*)<script>\s*\n\s*(?:\/\/\s*Pill nav overlay toggle\s*\n\s*)?const navBurgerBtn\s*=\s*document\.getElementById\('nav-burger-btn'\);[\s\S]*?closeOverlay\(\);\s*\n\s*\}\);\s*\n\s*<\/script>/;

    if (burgerScriptPattern.test(content)) {
        content = content.replace(burgerScriptPattern, '$1<script src="/js/nav-overlay.js"></script>');
        console.log(`  ✓ Replaced inline burger JS with nav-overlay.js in ${pagePath}`);
    } else {
        // Try alternate pattern for minified versions
        const minBurgerPattern = /(\n\s*)<script>\s*const e=document\.getElementById\("nav-burger-btn"\)[\s\S]*?<\/script>/;
        if (minBurgerPattern.test(content)) {
            content = content.replace(minBurgerPattern, '$1<script src="/js/nav-overlay.js"></script>');
            console.log(`  ✓ Replaced minified burger JS with nav-overlay.js in ${pagePath}`);
        } else {
            console.warn(`  ⚠ Could not find inline burger JS in ${pagePath} (may need manual replacement)`);
        }
    }

    return content;
}

// ============================================================
// DOMPURIFY FALLBACK INJECTION
// ============================================================

function addDompurifyFallback(content, pagePath, config) {
    // Check if fallback is already present
    if (content.indexOf('dompurify-fallback.js') !== -1) {
        return content;
    }

    // Find the DOMPurify CDN script and add fallback right after
    const cdnPattern = /(<script src="[^"]*dompurify[^"]*purify\.min\.js"><\/script>)/;
    if (cdnPattern.test(content)) {
        const relPrefix = config.relPrefix || '';
        content = content.replace(cdnPattern, `$1\n    <script src="${relPrefix}js/dompurify-fallback.js"></script>`);
        console.log(`  ✓ Added dompurify-fallback.js to ${pagePath}`);
    } else {
        console.warn(`  ⚠ Could not find DOMPurify CDN script in ${pagePath}`);
    }

    return content;
}

// ============================================================
// MAIN BUILD PROCESS
// ============================================================

function buildPage(pagePath, doInit) {
    const config = PAGE_CONFIGS[path.basename(pagePath)] || PAGE_CONFIGS[pagePath];
    if (!config) {
        console.error(`  ✗ No config for ${pagePath}`);
        return false;
    }

    const filePath = path.join(ROOT, pagePath);
    if (!fs.existsSync(filePath)) {
        console.error(`  ✗ File not found: ${filePath}`);
        return false;
    }

    let content = fs.readFileSync(filePath, 'utf8');
    let modified = false;

    // --- INIT MODE: Add markers ---
    if (doInit) {
        const withMarkers = addMarkers(content, pagePath);
        if (withMarkers && withMarkers !== content) {
            content = withMarkers;
            modified = true;
            console.log(`  ✓ Added markers to ${pagePath}`);
        }
    }

    // --- REPLACE: Generate template content between markers ---
    const navTemplate = loadTemplate('nav.html');
    const overlayTemplate = loadTemplate('overlay.html');
    const footerTemplate = loadTemplate('footer.html');

    const navHtml = resolveVars(navTemplate, config);
    const overlayHtml = resolveVars(overlayTemplate, config);
    const footerHtml = resolveVars(footerTemplate, config);

    // Replace nav section
    const withNav = replaceBetweenMarkers(content, 'NAV', navHtml);
    if (withNav) {
        content = withNav;
        modified = true;
        console.log(`  ✓ Replaced nav in ${pagePath}`);
    }

    // Replace overlay section
    const withOverlay = replaceBetweenMarkers(content, 'OVERLAY', overlayHtml);
    if (withOverlay) {
        content = withOverlay;
        modified = true;
        console.log(`  ✓ Replaced overlay in ${pagePath}`);
    }

    // Replace footer section
    const withFooter = replaceBetweenMarkers(content, 'FOOTER', footerHtml);
    if (withFooter) {
        content = withFooter;
        modified = true;
        console.log(`  ✓ Replaced footer in ${pagePath}`);
    }

    // --- Replace inline burger JS ---
    content = replaceInlineBurgerJS(content, pagePath, config);

    // --- Add DOMPurify fallback ---
    content = addDompurifyFallback(content, pagePath, config);

    // --- Write back ---
    if (modified || content !== fs.readFileSync(filePath, 'utf8')) {
        fs.writeFileSync(filePath, content, 'utf8');
        console.log(`  ✓ Wrote ${pagePath}`);
        return true;
    }

    console.log(`  - No changes needed for ${pagePath}`);
    return false;
}

// ============================================================
// CLI ENTRY POINT
// ============================================================

function main() {
    const args = process.argv.slice(2);
    const doInit = args.includes('--init');
    const specificPages = args.filter(a => a !== '--init');

    const pages = specificPages.length > 0
        ? specificPages
        : Object.keys(PAGE_CONFIGS);

    console.log(`\n🏗️  MURA Build — ${doInit ? 'INIT' : 'REBUILD'} mode`);
    console.log(`   Pages: ${pages.length}\n`);

    let changed = 0;
    for (const page of pages) {
        if (buildPage(page, doInit)) changed++;
    }

    console.log(`\n✅ Done. ${changed}/${pages.length} page(s) updated.\n`);
}

main();

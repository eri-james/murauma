/**
 * MURA — DOMPurify Fallback
 *
 * Provides a text-only sanitizer if the DOMPurify CDN fails to load
 * (ad blockers, network issues, corporate firewalls, etc.).
 *
 * Load right after the DOMPurify CDN script in <head>:
 *   <script src="https://cdnjs.cloudflare.com/ajax/libs/dompurify/3.2.5/purify.min.js"></script>
 *   <script src="/js/dompurify-fallback.js"></script>
 */
if (typeof DOMPurify === 'undefined') {
    window.DOMPurify = {
        sanitize: function (str) {
            if (typeof str !== 'string') return '';
            var d = document.createElement('div');
            d.textContent = str;
            return d.innerHTML;
        }
    };
}

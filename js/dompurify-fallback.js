/**
 * DOMPurify fallback — if the CDN script fails to load, provide a minimal
 * text-only sanitizer so the page still works instead of throwing
 * "DOMPurify is not defined" errors.
 *
 * Include right after the CDN <script> tag:
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
    console.warn('DOMPurify CDN failed — using text-only fallback sanitizer');
}

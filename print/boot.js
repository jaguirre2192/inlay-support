/* Consume the private fragment before fetching the editor or its assets. */
window.inlayIncomingPrint = location.hash.slice(1);
if (location.hash) history.replaceState(null, '', location.pathname + location.search);

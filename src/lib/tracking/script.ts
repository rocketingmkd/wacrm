/**
 * Source of the landing page script served at /api/tracking/script.
 *
 * What it does on the customer's site:
 *  1. Reads UTMs, gclid and fbclid from the URL and keeps them in
 *     localStorage for 90 days (last ad click wins).
 *  2. When a visitor clicks a WhatsApp link (wa.me, api.whatsapp.com),
 *     it generates a short code, sends the stored params to the CRM under
 *     that code and appends "[#CODE]" to the pre-filled message.
 *  3. Exposes window.RocketingTrack.link(url) for buttons that open
 *     WhatsApp with JavaScript instead of a plain link.
 *
 * Plain ES5 on purpose: it runs on any page builder, with no build step.
 */
export function buildTrackingScript(args: { key: string; endpoint: string }): string {
  const key = JSON.stringify(args.key)
  const endpoint = JSON.stringify(args.endpoint)
  return `(function () {
  var KEY = ${key};
  var ENDPOINT = ${endpoint};
  var STORE = 'rocketing_attr';
  var TTL = 90 * 24 * 60 * 60 * 1000;
  var FIELDS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'gclid', 'fbclid'];
  var ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

  function read() {
    try {
      var raw = localStorage.getItem(STORE);
      if (!raw) return null;
      var saved = JSON.parse(raw);
      if (!saved || !saved.at || Date.now() - saved.at > TTL) return null;
      return saved.data || null;
    } catch (e) { return null; }
  }

  function write(data) {
    try { localStorage.setItem(STORE, JSON.stringify({ at: Date.now(), data: data })); } catch (e) {}
  }

  function cookie(name) {
    var m = document.cookie.match(new RegExp('(?:^|; )' + name + '=([^;]*)'));
    return m ? decodeURIComponent(m[1]) : '';
  }

  function capture() {
    var found = {};
    var has = false;
    try {
      var params = new URLSearchParams(location.search);
      for (var i = 0; i < FIELDS.length; i++) {
        var v = params.get(FIELDS[i]);
        if (v) { found[FIELDS[i]] = v; has = true; }
      }
    } catch (e) {}
    if (has) {
      found.landing_url = location.href.split('#')[0];
      found.referrer = document.referrer || '';
      write(found);
    }
  }

  function newCode() {
    var out = '';
    var bytes = new Uint8Array(8);
    if (window.crypto && crypto.getRandomValues) crypto.getRandomValues(bytes);
    else for (var i = 0; i < 8; i++) bytes[i] = Math.floor(Math.random() * 256);
    for (var j = 0; j < 8; j++) out += ALPHABET.charAt(bytes[j] % ALPHABET.length);
    return out;
  }

  function isWhatsappLink(href) {
    return /^https?:\\/\\/(wa\\.me\\/|api\\.whatsapp\\.com\\/send|web\\.whatsapp\\.com\\/send)/i.test(href || '');
  }

  function send(code, data) {
    var payload = { key: KEY, code: code };
    for (var k in data) if (Object.prototype.hasOwnProperty.call(data, k)) payload[k] = data[k];
    var fbp = cookie('_fbp');
    var fbc = cookie('_fbc');
    if (!fbc && data.fbclid) fbc = 'fb.1.' + Date.now() + '.' + data.fbclid;
    if (fbp) payload.fbp = fbp;
    if (fbc) payload.fbc = fbc;
    var body = JSON.stringify(payload);
    try {
      if (navigator.sendBeacon && navigator.sendBeacon(ENDPOINT, new Blob([body], { type: 'text/plain' }))) return;
    } catch (e) {}
    try { fetch(ENDPOINT, { method: 'POST', body: body, keepalive: true, mode: 'no-cors' }); } catch (e) {}
  }

  // Returns the link with the tracking code in its message. Visitors who
  // did not come from an ad keep the original link untouched.
  function decorate(href) {
    var data = read();
    if (!data || !isWhatsappLink(href)) return href;
    var url;
    try { url = new URL(href); } catch (e) { return href; }
    var text = (url.searchParams.get('text') || '').replace(/\\s*\\[#[A-Za-z0-9]{6,12}\\]/g, '');
    var code = newCode();
    url.searchParams.set('text', text ? text + '\\n[#' + code + ']' : '[#' + code + ']');
    send(code, data);
    return url.toString();
  }

  function onClick(e) {
    var node = e.target;
    while (node && node !== document) {
      if (node.tagName === 'A' && node.href) {
        if (isWhatsappLink(node.href)) node.href = decorate(node.href);
        return;
      }
      node = node.parentNode;
    }
  }

  capture();
  document.addEventListener('click', onClick, true);
  document.addEventListener('auxclick', onClick, true);
  window.RocketingTrack = { link: decorate };
})();
`
}

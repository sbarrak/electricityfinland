// Optional visitor statistics: Google Analytics 4 and / or Matomo, switched on in stack.env (see README).
// The server says which ones are set (/api/analytics). Nothing is loaded when none is set, in standalone mode (file://),
// and Google Analytics (or Matomo with cookies) only after the visitor allows cookies when ANALYTICS_CONSENT is on.
// The page calls Analytics.page('prices') for each screen / tab and Analytics.event('refresh') for a few actions;
// no usernames or other personal data are sent.
(() => {
  const queue = [];  // calls made before the settings arrived
  window.Analytics = { page: n => queue.push(['page', n]), event: (a, n) => queue.push(['event', a, n]) };
  if (location.protocol === 'file:') return;
  const KEY = 'elfi_consent';
  const stored = () => { try { return localStorage.getItem(KEY); } catch { return null; } };
  const remember = v => { try { localStorage.setItem(KEY, v); } catch { /* private mode: ask again next time */ } };
  const load = src => { const s = document.createElement('script'); s.async = true; s.src = src; document.head.appendChild(s); };
  let cfg = {}, gaOn = false, last = null;

  function startGa() {
    if (gaOn || !cfg.ga) return;
    gaOn = true;
    window.dataLayer = window.dataLayer || [];
    window.gtag = function () { dataLayer.push(arguments); };
    gtag('js', new Date());
    gtag('config', cfg.ga, { send_page_view: false });  // page views are sent per screen / tab below
    load('https://www.googletagmanager.com/gtag/js?id=' + encodeURIComponent(cfg.ga));
    if (last) gtag('event', 'page_view', { page_title: document.title + ' – ' + last, page_location: url(last) });
  }
  function startMatomo() {
    const m = cfg.matomo;
    if (!m) return;
    const _paq = window._paq = window._paq || [];
    if (!m.cookies) _paq.push(['disableCookies']);  // cookieless: no consent needed
    else if (cfg.consent) _paq.push(['requireCookieConsent']);  // counts visits, sets cookies only after consent
    _paq.push(['setTrackerUrl', m.url + 'matomo.php'], ['setSiteId', m.site_id], ['enableLinkTracking']);
    load(m.url + 'matomo.js');
  }
  const url = name => location.origin + location.pathname + '#' + name;
  function page(name) {
    if (!name || name === last) return;
    last = name;
    const title = document.title + ' – ' + name;
    if (gaOn) gtag('event', 'page_view', { page_title: title, page_location: url(name) });
    if (cfg.matomo) _paq.push(['setCustomUrl', url(name)], ['setDocumentTitle', title], ['trackPageView']);
  }
  function event(action, name) {
    if (gaOn) gtag('event', action, name ? { label: name } : {});
    if (cfg.matomo) _paq.push(['trackEvent', 'app', action, ...(name ? [name] : [])]);
  }

  function grant() {
    startGa();
    if (cfg.matomo?.cookies && cfg.consent) _paq.push(['rememberCookieConsentGiven']);
  }
  function choose(v) {
    remember(v);
    $consent()?.remove();
    if (v === 'yes') grant();
    else {
      if (cfg.matomo?.cookies) _paq.push(['forgetCookieConsentGiven']);
      if (gaOn) location.reload();  // Google Analytics cannot be unloaded: start without it
    }
  }
  const $consent = () => document.getElementById('consent');
  function ask() {
    if ($consent()) return;
    const who = [cfg.ga && 'Google Analytics', cfg.matomo?.cookies && 'Matomo'].filter(Boolean).join(' and ');
    const box = document.createElement('div');
    box.id = 'consent';
    box.className = 'consent card';
    box.setAttribute('role', 'dialog');
    box.innerHTML = `<p>This site counts visits with ${who} to see how it is used. This sets cookies. Allow?</p>
      <div class="dlgbtns"><button type="button" class="ghost" data-c="no">No thanks</button><button type="button" data-c="yes">Allow</button></div>`;
    box.onclick = e => e.target.dataset.c && choose(e.target.dataset.c);
    document.body.appendChild(box);
  }

  async function init() {
    try {
      const r = await fetch('/api/analytics');
      if (!r.ok) return;
      cfg = await r.json();
    } catch { return; }  // server not reachable: the page shows that itself
    const cookies = cfg.ga || cfg.matomo?.cookies;
    Object.assign(window.Analytics, { page, event });
    startMatomo();
    if (!cfg.consent || stored() === 'yes') grant();
    else if (cookies && !stored()) ask();
    if (cookies && cfg.consent) {  // a link to change the choice later
      const a = document.createElement('a');
      a.href = '#'; a.id = 'cookieSettings'; a.className = 'hint cookielink'; a.textContent = 'Cookie settings';
      a.onclick = e => { e.preventDefault(); ask(); };
      document.body.appendChild(a);
    }
    queue.splice(0).forEach(([f, ...args]) => window.Analytics[f](...args));
  }
  init();
})();

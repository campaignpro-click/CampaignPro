/* CampaignPro landing page form.
   Client-side checks are for a friendly experience only; the real security
   (validation, sanitising, formula-injection protection) runs in the
   Google Apps Script (apps-script/Code.gs), which can't be bypassed. */
(function () {
  var cfg = window.CP_LP || {};
  var form = document.getElementById('lead-form');
  if (!form) return;

  var startedAt = Date.now();
  var started = false;
  var submitting = false;
  var turnstileToken = '';

  var fields = {
    name: document.getElementById('f-name'),
    email: document.getElementById('f-email'),
    phone: document.getElementById('f-phone'),
    website: document.getElementById('f-website'),
    problem: document.getElementById('f-problem')
  };
  var statusEl = document.getElementById('form-status');
  var button = document.getElementById('lead-submit');
  var buttonLabel = button.querySelector('.lp-btn-label');

  var EMAIL_RE = /^[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)*\.[A-Za-z]{2,24}$/;
  var NAME_RE = /^[\p{L}\p{M}][\p{L}\p{M}' .\-]{1,79}$/u;
  var PHONE_RE = /^\+?[0-9 ().\-]{7,25}$/;
  var WEBSITE_RE = /^(https?:\/\/)?([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,24}(:\d{2,5})?(\/[A-Za-z0-9._~%!$&'()*+,;=:@\/?#-]*)?$/i;

  // ---- Tracking parameters from the ad click (UTM tags, fbclid)
  var params = new URLSearchParams(window.location.search);
  function param(name, max) {
    var v = (params.get(name) || '').slice(0, max || 150);
    return /^[A-Za-z0-9 _.,:;|\/()+\-]*$/.test(v) ? v : '';
  }
  var tracking = {
    utm_source: param('utm_source'),
    utm_medium: param('utm_medium'),
    utm_campaign: param('utm_campaign'),
    utm_content: param('utm_content'),
    utm_term: param('utm_term'),
    fbclid: param('fbclid', 250),
    page: window.location.pathname.slice(0, 100)
  };

  // ---- Optional Cloudflare Turnstile (invisible bot check)
  if (cfg.turnstileSiteKey) {
    var holder = document.getElementById('cf-turnstile');
    holder.hidden = false;
    window.cpTurnstileReady = function () {
      window.turnstile.render(holder, {
        sitekey: cfg.turnstileSiteKey,
        size: 'flexible',
        callback: function (t) { turnstileToken = t; },
        'expired-callback': function () { turnstileToken = ''; }
      });
    };
    var ts = document.createElement('script');
    ts.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?onload=cpTurnstileReady&render=explicit';
    ts.async = true;
    document.head.appendChild(ts);
  }

  function track(event, extra) {
    try { if (window.gtag) window.gtag('event', event, extra || {}); } catch (e) {}
    try { if (window.clarity) window.clarity('event', event); } catch (e) {}
  }

  form.addEventListener('focusin', function () {
    if (started) return;
    started = true;
    track('form_start', { form_id: 'lp_audit' });
  });

  function showError(key, show) {
    var el = document.getElementById('e-' + key);
    el.hidden = !show;
    fields[key].setAttribute('aria-invalid', show ? 'true' : 'false');
    if (show) fields[key].setAttribute('aria-describedby', 'e-' + key);
    else fields[key].removeAttribute('aria-describedby');
  }

  function values() {
    return {
      name: fields.name.value.replace(/\s+/g, ' ').trim(),
      email: fields.email.value.trim(),
      phone: fields.phone.value.replace(/\s+/g, ' ').trim(),
      website: fields.website.value.trim(),
      problem: fields.problem.value.trim().slice(0, 1000)
    };
  }

  var FIELD_KEYS = ['name', 'email', 'phone', 'website', 'problem'];

  function isValid(k, v) {
    switch (k) {
      case 'name': return NAME_RE.test(v.name);
      case 'email': return EMAIL_RE.test(v.email);
      case 'phone':
        var digits = v.phone.replace(/\D/g, '');
        return PHONE_RE.test(v.phone) && digits.length >= 7 && digits.length <= 15;
      case 'website': return !v.website || WEBSITE_RE.test(v.website);
      case 'problem': return (v.problem.match(/https?:\/\/|www\./gi) || []).length <= 2;
    }
    return true;
  }

  function validate(v) {
    var bad = FIELD_KEYS.filter(function (k) { return !isValid(k, v); });
    FIELD_KEYS.forEach(function (k) { showError(k, bad.indexOf(k) !== -1); });
    return bad;
  }

  // Once a field shows an error, clear it as soon as the person fixes it while typing.
  // (Not on blur: removing the message on blur shifts the button just as they click it.)
  FIELD_KEYS.forEach(function (k) {
    fields[k].addEventListener('input', function () {
      if (fields[k].getAttribute('aria-invalid') === 'true' && isValid(k, values())) showError(k, false);
    });
  });

  function setBusy(busy) {
    submitting = busy;
    button.disabled = busy;
    button.classList.toggle('opacity-70', busy);
    buttonLabel.textContent = busy ? 'Sending…' : 'Get my free audit';
  }

  function showSuccess(name) {
    document.getElementById('lead-form-wrap').hidden = true;
    var ok = document.getElementById('lead-success');
    ok.hidden = false;
    var first = name.split(' ')[0];
    document.getElementById('success-name').textContent = first ? ', ' + first : '';
    ok.focus();
    ok.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    if (submitting) return;
    statusEl.textContent = '';

    var v = values();
    var bad = validate(v);
    if (bad.length) { fields[bad[0]].focus(); return; }

    if (!cfg.endpoint) {
      statusEl.textContent = 'The form is not connected yet. Please try again later.';
      console.warn('CP_LP.endpoint is empty: add your Apps Script URL in the page settings.');
      return;
    }
    if (cfg.turnstileSiteKey && !turnstileToken) {
      statusEl.textContent = 'Please wait a moment for the security check, then try again.';
      return;
    }

    var payload = {
      name: v.name,
      email: v.email,
      phone: v.phone,
      website: v.website,
      problem: v.problem,
      company_fax: form.company_fax.value,
      elapsed_ms: Date.now() - startedAt,
      turnstile_token: turnstileToken
    };
    Object.keys(tracking).forEach(function (k) { payload[k] = tracking[k]; });

    setBusy(true);
    var controller = window.AbortController ? new AbortController() : null;
    var timer = setTimeout(function () { if (controller) controller.abort(); }, 15000);

    // text/plain avoids a CORS preflight, which Apps Script doesn't support
    fetch(cfg.endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(payload),
      signal: controller ? controller.signal : undefined
    })
      .then(function (r) { return r.json(); })
      .then(function (res) {
        clearTimeout(timer);
        if (res && res.ok) {
          try { if (window.fbq) window.fbq('track', 'Lead', { content_name: 'free_google_ads_audit' }); } catch (err) {}
          track('generate_lead', { method: 'lp_audit_form' });
          showSuccess(v.name);
          return;
        }
        setBusy(false);
        if (res && res.error === 'invalid' && res.fields) {
          res.fields.forEach(function (k) { if (fields[k]) showError(k, true); });
          statusEl.textContent = 'Please check the highlighted fields.';
        } else if (res && res.error === 'rate_limited') {
          statusEl.textContent = 'We are receiving a lot of requests right now. Please try again in a minute.';
        } else {
          statusEl.textContent = 'Something went wrong. Please try again.';
        }
        if (window.turnstile && cfg.turnstileSiteKey) { window.turnstile.reset(); turnstileToken = ''; }
      })
      .catch(function () {
        clearTimeout(timer);
        setBusy(false);
        statusEl.textContent = 'Connection problem. Please check your internet and try again.';
      });
  });

  // ---- Logo click (tracked, so you can see how many leave the page this way)
  var logo = document.querySelector('[data-lp-logo]');
  if (logo) logo.addEventListener('click', function () { track('lp_logo_click'); });

  // ---- After submitting: optional inline calendar (no page change)
  var calBtn = document.getElementById('show-calendar');
  if (calBtn) {
    calBtn.addEventListener('click', function () {
      var slot = document.getElementById('calendar-slot');
      if (slot.firstChild) return;
      var f = document.createElement('iframe');
      f.title = 'Choose a time for your free Google Ads audit call';
      f.src = 'https://calendly.com/info-campaignpro/45min?embed_domain=www.campaignpro.click&embed_type=Inline&hide_gdpr_banner=1';
      f.width = '100%';
      f.height = '680';
      f.style.border = '0';
      f.style.display = 'block';
      slot.appendChild(f);
      calBtn.hidden = true;
      track('lp_calendar_open');
    });
  }
})();

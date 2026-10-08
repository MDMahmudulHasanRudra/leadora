/* global document, location */
/*
 * Leadora embeddable lead form (spec §91). No dependencies, no cookies.
 *
 *   <div id="leadora-form"></div>
 *   <script src="https://your-crm.example/lead-form.js" data-form-key="lf_..." data-target="leadora-form" async></script>
 *
 * Optional: data-api="https://your-crm.example" when the script is served from elsewhere.
 */
(function () {
  'use strict';
  var script = document.currentScript;
  if (!script) return;
  var key = script.getAttribute('data-form-key');
  var api = (script.getAttribute('data-api') || new URL(script.src).origin).replace(/\/$/, '');
  var target = document.getElementById(script.getAttribute('data-target') || '') || script.parentNode;
  if (!key || !target) return;

  var LABELS = { fullName: 'Your name', email: 'Email', phone: 'Phone', companyName: 'Company', message: 'Message' };
  var CAPTCHA_SCRIPTS = {
    TURNSTILE: 'https://challenges.cloudflare.com/turnstile/v0/api.js',
    HCAPTCHA: 'https://js.hcaptcha.com/1/api.js',
  };

  function el(tag, attrs, text) {
    var node = document.createElement(tag);
    for (var k in attrs || {}) node.setAttribute(k, attrs[k]);
    if (text) node.textContent = text;
    return node;
  }

  function utm() {
    var params = new URLSearchParams(location.search);
    var out = {};
    ['source', 'medium', 'campaign', 'term', 'content'].forEach(function (k) {
      var v = params.get('utm_' + k);
      if (v) out[k] = v.slice(0, 200);
    });
    return Object.keys(out).length ? out : undefined;
  }

  function render(config) {
    var form = el('form', { class: 'leadora-form', novalidate: '' });
    form.style.cssText = 'display:grid;gap:10px;max-width:420px;font:14px/1.4 system-ui,sans-serif';
    if (config.title) form.appendChild(el('h3', { style: 'margin:0 0 4px;font-size:18px' }, config.title));

    function field(name, type, required) {
      var id = 'leadora-' + name;
      var wrap = el('label', { for: id, style: 'display:grid;gap:4px' }, LABELS[name] + (required ? ' *' : ''));
      var input = type === 'textarea' ? el('textarea', { id: id, name: name, rows: '4' }) : el('input', { id: id, name: name, type: type });
      if (required) input.required = true;
      input.style.cssText = 'padding:8px 10px;border:1px solid #cbd5e1;border-radius:6px;font:inherit';
      wrap.appendChild(input);
      form.appendChild(wrap);
    }

    field('fullName', 'text', true);
    if (config.fields.email !== 'hidden') field('email', 'email', config.fields.email === 'required');
    if (config.fields.phone !== 'hidden') field('phone', 'tel', config.fields.phone === 'required');
    if (config.fields.companyName !== 'hidden') field('companyName', 'text', false);
    if (config.fields.message !== 'hidden') field('message', 'textarea', false);

    // Honeypot: off-screen and skipped by keyboard and screen readers; bots fill it in.
    var trap = el('input', { name: 'website', type: 'text', tabindex: '-1', autocomplete: 'off', 'aria-hidden': 'true' });
    trap.style.cssText = 'position:absolute;left:-10000px;width:1px;height:1px;opacity:0';
    form.appendChild(trap);

    if (config.captcha) {
      var captchaBox = el('div', { class: config.captcha.provider === 'TURNSTILE' ? 'cf-turnstile' : 'h-captcha', 'data-sitekey': config.captcha.siteKey });
      form.appendChild(captchaBox);
      var s = el('script', { src: CAPTCHA_SCRIPTS[config.captcha.provider], async: '', defer: '' });
      document.head.appendChild(s);
    }

    var status = el('p', { role: 'status', 'aria-live': 'polite', style: 'margin:0;min-height:1em' });
    var button = el('button', { type: 'submit' }, 'Send');
    button.style.cssText = 'padding:10px 14px;border:0;border-radius:6px;background:#2563eb;color:#fff;font:inherit;cursor:pointer';
    form.appendChild(button);
    form.appendChild(status);

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      if (!form.reportValidity()) return;
      var data = new FormData(form);
      var body = { pageUrl: location.href, utm: utm() };
      data.forEach(function (v, k) {
        if (k === 'cf-turnstile-response' || k === 'h-captcha-response') body.captchaToken = String(v);
        else body[k] = String(v);
      });
      button.disabled = true;
      status.textContent = 'Sending…';
      fetch(api + '/api/v1/public/forms/' + encodeURIComponent(key) + '/submissions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
        credentials: 'omit',
      })
        .then(function (res) {
          return res.json().then(function (json) {
            if (!res.ok) throw new Error((json && json.error && json.error.message) || 'Something went wrong');
            return json;
          });
        })
        .then(function (json) {
          form.replaceChildren(el('p', { role: 'status', style: 'margin:0' }, json.message));
        })
        .catch(function (err) {
          status.textContent = err.message;
          button.disabled = false;
        });
    });
    target.appendChild(form);
  }

  fetch(api + '/api/v1/public/forms/' + encodeURIComponent(key), { credentials: 'omit' })
    .then(function (res) {
      if (!res.ok) throw new Error('form unavailable');
      return res.json();
    })
    .then(render)
    .catch(function () {
      /* Fail quietly: never break the host page. */
    });
})();

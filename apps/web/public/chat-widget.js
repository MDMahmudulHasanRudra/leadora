/* global document */
/*
 * Leadora website chat widget. No dependencies, no cookies.
 *
 *   <script src="https://your-crm.example/chat-widget.js" data-widget-key="wc_..." async></script>
 *
 * Optional: data-api="https://your-crm.example" when the script is served from elsewhere,
 *           data-color="#2563eb" for the button colour.
 */
(function () {
  'use strict';
  var script = document.currentScript;
  if (!script) return;
  var key = script.getAttribute('data-widget-key');
  if (!key) return;
  var api = (script.getAttribute('data-api') || new URL(script.src).origin).replace(/\/$/, '');
  var color = script.getAttribute('data-color') || '#2563eb';
  var storeKey = 'leadora-chat:' + key;
  var base = api + '/api/v1/public/chat/' + encodeURIComponent(key);
  var token = null;
  var lastSeq = 0;
  var timer = null;
  var shown = {};

  try {
    token = localStorage.getItem(storeKey);
  } catch {
    token = null;
  }

  function el(tag, style, text) {
    var n = document.createElement(tag);
    if (style) n.style.cssText = style;
    if (text) n.textContent = text;
    return n;
  }

  function request(method, path, body) {
    var headers = { 'content-type': 'application/json' };
    if (token) headers['x-chat-token'] = token;
    return fetch(base + path, { method: method, headers: headers, body: body ? JSON.stringify(body) : undefined, credentials: 'omit' }).then(function (res) {
      return res.json().then(function (json) {
        if (!res.ok) {
          var err = new Error((json && json.error && json.error.message) || 'Something went wrong');
          err.status = res.status;
          throw err;
        }
        return json;
      });
    });
  }

  var font = 'font:14px/1.4 system-ui,sans-serif;';
  var button = el('button', 'position:fixed;right:20px;bottom:20px;z-index:2147483000;width:56px;height:56px;border-radius:50%;border:0;cursor:pointer;color:#fff;font-size:24px;box-shadow:0 4px 14px rgba(0,0,0,.2);background:' + color, '💬');
  button.setAttribute('aria-label', 'Open chat');
  var panel = el('div', 'position:fixed;right:20px;bottom:88px;z-index:2147483000;width:340px;max-width:calc(100vw - 40px);height:460px;max-height:calc(100vh - 120px);display:none;flex-direction:column;background:#fff;color:#111;border-radius:12px;box-shadow:0 8px 30px rgba(0,0,0,.25);overflow:hidden;' + font);
  panel.setAttribute('role', 'dialog');
  var header = el('div', 'padding:12px 14px;color:#fff;font-weight:600;background:' + color, 'Chat');
  var body = el('div', 'flex:1;overflow-y:auto;padding:12px;display:flex;flex-direction:column;gap:8px');
  var footer = el('form', 'display:flex;gap:6px;padding:10px;border-top:1px solid #e5e7eb');
  panel.appendChild(header);
  panel.appendChild(body);
  panel.appendChild(footer);
  document.body.appendChild(panel);
  document.body.appendChild(button);

  function bubble(m) {
    if (shown[m.id]) return;
    shown[m.id] = true;
    var mine = m.from === 'you';
    var b = el('div', 'max-width:80%;padding:8px 10px;border-radius:10px;white-space:pre-wrap;word-wrap:break-word;' + (mine ? 'align-self:flex-end;color:#fff;background:' + color : 'align-self:flex-start;background:#f1f5f9'), m.text);
    body.appendChild(b);
    body.scrollTop = body.scrollHeight;
    if (m.seq > lastSeq) lastSeq = m.seq;
  }

  function note(text) {
    body.appendChild(el('p', 'margin:0;color:#64748b;font-size:13px', text));
  }

  function poll() {
    request('GET', '/messages?after=' + lastSeq)
      .then(function (res) {
        res.items.forEach(bubble);
      })
      .catch(function (err) {
        if (err.status === 401) reset();
      });
  }

  function reset() {
    token = null;
    try {
      localStorage.removeItem(storeKey);
    } catch {
      /* storage blocked */
    }
    if (timer) clearInterval(timer);
    timer = null;
    showStart();
  }

  function input(name, placeholder, type) {
    var i = el('input', 'flex:1;min-width:0;padding:8px 10px;border:1px solid #cbd5e1;border-radius:6px;' + font);
    i.name = name;
    i.placeholder = placeholder;
    i.type = type || 'text';
    return i;
  }

  function sendButton(label) {
    return el('button', 'padding:8px 12px;border:0;border-radius:6px;color:#fff;cursor:pointer;' + font + 'background:' + color, label);
  }

  function showChat() {
    footer.replaceChildren();
    footer.style.flexDirection = 'row';
    var text = input('text', 'Type a message…');
    footer.appendChild(text);
    footer.appendChild(sendButton('Send'));
    footer.onsubmit = function (e) {
      e.preventDefault();
      var value = text.value.trim();
      if (!value) return;
      text.value = '';
      request('POST', '/messages', { text: value })
        .then(poll)
        .catch(function (err) {
          if (err.status === 401) reset();
          else note(err.message);
        });
    };
    poll();
    if (!timer) timer = setInterval(poll, 4000);
  }

  function showStart() {
    body.replaceChildren();
    footer.replaceChildren();
    footer.style.flexDirection = 'column';
    var name = input('name', 'Your name');
    var contact = input('email', 'Email (so we can reply later)', 'email');
    var message = input('message', 'How can we help?');
    var go = sendButton('Start chat');
    [name, contact, message, go].forEach(function (n) {
      footer.appendChild(n);
    });
    footer.onsubmit = function (e) {
      e.preventDefault();
      if (!name.value.trim() || !message.value.trim()) return;
      go.disabled = true;
      request('POST', '/sessions', { name: name.value, email: contact.value, message: message.value })
        .then(function (res) {
          token = res.token;
          try {
            localStorage.setItem(storeKey, token);
          } catch {
            /* storage blocked: the session lasts until the page closes */
          }
          body.replaceChildren();
          res.messages.forEach(bubble);
          showChat();
        })
        .catch(function (err) {
          note(err.message);
          go.disabled = false;
        });
    };
  }

  request('GET', '')
    .then(function (config) {
      header.textContent = config.title;
      if (token) showChat();
      else {
        showStart();
        note(config.greeting);
      }
    })
    .catch(function () {
      button.remove();
      panel.remove();
    });

  button.onclick = function () {
    var open = panel.style.display === 'flex';
    panel.style.display = open ? 'none' : 'flex';
    button.setAttribute('aria-label', open ? 'Open chat' : 'Close chat');
  };
})();

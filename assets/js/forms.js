(function () {
  const startedAt = Date.now();
  const MAX_FILE_BYTES = 4 * 1024 * 1024;
  const ALLOWED_EXT = ['pdf', 'jpg', 'jpeg', 'png'];

  function apiBase() {
    const meta = document.querySelector('meta[name="fci-api-base"]');
    const value = meta && meta.content ? meta.content.trim() : 'https://fcichs-forms.dubanicreatives.workers.dev';
    return value.replace(/\/$/, '');
  }

  function installHoneypot(form) {
    if (!form || form.querySelector('input[name="company_website"]')) return;
    const wrap = document.createElement('div');
    wrap.setAttribute('aria-hidden', 'true');
    wrap.style.cssText = 'position:absolute;left:-10000px;top:auto;width:1px;height:1px;overflow:hidden;';
    const input = document.createElement('input');
    input.type = 'text';
    input.name = 'company_website';
    input.tabIndex = -1;
    input.autocomplete = 'off';
    const label = document.createElement('label');
    label.textContent = 'Company website';
    label.appendChild(input);
    wrap.appendChild(label);
    form.appendChild(wrap);
  }

  function honeypotValue(form) {
    const field = form && form.querySelector('input[name="company_website"]');
    return field ? field.value : '';
  }

  function validateFile(file) {
    if (!file) return 'A required document is missing.';
    if (file.size > MAX_FILE_BYTES) return file.name + ' is larger than 4 MB.';
    const ext = (file.name.split('.').pop() || '').toLowerCase();
    if (!ALLOWED_EXT.includes(ext)) return file.name + ' must be a PDF, JPG, or PNG.';
    return '';
  }

  function fileToBase64(file) {
    return new Promise(function (resolve, reject) {
      const reader = new FileReader();
      reader.onload = function () {
        const result = String(reader.result || '');
        resolve(result.slice(result.indexOf(',') + 1));
      };
      reader.onerror = function () { reject(reader.error || new Error('Could not read the file.')); };
      reader.readAsDataURL(file);
    });
  }

  async function postJson(path, body) {
    let response;
    try {
      response = await fetch(apiBase() + path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body: JSON.stringify(body)
      });
    } catch (error) {
      throw new Error('We could not reach the FCI office mailbox. Please email the office using the address on this website.');
    }
    let data = {};
    try { data = await response.json(); } catch (error) { data = {}; }
    if (!response.ok || !data.ok) {
      const problem = new Error(data.error || 'We could not send that just now. Please try again or email the office.');
      problem.issues = Array.isArray(data.issues) ? data.issues : [];
      throw problem;
    }
    return data;
  }

  function showContactSuccess(name, email, refNo) {
    const popup = document.createElement('div');
    popup.style.cssText = 'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);background:#fff;border:1px solid rgba(2,59,60,0.15);border-radius:16px;padding:40px;box-shadow:0 24px 50px rgba(2,59,60,0.25);z-index:9999;max-width:420px;text-align:center;font-family:Inter,sans-serif;';
    const icon = document.createElement('div');
    icon.style.cssText = 'width:60px;height:60px;border-radius:9999px;background:rgba(105,153,54,0.15);color:#699936;display:flex;align-items:center;justify-content:center;margin:0 auto 24px;font-size:28px;';
    icon.textContent = '✓';
    const title = document.createElement('h3');
    title.style.cssText = "color:#0A2526;font-family:'Plus Jakarta Sans',sans-serif;margin:0 0 12px;font-weight:700;";
    title.textContent = 'Inquiry sent';
    const copy = document.createElement('p');
    copy.style.cssText = 'color:#4A6061;font-size:0.95rem;line-height:1.6;margin:0 0 24px;';
    copy.textContent = 'Thank you ' + name + '. Reference ' + (refNo || 'received') + '. A reply will be sent to ' + email + '.';
    const close = document.createElement('button');
    close.type = 'button';
    close.textContent = 'Close';
    close.style.cssText = "background:#023B3C;color:#fff;font-family:'Plus Jakarta Sans',sans-serif;font-weight:700;font-size:0.9rem;padding:12px 24px;border:none;border-radius:9999px;cursor:pointer;";
    popup.append(icon, title, copy, close);
    const dim = document.createElement('div');
    dim.style.cssText = 'position:fixed;inset:0;background:rgba(1,31,32,0.6);backdrop-filter:blur(5px);z-index:9998;';
    close.addEventListener('click', function () {
      dim.remove();
      popup.remove();
      const form = document.getElementById('contact-inquiry-form');
      if (form) form.reset();
    });
    document.body.append(dim, popup);
  }

  function bindNewsletter(form) {
    installHoneypot(form);
    form.addEventListener('submit', async function (event) {
      event.preventDefault();
      const input = form.querySelector('input[type="email"]');
      const button = form.querySelector('button[type="submit"]');
      const email = input ? input.value.trim() : '';
      if (!email || !button) return;
      const original = button.textContent;
      button.disabled = true;
      button.textContent = 'Sending…';
      try {
        await postJson('/api/newsletter', {
          email: email,
          formStartedAt: startedAt,
          company_website: honeypotValue(form)
        });
        if (input) input.value = '';
        button.textContent = 'Subscribed';
      } catch (error) {
        button.textContent = original || 'Subscribe';
        window.alert(error.message);
      } finally {
        button.disabled = false;
      }
    });
  }

  function bindContact(form) {
    installHoneypot(form);
    form.addEventListener('submit', async function (event) {
      event.preventDefault();
      const button = form.querySelector('button[type="submit"]');
      const name = document.getElementById('form-name').value.trim();
      const email = document.getElementById('form-email').value.trim();
      const phone = document.getElementById('form-phone').value.trim();
      const division = document.getElementById('form-inquiry-type').value;
      const message = document.getElementById('form-message').value.trim();
      if (button) button.disabled = true;
      try {
        const result = await postJson('/api/contact', {
          name: name,
          email: email,
          phone: phone,
          division: division,
          message: message,
          formStartedAt: startedAt,
          company_website: honeypotValue(form)
        });
        showContactSuccess(name, email, result.refNo);
      } catch (error) {
        window.alert(error.message);
      } finally {
        if (button) button.disabled = false;
      }
    });
  }

  document.querySelectorAll('#newsletter-subscription-form').forEach(bindNewsletter);
  const contact = document.getElementById('contact-inquiry-form');
  if (contact) bindContact(contact);
  const application = document.getElementById('online-application-form');
  if (application) installHoneypot(application);

  window.FCIForms = {
    startedAt: startedAt,
    apiBase: apiBase,
    postJson: postJson,
    validateFile: validateFile,
    fileToBase64: fileToBase64,
    honeypotValue: honeypotValue,
    installHoneypot: installHoneypot
  };
})();

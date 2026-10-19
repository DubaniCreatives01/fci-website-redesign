const CRLF = '\r\n';

/** Collapse control characters so a visitor cannot break out of a mail header. */
export function sanitizeHeader(value) {
  return String(value ?? '')
    .replace(/[\u0000-\u001F\u007F\u2028\u2029]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function encodeHeader(value) {
  const text = sanitizeHeader(value);
  if (/^[\x20-\x7e]*$/.test(text)) return text;
  const bytes = new TextEncoder().encode(text);
  return `=?UTF-8?B?${bytesToBase64(bytes)}?=`;
}

export function formatAddress(name, email) {
  const cleanEmail = sanitizeHeader(email).replace(/\s/g, '');
  const cleanName = sanitizeHeader(name).replace(/["\\<>]/g, '');
  if (!cleanName) return cleanEmail;
  return `${encodeHeader(`"${cleanName}"`)} <${cleanEmail}>`;
}

export function wrapBase64(input) {
  const clean = String(input || '').replace(/\s/g, '');
  const lines = [];
  for (let i = 0; i < clean.length; i += 76) {
    lines.push(clean.slice(i, i + 76));
  }
  return lines.join(CRLF);
}

export function dotStuff(raw) {
  const normalised = String(raw).replace(/\r\n/g, '\n').replace(/\r/g, '\n').replace(/\n/g, CRLF);
  const lines = normalised.split(CRLF);
  const stuffed = lines.map((line) => (line.startsWith('.') ? `.${line}` : line)).join(CRLF);
  return stuffed.endsWith(CRLF) ? stuffed : `${stuffed}${CRLF}`;
}

export function buildRawMessage({ fromName, fromEmail, to, replyTo, subject, html, attachments, messageIdDomain }) {
  const boundary = `fci_${crypto.randomUUID().replace(/-/g, '')}`;
  const domain = messageIdDomain || fromEmail.split('@')[1] || 'fcichs.co.za';
  const headers = [
    `From: ${formatAddress(fromName, fromEmail)}`,
    `To: ${to.map((email) => formatAddress('', email)).join(', ')}`,
    replyTo ? `Reply-To: ${formatAddress(replyTo.name, replyTo.email)}` : '',
    `Subject: ${encodeHeader(subject)}`,
    'MIME-Version: 1.0',
    `Date: ${formatSmtpDate(new Date())}`,
    `Message-ID: <${crypto.randomUUID()}@${domain}>`,
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
  ].filter(Boolean);

  const chunks = [`--${boundary}`, htmlPart(html)];
  for (const file of attachments || []) {
    chunks.push(`--${boundary}`, attachmentPart(file));
  }
  chunks.push(`--${boundary}--`, '');
  return `${headers.join(CRLF)}${CRLF}${CRLF}${chunks.join(CRLF)}`;
}

function htmlPart(html) {
  const encoded = wrapBase64(bytesToBase64(new TextEncoder().encode(String(html))));
  return [
    'Content-Type: text/html; charset="UTF-8"',
    'Content-Transfer-Encoding: base64',
    '',
    encoded,
  ].join(CRLF);
}

function attachmentPart(file) {
  const filename = String(file.filename || 'document.bin').replace(/["\r\n]/g, '');
  return [
    `Content-Type: ${file.contentType}; name="${filename}"`,
    'Content-Transfer-Encoding: base64',
    `Content-Disposition: attachment; filename="${filename}"`,
    '',
    wrapBase64(file.base64),
  ].join(CRLF);
}

function formatSmtpDate(date) {
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const pad = (n) => String(n).padStart(2, '0');
  return `${days[date.getUTCDay()]}, ${pad(date.getUTCDate())} ${months[date.getUTCMonth()]} ${date.getUTCFullYear()} ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())} +0000`;
}

export function bytesToBase64(bytes) {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[char]));
}

import { escapeHtml, sanitizeHeader } from './mime.js';

const MAX_BODY_BYTES = 22 * 1024 * 1024;
const MAX_FILE_BYTES = 4 * 1024 * 1024;
const MAX_TOTAL_BYTES = 16 * 1024 * 1024;
const MAX_FILES = 5;
const MIN_FILL_MS = 3000;
const MAX_AGE_MS = 24 * 60 * 60 * 1000;
const EMAIL_RE = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;
const HOST_RE = /^(?=.{1,253}$)(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+[A-Za-z]{2,}$/;
const REF_RE = /^FCI-APP-[A-Za-z0-9-]{4,40}$/;
const GMAIL_HOST = 'smtp.gmail.com';
const GMAIL_MAILBOX = 'fcicommunityhousing@gmail.com';

const buckets = new Map();

const FILE_TYPES = {
  pdf: { mime: 'application/pdf', sniff: (b) => b.length >= 5 && b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46 && b[4] === 0x2d },
  jpg: { mime: 'image/jpeg', sniff: (b) => b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  jpeg: { mime: 'image/jpeg', sniff: (b) => b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  png: { mime: 'image/png', sniff: (b) => b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a },
};

export default {
  async fetch(request, env, ctx) {
    return handleRequest(request, env, ctx);
  },
};

export async function handleRequest(request, env, ctx, deps = {}) {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/$/, '') || '/';
  const { ok: originOk, origin } = checkOrigin(request, env);

  if (request.method === 'OPTIONS') {
    if (!originOk) return json(403, { ok: false, error: 'Origin is not allowed.' }, null);
    return new Response(null, { status: 204, headers: corsHeaders(origin) });
  }

  if (request.method === 'GET' && (path === '/api/health' || path === '/health')) {
    const smtp = smtpConfig(env);
    return json(200, {
      ok: true,
      service: 'fcichs-forms',
      smtpConfigured: Boolean(smtp),
    }, originOk ? origin : null);
  }

  if (request.method !== 'POST') {
    return json(405, { ok: false, error: 'Method not allowed.' }, originOk ? origin : null);
  }
  if (!originOk) return json(403, { ok: false, error: 'Origin is not allowed.' }, null);

  const route = routeFor(path);
  if (!route) return json(404, { ok: false, error: 'Not found.' }, origin);

  const deliver = deps.deliver || defaultDeliver;
  try {
    const payload = await readJson(request);
    if (payload.company_website) return json(200, { ok: true }, origin);
    const started = assertTiming(payload.formStartedAt);
    if (started) return json(400, { ok: false, error: started }, origin);
    if (tooMany(request, route)) {
      return json(429, { ok: false, error: 'Too many submissions. Please wait a few minutes and try again.' }, origin);
    }

    if (route === 'apply') return await handleApply(payload, env, deliver, origin);
    if (route === 'contact') return await handleContact(payload, env, deliver, origin);
    return await handleNewsletter(payload, env, deliver, origin);
  } catch (error) {
    const status = error.status || 500;
    if (status >= 500) {
      console.log(JSON.stringify({ event: 'form_error', route, status, code: error.code || null }));
    }
    return json(status, { ok: false, error: error.publicMessage || 'We could not send that just now. Please try again or email the office.' }, origin);
  }
}

async function handleApply(payload, env, deliver, origin) {
  const smtp = requireSmtp(env);
  const recipients = recipientsFor(env, ['APPLICATION_TO_EMAILS']);
  const applicant = payload.applicant;
  if (!applicant || typeof applicant !== 'object') fail(400, 'Application details are missing.');
  const name = cleanText(applicant.name, 120, 'Full name');
  const email = cleanEmail(applicant.email);
  const phone = cleanText(applicant.phone, 30, 'Phone number');
  const idNumber = cleanText(applicant.idNumber, 20, 'Identity number');
  const refNo = String(payload.refNo || '');
  if (!REF_RE.test(refNo)) fail(400, 'Application reference is invalid.');

  const fields = {
    name,
    email,
    idNumber,
    phone,
    citizenship: cleanText(applicant.citizenship, 80, 'Citizenship'),
    marital: cleanText(applicant.marital, 80, 'Marital status'),
    dependents: cleanText(applicant.dependents ?? '0', 10, 'Dependents'),
    address: cleanText(applicant.address, 500, 'Address'),
    project: cleanText(applicant.project, 120, 'Project'),
    unit: cleanText(applicant.unit, 80, 'Unit type'),
    eligibilityStatus: cleanText(applicant.eligibilityStatus || 'Not specified', 80, 'Eligibility'),
    employment: cleanText(applicant.employment, 80, 'Employment'),
    employer: cleanText(applicant.employer, 160, 'Employer'),
    gross: cleanMoney(applicant.gross),
    net: cleanMoney(applicant.net),
    coName: cleanOptional(applicant.coName, 120),
    coIncome: cleanMoney(applicant.coIncome || 0),
    combinedIncome: cleanOptional(applicant.combinedIncome, 40),
  };
  const attachments = normaliseAttachments(payload.attachments, true);
  const rows = [
    ['Reference', refNo],
    ['Applicant', fields.name],
    ['Email', fields.email],
    ['Phone', fields.phone],
    ['Identity number', fields.idNumber],
    ['Citizenship', fields.citizenship],
    ['Marital status', fields.marital],
    ['Dependents', fields.dependents],
    ['Address', fields.address],
    ['Project', fields.project],
    ['Unit', fields.unit],
    ['Eligibility', fields.eligibilityStatus],
    ['Employment', fields.employment],
    ['Employer', fields.employer],
    ['Gross income', fields.gross],
    ['Net income', fields.net],
    ['Co-applicant', fields.coName || '—'],
    ['Co-applicant income', fields.coIncome],
    ['Combined income', fields.combinedIncome || '—'],
  ];
  await deliver(env, {
    smtp,
    to: recipients,
    replyTo: { name: viaWebsite(fields.name), email: fields.email },
    subject: subjectLine('Application', refNo, fields.name),
    html: renderEmail('New housing application', rows, 'Documents supplied by the applicant are attached. The message is sent from the FCI mailbox. Reply goes to the applicant.'),
    attachments,
  });
  return json(200, { ok: true, refNo }, origin);
}

async function handleContact(payload, env, deliver, origin) {
  const smtp = requireSmtp(env);
  const division = String(payload.division || '');
  const allowed = {
    applications: 'Housing Applications',
    partnerships: 'Municipal Partnerships',
    general: 'General Office',
  };
  if (!allowed[division]) fail(400, 'Choose an inquiry division.');
  const recipients = recipientsFor(env, division === 'partnerships'
    ? ['PARTNERSHIP_TO_EMAILS', 'CONTACT_TO_EMAILS']
    : ['CONTACT_TO_EMAILS']);
  const name = cleanText(payload.name, 120, 'Full name');
  const email = cleanEmail(payload.email);
  const phone = cleanText(payload.phone, 30, 'Phone number');
  const message = cleanText(payload.message, 5000, 'Message');
  const refNo = enquiryRef();
  await deliver(env, {
    smtp,
    to: recipients,
    replyTo: { name: viaWebsite(name), email },
    subject: subjectLine('Enquiry', refNo, name),
    html: renderEmail('Website inquiry', [
      ['Reference', refNo],
      ['Name', name],
      ['Email', email],
      ['Phone', phone],
      ['Division', allowed[division]],
      ['Message', message],
    ], 'Sent from the contact form on fcichs.co.za. The message is sent from the FCI mailbox. Reply goes to the person who wrote in.'),
    attachments: [],
  });
  return json(200, { ok: true, refNo }, origin);
}

async function handleNewsletter(payload, env, deliver, origin) {
  const smtp = requireSmtp(env);
  const recipients = recipientsFor(env, ['NEWSLETTER_TO_EMAILS', 'CONTACT_TO_EMAILS']);
  const email = cleanEmail(payload.email);
  await deliver(env, {
    smtp,
    to: recipients,
    replyTo: { name: viaWebsite('Newsletter subscriber'), email },
    subject: sanitizeHeader(`Newsletter signup - ${email}`),
    html: renderEmail('Tenant newsletter signup', [
      ['Email', email],
      ['Received', new Date().toISOString()],
    ], 'Add this address to the quarterly newsletter list. The signup was not sent to a third-party mailing provider.'),
    attachments: [],
  });
  return json(200, { ok: true }, origin);
}

async function defaultDeliver(env, mail) {
  const { sendSmtpMail } = await import('./smtp.js');
  await sendSmtpMail(env, mail);
}

function renderEmail(title, rows, note) {
  const body = rows.map(([label, value]) => (
    `<tr><th align="left" style="padding:8px 12px;border-bottom:1px solid #EBEFEF;color:#023B3C;font-family:Arial,sans-serif;font-size:14px;vertical-align:top;">${escapeHtml(label)}</th><td style="padding:8px 12px;border-bottom:1px solid #EBEFEF;color:#0A2526;font-family:Arial,sans-serif;font-size:14px;">${escapeHtml(value).replace(/\n/g, '<br>')}</td></tr>`
  )).join('');
  return `<!DOCTYPE html><html><body style="margin:0;background:#F4F7F6;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px;"><table role="presentation" width="640" cellpadding="0" cellspacing="0" style="max-width:640px;background:#ffffff;border-top:4px solid #FF9E00;"><tr><td style="background:#023B3C;color:#ffffff;padding:20px 24px;font-family:Arial,sans-serif;font-size:18px;font-weight:bold;">FCI Community Housing Services</td></tr><tr><td style="padding:20px 24px;font-family:Arial,sans-serif;color:#0A2526;"><h1 style="font-size:20px;margin:0 0 12px;">${escapeHtml(title)}</h1><table role="presentation" width="100%" cellpadding="0" cellspacing="0">${body}</table><p style="color:#4A6061;font-size:13px;line-height:1.5;">${escapeHtml(note)}</p></td></tr></table></td></tr></table></body></html>`;
}

function normaliseAttachments(input, required) {
  if (!Array.isArray(input) || (required && input.length === 0)) fail(400, 'Required documents are missing.');
  if (input.length > MAX_FILES) fail(400, 'Too many files were attached.');
  let total = 0;
  const roles = new Set();
  const files = input.map((file) => {
    if (!file || typeof file !== 'object') fail(400, 'A document could not be read.');
    const role = String(file.role || 'document');
    if (!/^[a-z-]{2,20}$/.test(role)) fail(400, 'A document could not be read.');
    if (roles.has(role)) fail(400, 'A document was sent twice.');
    roles.add(role);
    const filename = safeFilename(file.name, role);
    const ext = filename.split('.').pop().toLowerCase();
    const type = FILE_TYPES[ext];
    if (!type) fail(400, `${filename} must be a PDF, JPG, or PNG.`);
    const bytes = decodeBase64(file.content);
    if (!bytes) fail(400, `${filename} could not be read.`);
    if (bytes.length > MAX_FILE_BYTES) fail(400, `${filename} is larger than 4 MB.`);
    if (!type.sniff(bytes)) fail(400, `${filename} is not a valid PDF, JPG, or PNG.`);
    total += bytes.length;
    if (total > MAX_TOTAL_BYTES) fail(400, 'The combined documents are larger than 16 MB.');
    return { filename, contentType: type.mime, base64: String(file.content).replace(/\s/g, '') };
  });
  if (required) {
    for (const role of ['id', 'statements', 'payslips', 'address']) {
      if (!roles.has(role)) fail(400, 'A required document is missing.');
    }
  }
  return files;
}

function smtpConfig(env) {
  const host = String(env.SMTP_HOST || GMAIL_HOST).trim().toLowerCase();
  const portRaw = String(env.SMTP_PORT ?? '').trim();
  const port = Number(portRaw || (host === GMAIL_HOST ? '465' : ''));
  const user = String(env.SMTP_USER || (host === GMAIL_HOST ? GMAIL_MAILBOX : '')).trim();
  const password = host === GMAIL_HOST
    ? String(env.SMTP_PASSWORD || '').replace(/ /g, '')
    : String(env.SMTP_PASSWORD || '');
  const from = String(env.SMTP_FROM_EMAIL || user).trim();
  const fromName = sanitizeHeader(env.SMTP_FROM_NAME || 'FCI Community Housing Services') || 'FCI Community Housing Services';
  if (![465, 587].includes(port) || !HOST_RE.test(host) || !EMAIL_RE.test(from) || !EMAIL_RE.test(user)) return null;
  if (!password || /[\r\n]/.test(user) || /[\r\n]/.test(password)) return null;
  // Gmail rejects or rewrites a From address that is not the authenticated mailbox.
  if (host === GMAIL_HOST && from.toLowerCase() !== user.toLowerCase()) return null;
  return { port, host, user, password, from, fromName };
}

function requireSmtp(env) {
  const smtp = smtpConfig(env);
  if (!smtp) {
    fail(503, 'The office mailbox is not configured yet. Please email the office using the address on the contact page.');
  }
  return smtp;
}

function recipientsFor(env, names) {
  for (const name of names) {
    const raw = String(env[name] || '').trim();
    if (!raw) continue;
    return requireList(raw, name);
  }
  return [GMAIL_MAILBOX];
}

function requireList(value, name) {
  const list = String(value || '').split(',').map((item) => item.trim()).filter(Boolean);
  if (list.length === 0 || list.length > 10 || list.some((email) => !EMAIL_RE.test(email))) {
    console.log(JSON.stringify({ event: 'recipient_config', name, valid: false }));
    fail(503, 'The office mailbox is not configured yet. Please email the office using the address on the contact page.');
  }
  return list;
}

function checkOrigin(request, env) {
  const origin = request.headers.get('Origin');
  if (!origin) return { ok: true, origin: null };
  const allowed = String(env.ALLOWED_ORIGINS || 'https://fcichs.co.za,https://www.fcichs.co.za')
    .split(',').map((item) => item.trim()).filter(Boolean);
  if (allowed.includes(origin)) return { ok: true, origin };
  if (env.ALLOW_LOCAL_ORIGINS === 'true' && /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) {
    return { ok: true, origin };
  }
  return { ok: false, origin };
}

function routeFor(path) {
  if (path === '/api/apply' || path === '/apply') return 'apply';
  if (path === '/api/contact' || path === '/contact') return 'contact';
  if (path === '/api/newsletter' || path === '/newsletter') return 'newsletter';
  return '';
}

async function readJson(request) {
  const length = Number(request.headers.get('content-length') || 0);
  if (length > MAX_BODY_BYTES) fail(413, 'The upload is too large.');
  const buffer = await request.arrayBuffer();
  if (buffer.byteLength > MAX_BODY_BYTES) fail(413, 'The upload is too large.');
  try {
    return JSON.parse(new TextDecoder().decode(buffer));
  } catch {
    fail(400, 'The form could not be read.');
  }
}

function assertTiming(value) {
  const started = Number(value);
  if (!Number.isFinite(started)) return 'The form could not be verified. Please reload the page and try again.';
  const age = Date.now() - started;
  if (age < MIN_FILL_MS) return 'Please wait a moment and submit the form again.';
  if (age > MAX_AGE_MS) return 'This form has been open too long. Please reload the page and try again.';
  return '';
}

function tooMany(request, route) {
  const ip = request.headers.get('CF-Connecting-IP') || request.headers.get('x-forwarded-for') || 'local';
  const key = `${route}:${ip}`;
  const now = Date.now();
  const windowMs = route === 'newsletter' ? 60 * 60 * 1000 : 10 * 60 * 1000;
  const limit = route === 'apply' ? 5 : 8;
  const recent = (buckets.get(key) || []).filter((stamp) => now - stamp < windowMs);
  if (recent.length >= limit) {
    buckets.set(key, recent);
    return true;
  }
  recent.push(now);
  buckets.set(key, recent);
  if (buckets.size > 5000) {
    const oldest = buckets.keys().next().value;
    buckets.delete(oldest);
  }
  return false;
}

function viaWebsite(name) {
  return `${sanitizeHeader(name)} via FCI Website`;
}

function subjectLine(label, refNo, name) {
  return sanitizeHeader(`${label} ${refNo} - ${name}`);
}

function enquiryRef() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  let token = '';
  for (const byte of bytes) token += alphabet[byte % alphabet.length];
  return `FCI-ENQ-${token}`;
}

function cleanText(value, max, label) {
  const text = sanitizeHeader(value);
  if (!text) fail(400, `${label} is required.`);
  if (text.length > max) fail(400, `${label} is too long.`);
  return text;
}

function cleanOptional(value, max) {
  return sanitizeHeader(value).slice(0, max);
}

function cleanEmail(value) {
  const email = sanitizeHeader(value).replace(/\s/g, '');
  if (!EMAIL_RE.test(email) || email.length > 254) fail(400, 'Enter a valid email address.');
  return email;
}

function cleanMoney(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount < 0 || amount > 10000000) fail(400, 'Enter a valid income amount.');
  return amount.toFixed(2);
}

function safeFilename(name, role) {
  const base = String(name || role).split(/[/\\]/).pop().replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 80);
  const ext = (base.split('.').pop() || '').toLowerCase();
  if (!FILE_TYPES[ext]) return `${role}.pdf`;
  return base || `${role}.${ext}`;
}

function decodeBase64(value) {
  const clean = String(value || '').replace(/\s/g, '');
  if (!clean || clean.length % 4 === 1 || !/^[A-Za-z0-9+/]+={0,2}$/.test(clean)) return null;
  try {
    const binary = atob(clean);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return bytes;
  } catch {
    return null;
  }
}

function fail(status, publicMessage) {
  throw Object.assign(new Error(publicMessage), { status, publicMessage });
}

function corsHeaders(origin) {
  const headers = {
    'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Accept',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
  if (origin) headers['Access-Control-Allow-Origin'] = origin;
  return headers;
}

function json(status, body, origin) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      ...corsHeaders(origin),
    },
  });
}

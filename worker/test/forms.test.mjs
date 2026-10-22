import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { handleRequest } from '../src/index.js';
import { buildRawMessage, dotStuff, sanitizeHeader } from '../src/mime.js';
import { transact } from '../src/smtp.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const env = {
  SMTP_HOST: 'smtp.example.com',
  SMTP_PORT: '587',
  SMTP_USER: 'mailbox@fcichs.co.za',
  SMTP_PASSWORD: 'test-password',
  SMTP_FROM_EMAIL: 'mailbox@fcichs.co.za',
  SMTP_FROM_NAME: 'FCI Community Housing Services',
  APPLICATION_TO_EMAILS: 'applications@fcichs.co.za,info@fcichs.co.za',
  CONTACT_TO_EMAILS: 'info@fcichs.co.za',
  PARTNERSHIP_TO_EMAILS: 'development@fcichs.co.za',
  NEWSLETTER_TO_EMAILS: 'news@fcichs.co.za',
  ALLOWED_ORIGINS: 'https://fcichs.co.za',
  AI: {
    async toMarkdown(files) {
      return files.map((file) => ({
        name: file.name,
        format: 'text',
        data: file.name.startsWith('id')
          ? 'FCI Community Housing Services\nJane Applicant Bcc evil example com\n8001015009087\nSouth African Identity Document'
          : 'Statement / Payslip\n01/07/2026 31/07/2026\n01/08/2026 31/08/2026\n01/09/2026 30/09/2026\nGross salary Net salary',
      }));
    },
  },
};

function request(path, body, headers = {}) {
  return new Request(`https://fcichs-forms.dubanicreatives.workers.dev${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Origin: 'https://fcichs.co.za',
      'x-forwarded-for': `203.0.113.${Math.floor(Math.random() * 200) + 1}`,
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

function started() {
  return Date.now() - 10000;
}

function pdf(name = 'id.pdf') {
  return { name, content: Buffer.from('%PDF-1.4\ntrailer\n%%EOF').toString('base64'), role: 'id' };
}

function docs() {
  return ['id', 'statements', 'payslips', 'address', 'employment'].map((role) => ({
    ...pdf(`${role}.pdf`),
    role,
  }));
}

function applicant(overrides = {}) {
  return {
    name: 'Jane Applicant',
    email: 'jane.applicant@example.com',
    idNumber: '8001015009087',
    phone: '0820000000',
    citizenship: 'SA Citizen',
    marital: 'Single',
    dependents: '0',
    address: '1 Test Street, Cape Town',
    project: 'Goodwood Development',
    unit: '2 Bedroom Unit',
    eligibilityStatus: 'Qualifies',
    employment: 'Employed (Full-Time)',
    employer: 'Example Co',
    gross: 15000,
    net: 12000,
    coName: '',
    coIncome: 0,
    combinedIncome: 'R15 000.00',
    applicantAge: '35',
    affordabilitySurplus: '1500',
    homeownerStatus: 'no',
    creditPosition: 'favourable',
    employmentProof: 'permanent',
    privacyConsent: true,
    declarationAccepted: true,
    termsAccepted: true,
    ...overrides,
  };
}

async function captured(path, body, customEnv = env) {
  const sent = [];
  const effectiveEnv = customEnv === env ? env : { ...customEnv, AI: customEnv.AI || env.AI };
  const response = await handleRequest(request(path, body), effectiveEnv, {}, {
    deliver: async (_env, mail) => { sent.push(mail); },
  });
  const json = await response.json();
  return { response, json, sent };
}

test('application mail keeps the FCI mailbox as From and replies to the applicant', async () => {
  const { response, json, sent } = await captured('/api/apply', {
    formStartedAt: started(),
    company_website: '',
    refNo: 'FCI-APP-123456',
    applicant: applicant({ name: 'Jane\r\nBcc: evil@example.com' }),
    attachments: docs(),
  });
  assert.equal(response.status, 200);
  assert.equal(json.ok, true);
  assert.equal(sent.length, 1);
  const mail = sent[0];
  assert.equal(mail.smtp.from, 'mailbox@fcichs.co.za');
  assert.deepEqual(mail.to, ['applications@fcichs.co.za', 'info@fcichs.co.za']);
  assert.equal(mail.replyTo.email, 'jane.applicant@example.com');
  assert.equal(mail.replyTo.name, 'Jane Bcc: evil@example.com via FCI Website');
  assert.equal(mail.subject, 'Application FCI-APP-123456 - Jane Bcc: evil@example.com');
  assert.equal(mail.subject.includes('\n'), false);
  assert.equal(mail.attachments.length, 5);

  const raw = buildRawMessage({
    fromName: mail.smtp.fromName,
    fromEmail: mail.smtp.from,
    to: mail.to,
    replyTo: mail.replyTo,
    subject: mail.subject,
    html: mail.html,
    attachments: mail.attachments,
  });
  const header = raw.split('\r\n\r\n')[0];
  const lines = header.split('\r\n');
  assert.equal(lines.filter((line) => line.startsWith('From:')).length, 1);
  assert.equal(lines.filter((line) => line.startsWith('Reply-To:')).length, 1);
  assert.equal(lines.some((line) => /^bcc:/i.test(line)), false);
  assert.match(lines.find((line) => line.startsWith('From:')), /<mailbox@fcichs\.co\.za>$/);
  assert.match(lines.find((line) => line.startsWith('Reply-To:')), /"Jane Bcc: evil@example.com via FCI Website" <jane\.applicant@example\.com>$/);
  assert.equal(header.includes('evil@example.com') && header.includes('\nBcc'), false);
});

test('contact mail uses a reference and the applicant Reply-To', async () => {
  const { response, json, sent } = await captured('/api/contact', {
    formStartedAt: started(),
    company_website: '',
    name: 'Sam Writer',
    email: 'sam.writer@example.com',
    phone: '0210000000',
    division: 'partnerships',
    message: 'Hello\r\nBcc: evil@example.com',
  });
  assert.equal(response.status, 200);
  assert.match(json.refNo, /^FCI-ENQ-[A-Z2-9]{8}$/);
  assert.deepEqual(sent[0].to, ['development@fcichs.co.za']);
  assert.equal(sent[0].replyTo.email, 'sam.writer@example.com');
  assert.equal(sent[0].replyTo.name, 'Sam Writer via FCI Website');
  assert.equal(sent[0].subject, `Enquiry ${json.refNo} - Sam Writer`);
  assert.equal(sent[0].smtp.from, 'mailbox@fcichs.co.za');
  assert.match(sent[0].html, /Hello Bcc: evil@example.com/);
  assert.equal(sent[0].html.includes('\nBcc'), false);
});

test('newsletter notifies the office by the same mailbox and does not call Brevo', async () => {
  const calls = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (url) => {
    calls.push(String(url));
    throw new Error('network should not be used');
  };
  try {
    const { response, sent } = await captured('/api/newsletter', {
      formStartedAt: started(),
      company_website: '',
      email: 'reader@example.com',
    });
    assert.equal(response.status, 200);
    assert.deepEqual(sent[0].to, ['news@fcichs.co.za']);
    assert.equal(sent[0].replyTo.email, 'reader@example.com');
    assert.equal(calls.length, 0);
  } finally {
    globalThis.fetch = original;
  }
});

test('honeypot and incomplete uploads do not send mail', async () => {
  const honeypot = await captured('/api/apply', {
    formStartedAt: started(),
    company_website: 'http://spam.test',
    refNo: 'FCI-APP-123456',
    applicant: applicant(),
    attachments: docs(),
  });
  assert.equal(honeypot.json.ok, true);
  assert.equal(honeypot.sent.length, 0);

  const fast = await captured('/api/contact', {
    formStartedAt: Date.now(),
    name: 'Sam',
    email: 'sam@example.com',
    phone: '0210000000',
    division: 'general',
    message: 'Hello',
  });
  assert.equal(fast.response.status, 400);
  assert.equal(fast.sent.length, 0);

  const badFile = await captured('/api/apply', {
    formStartedAt: started(),
    refNo: 'FCI-APP-123456',
    applicant: applicant(),
    attachments: docs().map((file) => file.role === 'id'
      ? { ...file, name: 'id.exe', content: Buffer.from('MZ not a pdf').toString('base64') }
      : file),
  });
  assert.equal(badFile.response.status, 400);
  assert.equal(badFile.sent.length, 0);
});

test('an ID that does not match the uploaded document goes to manual review', async () => {
  const { response, json, sent } = await captured('/api/apply', {
    formStartedAt: started(),
    refNo: 'FCI-APP-123456',
    applicant: applicant({ idNumber: '8001015009088' }),
    attachments: docs(),
  });
  assert.equal(response.status, 202);
  assert.equal(json.ok, true);
  assert.equal(json.status, 'manual_review');
  assert.match(json.message, /staff will verify your documents/);
  assert.equal(sent.length, 1);
  assert.match(sent[0].subject, /^NEEDS MANUAL REVIEW - Application FCI-APP-123456 - /);
  assert.match(sent[0].html, /does not match the number entered on the form/);
  assert.equal(sent[0].attachments.length, 5);
});

test('statements and payslips without recent dates go to manual review', async () => {
  const staleEnv = {
    ...env,
    AI: {
      async toMarkdown(files) {
        return files.map((file) => ({
          name: file.name,
          format: 'text',
          data: file.name.startsWith('id')
            ? 'Jane Applicant 8001015009087 South African Identity Document'
            : '01/01/2025 31/01/2025 01/02/2025 28/02/2025',
        }));
      },
    },
  };
  const { response, sent, json } = await captured('/api/apply', {
    formStartedAt: started(),
    refNo: 'FCI-APP-123456',
    applicant: applicant(),
    attachments: docs(),
  }, staleEnv);
  assert.equal(response.status, 202);
  assert.equal(json.status, 'manual_review');
  assert.equal(sent.length, 1);
  assert.match(sent[0].subject, /^NEEDS MANUAL REVIEW/);
  assert.match(sent[0].html, /No recent bank-statement months/);
  assert.match(sent[0].html, /No recent payslip months/);
  assert.deepEqual(sent[0].to, ['applications@fcichs.co.za', 'info@fcichs.co.za']);
});

test('application routes borderline document extraction to manual review', async () => {
  const reviewEnv = {
    ...env,
    AI: {
      async toMarkdown(files) {
        return files.map((file) => ({
          name: file.name,
          format: 'text',
          data: file.name.startsWith('id')
            ? 'Jane 8001015009087 South African Identity Document'
            : '01/08/2026 31/08/2026 01/09/2026 30/09/2026',
        }));
      },
    },
  };
  const { response, json, sent } = await captured('/api/apply', {
    formStartedAt: started(),
    refNo: 'FCI-APP-123456',
    applicant: applicant(),
    attachments: docs(),
  }, reviewEnv);
  assert.equal(response.status, 202);
  assert.equal(json.status, 'manual_review');
  assert.equal(sent.length, 1);
  assert.match(sent[0].subject, /^NEEDS MANUAL REVIEW - Application/);
  assert.match(sent[0].html, /Checks not verified/);
  assert.match(sent[0].html, /partially matched/);
});

test('application requires server-side consent flags', async () => {
  const { response, sent, json } = await captured('/api/apply', {
    formStartedAt: started(),
    refNo: 'FCI-APP-123456',
    applicant: applicant({ privacyConsent: false }),
    attachments: docs(),
  });
  assert.equal(response.status, 400);
  assert.equal(sent.length, 0);
  assert.match(json.error, /Consent/);
  assert.ok(json.issues.includes('Consent to document extraction and personal-information processing is required.'));
});

test('unreadable documents are still delivered for manual review', async () => {
  const unreadableEnv = {
    ...env,
    AI: {
      async toMarkdown(files) {
        return files.map((file) => ({ name: file.name, format: 'error', data: '' }));
      },
    },
  };
  const { response, sent, json } = await captured('/api/apply', {
    formStartedAt: started(),
    refNo: 'FCI-APP-123456',
    applicant: applicant(),
    attachments: docs(),
  }, unreadableEnv);
  assert.equal(response.status, 202);
  assert.equal(json.status, 'manual_review');
  assert.equal(sent.length, 1);
  assert.match(sent[0].subject, /^NEEDS MANUAL REVIEW/);
  assert.match(sent[0].html, /identity document could not be read automatically/);
  assert.match(sent[0].html, /bank statements could not be read automatically/);
  assert.match(sent[0].html, /payslips could not be read automatically/);
  assert.equal(sent[0].attachments.length, 5);
});

test('a document conversion error or missing AI binding still delivers for manual review', async () => {
  const body = () => ({
    formStartedAt: started(),
    refNo: 'FCI-APP-123456',
    applicant: applicant(),
    attachments: docs(),
  });
  const throwing = await captured('/api/apply', body(), {
    ...env,
    AI: { async toMarkdown() { throw new Error('conversion failed'); } },
  });
  assert.equal(throwing.response.status, 202);
  assert.equal(throwing.sent.length, 1);
  assert.match(throwing.sent[0].html, /could not be read automatically/);

  const noAi = { ...env };
  delete noAi.AI;
  const sent = [];
  const response = await handleRequest(request('/api/apply', body()), noAi, {}, {
    deliver: async (_env, mail) => { sent.push(mail); },
  });
  assert.equal(response.status, 202);
  assert.equal(sent.length, 1);
  assert.match(sent[0].html, /screening was unavailable/);
});

test('passed applications are not marked for manual review', async () => {
  const { response, json, sent } = await captured('/api/apply', {
    formStartedAt: started(),
    refNo: 'FCI-APP-123456',
    applicant: applicant(),
    attachments: docs(),
  });
  assert.equal(response.status, 200);
  assert.equal(json.status, 'passed');
  assert.equal(sent[0].subject.includes('MANUAL REVIEW'), false);
});

async function withLogs(fn) {
  const lines = [];
  const original = console.log;
  console.log = (...args) => { lines.push(args.join(' ')); };
  try {
    await fn();
  } finally {
    console.log = original;
  }
  return lines;
}

test('eligibility failures still hard-reject and log only non-personal reason codes', async () => {
  let result;
  const lines = await withLogs(async () => {
    result = await captured('/api/apply', {
      formStartedAt: started(),
      refNo: 'FCI-APP-123456',
      applicant: applicant({ gross: 90000 }),
      attachments: docs(),
    });
  });
  assert.equal(result.response.status, 400);
  assert.equal(result.sent.length, 0);
  assert.match(result.json.error, /R11,301 and R22,000/);
  const event = lines.map((line) => JSON.parse(line)).find((item) => item.event === 'application_rejected');
  assert.deepEqual(event.reasons, ['rule_income_band']);
  const logged = lines.join('\n');
  for (const secret of ['Jane', 'Applicant', '8001015009087', 'jane.applicant@example.com', '0820000000']) {
    assert.equal(logged.includes(secret), false, `log leaked ${secret}`);
  }
});

test('invalid files still hard-reject with a reason code', async () => {
  let result;
  const lines = await withLogs(async () => {
    result = await captured('/api/apply', {
      formStartedAt: started(),
      refNo: 'FCI-APP-123456',
      applicant: applicant(),
      attachments: docs().filter((file) => file.role !== 'payslips'),
    });
  });
  assert.equal(result.response.status, 400);
  assert.equal(result.sent.length, 0);
  const event = lines.map((line) => JSON.parse(line)).find((item) => item.event === 'application_rejected');
  assert.deepEqual(event.reasons, ['attachment_missing_role']);
});

test('manual-review screening logs reason codes without personal data', async () => {
  const lines = await withLogs(async () => {
    await captured('/api/apply', {
      formStartedAt: started(),
      refNo: 'FCI-APP-123456',
      applicant: applicant({ idNumber: '8001015009088' }),
      attachments: docs(),
    });
  });
  const event = lines.map((line) => JSON.parse(line)).find((item) => item.event === 'application_screened');
  assert.equal(event.status, 'manual_review');
  assert.ok(event.reviewCodes.includes('id_number_mismatch'));
  const logged = lines.join('\n');
  for (const secret of ['Jane', '8001015009088', 'jane.applicant@example.com']) {
    assert.equal(logged.includes(secret), false, `log leaked ${secret}`);
  }
});

test('wrangler config sends applications to info@ and the Gmail mailbox only', () => {
  const config = readFileSync(join(root, 'worker', 'wrangler.jsonc'), 'utf8');
  const vars = JSON.parse(config.replace(/^\s*\/\/.*$/gm, '')).vars;
  assert.equal(vars.APPLICATION_TO_EMAILS, 'info@fcichs.co.za,fcicommunityhousing@gmail.com');
  assert.equal(vars.CONTACT_TO_EMAILS, undefined);
  assert.equal(vars.NEWSLETTER_TO_EMAILS, undefined);
  assert.equal(vars.PARTNERSHIP_TO_EMAILS, undefined);
  assert.equal(Object.keys(vars).some((key) => /PASSWORD/i.test(key)), false);
});

test('the apply page treats a manual-review response as success', () => {
  const page = readFileSync(join(root, 'apply.html'), 'utf8');
  assert.match(page, /result\.status === 'manual_review' \? 'manual_review' : 'passed'/);
  assert.match(page, /redirectToSuccessPage\(screeningStatus\)/);
  const forms = readFileSync(join(root, 'assets', 'js', 'forms.js'), 'utf8');
  assert.match(forms, /!response\.ok \|\| !data\.ok/);
});

test('plain SMTP on port 25 is not used', async () => {
  const { response, sent } = await captured('/api/contact', {
    formStartedAt: started(),
    name: 'Sam',
    email: 'sam@example.com',
    phone: '0210000000',
    division: 'general',
    message: 'Hello',
  }, { ...env, SMTP_PORT: '25' });
  assert.equal(response.status, 503);
  assert.equal(sent.length, 0);
});

test('gmail defaults send as fcicommunityhousing@gmail.com and deliver there', async () => {
  const onlyPassword = {
    SMTP_PASSWORD: 'abcd efgh ijkl mnop',
    ALLOWED_ORIGINS: 'https://fcichs.co.za',
  };
  const contact = await captured('/api/contact', {
    formStartedAt: started(),
    name: 'Sam Writer',
    email: 'sam.writer@example.com',
    phone: '0210000000',
    division: 'general',
    message: 'Hello',
  }, onlyPassword);
  assert.equal(contact.response.status, 200);
  assert.equal(contact.sent[0].smtp.host, 'smtp.gmail.com');
  assert.equal(contact.sent[0].smtp.port, 465);
  assert.equal(contact.sent[0].smtp.user, 'fcicommunityhousing@gmail.com');
  assert.equal(contact.sent[0].smtp.from, 'fcicommunityhousing@gmail.com');
  assert.equal(contact.sent[0].smtp.password, 'abcdefghijklmnop');
  assert.deepEqual(contact.sent[0].to, ['fcicommunityhousing@gmail.com']);
  assert.equal(contact.sent[0].replyTo.email, 'sam.writer@example.com');

  const newsletter = await captured('/api/newsletter', {
    formStartedAt: started(),
    email: 'reader@example.com',
  }, onlyPassword);
  assert.deepEqual(newsletter.sent[0].to, ['fcicommunityhousing@gmail.com']);

  const application = await captured('/api/apply', {
    formStartedAt: started(),
    refNo: 'FCI-APP-123456',
    applicant: applicant(),
    attachments: docs(),
  }, {
    ...onlyPassword,
    SMTP_PORT: '587',
    APPLICATION_TO_EMAILS: 'applications@fcichs.co.za',
  });
  assert.equal(application.response.status, 200);
  assert.equal(application.sent[0].smtp.port, 587);
  assert.equal(application.sent[0].smtp.host, 'smtp.gmail.com');
  assert.deepEqual(application.sent[0].to, ['applications@fcichs.co.za']);
  assert.equal(application.sent[0].smtp.from, 'fcicommunityhousing@gmail.com');
});

test('a Gmail From address that is not the authenticated mailbox is refused', async () => {
  const { response, sent } = await captured('/api/contact', {
    formStartedAt: started(),
    name: 'Sam',
    email: 'sam@example.com',
    phone: '0210000000',
    division: 'general',
    message: 'Hello',
  }, {
    SMTP_PASSWORD: 'abcdefghijklmnop',
    SMTP_FROM_EMAIL: 'other@gmail.com',
    ALLOWED_ORIGINS: 'https://fcichs.co.za',
  });
  assert.equal(response.status, 503);
  assert.equal(sent.length, 0);
});

test('missing mailbox settings fail closed', async () => {
  const { response, sent } = await captured('/api/contact', {
    formStartedAt: started(),
    name: 'Sam',
    email: 'sam@example.com',
    phone: '0210000000',
    division: 'general',
    message: 'Hello',
  }, { ALLOWED_ORIGINS: 'https://fcichs.co.za' });
  assert.equal(response.status, 503);
  assert.equal(sent.length, 0);
});

test('SMTP envelope uses the authenticated mailbox on port 587', async () => {
  const replies = ['220 ready', '250 hello', '220 tls', '250 hello', '334 user', '334 pass', '235 ok', '250 from', '250 rcpt', '354 go', '250 queued', '221 bye'];
  const sent = [];
  let cursor = 0;
  const session = {
    async expect(codes, label) {
      const line = replies[cursor++];
      const code = Number(line.slice(0, 3));
      assert.ok(codes.includes(code), label);
      return { code, text: line };
    },
    async command(line, codes, label) {
      sent.push(line);
      return this.expect(codes, label);
    },
    async sendRaw(text) { sent.push(text); },
    async upgradeTls() { sent.push('<<starttls>>'); },
  };
  const raw = buildRawMessage({
    fromName: 'FCI Community Housing Services',
    fromEmail: 'mailbox@fcichs.co.za',
    to: ['info@fcichs.co.za'],
    replyTo: { name: 'Jane Applicant via FCI Website', email: 'jane.applicant@example.com' },
    subject: 'Application FCI-APP-123456 - Jane Applicant',
    html: '<p>Hello</p>',
    attachments: [],
  });
  await transact(session, {
    host: 'smtp.example.com',
    user: 'mailbox@fcichs.co.za',
    password: 'test-password',
    from: 'mailbox@fcichs.co.za',
    recipients: ['info@fcichs.co.za'],
    raw,
    implicitTls: false,
  });
  assert.ok(sent.includes('MAIL FROM:<mailbox@fcichs.co.za>'));
  assert.equal(sent.some((line) => String(line).includes('MAIL FROM:<jane.applicant@example.com>')), false);
  assert.ok(sent.includes('RCPT TO:<info@fcichs.co.za>'));
  assert.ok(sent.includes('<<starttls>>'));
  const data = sent.find((line) => String(line).includes('Reply-To:'));
  assert.match(data, /Reply-To: "Jane Applicant via FCI Website" <jane\.applicant@example\.com>/);
  assert.match(data, /From: "FCI Community Housing Services" <mailbox@fcichs\.co\.za>/);
});

test('dot-stuffing and header sanitising', () => {
  assert.equal(dotStuff('Hello\r\n.secret\r\n'), 'Hello\r\n..secret\r\n');
  assert.equal(sanitizeHeader('A\r\nB\u2028C'), 'A B C');
});

test('the public site no longer contains a mail provider key', () => {
  const files = readdirSync(root).filter((name) => name.endsWith('.html'));
  files.push('assets/js/forms.js', 'assets/js/main.js');
  const banned = ['xkeysib-', 'api.brevo.com', 'api-key'];
  for (const file of files) {
    const text = readFileSync(join(root, file), 'utf8');
    for (const token of banned) {
      assert.equal(text.includes(token), false, `${file} still contains ${token}`);
    }
  }
});

import { buildRawMessage, dotStuff } from './mime.js';

const encoder = new TextEncoder();

export async function readSmtpReply(readLine) {
  let text = '';
  let code = 0;
  for (;;) {
    const line = await readLine();
    text += `${line}\n`;
    const match = /^(\d{3})([ -])/.exec(line);
    if (!match) {
      throw Object.assign(new Error('Unexpected SMTP response'), { code: 0 });
    }
    code = Number(match[1]);
    if (match[2] === ' ') return { code, text };
  }
}

export async function transact(session, { host, user, password, from, recipients, raw, implicitTls }) {
  await session.expect([220], 'greeting');
  await session.command(`EHLO ${ehloName(from)}`, [250], 'ehlo');
  if (!implicitTls) {
    await session.command('STARTTLS', [220], 'starttls');
    await session.upgradeTls();
    await session.command(`EHLO ${ehloName(from)}`, [250], 'ehlo-tls');
  }
  await session.command('AUTH LOGIN', [334], 'auth');
  await session.command(toBase64(user), [334], 'auth-user');
  await session.command(toBase64(password), [235], 'auth-pass');
  // Envelope sender is the authenticated FCI mailbox. The applicant is only a Reply-To.
  await session.command(`MAIL FROM:<${from}>`, [250], 'mail-from');
  for (const recipient of recipients) {
    await session.command(`RCPT TO:<${recipient}>`, [250, 251], 'rcpt');
  }
  await session.command('DATA', [354], 'data');
  await session.sendRaw(`${dotStuff(raw)}.${'\r\n'}`);
  await session.expect([250], 'queued');
  try {
    await session.command('QUIT', [221], 'quit');
  } catch {
    // The message is already accepted. A missing quit reply should not fail the visitor.
  }
  void host;
}

export async function sendSmtpMail(env, mail) {
  const { connect } = await import('cloudflare:sockets');
  const implicitTls = mail.smtp.port === 465;
  const socket = connect(
    { hostname: mail.smtp.host, port: mail.smtp.port },
    { secureTransport: implicitTls ? 'on' : 'starttls' },
  );
  await socket.opened;
  const session = createSocketSession(socket);
  const raw = buildRawMessage({
    fromName: mail.smtp.fromName,
    fromEmail: mail.smtp.from,
    to: mail.to,
    replyTo: mail.replyTo,
    subject: mail.subject,
    html: mail.html,
    attachments: mail.attachments,
    messageIdDomain: mail.smtp.from.split('@')[1],
  });
  try {
    await transact(session, {
      host: mail.smtp.host,
      user: mail.smtp.user,
      password: mail.smtp.password,
      from: mail.smtp.from,
      recipients: mail.to,
      raw,
      implicitTls,
    });
  } finally {
    await session.close();
  }
}

export function createSocketSession(initialSocket) {
  let socket = initialSocket;
  let reader = socket.readable.getReader();
  let writer = socket.writable.getWriter();
  let buffer = '';
  const decoder = new TextDecoder();

  async function readLine() {
    for (;;) {
      const breakAt = buffer.indexOf('\n');
      if (breakAt >= 0) {
        let line = buffer.slice(0, breakAt);
        buffer = buffer.slice(breakAt + 1);
        if (line.endsWith('\r')) line = line.slice(0, -1);
        return line;
      }
      const { value, done } = await reader.read();
      if (done) throw Object.assign(new Error('SMTP connection closed'), { code: 0 });
      buffer += decoder.decode(value, { stream: true });
    }
  }

  return {
    async expect(codes, label) {
      const reply = await readSmtpReply(readLine);
      if (!codes.includes(reply.code)) {
        throw Object.assign(new Error(`SMTP ${label} failed`), { code: reply.code });
      }
      return reply;
    },
    async command(line, codes, label) {
      await writer.write(encoder.encode(`${line}\r\n`));
      return this.expect(codes, label);
    },
    async sendRaw(text) {
      await writer.write(encoder.encode(text));
    },
    async upgradeTls() {
      reader.releaseLock();
      writer.releaseLock();
      socket = socket.startTls();
      reader = socket.readable.getReader();
      writer = socket.writable.getWriter();
      buffer = '';
    },
    async close() {
      try {
        reader.releaseLock();
      } catch { /* already released */ }
      try {
        writer.releaseLock();
      } catch { /* already released */ }
      try {
        await socket.close();
      } catch { /* already closed */ }
    },
  };
}

function ehloName(from) {
  const domain = String(from).split('@')[1] || 'fcichs.co.za';
  return /^[A-Za-z0-9.-]+$/.test(domain) ? domain : 'fcichs.co.za';
}

function toBase64(value) {
  return btoa(String.fromCharCode(...new TextEncoder().encode(value)));
}

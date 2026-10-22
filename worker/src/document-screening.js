const MONTHS = {
  january: 0, february: 1, march: 2, april: 3, may: 4, june: 5,
  july: 6, august: 7, september: 8, october: 9, november: 10, december: 11,
  jan: 0, feb: 1, mar: 2, apr: 3, jun: 5, jul: 6, aug: 7, sep: 8, sept: 8, oct: 9, nov: 10, dec: 11,
};

// Document checks never hard-reject an application. Anything the automated
// extraction cannot confirm is routed to FCI staff for manual review, with a
// non-personal reason code per check. Only invalid input (missing roles) fails.
const REVIEW_NOTES = {
  screening_unavailable: 'Automated document screening was unavailable; all documents must be checked manually.',
  documents_unreadable: 'One or more documents could not be read automatically (likely a photo or scan); check them manually.',
  id_unreadable: 'The identity document could not be read automatically.',
  id_number_not_found: 'No valid South African ID number could be read from the identity document.',
  id_number_mismatch: 'The ID number read from the identity document does not match the number entered on the form.',
  id_name_not_found: 'The applicant name could not be found on the identity document.',
  id_name_partial: 'The ID name could only be partially matched.',
  statements_unreadable: 'The bank statements could not be read automatically.',
  statements_dates_not_found: 'No recent bank-statement months (latest three months) could be detected.',
  statements_two_months: 'Only two recent bank-statement months were confidently detected.',
  payslips_unreadable: 'The payslips could not be read automatically.',
  payslips_dates_not_found: 'No recent payslip months (latest three months) could be detected.',
  payslips_two_months: 'Only two recent payslip months were confidently detected.',
};

export function reviewNote(code) {
  return REVIEW_NOTES[code] || code;
}

export async function screenDocuments(env, attachments, applicant, now = new Date()) {
  const required = ['id', 'statements', 'payslips'];
  const byRole = new Map(attachments.map((file) => [file.role, file]));
  for (const role of required) if (!byRole.has(role)) fail(400, `The ${role} document is required.`);

  const codes = [];
  const review = (code) => { if (!codes.includes(code)) codes.push(code); };
  const result = (statementMonths = new Set(), payslipMonths = new Set(), nameQuality = 'none', idMatched = false) => ({
    status: codes.length ? 'manual_review' : 'passed',
    idMatched,
    nameMatched: nameQuality === 'full',
    reviewCodes: [...codes],
    manualReviewReasons: codes.map(reviewNote),
    statementMonths: [...statementMonths].sort(),
    payslipMonths: [...payslipMonths].sort(),
  });

  if (!env.AI || typeof env.AI.toMarkdown !== 'function') {
    review('screening_unavailable');
    return result();
  }

  const files = required.map((role) => {
    const file = byRole.get(role);
    return {
      name: file.filename,
      blob: new Blob([decode(file.base64)], { type: file.contentType }),
    };
  });

  let converted;
  try {
    converted = await env.AI.toMarkdown(files, {
      conversionOptions: { output: { format: 'text' }, pdf: { metadata: false } },
    });
  } catch (error) {
    console.log(JSON.stringify({ event: 'document_ocr_error', code: error?.name || 'ocr_error' }));
    review('documents_unreadable');
    return result();
  }

  const results = Array.isArray(converted) ? converted : [converted];
  const textByRole = new Map();
  for (const item of results) {
    if (!item || item.format === 'error' || !item.data) continue;
    const role = [...byRole.values()].find((file) => file.filename === item.name)?.role;
    if (role) textByRole.set(role, String(item.data));
  }

  let idMatched = false;
  let nameQuality = 'none';
  if (!textByRole.has('id')) {
    review('id_unreadable');
  } else {
    const idText = textByRole.get('id');
    const validIds = findIdNumbers(idText).filter(validSouthAfricanId);
    const enteredId = digits(applicant.idNumber);
    idMatched = validIds.includes(enteredId);
    if (!idMatched) review(validIds.length ? 'id_number_mismatch' : 'id_number_not_found');
    nameQuality = nameMatchQuality(applicant.name, idText);
    if (nameQuality === 'none') review('id_name_not_found');
    if (nameQuality === 'partial') review('id_name_partial');
  }

  let statementMonths = new Set();
  if (!textByRole.has('statements')) {
    review('statements_unreadable');
  } else {
    statementMonths = recentMonths(textByRole.get('statements'), now);
    if (statementMonths.size < 2) review('statements_dates_not_found');
    else if (statementMonths.size === 2) review('statements_two_months');
  }

  let payslipMonths = new Set();
  if (!textByRole.has('payslips')) {
    review('payslips_unreadable');
  } else {
    payslipMonths = recentMonths(textByRole.get('payslips'), now);
    if (payslipMonths.size < 2) review('payslips_dates_not_found');
    else if (payslipMonths.size === 2) review('payslips_two_months');
  }

  return result(statementMonths, payslipMonths, nameQuality, idMatched);
}

function recentMonths(text, now) {
  const dates = extractDates(text);
  const current = new Date(now.getFullYear(), now.getMonth(), 1);
  const earliest = new Date(current.getFullYear(), current.getMonth() - 3, 1);
  const latest = new Date(current.getFullYear(), current.getMonth(), 0);
  return new Set(dates
    .filter((date) => date >= earliest && date <= latest)
    .map((date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`));
}

function extractDates(text) {
  const dates = [];
  const numeric = /\b(\d{1,2})[\s./-](\d{1,2})[\s./-](\d{2,4})\b/g;
  for (const match of text.matchAll(numeric)) {
    let year = Number(match[3]);
    if (year < 100) year += year >= 70 ? 1900 : 2000;
    const date = new Date(year, Number(match[2]) - 1, Number(match[1]));
    if (date.getFullYear() === year && date.getMonth() === Number(match[2]) - 1 && date.getDate() === Number(match[1])) dates.push(date);
  }
  const named = /\b(January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[\s-]+(20\d{2})\b/gi;
  for (const match of text.matchAll(named)) dates.push(new Date(Number(match[2]), MONTHS[match[1].toLowerCase()], 1));
  return dates;
}

function findIdNumbers(text) {
  const candidates = new Set();
  for (const match of text.matchAll(/\d[\d\s-]{11,20}\d/g)) {
    const value = digits(match[0]);
    for (let index = 0; index + 13 <= value.length; index += 1) candidates.add(value.slice(index, index + 13));
  }
  return [...candidates];
}

function validSouthAfricanId(value) {
  if (!/^\d{13}$/.test(value)) return false;
  const yy = Number(value.slice(0, 2));
  const month = Number(value.slice(2, 4));
  const day = Number(value.slice(4, 6));
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;
  let sum = 0;
  for (let index = 0; index < 12; index += 1) {
    let digit = Number(value[index]);
    if (index % 2 === 1) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
  }
  return (10 - (sum % 10)) % 10 === Number(value[12]);
}

function nameMatchQuality(name, text) {
  const tokens = String(name).toLowerCase().replace(/[^a-z\s-]/g, ' ').split(/\s+/).filter((token) => token.length >= 3);
  const haystack = text.toLowerCase().replace(/[^a-z\s-]/g, ' ');
  if (!tokens.length) return 'none';
  const matched = tokens.filter((token) => haystack.includes(token)).length;
  if (matched === tokens.length) return 'full';
  if (matched > 0) return 'partial';
  return 'none';
}

function digits(value) { return String(value || '').replace(/\D/g, ''); }

function decode(value) {
  const binary = atob(String(value || '').replace(/\s/g, ''));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function fail(status, publicMessage) {
  throw Object.assign(new Error(publicMessage), { status, publicMessage });
}

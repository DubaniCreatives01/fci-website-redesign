# Form delivery for fcichs.co.za

The public site at https://fcichs.co.za/ is this repository, served by **GitHub Pages**.

Confirmed against the live site on 19 October 2026:

- `server: GitHub.com`, Fastly cache, homepage `content-length` matching `index.html`
- DNS `A` records `185.199.108.153`–`185.199.111.153` (GitHub Pages)
- `www` CNAME `dubanicreatives01.github.io`
- Repository file `CNAME` contains `fcichs.co.za`
- Nameservers are 1-grid (`linus.ns.1-grid.*`), not Cloudflare, Netlify, or Vercel

GitHub Pages only serves static files. It does not run PHP, and it ignores `.htaccess`. Clean URLs on the live site are done in the browser. There is nowhere on the current host to keep a mailbox password or to open an SMTP connection.

Applications, contact messages, and newsletter signups are therefore posted to a small **Cloudflare Worker** in `worker/`. The Worker reads mailbox settings from secrets and sends the message over authenticated SMTP. Attachments are sent only to the recipient addresses you configure. They are not sent through Brevo.

## Gmail mailbox

Forms send through the Google account **fcicommunityhousing@gmail.com**.

| Setting | Value |
| --- | --- |
| Host | `smtp.gmail.com` |
| Port | `465` (SSL, implicit TLS) or `587` (STARTTLS). The Worker is set to **465**. |
| Username | `fcicommunityhousing@gmail.com` |
| Password | A Google **App Password**, stored only as the Worker secret `SMTP_PASSWORD` |
| From | `fcicommunityhousing@gmail.com` (display name `FCI Community Housing Services`) |
| Recipients | That same address, unless you set a recipient secret |

Cloudflare Workers can open outbound TCP sockets with `connect()` from `cloudflare:sockets`. They **cannot** connect to port 25 (`Connections to port 25 are prohibited`). Gmail’s submission ports are 465 and 587, which the Worker allows. Any other port, including 25, is rejected.

Gmail will not let this Worker pretend to be a different sender. The SMTP envelope and the From header are the authenticated Gmail address. The applicant is never the sender. **Reply-To** is the applicant’s validated address, with the display name `Applicant Name via FCI Website`, so a staff Reply in Gmail goes to the applicant. The subject contains the applicant’s name and a reference (`Application FCI-APP-…` or `Enquiry FCI-ENQ-…`). Names, subjects, and addresses are stripped of control characters so a visitor cannot inject extra headers.

### Create the App Password

Gmail will not accept the normal account password for this connection. Use an App Password. That option exists only after **2-Step Verification** is turned on for `fcicommunityhousing@gmail.com`.

1. Sign in to Google as `fcicommunityhousing@gmail.com`.
2. Open [2-Step Verification](https://myaccount.google.com/signinoptions/two-step-verification) and turn it on if it is not already on.
3. Open [App passwords](https://myaccount.google.com/apppasswords). The page is missing until 2-Step Verification is on. If it is still missing, the account’s security settings are blocking App Passwords and this mailbox cannot be used for SMTP until that is allowed.
4. Create an app password named `FCI website`.
5. Google shows a 16-character password, often in four groups. Copy it. Spaces do not matter; the Worker removes them.

Do not put that password in this repository, in `wrangler.jsonc`, in a screenshot, or in email. It is not the account’s normal password, but anyone who has it can send mail as this mailbox.

### Where to set it

The site host is GitHub Pages. The password is set on the **Cloudflare Worker**, not on GitHub Pages.

After the first `npx wrangler@4 deploy` (steps below):

```bash
cd worker
npx wrangler@4 secret put SMTP_PASSWORD
```

Paste the App Password when prompted. Wrangler stores it as an encrypted secret and deploys a new version. A later code deploy does not erase it.

Dashboard equivalent: [Workers & Pages](https://dash.cloudflare.com/?to=/:account/workers-and-pages) → **fcichs-forms** → **Settings** → **Variables and Secrets** → **Add** → type **Secret** → name `SMTP_PASSWORD` → paste the App Password → **Deploy**.

For local `npx wrangler dev`, copy `worker/.dev.vars.example` to `worker/.dev.vars` and put the App Password only in that file. `.dev.vars` is gitignored.

### Gmail sending limit

A consumer Gmail account can send about **500 messages per day**. Each application, contact enquiry, and newsletter signup counts as one message when it is delivered to this one mailbox. A busy day, or several recipients on one message, can reach that cap. Gmail then refuses the message and the form asks the visitor to email the office. This mailbox is for form delivery, not for bulk mail. Raising the limit means a Google Workspace mailbox (about 2,000 messages per day) or another submission host; change `SMTP_HOST`, `SMTP_USER`, `SMTP_FROM_EMAIL`, and `SMTP_PASSWORD` together if you move.

### Recipient overrides

If `APPLICATION_TO_EMAILS`, `CONTACT_TO_EMAILS`, `PARTNERSHIP_TO_EMAILS`, and `NEWSLETTER_TO_EMAILS` are unset, every form is delivered to `fcicommunityhousing@gmail.com`.

To send a form somewhere else, set that name as a **Worker secret** (so the next code deploy does not wipe it) to a comma-separated list of up to 10 addresses:

```bash
npx wrangler@4 secret put APPLICATION_TO_EMAILS
# example value, not a default: applications@fcichs.co.za,fcicommunityhousing@gmail.com
```

Partnership enquiries use `PARTNERSHIP_TO_EMAILS` when set, otherwise the contact list, otherwise the Gmail address. Newsletter notices use `NEWSLETTER_TO_EMAILS`, then the contact list, then the Gmail address. An invalid list fails closed; it does not fall through to Gmail.

## Newsletter

Newsletter signups use the **same Gmail mailbox**, not Brevo. A signup sends `fcicommunityhousing@gmail.com` an email containing the address to add to the quarterly list. That needs no second vendor, and means the Brevo key that was published in this repository can be revoked without provisioning a replacement. A Brevo list can be added later behind the same `/api/newsletter` route if automatic list management is wanted. Do not put that key back in the browser.

## What you must set

The Gmail host, port, username, and From address are already in `worker/wrangler.jsonc` as plain variables. They are not secrets. The only value you must add is the App Password.

| Name | Required | Where | What to put |
| --- | --- | --- | --- |
| `SMTP_HOST` | Already set | `wrangler.jsonc` | `smtp.gmail.com` |
| `SMTP_PORT` | Already set | `wrangler.jsonc` | `465`. Change the variable to `587` if you prefer STARTTLS. |
| `SMTP_USER` | Already set | `wrangler.jsonc` | `fcicommunityhousing@gmail.com` |
| `SMTP_FROM_EMAIL` | Already set | `wrangler.jsonc` | `fcicommunityhousing@gmail.com`. Gmail requires this to match `SMTP_USER`. |
| `SMTP_FROM_NAME` | Already set | `wrangler.jsonc` | `FCI Community Housing Services` |
| `SMTP_PASSWORD` | **Yes** | Worker **secret** only | The 16-character Google App Password. Never commit it. |
| `APPLICATION_TO_EMAILS` | No | Worker secret | Applications and their documents. Blank means `fcicommunityhousing@gmail.com`. |
| `CONTACT_TO_EMAILS` | No | Worker secret | Contact form. Blank means the Gmail address. |
| `PARTNERSHIP_TO_EMAILS` | No | Worker secret | Partnership enquiries. Blank means the contact list, then the Gmail address. |
| `NEWSLETTER_TO_EMAILS` | No | Worker secret | Signup notices. Blank means the contact list, then the Gmail address. |
| `ALLOWED_ORIGINS` | No | `wrangler.jsonc` or secret | Comma-separated browser origins. Defaults to `https://fcichs.co.za,https://www.fcichs.co.za`. |
| `ALLOW_LOCAL_ORIGINS` | No | local `.dev.vars` only | `true` only for `http://localhost`. Do not enable it in production. |

`wrangler secret put` deploys a new version immediately. Secrets are not overwritten by a later code deploy. Do not put `SMTP_PASSWORD` in `wrangler.jsonc`. A code deploy replaces plain variables with the values in that file.

The website calls `https://api.fcichs.co.za` (the `fci-api-base` meta tag on each page). Change that tag if the Worker URL is different.

## Deploy the Worker beside GitHub Pages

1. In the [Cloudflare dashboard](https://dash.cloudflare.com/), create a free account if needed. You do **not** have to move the website off GitHub Pages.
2. From this repository:

   ```bash
   cd worker
   npx wrangler@4 login
   npx wrangler@4 deploy
   ```

3. Set the App Password: `npx wrangler@4 secret put SMTP_PASSWORD`. That is the only required secret. Add recipient secrets only if mail should go somewhere other than `fcicommunityhousing@gmail.com`.
4. Open `https://<worker-name>.<account>.workers.dev/api/health`. It should return `"smtpConfigured": true` once `SMTP_PASSWORD` is present. It does not reveal the password or the mailbox.
5. Point the site at that Worker:
   - **No DNS cutover:** set each page’s `<meta name="fci-api-base">` to the `workers.dev` URL printed by `wrangler deploy`, then push to GitHub Pages. The browser will call that host. CORS allows `https://fcichs.co.za` and `https://www.fcichs.co.za`.
   - **Custom hostname `api.fcichs.co.za`:** add the domain to the same Cloudflare account and attach it to the Worker (Workers → Settings → Domains & Routes). A Worker custom domain normally needs the DNS zone on Cloudflare. If you move the zone from 1-grid, recreate the GitHub Pages `A`/`CNAME` records, and keep the existing mail records (MX, SPF, Outlook) or sending and receiving will break. Leave the apex on GitHub Pages; only `api` needs to reach the Worker.

6. Send a test enquiry with an ordinary file (a small PDF). Confirm `fcicommunityhousing@gmail.com` receives it, the From address is that Gmail account, and Reply goes to the address you typed.

Until those secrets exist, the forms tell the visitor to email the office. They no longer pretend a message was sent, and they no longer call Brevo from the browser.

## Limits and checks

- Documents must be PDF, JPG, or PNG, at most 4 MB each and 16 MB together. The type is checked from the file contents, not only the name.
- A hidden field and a short minimum time on the form drop simple automated posts. Each IP is limited to a few submissions per ten minutes (newsletter: per hour).
- The previous client-side behaviour redirected to the success page even when sending failed. That redirect now happens only after the Worker accepts the message.

## Revoke the exposed Brevo key

The old housing form assembled a Brevo API key in public JavaScript. That key is in the git history of this public repository. **Revoke or rotate it in Brevo now.** Rewriting git history does not help, because the key is already public. This change stops using Brevo for applications, contact, and the newsletter. Do not paste a new key into the website.

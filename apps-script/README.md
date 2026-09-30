# Landing page form → Google Sheet: setup

The landing page is `get-audit.html` (live at https://www.campaignpro.click/get-audit).
Its form sends each submission to a Google Apps Script, which checks it and adds a row to your Google Sheet.

## 1. Create the sheet and the script (5 minutes)

1. Go to **sheets.google.com** and create a new blank spreadsheet. Name it e.g. `CampaignPro Leads`.
2. In the sheet: **Extensions → Apps Script**.
3. Delete everything in the editor and paste the full contents of `apps-script/Code.gs`.
4. At the top of the script, set the options you want:
   - `NOTIFY_EMAIL = 'hello@campaignpro.click';` to get an email for every new lead (optional).
   - Leave `TURNSTILE_SECRET` empty unless you set up Turnstile (step 4).
5. Click **Save** (disk icon). Name the project e.g. `CampaignPro form`.

## 2. Deploy it as a web app

1. Click **Deploy → New deployment**.
2. Click the gear next to "Select type" → **Web app**.
3. Settings:
   - **Description:** Landing page form
   - **Execute as:** **Me**
   - **Who has access:** **Anyone** (this lets the website send data; only the script can write to your sheet)
4. Click **Deploy** → **Authorize access** → choose your Google account.
   Google shows "Google hasn't verified this app": click **Advanced → Go to CampaignPro form (unsafe)** → **Allow**. This is normal for your own scripts.
5. Copy the **Web app URL** (it ends in `/exec`).

## 3. Connect the page

In `get-audit.html`, at the top, fill in the settings block:

```js
window.CP_LP = {
  endpoint: 'https://script.google.com/macros/s/XXXXXXXX/exec',
  metaPixelId: '123456789012345',
  turnstileSiteKey: ''
};
```

The Meta Pixel ID is in Meta Events Manager → Data sources → your Pixel.

## 4. Optional: Cloudflare Turnstile (invisible bot check)

Only needed if you start receiving spam.
1. Cloudflare dashboard → **Turnstile → Add widget** → hostname `www.campaignpro.click`, mode **Managed** (or Invisible).
2. Put the **Site key** in `turnstileSiteKey` on the page and the **Secret key** in `TURNSTILE_SECRET` in the script.
3. In Apps Script: **Deploy → Manage deployments → edit → Version: New version → Deploy** (the URL stays the same).

## Updating the script later

Always use **Deploy → Manage deployments → edit (pencil) → Version: New version → Deploy**.
Creating a *new* deployment instead would give you a new URL that the page doesn't know about.

## Security built in

All checks run in the script, so they can't be bypassed by calling the URL directly:
- Every field validated for type, length and allowed characters; invalid submissions are rejected.
- Invisible/control characters and `< > " \` \\` stripped.
- **Spreadsheet formula injection blocked**: values can never start with `= + - @` or a tab/newline in a cell (they get stored as plain text), and the columns are formatted as plain text.
- Honeypot field and minimum fill time: bots are silently ignored.
- Global rate limit (20 submissions per minute by default).
- Only fixed columns are written; any extra data sent is ignored.

## Columns in the sheet

Submitted at · Name · Email · Website · UTM source · UTM medium · UTM campaign · UTM content · UTM term · fbclid · Page

> Never put your Turnstile **secret** key in this repository. It belongs only inside the Apps Script editor.

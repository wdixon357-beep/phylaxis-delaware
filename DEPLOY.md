# Deploying the membership application

## The one rule that matters

The live form posts to a **pinned deployment URL**. Changing the code is not enough, and choosing
the wrong menu item breaks the form silently, with no error anyone will ever see.

**Always:** Apps Script editor > **Deploy** > **Manage deployments** > pencil (edit) >
**Version: New version** > **Deploy**. Then re-open Manage deployments and **read the version
number back**.

**Never: Deploy > New deployment.** That mints a brand new `/exec` URL. The live page keeps
posting to the old one, so every application after that either runs stale code or, if the old
deployment is archived, disappears with no error and no record.

## Verify the deploy actually landed

The dialog has closed without deploying more than once. Do not trust it. Test the endpoint:

```
curl -s -L -X POST "<the /exec url>" -d "" | grep -c "not complete"
```

`1` means the current hardened build is live, because it refuses an empty submission.
`0` means an older build is still serving and the deploy did not land.

## After any deploy

1. Run `setup()` once from the editor. The log prints the admin key, the kill switch URL, and the
   real daily mail quota. 1500 means Google Workspace. 100 means a consumer account.
2. File one complete test application and confirm the notification reads `[CERTIFIED]` and that the
   Masonic affiliations are quoted line by line with a leading `|`.
3. Confirm the President is on `NOTIFY`. He is removed during testing and must be restored before
   the link is publicised.

## Kill switch

`<the /exec url>?k=<ADMIN_KEY>&set=off` closes the form from a phone.
`&set=on` reopens it. `&set=reset` clears the rate counter.
Get `ADMIN_KEY` from the `setup()` log.

## Where things live

- Page source: `apply/index.html` in this repo. It must stay byte-identical to the live page.
- Backend: `apps-script-membership-backend.js` in this repo, mirroring the deployed Apps Script.
- Design constraints, which are fixed: no Google Sheets, no third-party form service, no database.
  The notification email is the record.

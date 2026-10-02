# Anna — trial v1

Anna is a personal taste agent. Each friend builds her own Anna: she swipes, sends things she loves from any app with a double-tap on the back of her iPhone, and every night at a time she chooses her Anna brings her an edit of 12 — 30% squarely her, 70% adjacent, new and wildcard.

This repo is the whole thing: the phone app (`public/`), the server (`netlify/functions/`), and the database setup (`supabase/schema.sql`).

---

## Setting it up (about 30 minutes, once)

### 1. Put the site on Netlify
1. Go to **app.netlify.com** → **Add new site** → **Import an existing project** → **GitHub**.
2. Pick **anna-trial**. Leave every build setting as it is (the repo already tells Netlify what to do) and click **Deploy**.
3. When it's live, note the address, e.g. `https://anna-trial.netlify.app`. You can rename it under **Site configuration → Change site name**.

### 2. Create Anna's tables in Supabase
1. Open the pipeline project → **SQL Editor** → **New query**.
2. Paste the whole of `supabase/schema.sql` and click **Run**. It only adds new `anna_*` tables and a private screenshot bucket; it doesn't touch `pipeline_products`.

### 3. Add the keys in Netlify
In Netlify: **Site configuration → Environment variables → Add a variable**. Add each of these:

| Name | Where to get it |
|---|---|
| `SUPABASE_URL` | Supabase → **Project Settings → API** → Project URL |
| `SUPABASE_SERVICE_KEY` | Supabase → **Project Settings → API keys** → the `service_role` secret key. Keep it secret: paste it only here. |
| `ANTHROPIC_API_KEY` | **console.anthropic.com → API Keys → Create Key** |
| `ADMIN_KEY` | Make one up — a long password only you know. You'll use it to add friends and see numbers. |
| `VAPID_SUBJECT` | `mailto:` followed by your email |
| `CUTOUT_API_KEY` | Optional. A **remove.bg** API key (remove.bg → API). It cuts the background from photos so the Behind and Product pages work; without it every piece uses the Landscape or Printed tail page. About 14 images per person per night. |

Then **Deploys → Trigger deploy → Deploy site** so the keys take effect.

### 4. Make the notification keys
Visit (with your own site and admin key):
```
https://YOUR-SITE.netlify.app/api/admin?admin=YOUR_ADMIN_KEY&action=vapid
```
It shows two values. Add both as environment variables, `VAPID_PUBLIC_KEY` and `VAPID_PRIVATE_KEY`, then trigger a deploy again. Only do this once — making new keys later switches off everyone's notifications.

### 5. Build the double-tap Shortcut (on your iPhone, 5 minutes)
1. Open the **Shortcuts** app → **+** → name it **Anna**.
2. Add action **Text**. Type `YOUR-CODE` in it.
3. Add action **Take Screenshot**.
4. Add action **Convert Image** → Convert *Screenshot* to **JPEG** (keeps uploads quick).
5. Add action **Get Contents of URL**:
   - URL: `https://YOUR-SITE.netlify.app/capture?c=` and then insert the **Text** variable from step 2 right after `c=`
   - Tap **Show More** → Method **POST** → Request Body **File** → choose **Converted Image**
6. Add action **Show Notification** → set its text to **Contents of URL** (it will say "Sent to your Anna ✓").
7. Open the shortcut's settings (ⓘ / Details) → **Setup** → add an **Import Question** on the Text action: "What's your Anna code?". Each friend then types her own code when she adds it.
8. **Share → Copy iCloud Link**. Add it in Netlify as `SHORTCUT_URL`, then trigger a deploy.

Test it on yourself: add the shortcut from the link, enter your code, set **Settings → Accessibility → Touch → Back Tap → Double Tap → Anna**, double-tap on any screen and tap **Always Allow**.

### 6. Add yourself and your friends
For each person, visit:
```
https://YOUR-SITE.netlify.app/api/admin?admin=YOUR_ADMIN_KEY&action=add&name=Sophie
```
It returns her personal **link** and her **shortcut code**. Text her the link. The app shows her code during setup, so she doesn't need it separately.

Do yourself first and go through the whole thing on your phone before sending anyone else a link.

---

## Running the trial

- **Numbers per person:** `…/api/admin?admin=YOUR_ADMIN_KEY&action=stats` — edits received, opened, finished, loves, passes, closer looks, "Take me there" taps, double-taps.
- **Everyone's links again:** `…&action=users`
- **Build someone's edit right now:** `…&action=build&u=sophie`
- **Send someone a test notification:** `…&action=push&u=sophie`

Every 15 minutes the site checks each person's time: it builds her edit about three hours before, and sends the notification at her chosen time.

## How a night is built (design v2, 30 Sep 2026)

Every night is an issue: a cover (masthead, number, day), then twelve pages. Each piece becomes one of four pages, chosen from its photo, never its category: **Behind** (a person, cut out, in front of the brand name), **Product** (an object, cut out, on cream), **Landscape** (a wide photo) or **Printed tail** (the fallback, always safe). The rules live in `lib/layout.mjs`: never the same page twice running, open on Behind or Tail, close on Landscape or Product. Cut-outs need `CUTOUT_API_KEY`; the phone falls back on its own when the server hasn't measured a photo (the first swipes, say).

## Changing things

- **Fresh sources** (vintage, objects, art for the wildcards): `config/sources.json`. Shopify-based shops work out of the box.
- **The first 40 swipes:** leave `config/calibration.json` empty for an automatic wide spread (one piece per retailer), or list pipeline `url_key`s to hand-pick them.
- **The 30/70 mix:** `MIX` in `lib/claude.mjs`.
- **Pipeline columns:** already set for `pipeline_products`; only change `POOL_*` variables if the pipeline changes.

## Local testing (no accounts needed)

```
ANNA_MOCK=1 ADMIN_KEY=dev node scripts/dev-server.mjs
ANNA_MOCK=1 node scripts/smoke-test.mjs
```
The dev server uses `config/sample_pool.json` and a local JSON file instead of Supabase.

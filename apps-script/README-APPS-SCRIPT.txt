PERTH RESOLES - APPS SCRIPT SETUP (paid website orders -> sheet + Gmail DRAFT)
=============================================================================
What it does, for every PAID website order the website sends it:
  - checks a shared secret (so nobody else can add rows),
  - adds ONE row to 'Test Orders' (while TEST_MODE is on) or 'Order Tracking',
    skipping duplicates, and never touching the formula columns
    (List Price (x Pairs) and Due Date),
  - creates a Gmail DRAFT confirmation email in your Gmail. It NEVER sends anything.
    You open Gmail > Drafts, check it, and press Send yourself.
  - Address guard: if the email text contains a blocked word (always "Perth Hills",
    plus your own words such as your street name), no draft is made. Instead a line
    is written to the 'Automation Log' tab.
  - Only Urban Jungle orders get a draft. "Other / arrange handover" orders are logged
    so you can email them yourself.

STEP 1 - Paste the script (5 min)
  1. Open your "Order Tracker and Status Updates" Google Sheet.
  2. Extensions > Apps Script. A new tab opens.
  3. Delete everything in Code.gs, then paste ALL of apps-script/Code.gs from this folder.
     Click the disk icon (Save). Name the project "Perth Resoles orders".

STEP 2 - Safe settings (Test Orders tab first)
  1. In the function dropdown at the top (next to "Debug") pick  setupTestMode  and click Run.
  2. Google asks for permission ("Review permissions" > your account > Advanced >
     "Go to Perth Resoles orders (unsafe)" > Allow). This is your own script; it needs
     your Sheet and Gmail (drafts) access.
  3. This creates the 'Test Orders' and 'Automation Log' tabs and these Script properties
     (Project Settings (gear icon) > Script properties):
        TEST_MODE      true      <- keeps everything on 'Test Orders'
        SHARED_SECRET  (a long random password - you'll copy this in Step 4)
        BLOCKED_WORDS  Perth Hills,ADD_YOUR_STREET_NAME_HERE
        CREATE_DRAFTS  true
  4. Edit BLOCKED_WORDS: replace ADD_YOUR_STREET_NAME_HERE with your street name
     (and anything else that must never appear in an automated email), comma separated.
  5. Optional check: pick  testWithSampleOrder  and Run. A test row appears on 'Test Orders'
     and a draft addressed to you appears in Gmail > Drafts. Delete both afterwards.

STEP 3 - Deploy as a web app
  1. Deploy > New deployment > gear icon > Web app.
  2. Description: "orders v1". Execute as: Me. Who has access: Anyone.
     ("Anyone" is needed because the website calls it without a Google login;
      the SHARED_SECRET is what keeps others out.)
  3. Deploy, then copy the Web app URL (ends in /exec).
  When you change the code later: Deploy > Manage deployments > pencil > Version: New version
  > Deploy. That keeps the same URL.

STEP 4 - Tell the website about it
  In the trial folder's .dev.vars file set:
      SHEET_WEBHOOK_URL=<the /exec URL from Step 3>
      SHEET_WEBHOOK_SECRET=<the SHARED_SECRET value from Script properties>
  Restart  npx wrangler dev , place a sandbox order, pay with the test card, and land on the
  thank-you page. Within a few seconds a row appears on 'Test Orders' and a draft is in Gmail.

STEP 5 - Going live (later, only when you're happy)
  - Set TEST_MODE to false in Script properties (rows then go to 'Order Tracking').
  - The live website uses Worker secrets instead of .dev.vars (see README-TRIAL.txt "Going live").

Columns written (exactly as in 'Order Tracking'):
  Order ID | Customer Name | Email | Phone | Order Date | Service (matched from Price List col A)
  | Rubber | Thickness | Rand Repair | Rand Coverage | Pairs | Shoe Model | Size | Amount (AUD)
  | List Price (x Pairs) [formula, not written] | Drop-off / Pick-up | Status = Paid
  | Shoes Received Date (blank) | Due Date [formula, not written] | Returned Date (blank)
  | Square Receipt | Notes ("Website order via ... Square order ..., payment ...")
The email is built only from fixed template fields (first name, order number, service, pairs,
shoe model, size, amount, receipt link). It never uses the Notes column.

Testing without Google (for developers): node --test apps-script/test/*.test.mjs

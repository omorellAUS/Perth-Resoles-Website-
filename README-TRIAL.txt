PERTH RESOLES - CHECKOUT + ORDER AUTOMATION LOCAL TRIAL v2  (branch: proposed/order-automation)
================================================================================================
Runs the website, the Square checkout and the new order automation on YOUR computer, using
Square's SANDBOX (test mode). No real money moves and nothing goes live.
!! Use your SANDBOX access token only. NEVER put your production token in this trial. !!

NEW IN v2
  - Short order numbers: PR- plus 4 digits (e.g. PR-4827), easy to write on a tag.
  - The thank-you page shows the order number big and confirms the payment with Square.
  - Paid orders are sent ONCE to your Google Sheet (Apps Script) and a Gmail DRAFT confirmation
    is created for you to check and send. Nothing is emailed automatically.

------------------------------------------------------------------------------------------------
A) REPLACE YOUR TRIAL FOLDER (Windows, Command Prompt)
------------------------------------------------------------------------------------------------
Save perth-resoles-checkout-trial-v2.zip in your Downloads folder, open Command Prompt
(Start > type cmd > Enter) and paste these lines one at a time. They keep your .dev.vars (token).

  cd /d "C:\Users\ollym\OneDrive\Documents\GitHub\Perth Resoles Testnet"
  copy "perth-resoles-checkout-trial\.dev.vars" "dev.vars.backup"
  rmdir /s /q "perth-resoles-checkout-trial"
  tar -xf "%USERPROFILE%\Downloads\perth-resoles-checkout-trial-v2.zip"
  copy "dev.vars.backup" "perth-resoles-checkout-trial\.dev.vars"
  cd "perth-resoles-checkout-trial"
  npm install

(If "rmdir" says a file is in use, close any old "npx wrangler dev" window first (Ctrl+C).)

Open .dev.vars in Notepad:   notepad .dev.vars
Add these lines at the bottom if they are not there yet (leave the values empty for now):
  SHEET_WEBHOOK_URL=
  SHEET_WEBHOOK_SECRET=
  SQUARE_WEBHOOK_SIGNATURE_KEY=
  SQUARE_WEBHOOK_URL=
Save and close. (.dev.vars.example shows the full list.)

------------------------------------------------------------------------------------------------
B) RUN IT
------------------------------------------------------------------------------------------------
  npx wrangler dev
Wait for "Ready on http://localhost:8787" and open  http://localhost:8787
Fill in the order form > Pay Now with Square > in Square's sandbox panel click Next and pay
with the test card (or 4111 1111 1111 1111, any future expiry, CVV 111). You land on the
thank-you page with your short order number and "Payment confirmed".
Stop with Ctrl+C.

------------------------------------------------------------------------------------------------
C) OPTIONAL - TRY THE AUTOMATION WITHOUT GOOGLE (mock sheet on your PC)
------------------------------------------------------------------------------------------------
This runs the real Apps Script code against a pretend sheet and saves the email it would draft.
1. In .dev.vars set:
     SHEET_WEBHOOK_URL=http://127.0.0.1:8799/exec
     SHEET_WEBHOOK_SECRET=trial-secret-123
2. Open a SECOND Command Prompt window:
     cd /d "C:\Users\ollym\OneDrive\Documents\GitHub\Perth Resoles Testnet\perth-resoles-checkout-trial"
     set SHARED_SECRET=trial-secret-123
     set OUT=mock-sheet-output
     node apps-script\test\mock-sheet-server.mjs 8799
3. In the first window restart:  npx wrangler dev   and place + pay a sandbox order.
4. Look in the mock-sheet-output folder:
     Test_Orders.csv        the row that would be added
     Automation_Log.csv     what happened (e.g. "email draft: created" or BLOCKED)
     drafts\PR-xxxx.html    the confirmation email (double-click to view)

------------------------------------------------------------------------------------------------
D) CONNECT YOUR REAL GOOGLE SHEET ('Test Orders' tab first)
------------------------------------------------------------------------------------------------
Follow apps-script\README-APPS-SCRIPT.txt (paste the script, run setupTestMode, deploy as a
web app). Then in .dev.vars:
     SHEET_WEBHOOK_URL=<your Apps Script /exec URL>
     SHEET_WEBHOOK_SECRET=<the SHARED_SECRET from Apps Script > Project Settings > Script properties>
Restart npx wrangler dev, place a sandbox order and pay. A row appears on 'Test Orders' and a
DRAFT appears in Gmail > Drafts (sandbox orders say "SANDBOX TEST" in the Notes column).

------------------------------------------------------------------------------------------------
HOW DUPLICATES ARE PREVENTED
------------------------------------------------------------------------------------------------
The thank-you page (GET /api/confirm) and, once live, Square's webhook can both report the same
payment. The website sends each paid order ONCE (it remembers what it sent), and the Apps Script
also skips an Order ID it already has for the same Square payment.
Order numbers: random 4 digits, checked against all Square orders from the last 365 days
(including unpaid checkouts). If a number is ever reused after a year, the sheet still adds it
as a new order and writes a warning in 'Automation Log'.

------------------------------------------------------------------------------------------------
GOING LIVE (later - needs your OK, nothing here has been deployed)
------------------------------------------------------------------------------------------------
 1. npx wrangler kv namespace create ORDER_STATE   -> paste the id into wrangler.jsonc
 2. npx wrangler secret put SQUARE_ACCESS_TOKEN            (production token)
    npx wrangler secret put SHEET_WEBHOOK_SECRET
    npx wrangler secret put SQUARE_WEBHOOK_SIGNATURE_KEY   (from step 4)
 3. In wrangler.jsonc vars: SQUARE_ENV=production, SQUARE_LOCATION_ID=L2KV77K60Z4XZ,
    SITE_URL=https://www.perthresoles.com.au, SHEET_WEBHOOK_URL=<Apps Script /exec URL>,
    SQUARE_WEBHOOK_URL=https://www.perthresoles.com.au/api/square-webhook
 4. Square Developer Console > your app > Production > Webhooks > Add subscription:
    URL https://www.perthresoles.com.au/api/square-webhook, event payment.updated.
    Copy its Signature key into the secret above.
 5. Merge/push and deploy, do one small real order, refund it, then set TEST_MODE=false
    in Apps Script.

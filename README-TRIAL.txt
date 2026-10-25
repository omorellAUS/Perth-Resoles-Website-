PERTH RESOLES - SQUARE CHECKOUT LOCAL TRIAL (branch: proposed/square-checkout)
=============================================================================
This runs the whole website plus the new secure Square checkout on YOUR computer,
using Square's SANDBOX (test mode). No real money moves and nothing goes live.

!! Use your SANDBOX access token only. NEVER put your production token in this trial. !!

1) INSTALL NODE.JS (one time)
   Go to https://nodejs.org and install the "LTS" version (22 or newer).
   Check it worked: open Terminal (Mac) or Command Prompt (Windows) and type:
       node -v
   It should print v22... or higher.

2) UNZIP
   Mac: double-click perth-resoles-checkout-trial.zip
   Windows: right-click > Extract All...
   You get a folder called "perth-resoles-checkout-trial".

3) OPEN A TERMINAL IN THAT FOLDER
   Mac: open Terminal, type  cd  and a space, drag the folder onto the window, press Enter.
   Windows: open the folder, click the address bar, type  cmd  and press Enter.

4) INSTALL THE TOOLS (one time, needs internet, takes a minute)
       npm install

5) ADD YOUR SQUARE SANDBOX TOKEN
   a. Get it: https://developer.squareup.com/apps > your app > Credentials >
      switch the toggle at the top to "Sandbox" > copy the "Sandbox Access token"
      (it starts with EAAA...). Your sandbox test account must be Australian (AUD).
   b. Make the settings file:
        Mac:      cp .dev.vars.example .dev.vars
        Windows:  copy .dev.vars.example .dev.vars
   c. Open .dev.vars in a text editor (TextEdit / Notepad) and replace
      paste-your-SANDBOX-access-token-here  with your sandbox token. Save.
      Keep SQUARE_ENV=sandbox. (.dev.vars is private: it's never committed or published.)
   No token yet? Set SQUARE_DRY_RUN=true in .dev.vars. The site then shows a
   mock checkout page with the exact request it would send to Square.

6) START IT
       npx wrangler dev
   Wait for "Ready on http://localhost:8787", then open  http://localhost:8787
   (Mac shortcut: steps 5b-6 can be done with
       export SQUARE_SANDBOX_ACCESS_TOKEN=your-sandbox-token
       ./run-local.sh )

7) TRY AN ORDER
   Fill in the order form > Pay Now with Square. You're sent to Square's
   SANDBOX checkout ("Checkout API Sandbox Testing Panel"). Click Next, pay with
   the test card it offers (or 4111 1111 1111 1111, any future expiry, CVV 111),
   and you're returned to the Perth Resoles thank-you page.
   See the test order in the Square Developer Console > Sandbox test account >
   Open in Square Dashboard > Orders / Transactions. The line item, note and
   order reference (PR-...) carry the shoe model, size and drop-off.

8) STOP: press Ctrl+C in the terminal.

Safety built in
- Prices are calculated on the server from one price table (src/prices.js);
  a changed price in the browser is rejected.
- On localhost the checkout refuses to use production Square at all.

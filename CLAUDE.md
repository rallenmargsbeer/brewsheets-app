# Margaret River Beer Co Production App: handover notes

Read this first. It's what a new Claude session needs to pick up where the last one left off.
Ryan (head brewer / production) runs this app and is the person you'll be working with.

## Standing rules (always)

- **Unleashed is read-only.** Never create, edit or delete anything in Unleashed. Edge functions
  only ever issue HTTP GET to the Unleashed API.
- **Google Drive is read-only.**
- **Never use the long dash (em dash)** in anything you write: chat, code comments, docs, commits.
- Never paste or commit credentials or secrets.
- Ryan is in **Perth (AWST, UTC+8)**. The server clock is UTC: convert before saying "today" or
  "tomorrow".
- Keep replies short and conserve tokens. Ryan likes multi-choice questions (AskUserQuestion) when a
  decision is his to make.
- Don't make changes he didn't ask for; offer them instead.
- Destructive SQL that needs approval may time out: if so, give Ryan the SQL to run himself.

## Where things live

- **Code:** this repo (`rallenmargsbeer/brewsheets-app`), app in `brewsheets-app-scaffold/`
  (React + Vite SPA). Migrations in `brewsheets-app-scaffold/supabase/migrations/`, edge functions in
  `brewsheets-app-scaffold/supabase/functions/`.
- **Supabase project:** `aalplzzyijrmucgkxoko` (Postgres, RLS, edge functions, pg_net, vault).
- **Vercel project:** `brewsheets-app-obi4` in team "rallenmargsbeer's projects". Deploys on every
  merge to `main`. If the Vercel connector can't read deployments, check the deploy through GitHub
  instead: the PR's commit status from "Vercel" says "Deployment has completed" (or failed).
- **QC SOP** (Claude doc): https://claude.ai/artifact/JHR8HKxKyAsJMzyzsek7VR. Version 1.1, sections
  1 to 9 (Ryan removed 10, 11, the version table and sources). There is also a one-page A4 wall sheet
  of it (sent to Ryan as a PDF; regenerate from the SOP if it changes).

## Shipping a change

1. `git fetch origin main && git checkout -B claude/loving-gauss-xl4gc8 origin/main` (or your branch).
2. Edit, then `cd brewsheets-app-scaffold && npx vite build` (`npm install` first in a fresh container).
3. Commit, push, open a PR, squash-merge it, reset the branch to main. Ryan wants changes merged and
   live, not left as open PRs, unless he says otherwise.
4. Database changes: add a migration file to the repo AND apply it (Supabase MCP `apply_migration`).
5. Edge function changes: keep the repo copy and the deployed copy identical.

**Headless testing:** run `npx vite --port 5179` with `VITE_SUPABASE_URL=https://aalplzzyijrmucgkxoko.supabase.co VITE_SUPABASE_ANON_KEY=x`,
use the globally installed Playwright, stub Supabase with `page.route`, and put a fake session in
localStorage key `sb-aalplzzyijrmucgkxoko-auth-token`. Never test by writing to the real database.

## Unleashed sync (read-only)

Edge functions are called from SQL with `net.http_post` and header `x-cron-secret: public.get_sync_cron_secret()`.
Results land in `unl_dataset` (key → JSON):

- `unleashed-sync` (nightly 2:00 am Perth via cron, and the Reports "Refresh" button): Board Report
  data. Owns keys `products`, `assemblies`, `fbBatches`, `beerRange`, `parked`, `eff`, `meta`. Fetches
  pages a few at a time so it fits the 150 s edge function limit (it used to time out from the cron).
- `keg-stock` with body `{"mode":"all"}`: all stock on hand + open PO lines → key `sohAll`.
  Without it: Kegstar stock → `kegStock`.
- `unleashed-assemblies`: open (not completed) assemblies with lines → key `open_assemblies`.
  Body `{"match":"text"}` returns any status matching a product; `params` passes GET filters.
  It must never write the Board Report keys above. Forecast assemblies are Parked with
  `CustomAssemblyStatus = "Forecasted-FB"`.
- `unleashed-bom`, `ingredient-sync`, `stock-sync`, `hop-stock`: BOMs, ingredient list, stock.

## How the brewery uses the app (things that bit us before)

- Brew sheet quantities are stored in **grams** (ml for liquids, 1:1). Unleashed units vary: Kg, g,
  ml, Litre, or none. Malt and hops with no unit in Unleashed are Kg.
- **Ingredients used** (Batch Details) is what gets copied into the Unleashed assembly. A blank
  actual means none went in (actuals start pre-filled with the planned amount). It pastes plain
  numbers and leaves "CHECK UNIT" rather than a guess.
- Unleashed FB assemblies are completed when beer goes to the BBT (`batches.unl_bbt_done_at`). Until
  then, hops and malt used in the cellar are gone physically but still on hand in Unleashed: account
  for that in stock or stock-take work.
- Hops for each turn are that turn's own planned amount. No "catch-up" for a short or over pour on an
  earlier turn (that caused wrong prompts after a turn split).
- Turns over 25 HL are high gravity (kettle fill, diluted at KO, mash 2°C hotter).
- **Split a beer** (Cellar → tank → "Split off a new beer"): the new beer is its own batch with the
  next batch number, linked by `parent_batch_id` / `split_l` / `split_date`. It copies the parent's OG,
  readings and cellar steps; outstanding additions are shared by volume. In Unleashed the parent is
  assembled for its full volume and the split beer from litres of the parent's FB plus its additions.
- **Barrels:** status `barrelled` (no tank); in from an FV or a BBT, back out to a BBT.
- Today / cellar rules live in `src/lib/cellarSteps.js` (stable = a reading the same as or higher than
  the day before; Biofine the day after chill).
- Starting a brew: the booked FV isn't pre-selected if a beer is still in it (pick and confirm), and a
  brew started in a different FV than booked moves its booking's FV cells on the schedule to that tank.
- **Label energy statement** (recipe page, "Energy information (label)"): same maths as FSANZ's alcohol
  energy calculator (`src/lib/energyLabel.js`: ABV × 0.791 ÷ SG, Schedule 11 factors, 3 dp steps, 3 sig figs).
  Inputs saved in `recipes.energy_label`.
- Packaging cells on the Schedule work out their beer from the booking, then cell colour; double-click
  shows the brewed batch.

## Open items / offers not yet taken up

- QC Log marks the B-Tube due on day 5; the SOP reads it finally on day 7. Ryan may want the app
  changed to day 7.
- QC Log's batch list only has core-range beers (it comes from Sensory): seasonals are logged as
  Environmental on "Seasonal batch". Offered to fix.
- SOP still refers to removed sections 10 and 11 in a few places; the 60% swab-round rule was
  removed with section 10.
- "Blue Lake Milling Rolled Barley 25kg" has no PPG or colour on the Ingredients page yet (suggested
  32 PPG, 1.5 °L until the supplier's spec arrives).
- Mammoth: switch back to Caraamber once it's in Unleashed. Hop stock refresh for all users was offered.

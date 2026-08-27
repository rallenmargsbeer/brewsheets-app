# Brewsheets App

Replaces the Google Sheets brewsheets (recipe + brew-day process logging + fermentation/cellar
logging) with a dedicated app. Stack: React + Vite, Supabase, deployed on Vercel — same pattern
as [sensory-app](https://github.com/rallenmargsbeer/sensory-app).

## v1 scope

- **Recipes** — grist bill, water chemistry, mash schedule, hop schedule, yeast/whirlfloc/biofine
- **Batches** — one actual brew of a recipe, made up of 1–4 "brew runs" (separate brewhouse
  turns combined into one fermenter)
- **Brew-day logging** — per brew run: mash, lauter, boil, transfer/knockout, whirlpool
- **Fermentation / cellar logging** — daily tank readings + cellar tasks

Out of scope for v1 (later phases): full tank/vessel scheduling & brewing calendar, packaging/
excise tracking, centrifuge log, CIP tracking. `tanks` exists now only as a lightweight lookup so
batches/fermentation readings can reference a vessel.

The original template this was modeled on lives at `MR Beer Co Brewsheet Templates 25HL.xlsx`
in this repo — kept for reference, not used programmatically. The schema here is a redesigned,
normalized version of it, not a 1:1 copy.

## Local setup

```bash
npm install
cp .env.example .env.local   # fill in your Supabase project URL + anon key
npm run dev
```

## Database

Schema lives in `supabase/migrations/`. Apply with the Supabase CLI (`supabase db push`) or
paste the SQL into the Supabase SQL editor.

## Future integration with sensory-app

Once this app has real batch data, sensory-app's batch sync (`sync-batches` edge function
currently reading a Google Sheet) will be replaced by a small integration reading directly from
this app's `batches` table instead. See the sensory-app repo / project notes for details.

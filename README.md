# Living Dex

Your own app for collecting one card of every Pokémon. Scan a card with your phone and it finds the
exact card, shows the official card image in your binder, and fills in its **TCGplayer market price
in pounds** automatically.

## Put it on your phone (about 10 minutes, once)

You host it free on GitHub Pages, the same way as Fed and Watered.

1. **Make a repository.** On github.com, click **New repository**. Name it `living-dex`, set it to
   **Public**, and click **Create repository**.
2. **Upload the files.** On the new repository's page, click **uploading an existing file**. Unzip
   `living-dex-site.zip` on your computer and drag **everything inside the folder** (`index.html`,
   `sw.js`, `manifest.webmanifest` and the `icons` folder) into the upload box. Click **Commit changes**.

   **Already set up from the first version?** Just upload the new `index.html` and `sw.js` over the
   old ones (GitHub replaces files with the same name). You can delete the old `styles.css` file and
   `js` folder from the repository afterwards; they're no longer used.
3. **Switch on Pages.** Go to **Settings → Pages**. Under *Build and deployment*, set *Source* to
   **Deploy from a branch**, the branch to **main** and the folder to **/ (root)**, then **Save**.
4. **Wait a minute,** then refresh that Settings page. It shows your link, which will be
   `https://<your-github-username>.github.io/living-dex/`.
5. **Install it.** Open that link in **Safari** on your iPhone, tap **Share → Add to Home Screen**,
   and leave **Open as Web App** switched on.

Open it from the home screen icon from now on. That matters on iPhone: Safari can clear data for
websites you haven't visited in a while, but not for apps on your home screen.

## Using it

**Getting around:** the bottom bar has **Binder**, **Search**, **Scan** (in the middle), **Wishlist**
and **Value** (Prices, Insights, Grading, Top cards). The top bar switches collection (English,
Japanese, Korean, Chinese), adds a card by hand (**+**) and opens settings.

- **Search**: type a Pokémon, a card name ("Charizard ex") or an illustrator ("artist: Arita") to see
  every printing: picture, set and set symbol, number, rarity, year, illustrator and a TCGplayer price
  for each finish (normal, holo, reverse holo, 1st Edition), marked Owned or Missing. Sort by newest,
  oldest or price, and filter to owned or missing. Tap any card for its page.
- **Card page**: big picture (tap to enlarge), price by finish with an **Add** button for each,
  your copies, set details, illustrator (tap to see all their cards), graded estimates, price history
  and wishlist.
- **Binder**: tap a card to open its page. Tap an empty slot to see every version of that Pokémon.
- **Quick scan** (in the filter sheet): a live camera. Hold cards up one at a time and each is read,
  added (or counted as a spare) with a beep, then it waits for the next. Anything it isn't sure of
  (several matches, a possible 1st Edition, an unreadable card) goes in a list to sort out by tapping.

- **Scan a card**: take a photo, check the crop (it finds the card's edges by itself), and tap
  **Use this crop**. It reads the name and the number at the bottom (like `025/165`), finds that
  exact card, and shows the price. Tap **Add to Dex**.
  - Several matches? Tap the one that looks like yours.
  - Couldn't read it? Type the Pokémon and the card number, then tap **Find**.
  - **Reverse holo**? Tap it under the price, since those are often worth more.
- **The first scan takes longer**: it downloads the text reader (a few MB). After that it's cached.
- **Rapid scan** (in the filter sheet; the Scan button turns to Rapid when it's on): skips the crop screen when the card is found, and adds clear
  matches by itself. Duplicates count as spares. Great for bulk lots.
- **Prices tab**: your collection, most valuable first. **Update all prices** refreshes every card.
  The app reminds you when prices are over a week old. TCGplayer prices in the price database are refreshed every week or two.
- **Wishlist**: tap any missing slot to star it and set the most you'd pay.
- **Spares list**: a ready-to-paste list of your duplicates for trading.
- **Regions strip**: tap **All** for every Pokémon, or a region to see just that generation.
- **Sort**: Dex order, or value high to low (the dropdown next to the type filter).
- **Search**: by name, Dex number or illustrator (e.g. "Arita"). Illustrators fill in as cards are
  scanned or prices updated.
- **Stats tab**: your collection's value over time (tap the chart to see any day), the cards whose
  prices moved most since the last update, spending by month against what those cards are worth now,
  and milestones (with a pop-up when you earn one).
- **Grading tab**: your cards ranked by the likely gain from grading, after the grading cost (set it
  at the top of the tab; it starts at £45, roughly PSA's cheapest open service). Uses the condition
  you recorded, so set it on your best cards. Cards on your graded watch list (see below) show **real
  PSA 8, 9 and 10 prices**: the median of recent eBay sales, with how many sold. Anything shown with a
  **~** is a rough guide worked out from typical PSA premiums, so check recent sold slabs before
  sending those off. Each card also shows its PSA 8, 9 and 10 values when you open it.
- **Wishlist tab**: tap **Check prices** to find the cheapest card for each wishlisted Pokémon. Any at or
  under your "most I'd pay" price get a **Deal** tag.
- **Top cards tab**: the 500 most valuable Pokémon cards of all, by TCGplayer market price, with a tag on
  any you own. Needs the one-off setup below.
- **Dex / All cards switch** (next to Rapid scan): **Dex** is one card per Pokémon. **All cards** shows how
  many cards you own of each Pokémon; tap one to see every card printed for it, with the ones you own
  highlighted and your binder card starred. Add any card to your collection, or tap an owned card and
  choose **Make this my binder card**. Scanning a different card of a Pokémon you already have offers
  **Keep both**.
- **Regional forms and Megas**: switch them on in Settings → Extra binder slots. They get their own
  slots straight after their Pokémon, and scanned form cards (e.g. "Alolan Vulpix", "Mega Charizard X ex")
  go into the right slot by themselves.
- **Japanese, Korean and Chinese collections**: switch with the English / Japanese / Korean /
  Chinese buttons at the top. Each is its own binder with its own progress, value, wishlist and stats,
  stored separately on the phone, so they never mix with your English cards. Scanning reads the name in
  that language (the first scan downloads the reader for it), and you can type names in English, the
  local language or by Dex number. Chinese searches both Traditional and Simplified cards. Most of these
  cards have no market price, so there's a **Your value** box to set your own. The card database is less
  complete for these languages (Korean especially), so some cards won't be found: save them without card
  details and set a value.
- **Price history chart**: open any card to see a line chart of its value over time (tap it for any
  point). Each card saves a point every day its price is updated or you change your value. Until a card
  has two saved prices, it shows the one saved price.
- **Settings (cog icon)**: extra slots for forms, official card images or your photos, back up,
  restore, export to a spreadsheet, or import one.

## Setting up the Top cards tab (once)

The list is built once a day by GitHub itself, for free, and saved to your site.

1. **Upload the script.** In your repository, click **Add file → Upload files** and drag in the
   `scripts` folder from the zip (it contains `top-cards.mjs`). Commit.
2. **Create the daily job.** Click **Add file → Create new file**. For the name, type
   `.github/workflows/top-cards.yml` exactly (typing the slashes makes the folders). Open
   `top-cards.yml` from the zip (it's in `.github/workflows`, also copied as
   `top-cards-workflow.txt` so it's easy to find), copy all of it, paste it in, and commit.
3. **Run it the first time.** Open the **Actions** tab (click the button to enable workflows if GitHub
   asks), choose **Update top cards**, then **Run workflow**. It can take up to an hour the first time,
   because it may need to look up every card's price. After that it runs by itself every Monday and
   Thursday morning.
4. Open the app's **Top cards** tab.

If the run fails with a permissions error: **Settings → Actions → General → Workflow permissions**,
choose **Read and write permissions**, save, and run it again.

## Setting up real graded prices (once)

Real PSA prices come from [PokemonPriceTracker](https://www.pokemonpricetracker.com), which tracks eBay
sold listings. Its free plan allows about 40 cards a day, so you pick which cards to watch. GitHub
fetches their prices every morning and saves them to your site, so your key never goes near the app.

1. **Get a free key.** Sign up at pokemonpricetracker.com and copy your API key from the API keys page.
2. **Give it to GitHub.** In your repository: **Settings → Secrets and variables → Actions → New
   repository secret**. Name it `PPT_API_KEY` exactly, paste the key, and **Add secret**.
3. **Upload the files** from the update: `scripts/graded-prices.mjs`, `data/graded-watch.json`, and the
   workflow (create `.github/workflows/graded-prices.yml` the same way as the top cards one).
4. **Choose your cards.** In the app, go to **Value → Grading** and tap **Copy list for real graded
   prices**. It copies your 40 most valuable cards. On GitHub, open `data/graded-watch.json`, tap the
   pencil, select everything, paste, and commit.
5. Saving that file starts a run straight away (watch it in the **Actions** tab, **Update graded
   prices**). New cards are searched for once, which costs more, so a long list can take two mornings
   to fill in. After that it refreshes each card once a week.

Copy and paste the list again whenever your best cards change. If a run fails, open it in the Actions
tab: the log says which cards weren't found and shows an example answer from the price service.

## Moving your cards over from the Claude version

In the Claude version, tap **Export CSV** and save the file. Here, go to **Settings → Import CSV**
and pick it. Your cards, wishlist, paid amounts and values come across. To get live prices for an
imported card, open it, check the Pokémon and card number, tap **Find** and pick the card.

## Back it up

Your collections live on your phone only. Every so often, go to **Settings → Save a backup** and keep
the file in iCloud Drive or Files. One backup holds every collection (English, Japanese, Korean and
Chinese), each kept separate, plus each card's price history. To move to a new phone, install the app
there and use **Restore a backup**.

## Where prices come from

Prices are TCGplayer **market** prices (recent sale prices on TCGplayer, a US marketplace) for the
card's finish, fetched from the [Pokémon TCG API](https://pokemontcg.io) (free, no sign-up). It's the
only free source of TCGplayer prices, refreshes them every week or two, and often answers with an error
before working a moment later, so the app retries and keeps each card's last price if it can't get a new
one. Cards are also looked up on [TCGdex](https://tcgdex.dev) for newer sets and better pictures, then
priced from their Pokémon TCG API twin. Dollars are converted to pounds using the day's rate from
[Frankfurter](https://frankfurter.dev). The text
reading uses [Tesseract.js](https://tesseract.projectnaptha.com), which runs on your phone.
Pokémon names and types come from [PokéAPI](https://pokeapi.co).

## What's in the folder

| File | What it does |
|---|---|
| `index.html` | The whole app: page, styles and code in one file |
| `scripts/top-cards.mjs` | Builds the Top cards list from TCGdex (run by GitHub) |
| `.github/workflows/top-cards.yml` | Tells GitHub to run that script twice a week |
| `scripts/graded-prices.mjs` | Fetches real PSA prices for your watch list (run by GitHub) |
| `.github/workflows/graded-prices.yml` | Tells GitHub to run that script every morning |
| `data/graded-watch.json` | The cards to fetch graded prices for (paste from the app) |
| `sw.js` | Lets the app open offline and load fast |
| `manifest.webmanifest`, `icons/` | Home screen name and icon |

The readable source code, split into separate files with comments, is in `living-dex-source.zip`:

| File | What it does |
|---|---|
| `styles.css` | How it looks, light and dark |
| `js/app.js` | The app: binder, scanning flow, prices, wishlist, backups |
| `js/cards-api.js` | Looks cards and prices up in TCGdex and the Pokémon TCG API |
| `js/ocr.js` | Reads the name and card number off your photo |
| `js/detect.js` | Finds the card's edges and runs the crop screen |
| `js/store.js` | Saves your collection on the phone (IndexedDB) |
| `js/data.js` | The 1,025 Pokémon, their types and legendaries |
| `js/grading.js` | Graded value estimates and the grading advice |

## Changing it later

After uploading a new version, **change `VERSION` in `sw.js`** (for example to `living-dex-v3`) and
upload that too. Phones pick up the new version the next time the app is opened twice.

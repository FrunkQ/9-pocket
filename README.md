# Nine Pocket

Scan your cards, fill the binder. A free set-completion tracker for trading cards that runs in the browser on a phone or a computer.

Add a set, and every card in it appears as an empty pocket on a 9-pocket binder page. Scan or search for a card you own and its pocket fills in. The app shows what is still missing, a rough cost to finish the set, and an eBay search for each card.

## What it covers

| Kind | Sets | Source | Pictures | Prices |
|---|---|---|---|---|
| Hockey | 269 Upper Deck products, 2015-16 to 2026-27 | Upper Deck's published checklists, built into `public/catalog/hockey/` | your own scans | estimates |
| Magic | every paper set | [Scryfall](https://scryfall.com/docs/api), fetched on demand | yes | market prices |
| Pokémon | every English set | [TCGdex](https://tcgdex.dev), fetched on demand | yes | estimates |

| Baseball, Basketball, Football, Soccer, Other | whatever you load | checklist files you download yourself (see below) | your own scans | estimates |

Sets are downloaded when first added and kept on the device, so only the sets a person collects take up space.

### Sets from checklist files

Topps and other makers publish their checklists for collectors but do not license them to apps, and their sites turn automated readers away. So for those sets the user fetches the list and the app reads it: "Add a set", then "Load a checklist file".

- The screen links to Topps' "Checklist Spotlight" articles and explains the steps.
- A Topps checklist PDF is read as it is: headings become the base set, its versions and the insert sets, and each line gives a card's number, name, team and rookie marker.
- A list printed in an article can be copied and pasted in, or saved as a .csv or .txt file: one card per line, number first.
- The set is kept on the device and included in backups. It is never added to this repository or sent anywhere.

Each of these kinds of card is a tab that stays hidden until a set of that kind is loaded.

## What it does

- **Your tabs**: "Card types" on the home screen switches tabs on and off, so a collector sees only the kinds of card they collect. The app opens on the tab used most.
- **Add a set** from the list, or scan a card and let the app find which set it is from. When a card prints its own set or subset (hockey backs say "2025-26 SP HOCKEY"; fronts often name the subset, "Rookie Authentics") and that set is not in your binders, the app offers it above the other matches, even if the player was found in a set you do have. The version printed on the back ("BLUE") is selected for you. Matching itself only looks in sets already downloaded to the device, so when a scan matches nothing there, the app lists the sets that card is in, ready to add.
- **Scan a card** with the phone camera. The app finds the card's edges, straightens it, reads the text on it in the browser and offers the closest matches to confirm. A photo upload and typed search do the same job without a camera. Typed search takes a name, a card number ("MVP-6", "MVP 6" and "MVP6" all work) or a subset ("stickers").
- **Which card of that player**: the reader finds the name but cannot tell a base card from a sticker or an insert, so the confirm step lists the player's other cards in the set to switch to in one tap. Matches from sets in your binders come first; matches from other sets are greyed out below.
- **Either side of a card**: the back of a card names its set and version, the front makes the better picture. Stuck after scanning a front? "Scan the back of this card" reads the back while the front stays the saved picture. Scanned the back first? The confirm step offers to take the front for the picture. For the first card from a new set, the back is the side to start with.
- **Several cards in one shot**: lay cards out 2×2, 3×3 or 4×4, take one picture, and confirm the matches in a list. Each card gets fewer pixels the more you fit in, so the app reports how many it had and warns when that is too few.
- **Select**: the third tab on the scan screen, beside Camera and Type. Pick a set and every card number is a button: tap to add, tap again to take it back. The fast way to record a set you already own.
- **Card photos**: the straightened scan is saved (compressed) with the copy and shown in the binder and on the card.
- **Versions**: each copy records which parallel or finish it is, its condition and how it is protected. A version the checklist does not list can be given a name of your own ("Blue"), which is then offered for the set's other cards.
- **Values**: market prices where the source has them, otherwise an estimate marked with `~` (see `src/lib/estimate.ts`).
- **Display currency**: values are worked out in US dollars and can be shown in Canadian dollars, pounds, euros or Australian dollars, using the European Central Bank's daily rates (via the Frankfurter API).
- **eBay links** on every card: items for sale now, and recent sold prices.
- **Compare with a friend**: send your collection as a link or a file (photos optional), open theirs, and see which cards each of you could give the other.
- **Backup**: download the collection as a file, with or without the photos, and restore it later or on another device. Sets loaded from checklist files are in the backup too.

### Install and offline

The app can be installed to a phone's home screen or a computer. On Android, Chrome and Edge the home screen shows an Install button; on iPhone and iPad it shows the steps (Share, then Add to Home Screen), because Safari gives a page no way to trigger it.

Once opened online, the app is stored on the device by a service worker and opens without a connection. Hockey sets, fonts and the text reader are stored as they are used. Adding a new set, and Magic and Pokémon card pictures, still need a connection.

The collection is stored in the browser (`localStorage` for the card list, IndexedDB for photos and downloaded sets). Nothing is sent to a server; a shared link carries the card list inside the link itself. "Advanced" on the home screen can erase everything on the device. The line at the very bottom of the home screen shows when the running version was built and from which commit, to check that a deploy has arrived.

### Scanning tips

Phone cameras cannot focus very close. If the card is blurry, hold the phone further back and use the 2× or 3× zoom on the scan screen, or pick a different lens from the camera list. Tapping the picture asks the camera to refocus.

Take cards out of sleeves and top-loaders where you can: the app finds a bare card's edges and crops the photo much more cleanly, and there is no glare over the name.

Card fronts often use display lettering that is hard to read by machine. The app reads each card several ways (including turned on its side, for names printed up the edge) and matches loosely against the names in your sets. It tries first whatever worked on the last few cards, so a pile from one set gets quicker after the first card. When a front will not read, the back of the card usually does.

## Run it

```bash
npm install
npm run dev
```

Then open http://localhost:5173.

### Try it on a phone

Phone browsers only allow the camera on a secure (https) page. This serves the app over https on your local network:

```bash
npm run dev:phone
```

Open the `https://<your-computer>:5173` address it prints on the phone and accept the self-signed certificate warning.

## Deploy

The app is a static site. `npm run build` writes it to `dist/`, including the hockey catalogue.

The build also writes `sw.js` (from `sw/sw.js`, with the list of built files filled in by `vite.config.ts`). App icons are generated by `node scripts/make-icons.mjs`.

`wrangler.jsonc` is set up for Cloudflare Workers static assets:

- Build command: `npm run build`
- Deploy command: `npx wrangler deploy`

## The hockey catalogue

`public/catalog/hockey/` is generated: one file per set, `index.json` listing them, `players.json` saying which sets each player appears in, and `subsets.json` saying which sets have a named part such as "Rookie Authentics" or "Young Guns" (both used to find a scanned card's set).

```bash
npm run data:fetch
```

downloads every NHL checklist page from Upper Deck into `data/raw/ud/` (it skips pages already saved), and

```bash
npm run data
```

rebuilds the catalogue from them. `node scripts/inspect-checklist.mjs data/raw/ud/<file>.html` lists the subsets in one page.

## Adding another kind of card

A kind of card is an entry in `CATEGORIES` in `src/types.ts`. With `source: 'files'` that is all it needs: its sets come from checklist files (`src/lib/checklist-file.ts`). With `source: 'catalogue'` it also needs a provider in `src/data/providers.ts` with two functions (list the sets, and load one set as a `Product`), and `src/lib/identify.ts` taught how to find a card's set from text.

## Known limits

- Card matching reads printed text. It does not compare the picture on the card, so it cannot tell parallels apart; you pick the version.
- Hockey has no stock card images. A card shows your own scan once you have one, and a plain team-coloured face until then.
- Straightening needs the whole card in the picture with a little of the table showing all round. It finds the card by learning the background's colours from the rim of the picture, so the card can be small, off-centre or tilted, and the background can be textured (carpet). When the card runs off the picture it says so and crops to the frame instead. A card with a border the same colour as the surface it lies on (white on white) may be cropped to the picture inside its border.
- Estimated values come from a simple formula, not sale prices.
- A checklist file has to be text with one card per line. A PDF made of scanned pictures cannot be read, and a file laid out very differently from Topps' may need tidying first.
- "Find its set" from a scan only covers Hockey, Magic and Pokémon. A set loaded from a file has to be loaded before its cards can be matched.
- The first scan downloads the text reader (a few megabytes) and needs a connection. Adding a set needs a connection too.

## Licence

Free and open source under the [MIT licence](LICENSE): use it, change it and share it, for anything, as long as the copyright notice and licence text stay with it. That notice is the attribution.

The licence covers this app's code. The card lists and pictures come from Upper Deck's published checklists, Scryfall and TCGdex and stay under their own terms, and card names, logos and artwork belong to their owners. The text reader is [tesseract.js](https://github.com/naptha/tesseract.js) (Apache 2.0); the typefaces are Big Shoulders, Inter and IBM Plex Mono (SIL Open Font Licence).

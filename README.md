# Nine Pocket

Scan your cards, fill the binder. A free set-completion tracker for trading cards that runs in the browser on a phone or a computer.

Pick a set, and every card in it appears as an empty pocket on a 9-pocket binder page. Scan or search for a card you own and its pocket fills in. The app shows what is still missing, a rough cost to finish the set, and an eBay search for each card.

## What is in this first version

- **Four ice hockey sets**, built from Upper Deck's published checklists:
  2025-26 Allure, 2025-26 Series 1, 2026-27 MVP and 2023-24 SP Authentic. Base cards, rookies, every parallel, and the insert sets.
- **Scan a card** with the phone camera. The app finds the card's edges, straightens it, reads the text on it in the browser and offers the closest matches to confirm. A photo upload and typed search do the same job without a camera.
- **Card photos**: the straightened scan is saved (compressed) with the copy and shown in the binder and on the card.
- **Compare with a friend**: send your collection as a link or a file (photos optional), open theirs, and see which cards each of you could give the other.
- **Versions**: each copy records which parallel it is (Base, Red Rainbow, Gold Glitter Bomb /199 and so on), its condition and how it is protected.
- **Estimated values**, marked with `~`. There is no live price feed yet; see `src/lib/estimate.ts`.
- **eBay links** on every card: items for sale now, and recent sold prices.
- **Backup**: download the collection as a file, with or without the photos, and restore it later or on another device.

The collection is stored in the browser (`localStorage` for the card list, IndexedDB for photos). Nothing is sent to a server; a shared link carries the card list inside the link itself.

### Scanning tips

Phone cameras cannot focus very close. If the card is blurry, hold the phone further back and use the 2× or 3× zoom on the scan screen, or pick a different lens from the camera list. Tapping the picture asks the camera to refocus.

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

The app is a static site. `npm run build` writes it to `dist/`.

`wrangler.jsonc` is set up for Cloudflare Workers static assets:

- Build command: `npm run build`
- Deploy command: `npx wrangler deploy`

## Checklist data

`src/data/sets/*.json` is generated. To rebuild it, save each Upper Deck checklist page into `data/raw/` under the file name listed in `scripts/build-checklists.mjs`, then run:

```bash
npm run data
```

`node scripts/inspect-checklist.mjs data/raw/<file>.html` lists the subsets in a page, which helps when adding a new set. Adding a set means adding it to `PRODUCTS` in the build script and importing its JSON in `src/data/catalog.ts`.

## Known limits

- Card matching reads the printed name, team, number and set name. It does not yet compare the picture on the card, so it cannot tell parallels apart; you pick the version.
- There are no stock card images. A card shows your own scan once you have one, and a plain team-coloured face until then.
- Straightening needs the card's four edges to be visible against the background; when it cannot find them it crops to the frame instead.
- Values are estimates from a simple formula, not sale prices.
- The first scan downloads the text reader (a few megabytes) and needs a connection.

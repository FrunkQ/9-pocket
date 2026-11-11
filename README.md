# Nine Pocket

Scan your cards, fill the binder. A free set-completion tracker for trading cards that runs in the browser on a phone or a computer.

Pick a set, and every card in it appears as an empty pocket on a 9-pocket binder page. Scan or search for a card you own and its pocket fills in. The app shows what is still missing, a rough cost to finish the set, and an eBay search for each card.

## What is in this first version

- **Four ice hockey sets**, built from Upper Deck's published checklists:
  2025-26 Allure, 2025-26 Series 1, 2026-27 MVP and 2023-24 SP Authentic. Base cards, rookies, every parallel, and the insert sets.
- **Scan a card** with the phone camera. The app reads the text on the card in the browser and offers the closest matches to confirm. A photo upload and typed search do the same job without a camera.
- **Versions**: each copy records which parallel it is (Base, Red Rainbow, Gold Glitter Bomb /199 and so on), its condition and how it is protected.
- **Estimated values**, marked with `~`. There is no live price feed yet; see `src/lib/estimate.ts`.
- **eBay links** on every card: items for sale now, and recent sold prices.
- **Backup**: download the collection as a file and restore it later or on another device.

The collection is stored in the browser (`localStorage`). Nothing is sent to a server.

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
- There are no card images. Cards are drawn as plain team-coloured faces.
- Values are estimates from a simple formula, not sale prices.
- The first scan downloads the text reader (a few megabytes) and needs a connection.

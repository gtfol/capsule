# Capsule browser extension

A small Manifest V3 extension for Chrome and Brave. Open a product page, click Capsule in the toolbar, then choose **Add to wardrobe** or **Save to wishlist**. Capsule opens in a new tab, fetches the product information, and lets you review and edit the item before saving.

The extension uses the Capsule data and optional sync session in that browser profile. You do not need an account. It does not save an item until you confirm it in Capsule.

## Install locally

1. Download or clone this repository. Keep the `extension` directory somewhere permanent.
2. Open `chrome://extensions` in Chrome or `brave://extensions` in Brave.
3. Turn on **Developer mode**, choose **Load unpacked**, and select the `extension` directory (the directory containing `manifest.json`).
4. Pin Capsule from the browser's extensions menu.
5. Visit a shopping website and click the Capsule toolbar button.

No build step is required for the extension. It is not published in the Chrome Web Store; this is a local installation. After updating these files, click the extension's reload button on the extensions page.

## Permissions and privacy

- `activeTab` lets the popup read the URL and title of the current tab when you click the extension. There are no permanent site permissions.
- It passes the selected product URL to `https://capsule.gtfol.dev` only when you choose one of the two actions. The title stays in the popup.
- The full product URL, including variant parameters and fragments, is preserved. It travels in the new tab's address, so it may appear in browser history or hosting request logs.
- Capsule's existing importer fetches the selected listing. The extension does not read the page's content, send cookies, capture images, track browsing, save credentials, or scrape in the background.
- Browser internal pages, non-web URLs, URLs containing credentials, and Capsule itself cannot be imported.
- A retailer can block Capsule's fetch or remove a listing. The extension uses the same URL importer as the app, so those limitations also apply here.

## Local app development

The production destination is set in `config.mjs`. To test against a local Capsule server, make a separate copy of the extension directory and change `CAPSULE_URL` in that copy to your server, for example `http://127.0.0.1:3103/`. Load the copy unpacked, then reload it whenever you change its files. Keep the production value in the committed extension.

The app must include support for the `import` query parameter. The handoff URL is `/?view=add&to=wardrobe&import=…` or `/?view=add&to=wishlist&import=…`. An import is a draft for review, not an instruction to save.

Run the automated handoff and permissions checks from the repository root:

```sh
node --import tsx --test tests/browser-extension.test.ts
```

The PNG icons are rasterizations of Capsule's existing `public/icon.svg`. The regular Lato Latin font is the same WOFF2 used by the app, bundled in `fonts/lato-regular-latin.woff2` with the full [SIL Open Font License](fonts/OFL.txt) from [Google Fonts' Lato source](https://github.com/google/fonts/blob/main/ofl/lato/OFL.txt). Runtime scripts, styles, icons, and the font are bundled locally; the extension makes no remote font or script requests.

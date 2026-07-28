# BrewOS — Setup Guide

A personal, offline-first beer inventory app with a futuristic HUD look, a
pour-in launch animation, and 38 collectible badges. All your data (photos,
ratings, notes) is stored only on your own phone — nothing is uploaded
anywhere.

## 1. Put it on GitHub Pages (free, ~5 minutes)

1. Go to https://github.com and create a free account if you don't have one.
2. Click **+** (top right) → **New repository**.
   - Name it `beershelf` (any name works).
   - Set it to **Public**.
   - Click **Create repository**.
3. On the new repo page, click **uploading an existing file**.
4. Drag in *all* the files from this folder:
   `index.html, style.css, app.js, manifest.json, service-worker.js,
   icon-192.png, icon-512.png, apple-touch-icon.png`
5. Scroll down and click **Commit changes**.
6. Go to the repo's **Settings** tab → **Pages** (left sidebar).
7. Under "Build and deployment" → Source, choose **Deploy from a branch**.
   Branch: `main`, folder: `/ (root)`. Click **Save**.
8. Wait about a minute, then refresh — GitHub will show you a live URL like:
   `https://yourusername.github.io/beershelf/`

That URL is your app. It works from any phone or computer with internet the
first time, and keeps working offline afterward (the service worker caches it).

## 2. Add it to your iPhone Home Screen

1. Open the GitHub Pages URL in **Safari** (must be Safari, not Chrome, for this to work on iOS).
2. Tap the **Share** icon (square with an arrow) in the bottom toolbar.
3. Tap **Add to Home Screen**.
4. Tap **Add**.

You'll now have a BeerShelf icon on your home screen that opens full-screen,
like a real app — no App Store needed.

## 3. Share with a friend

Just send them the same GitHub Pages link. Each person's data stays on their
own device — you won't see each other's collections (this app has no shared
server/database). If you ever want a shared collection between devices, that's
a bigger project (needs a real backend) — happy to help with that later if you want it.

## Using the app

- **Shelf**: your main view. Tap **+ Add Beer** to add one.
- **Add Beer**: take/choose a photo → drag the 4 gold handles to crop tightly
  around the can or bottle → fill in name, brewery, style, star rating,
  location, date, notes → Save.
- Tap any can on the shelf to see its full details, edit, or delete it.
- **Collection**: a sortable list view of everything.
- **Stats**: totals, average rating, top styles.
- **Settings**: change the shelf background photo, export/import a backup
  file (JSON), or clear everything.

## Backing up your data

Since everything lives only on your phone's browser storage, it's a good idea
to occasionally go to **Settings → Export Data** and save the file somewhere
(e.g. email it to yourself, or save to Files/Drive). If you ever clear your
browser data or switch phones, use **Settings → Import Data** to restore it.

# What Trying Costs: A David Destroyers Digital Exhibit

A 3D walk-through museum that runs in the web browser, built with [Three.js](https://threejs.org/).

**Thesis (short version):** Debt doesn't decide who succeeds. It decides what trying costs, how you have to pay,
and what failing takes from you. The full thesis hangs in the domed Rotunda, behind a marble bust of David Copperfield.

```
       2. Ways to Pay           3. What Failure Takes
               \                       /
                \    ┌───────────┐    /
                 ╲──┤  ROTUNDA  ├──╱
                    │  bust under│
                    │  the dome  │
                 ╱──┤           ├──╲
                /    └─────┬─────┘    \
               /           │           \
   1. The Price Up Front   │    4. Same Price, Different Weight
                         Lobby
```

Each gallery has an intro panel with its part of the thesis. Its picture frames and plinths are **empty slots**
("Exhibit coming soon") waiting for the team's exhibits.

## Running it

Browsers block JavaScript modules opened straight from a file (`file://`), so start a tiny local web server:

```bash
# from the project folder
python3 -m http.server 8000
```

Then open <http://localhost:8000>. (VS Code's **Live Server** extension also works.)

Three.js is included in `lib/three/`, so the museum works with no internet connection.

### Controls

| Key | Action |
| --- | --- |
| W A S D / arrow keys | Walk |
| Mouse | Look around |
| Shift | Walk faster |
| E or click | Open the exhibit you're looking at |
| 1–6 | Jump to a room (numbers match the minimap: 1 Lobby, 2 Rotunda, 3–6 Galleries 1–4) |
| M | Show or hide the minimap |
| N | Music on/off |
| Esc | Pause |

**Phone or tablet:** tap **Enter on phone / tablet**. Use the left thumb stick to walk, drag anywhere else to look,
and tap an exhibit to open it. Buttons in the top-right corner toggle music and the map and open the menu.

**Music:** soft ambient music is generated live in the browser, so there are no audio files or licenses to worry about.
To play your own royalty-free track instead, set `music.file` in `js/config.js`.

## Adding your content

**Everything you need to change is in [`js/config.js`](js/config.js).** You shouldn't need to touch `main.js`.

- **Images**: put files in `assets/images/`, then add `image: 'assets/images/your-file.jpg'` to a painting.
  Set `width`/`height` to match the picture's shape (for example, a 3:2 photo could be `width: 3, height: 2`).
- **Text**: edit `title`, `subtitle`, and `description` (one string or a list of paragraphs). Add `link` for a "Learn more" link.
- **3D models**: put a `.glb` file in `assets/models/` and add `model: 'assets/models/thing.glb'` to a pedestal.
  Free models are available on [Sketchfab](https://sketchfab.com) (check the license) or you can export them from Blender.
- **New rooms**: copy a room block and give it new `x`, `z` values so it sits next to an existing room.
  Add a door on the shared wall, and the room on the other side gets the matching opening automatically.
- **Colors and floors**: `wallColor`, `floorColor`, `accent`, and `floor` (`concrete`, `wood`, `marble`, `tile`, `carpet`).
  `featureWall: 'north'` paints one wall in the room's accent color, `woodWall: 'north'` covers a wall in light wood slats,
  `ceiling: 'wood'` gives a wood-slat ceiling, and `skylight: true` adds a glowing ceiling skylight.
- **The bust**: the Main Hall centerpiece uses `shape: 'bust'`, a marble bust built from simple shapes.
  Pedestals also take `spin`, `facing`, and `spotlight`.

Remember to cite your image sources in each exhibit's description.

## Publishing (GitHub Pages)

1. Push to GitHub.
2. Go to **Settings → Pages**, choose **Deploy from a branch**, select `main` and `/ (root)`.
3. After a minute your museum will be live at `https://<username>.github.io/david-destroyers-digital-exhibit/`.

## Project structure

```
index.html        page layout, start screen, exhibit pop-up
css/style.css     on-screen styling
js/config.js      ← museum content: rooms, exhibits, decor
js/main.js        3D engine: building rooms, movement, collisions, interaction
lib/three/        Three.js library (MIT license)
assets/           your images and 3D models
```

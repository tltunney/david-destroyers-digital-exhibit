# David Destroyers Digital Exhibit

A 3D walk-through museum that runs in the web browser, built with [Three.js](https://threejs.org/).
Visitors enter through a **Lobby**, walk into the **Main Hall**, and branch off into four galleries.

```
            ┌──────────┬──────────┐
            │ Gallery 3│ Gallery 4│
            │  People  │  Legacy  │
   ┌────────┴───┬──────┴──────┬───┴────────┐
   │ Gallery 1  │  Main Hall  │ Gallery 2  │
   │  Origins   │             │  Turning   │
   └────────────┴──────┬──────┴────────────┘
                       │   Lobby   │
                       └───────────┘
```

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
| 1–6 | Jump to a room (numbers match the minimap) |
| M | Show or hide the minimap |
| Esc | Pause |

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
  `featureWall: 'north'` paints one wall in the room's accent color, and `skylight: true` adds a glowing ceiling skylight.
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

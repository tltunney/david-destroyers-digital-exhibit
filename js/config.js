// =====================================================================
//  MUSEUM CONTENT — this is the file you edit to build your exhibit.
// =====================================================================
//
//  Coordinates: the map is a flat grid seen from above.
//    x  = left (-) / right (+)        (west / east)
//    z  = forward (-) / backward (+)  (north / south)
//  Units are roughly meters. The visitor starts in the lobby facing north.
//
//  ROOMS
//    id        unique name used by the code
//    name      shown on the screen and on door signs
//    x, z      center of the room
//    w, d      width (x direction) and depth (z direction)
//    height    ceiling height (default 5)
//    floor     'wood' (oak planks) | 'concrete' (polished)
//    floorColor, wallColor, accent   any CSS color
//    featureWall  one wall painted in the accent color: 'north' | 'south' | 'east' | 'west'
//    woodWall  one wall covered in light wood slats: 'north' | 'south' | 'east' | 'west'
//    ceiling   'wood' for a wood-slat ceiling (default is plain white)
//    skylight  true to add a glowing skylight in the ceiling
//    entrance  glass front doors with an EXIT sign on that wall, e.g. 'south'
//    fixtures  false to leave out the guard chair, EXIT sign, extinguisher, smoke detectors, and camera
//    victorian true for the period look: gas-lamp sconces beside panels, a plaster cornice, mahogany trim
//    wallpaper damask wallpaper color, e.g. '#5e1a1f'     wainscot  true for mahogany panelling below
//
//  THE ROTUNDA is an octagon (shape: 'octagon') sized by its `apothem` (center to wall).
//    Things on its walls use `face` instead of `wall`: the compass bearing of that wall
//    (0 = north, 90 = east, -90 = west). Gallery wings attach to it with
//    attach: { to: 'rotunda', angle }, and get a doorway on their own south wall.
//    Inside a wing, north is always the far end and south the doorway back to the rotunda.
//    doors     { north|south|east|west: [{ at, width }] }
//              `at` = how far the door is from the middle of that wall.
//              You only need to put a door on ONE side; the room on the
//              other side of the wall gets the matching opening automatically.
//    exhibits  list of things to see (see EXHIBIT TYPES below)
//    decor     furniture: [{ type, x, z, rotation }]  (rotation in degrees; the front faces south at 0)
//              types: bench, settee, plant, palm, monstera, admissions (desk), clock, coatstand, guide (map easel),
//              donations, brochures, and stanchions: { type:'stanchions', points:[[x, z], [x, z], ...] } (a rope line)
//              x/z are relative to the room's center.
//
//  EXHIBIT TYPES
//    painting  framed image hung on a wall
//              { type:'painting', wall:'north', at:0, width, height, y,
//                image:'assets/images/my-photo.jpg', title, subtitle, description, link }
//              With no `image`, generated placeholder art is shown.
//    panel     wall-mounted text sign (good for room intros)
//              { type:'panel', wall:'east', at:-5, title, text, width, height }
//    pedestal  3D object on a stand
//              { type:'pedestal', x, z, shape:'bust'|'torusKnot'|'icosahedron'|'sphere'|'box'|'cone'|'torus',
//                color, model:'assets/models/thing.glb', scale, spin, facing, spotlight, rope, title, description }
//              `plinth: { width, height, inscription }` stands it on a tall marble monument plinth, and
//              `material: 'marble'` gives a model a marble surface.
//              `rope: true` puts brass posts and a velvet rope around it.
//    case      glass display case on a mahogany cabinet
//              { type:'case', x, z, rotation, title, subtitle, description, image }
//
//  `description` can be one string or an array of paragraphs.
//  Every painting, panel, and pedestal can be clicked (or press E) for details.
//
//  EMPTY SLOTS: a painting with no `image` and no `title` shows a blank
//  "Exhibit coming soon" frame, and a pedestal with no `shape` or `model`
//  is an empty plinth. Fill in the fields to add your exhibit.
// =====================================================================

export const MUSEUM = {
  title: 'What Trying Costs',
  subtitle: 'Debt, cushion, and the price of a chance in Dickens\'s David Copperfield and today',
  credits: 'A digital exhibit by the David Destroyers',
  spawn: { x: 0, z: 5, facing: 'north' },
  // Ambient music is generated in the browser. To use your own royalty-free track instead,
  // put it in assets/audio/ and set file: 'assets/audio/your-track.mp3'.
  music: { enabled: true, volume: 0.3, file: '' },
};

// The passage text on the wall panels is hidden while the team finalizes the wording.
// Panels show their titles with "Text coming soon". Set this to true to show the passages again.
const SHOW_PASSAGES = false;
const passage = (text) => (SHOW_PASSAGES ? text : '');

// Full thesis, shown in the Main Hall.
const THESIS =
  'In David Copperfield, debt works as an invisible filter that decides not who can succeed but what each attempt costs: ' +
  'the price paid up front, the way a person has to pay it, and what happens if they fail. All three depend on cushion: ' +
  'a patron, status, and socioeconomic position. The entry price is the same for everyone, but its weight is not. ' +
  'Betsey pays David\'s premium, and her later ruin doesn\'t end his career. Heep, with no money or status, must pay in ' +
  'other currencies, performed humility and eventually leverage over other people\'s debts and weaknesses, and no one ' +
  'catches him when it fails. Micawber and Traddles pay by credit and co-signing and are punished severely. Today\'s ' +
  'young people face the same three costs: a price to enter a profession, a limited set of ways to pay it, and a system ' +
  'whose language is hard to read, which sorts them less by effort than by who can afford to be wrong.';

const PITCH = 'Debt doesn\'t decide who succeeds. It decides what trying costs, how you have to pay, and what failing takes from you.';

// An empty exhibit slot. Fill in image/title/description to add an exhibit.
const empty = (wall, at, size = {}) => ({ type: 'painting', wall, at, ...size, image: '', title: '', subtitle: '', description: '' });
const emptyPlinth = (x, z) => ({ type: 'pedestal', x, z, model: '', shape: '', title: '', description: '' });

export const ROOMS = [
  // ------------------------------------------------------------- LOBBY (Victorian)
  {
    id: 'lobby',
    name: 'Lobby',
    x: 0, z: 0, w: 16, d: 14,
    floor: 'wood', floorColor: '#a8774d', accent: '#a07a4c',
    victorian: true, wallpaper: '#2e4a3c', wainscot: true, entrance: 'south',
    doors: { north: [{ at: 0, width: 5 }] },
    exhibits: [
      { type: 'panel', wall: 'west', at: 0, width: 3.4, height: 2.2, title: 'What Trying Costs', text: passage(PITCH) },
      {
        type: 'panel', wall: 'east', at: 0, width: 3.4, height: 2.2,
        title: 'About This Project',
        text: 'Add your names, class, and date here.',
      },
      empty('south', -5, { width: 2.2, height: 1.5 }),
      empty('south', 5, { width: 2.2, height: 1.5 }),
    ],
    decor: [
      { type: 'admissions', x: -4.6, z: -3.6 },
      { type: 'stanchions', points: [[-6.2, -1.9], [-6.2, 0.6]] },
      { type: 'brochures', x: -1.9, z: -4.4 },
      { type: 'stanchions', points: [[-3, -1.9], [-3, 0.6]] },
      { type: 'clock', x: 7.5, z: -5, rotation: -90 },
      { type: 'monstera', x: -3.6, z: -6.2 },
      { type: 'monstera', x: 3.6, z: -6.2 },
      { type: 'monstera', x: 7.1, z: 6.1 },
      { type: 'coatstand', x: -7.2, z: 5.6 },
      { type: 'guide', x: 2.6, z: 4.4, rotation: -20 },
      { type: 'donations', x: 6.9, z: 3 },
      { type: 'settee', x: -4.5, z: 3.5, rotation: 90 },
      { type: 'settee', x: 4.5, z: 3.5, rotation: 90 },
    ],
  },

  // ------------------------------------------------------------- PASSAGE into the rotunda
  {
    id: 'vestibule',
    name: 'Rotunda',
    passage: true, // not counted on the map or the number keys
    x: 0, z: -8.5, w: 5, d: 3, height: 4.5,
    floor: 'wood', floorColor: '#a8774d', accent: '#c9a24a',
    victorian: true, wallpaper: '#5e1a1f', wainscot: true,
    exhibits: [],
  },

  // ------------------------------------------------------------- ROTUNDA
  {
    id: 'rotunda',
    name: 'Rotunda',
    shape: 'octagon', apothem: 13.5,
    x: 0, z: -23.5, height: 7.5,
    accent: '#c9a24a',
    victorian: true, wallpaper: '#5e1a1f', wainscot: true,
    // the doorway to the lobby passage; the four gallery wings add their own doorways
    openings: [{ angle: 180, width: 5, link: 'vestibule', label: 'Lobby' }],
    exhibits: [
      {
        // full-length marble statue (made by tools/statue/make-statue.mjs); the old bust is the fallback
        type: 'pedestal', x: 0, z: 0, model: 'assets/models/copperfield.glb', material: 'marble', shape: 'bust',
        // a colossal 8 m figure (half again as tall as Michelangelo's 5.17 m David) under the dome
        color: '#f1eee8', scale: 8, plinth: { width: 3.2, height: 2.3, inscription: 'DAVID COPPERFIELD' },
        spin: false, facing: 'south', spotlight: true, rope: true,
        title: 'David Copperfield', subtitle: 'Narrator and hero of Charles Dickens\'s David Copperfield (1849–50)',
        description: 'Add your introduction to David here.',
      },
      { type: 'panel', face: 0, at: 0, width: 7, height: 3.8, y: 3.7, title: 'Thesis', text: passage(THESIS) },
      { type: 'panel', face: 90, at: 0, width: 3.4, height: 2.4, y: 2.6, title: 'The Big Idea', text: passage(PITCH) },
      {
        type: 'panel', face: -90, at: 0, width: 3.4, height: 2.4, y: 2.6,
        title: 'The Galleries',
        text:
          'Lower left: 1. The Price Up Front\n' +
          'Upper left: 2. Ways to Pay\n' +
          'Upper right: 3. What Failure Takes\n' +
          'Lower right: 4. Same Price, Different Weight',
      },
      // glass display cases between the gallery doorways (empty exhibit slots)
      { type: 'case', x: -4, z: -9.5, rotation: 23, title: '', description: '' },
      { type: 'case', x: 4, z: -9.5, rotation: -23, title: '', description: '' },
      { type: 'case', x: -9.5, z: 3.5, rotation: 110, title: '', description: '' },
      { type: 'case', x: 9.5, z: 3.5, rotation: -110, title: '', description: '' },
    ],
    decor: [
      { type: 'settee', x: 0, z: -6.5 },
      { type: 'monstera', x: -3.4, z: 11.2 },
      { type: 'monstera', x: 3.4, z: 11.2 },
      { type: 'settee', x: 6.5, z: 0, rotation: 90 },
      { type: 'settee', x: -6.5, z: 0, rotation: 90 },
    ],
  },

  // ---------------------------------------- GALLERY 1 (lower left): THE PRICE UP FRONT
  {
    id: 'price',
    name: 'Gallery 1: The Price Up Front',
    attach: { to: 'rotunda', angle: -135 },
    w: 11, d: 16,
    floor: 'wood', floorColor: '#c29a6b', wallColor: '#ebe5da', accent: '#2f6fde', featureWall: 'north', ceiling: 'wood',
    exhibits: [
      {
        type: 'panel', wall: 'south', at: -3.8, width: 2.6, height: 2,
        title: 'The Price Up Front',
        text:
          passage(
            'What you pay before knowing if it will work, usually with no refund.\n\n' +
            'In Dickens: Betsey pays David\'s premium.\n' +
            'Today: tuition, exam and licensing fees, unpaid internships.',
          ),
      },
      empty('west', -4), empty('west', 3.5),
      empty('east', -4), empty('east', 3.5),
      empty('north', 0, { width: 3.2, height: 2.2 }),
      emptyPlinth(-2, -3.5), emptyPlinth(2, -3.5),
    ],
    decor: [{ type: 'bench', x: 0, z: 1.5 }],
  },

  // ---------------------------------------- GALLERY 2 (upper left): WAYS TO PAY
  {
    id: 'ways',
    name: 'Gallery 2: Ways to Pay',
    attach: { to: 'rotunda', angle: -45 },
    w: 11, d: 16,
    floor: 'wood', floorColor: '#c29a6b', wallColor: '#ebe5da', accent: '#e4572e', featureWall: 'north', ceiling: 'wood',
    exhibits: [
      {
        type: 'panel', wall: 'south', at: -3.8, width: 2.6, height: 2.2,
        title: 'Ways to Pay',
        text:
          passage(
            'The route available to you, and what each one costs.\n\n' +
            '• Patron or family pays\n• Status or merit pays\n• Borrow\n• Someone else\'s credit\n' +
            '• Pay with time\n• Performance or deception\n• Leverage over others\n\n' +
            'Today: parents, loans, scholarships, working through school.',
          ),
      },
      empty('west', -4), empty('west', 3.5),
      empty('east', -4), empty('east', 3.5),
      empty('north', 0, { width: 3.2, height: 2.2 }),
      emptyPlinth(-2, -3.5), emptyPlinth(2, -3.5),
    ],
    decor: [{ type: 'bench', x: 0, z: 1.5 }],
  },

  // ---------------------------------------- GALLERY 3 (upper right): WHAT FAILURE TAKES
  {
    id: 'failure',
    name: 'Gallery 3: What Failure Takes',
    attach: { to: 'rotunda', angle: 45 },
    w: 11, d: 16,
    floor: 'wood', floorColor: '#c29a6b', wallColor: '#ebe5da', accent: '#1f9d6b', featureWall: 'north', ceiling: 'wood',
    exhibits: [
      {
        type: 'panel', wall: 'south', at: -3.8, width: 2.6, height: 2,
        title: 'What Failure Takes',
        text:
          passage(
            'What a mistake takes from you.\n\n' +
            'In Dickens: Betsey catches David; no one catches Heep or Micawber.\n' +
            'Today: the same missed payment, with or without savings or family behind it.',
          ),
      },
      empty('west', -4, { width: 1.6, height: 2.2 }), empty('west', 3.5, { width: 1.6, height: 2.2 }),
      empty('east', -4, { width: 1.6, height: 2.2 }), empty('east', 3.5, { width: 1.6, height: 2.2 }),
      empty('north', 0, { width: 3.5, height: 2.4 }),
      emptyPlinth(0, -3),
    ],
    decor: [{ type: 'bench', x: 0, z: 2 }],
  },

  // ---------------------------------------- GALLERY 4 (lower right): SAME PRICE, DIFFERENT WEIGHT
  {
    id: 'weight',
    name: 'Gallery 4: Same Price, Different Weight',
    attach: { to: 'rotunda', angle: 135 },
    w: 11, d: 16,
    floor: 'wood', floorColor: '#c29a6b', wallColor: '#ebe5da', accent: '#7b5cf0', featureWall: 'north', ceiling: 'wood',
    exhibits: [
      {
        type: 'panel', wall: 'south', at: -3.8, width: 2.6, height: 2.2,
        title: 'Same Price, Different Weight',
        text:
          passage(
            '• The price can look fair on paper, since everyone faces the same number.\n' +
            '• For David, it\'s one cost among many, covered by a patron. For someone without a cushion, it means ' +
            'borrowing, years of work, or a risky route.\n' +
            '• The price comes before you know whether it will pay off, so the buyer carries all the risk.',
          ),
      },
      {
        type: 'panel', wall: 'south', at: 3.8, width: 2.6, height: 2.2,
        title: 'Objections',
        text:
          passage(
            '"A fixed price is neutral." The price is equal, but its weight isn\'t.\n' +
            '"Merit and scholarships pay the price." They do, but they must be kept, and losing one costs more for people with no cushion.\n' +
            '"Heep is guilty." Yes. Poverty doesn\'t excuse him; it narrows his routes and removes his safety net.\n' +
            '"Today there are loans, bankruptcy, and aid." Those tools only help if you understand them.',
          ),
      },
      empty('west', -4), empty('west', 3.5),
      empty('east', -4), empty('east', 3.5),
      empty('north', 0, { width: 3.5, height: 2.4 }),
      emptyPlinth(0, -3),
    ],
    decor: [{ type: 'bench', x: 0, z: 2 }],
  },
];

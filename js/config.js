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
//    doors     { north|south|east|west: [{ at, width }] }
//              `at` = how far the door is from the middle of that wall.
//              You only need to put a door on ONE side; the room on the
//              other side of the wall gets the matching opening automatically.
//    exhibits  list of things to see (see EXHIBIT TYPES below)
//    decor     benches, plants, and desks: [{ type, x, z, rotation }]
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
//              `rope: true` puts brass posts and a velvet rope around it.
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
  // ------------------------------------------------------------- 1. LOBBY
  {
    id: 'lobby',
    name: 'Lobby',
    x: 0, z: 0, w: 16, d: 14,
    floor: 'wood', floorColor: '#c99f6e', wallColor: '#ebe5da', accent: '#a07a4c',
    woodWall: 'north', ceiling: 'wood', entrance: 'south',
    doors: { north: [{ at: 0, width: 5 }] },
    exhibits: [
      { type: 'panel', wall: 'west', at: 0, width: 3.4, height: 2.2, title: 'What Trying Costs', text: PITCH },
      {
        type: 'panel', wall: 'east', at: 0, width: 3.4, height: 2.2,
        title: 'About This Project',
        text: 'Add your names, class, and date here.',
      },
      empty('south', -5, { width: 2.2, height: 1.5 }),
      empty('south', 5, { width: 2.2, height: 1.5 }),
    ],
    decor: [
      { type: 'desk', x: -4, z: -3.5 },
      { type: 'plant', x: -6.8, z: -5.8 },
      { type: 'plant', x: 6.8, z: -5.8 },
      { type: 'bench', x: -4.5, z: 3.5, rotation: 90 },
      { type: 'bench', x: 4.5, z: 3.5, rotation: 90 },
    ],
  },

  // --------------------------------------------------------- 2. MAIN HALL
  {
    id: 'hall',
    name: 'Main Hall',
    x: 0, z: -19, w: 28, d: 24, height: 7, skylight: true,
    floor: 'concrete', floorColor: '#c4beb3', wallColor: '#ebe5da', accent: '#c9a24a',
    woodWall: 'north', ceiling: 'wood',
    doors: {
      west:  [{ at: 0, width: 4 }],
      east:  [{ at: 0, width: 4 }],
      north: [{ at: -7, width: 4 }, { at: 7, width: 4 }],
    },
    exhibits: [
      {
        type: 'pedestal', x: 0, z: 0, shape: 'bust', color: '#f1eee8', scale: 1.5,
        spin: false, facing: 'south', spotlight: true, rope: true,
        title: 'David Copperfield', subtitle: 'Narrator and hero of Charles Dickens\'s David Copperfield (1849–50)',
        description: 'Add your introduction to David here.',
      },
      { type: 'panel', wall: 'north', at: 0, width: 9, height: 4.4, y: 4, title: 'Thesis', text: THESIS },
      {
        type: 'panel', wall: 'south', at: -8, width: 3.4, height: 2.4,
        title: 'The Galleries',
        text:
          'West: 1. The Price Up Front\n' +
          'East: 2. Ways to Pay\n' +
          'North-west: 3. What Failure Takes\n' +
          'North-east: 4. Same Price, Different Weight',
      },
      { type: 'panel', wall: 'south', at: 8, width: 3.4, height: 2.4, title: 'The Big Idea', text: PITCH },
      empty('west', -7), empty('west', 7),
      empty('east', -7), empty('east', 7),
    ],
    decor: [
      { type: 'bench', x: -5, z: 5 },
      { type: 'bench', x: 5, z: 5 },
      { type: 'bench', x: -5, z: -5 },
      { type: 'bench', x: 5, z: -5 },
      { type: 'plant', x: -12.8, z: -10.8 },
      { type: 'plant', x: 12.8, z: -10.8 },
      { type: 'plant', x: -12.8, z: 10.8 },
      { type: 'plant', x: 12.8, z: 10.8 },
    ],
  },

  // ---------------------------------------- 3. GALLERY 1 (WEST): THE PRICE UP FRONT
  {
    id: 'price',
    name: 'Gallery 1: The Price Up Front',
    x: -24, z: -19, w: 20, d: 16,
    floor: 'wood', floorColor: '#c29a6b', wallColor: '#ebe5da', accent: '#2f6fde', featureWall: 'west', ceiling: 'wood',
    exhibits: [
      {
        type: 'panel', wall: 'east', at: -5, width: 3.2, height: 2.2,
        title: 'The Price Up Front',
        text:
          'What you pay before knowing if it will work, usually with no refund.\n\n' +
          'In Dickens: Betsey pays David\'s premium.\n' +
          'Today: tuition, exam and licensing fees, unpaid internships.',
      },
      empty('north', -5), empty('north', 4),
      empty('west', 0, { width: 3.2, height: 2.2 }),
      empty('south', -5), empty('south', 4),
      emptyPlinth(-3, 0), emptyPlinth(3, 0),
    ],
    decor: [{ type: 'bench', x: 0, z: 4 }],
  },

  // ---------------------------------------- 4. GALLERY 2 (EAST): WAYS TO PAY
  {
    id: 'ways',
    name: 'Gallery 2: Ways to Pay',
    x: 24, z: -19, w: 20, d: 16,
    floor: 'wood', floorColor: '#c29a6b', wallColor: '#ebe5da', accent: '#e4572e', featureWall: 'east', ceiling: 'wood',
    exhibits: [
      {
        type: 'panel', wall: 'west', at: -5, width: 3.2, height: 2.4,
        title: 'Ways to Pay',
        text:
          'The route available to you, and what each one costs.\n\n' +
          '• Patron or family pays\n• Status or merit pays\n• Borrow\n• Someone else\'s credit\n' +
          '• Pay with time\n• Performance or deception\n• Leverage over others\n\n' +
          'Today: parents, loans, scholarships, working through school.',
      },
      empty('north', -4), empty('north', 5),
      empty('east', 0, { width: 3.2, height: 2.2 }),
      empty('south', -4), empty('south', 5),
      emptyPlinth(-3, 0), emptyPlinth(3, 0),
    ],
    decor: [{ type: 'bench', x: 0, z: 4 }],
  },

  // ---------------------------------------- 5. GALLERY 3 (NORTH-WEST): WHAT FAILURE TAKES
  {
    id: 'failure',
    name: 'Gallery 3: What Failure Takes',
    x: -7, z: -41, w: 14, d: 20,
    floor: 'wood', floorColor: '#c29a6b', wallColor: '#ebe5da', accent: '#1f9d6b', featureWall: 'north', ceiling: 'wood',
    exhibits: [
      {
        type: 'panel', wall: 'south', at: -4.5, width: 2.6, height: 2,
        title: 'What Failure Takes',
        text:
          'What a mistake takes from you.\n\n' +
          'In Dickens: Betsey catches David; no one catches Heep or Micawber.\n' +
          'Today: the same missed payment, with or without savings or family behind it.',
      },
      empty('west', -5, { width: 1.6, height: 2.2 }), empty('west', 3, { width: 1.6, height: 2.2 }),
      empty('east', -5, { width: 1.6, height: 2.2 }), empty('east', 3, { width: 1.6, height: 2.2 }),
      empty('north', 0, { width: 3.5, height: 2.4 }),
      emptyPlinth(0, -2),
    ],
    decor: [{ type: 'bench', x: 0, z: 4 }],
  },

  // ---------------------------------------- 6. GALLERY 4 (NORTH-EAST): SAME PRICE, DIFFERENT WEIGHT
  {
    id: 'weight',
    name: 'Gallery 4: Same Price, Different Weight',
    x: 7, z: -41, w: 14, d: 20,
    floor: 'wood', floorColor: '#c29a6b', wallColor: '#ebe5da', accent: '#7b5cf0', featureWall: 'north', ceiling: 'wood',
    exhibits: [
      {
        type: 'panel', wall: 'south', at: -4.5, width: 2.6, height: 2.2,
        title: 'Same Price, Different Weight',
        text:
          '• The price can look fair on paper, since everyone faces the same number.\n' +
          '• For David, it\'s one cost among many, covered by a patron. For someone without a cushion, it means ' +
          'borrowing, years of work, or a risky route.\n' +
          '• The price comes before you know whether it will pay off, so the buyer carries all the risk.',
      },
      {
        type: 'panel', wall: 'south', at: 4.5, width: 2.6, height: 2.2,
        title: 'Objections',
        text:
          '"A fixed price is neutral." The price is equal, but its weight isn\'t.\n' +
          '"Merit and scholarships pay the price." They do, but they must be kept, and losing one costs more for people with no cushion.\n' +
          '"Heep is guilty." Yes. Poverty doesn\'t excuse him; it narrows his routes and removes his safety net.\n' +
          '"Today there are loans, bankruptcy, and aid." Those tools only help if you understand them.',
      },
      empty('west', -5), empty('west', 3),
      empty('east', -5), empty('east', 3),
      empty('north', 0, { width: 3.5, height: 2.4 }),
      emptyPlinth(0, -2),
    ],
    decor: [{ type: 'bench', x: 0, z: 4 }],
  },
];

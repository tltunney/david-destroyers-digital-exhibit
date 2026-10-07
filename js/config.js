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
//    floor     'wood' | 'marble' | 'tile' | 'carpet'
//    floorColor, wallColor, accent   any CSS color
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
//              { type:'pedestal', x, z, shape:'torusKnot'|'icosahedron'|'sphere'|'box'|'cone'|'torus',
//                color, model:'assets/models/thing.glb', scale, title, description }
//
//  `description` can be one string or an array of paragraphs.
//  Every painting, panel, and pedestal can be clicked (or press E) for details.
// =====================================================================

export const MUSEUM = {
  title: 'David Destroyers Digital Exhibit',
  subtitle: 'An interactive walk-through museum',
  credits: 'Created by the David Destroyers team',
  spawn: { x: 0, z: 5, facing: 'north' },
};

const PLACEHOLDER =
  'Replace this with your exhibit text: what this object is, where and when it is from, and why it matters to the story of the exhibit.';

export const ROOMS = [
  // ------------------------------------------------------------- LOBBY
  {
    id: 'lobby',
    name: 'Lobby',
    x: 0, z: 0, w: 16, d: 14,
    floor: 'marble', floorColor: '#d8d2c6', wallColor: '#e9e2d4', accent: '#b8862b',
    doors: { north: [{ at: 0, width: 5 }] },
    exhibits: [
      {
        type: 'panel', wall: 'west', at: 0, width: 3.2, height: 2.2,
        title: 'Welcome',
        text: 'Welcome to our digital exhibit. Walk through the Main Hall ahead to reach four galleries. Click on any artwork or sign to learn more.',
      },
      {
        type: 'panel', wall: 'east', at: 0, width: 3.2, height: 2.2,
        title: 'About This Project',
        text: 'Use this panel to introduce your class, your group members, and the big question your exhibit explores.',
      },
      {
        type: 'painting', wall: 'south', at: -5, width: 2.2, height: 1.5,
        title: 'Featured Image', subtitle: 'Lobby highlight', description: PLACEHOLDER,
      },
      {
        type: 'painting', wall: 'south', at: 5, width: 2.2, height: 1.5,
        title: 'Featured Image II', subtitle: 'Lobby highlight', description: PLACEHOLDER,
      },
    ],
    decor: [
      { type: 'desk', x: -4, z: -3.5 },
      { type: 'plant', x: -6.8, z: -5.8 },
      { type: 'plant', x: 6.8, z: -5.8 },
      { type: 'bench', x: -4.5, z: 3.5, rotation: 90 },
      { type: 'bench', x: 4.5, z: 3.5, rotation: 90 },
    ],
  },

  // --------------------------------------------------------- MAIN HALL
  {
    id: 'hall',
    name: 'Main Hall',
    x: 0, z: -19, w: 28, d: 24, height: 7,
    floor: 'tile', floorColor: '#bfb6a6', wallColor: '#d9cfbd', accent: '#8a5a2b',
    doors: {
      west:  [{ at: 0, width: 4 }],
      east:  [{ at: 0, width: 4 }],
      north: [{ at: -7, width: 4 }, { at: 7, width: 4 }],
    },
    exhibits: [
      {
        type: 'pedestal', x: 0, z: 0, shape: 'torusKnot', color: '#c9a227', scale: 1.8,
        title: 'Centerpiece', subtitle: 'The heart of the collection',
        description: [
          'The centerpiece is the first thing visitors see. Use it for the single most important object or idea in your exhibit.',
          'Tip: you can replace this shape with a real 3D model (.glb file) by setting `model` in config.js.',
        ],
      },
      {
        type: 'painting', wall: 'north', at: 0, width: 4.5, height: 3, y: 3,
        title: 'The Big Picture', subtitle: 'Overview', description: PLACEHOLDER,
      },
      { type: 'painting', wall: 'west', at: -7, width: 2.4, height: 1.8, title: 'Hall Piece I', description: PLACEHOLDER },
      { type: 'painting', wall: 'west', at: 7,  width: 2.4, height: 1.8, title: 'Hall Piece II', description: PLACEHOLDER },
      { type: 'painting', wall: 'east', at: -7, width: 2.4, height: 1.8, title: 'Hall Piece III', description: PLACEHOLDER },
      { type: 'painting', wall: 'east', at: 7,  width: 2.4, height: 1.8, title: 'Hall Piece IV', description: PLACEHOLDER },
      {
        type: 'panel', wall: 'south', at: -8, width: 3, height: 2,
        title: 'Galleries',
        text: 'West: Origins. East: Turning Points. North-west: People & Voices. North-east: Legacy.',
      },
      {
        type: 'panel', wall: 'south', at: 8, width: 3, height: 2,
        title: 'Timeline',
        text: 'Add a short timeline of key dates here so visitors have context before entering the galleries.',
      },
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

  // ------------------------------------------------- GALLERY 1 (WEST)
  {
    id: 'origins',
    name: 'Gallery 1: Origins',
    x: -24, z: -19, w: 20, d: 16,
    floor: 'wood', floorColor: '#8b5e3c', wallColor: '#3f5a73', accent: '#e0b64f',
    exhibits: [
      { type: 'panel', wall: 'east', at: -5, width: 2.4, height: 1.8, title: 'Origins', text: 'Introduce this gallery: where does the story begin?' },
      { type: 'painting', wall: 'north', at: -5, title: 'Origins I', description: PLACEHOLDER },
      { type: 'painting', wall: 'north', at: 4, title: 'Origins II', description: PLACEHOLDER },
      { type: 'painting', wall: 'west', at: 0, width: 3.2, height: 2.2, title: 'Origins III', description: PLACEHOLDER },
      { type: 'painting', wall: 'south', at: -5, title: 'Origins IV', description: PLACEHOLDER },
      { type: 'painting', wall: 'south', at: 4, title: 'Origins V', description: PLACEHOLDER },
      { type: 'pedestal', x: -3, z: 0, shape: 'icosahedron', color: '#7fb3d5', title: 'Artifact A', description: PLACEHOLDER },
      { type: 'pedestal', x: 3, z: 0, shape: 'box', color: '#c0392b', title: 'Artifact B', description: PLACEHOLDER },
    ],
    decor: [{ type: 'bench', x: 0, z: 4 }],
  },

  // ------------------------------------------------- GALLERY 2 (EAST)
  {
    id: 'turning-points',
    name: 'Gallery 2: Turning Points',
    x: 24, z: -19, w: 20, d: 16,
    floor: 'wood', floorColor: '#6e4a2f', wallColor: '#6b2f2f', accent: '#f0c674',
    exhibits: [
      { type: 'panel', wall: 'west', at: -5, width: 2.4, height: 1.8, title: 'Turning Points', text: 'Introduce this gallery: which moments changed everything?' },
      { type: 'painting', wall: 'north', at: -4, title: 'Turning Point I', description: PLACEHOLDER },
      { type: 'painting', wall: 'north', at: 5, title: 'Turning Point II', description: PLACEHOLDER },
      { type: 'painting', wall: 'east', at: 0, width: 3.2, height: 2.2, title: 'Turning Point III', description: PLACEHOLDER },
      { type: 'painting', wall: 'south', at: -4, title: 'Turning Point IV', description: PLACEHOLDER },
      { type: 'painting', wall: 'south', at: 5, title: 'Turning Point V', description: PLACEHOLDER },
      { type: 'pedestal', x: -3, z: 0, shape: 'torus', color: '#e67e22', title: 'Artifact C', description: PLACEHOLDER },
      { type: 'pedestal', x: 3, z: 0, shape: 'cone', color: '#ecf0f1', title: 'Artifact D', description: PLACEHOLDER },
    ],
    decor: [{ type: 'bench', x: 0, z: 4 }],
  },

  // ------------------------------------------- GALLERY 3 (NORTH-WEST)
  {
    id: 'people',
    name: 'Gallery 3: People & Voices',
    x: -7, z: -41, w: 14, d: 20,
    floor: 'carpet', floorColor: '#4a3b5c', wallColor: '#2f4f45', accent: '#e8d5a3',
    exhibits: [
      { type: 'panel', wall: 'south', at: -4.5, width: 2.2, height: 1.6, title: 'People & Voices', text: 'Introduce the people at the center of your story.' },
      { type: 'painting', wall: 'west', at: -5, width: 1.6, height: 2.2, title: 'Portrait I', description: PLACEHOLDER },
      { type: 'painting', wall: 'west', at: 3, width: 1.6, height: 2.2, title: 'Portrait II', description: PLACEHOLDER },
      { type: 'painting', wall: 'east', at: -5, width: 1.6, height: 2.2, title: 'Portrait III', description: PLACEHOLDER },
      { type: 'painting', wall: 'east', at: 3, width: 1.6, height: 2.2, title: 'Portrait IV', description: PLACEHOLDER },
      { type: 'painting', wall: 'north', at: 0, width: 3.5, height: 2.4, title: 'Group Portrait', description: PLACEHOLDER },
      { type: 'pedestal', x: 0, z: -2, shape: 'sphere', color: '#d4af37', title: 'Personal Object', description: PLACEHOLDER },
    ],
    decor: [{ type: 'bench', x: 0, z: 4, rotation: 0 }],
  },

  // ------------------------------------------- GALLERY 4 (NORTH-EAST)
  {
    id: 'legacy',
    name: 'Gallery 4: Legacy',
    x: 7, z: -41, w: 14, d: 20,
    floor: 'marble', floorColor: '#e7e3dc', wallColor: '#1f2a3a', accent: '#9ad1d4',
    exhibits: [
      { type: 'panel', wall: 'south', at: 4.5, width: 2.2, height: 1.6, title: 'Legacy', text: 'Wrap up your story: what is the lasting impact today?' },
      { type: 'painting', wall: 'west', at: -5, title: 'Legacy I', description: PLACEHOLDER },
      { type: 'painting', wall: 'west', at: 3, title: 'Legacy II', description: PLACEHOLDER },
      { type: 'painting', wall: 'east', at: -5, title: 'Legacy III', description: PLACEHOLDER },
      { type: 'painting', wall: 'east', at: 3, title: 'Legacy IV', description: PLACEHOLDER },
      { type: 'painting', wall: 'north', at: 0, width: 3.5, height: 2.4, title: 'Looking Forward', description: PLACEHOLDER },
      { type: 'pedestal', x: 0, z: -2, shape: 'icosahedron', color: '#9ad1d4', title: 'Final Artifact', description: PLACEHOLDER },
    ],
    decor: [{ type: 'bench', x: 0, z: 4 }],
  },
];

// Factory patterns and sound kits.
//
// Drum patterns are written as 16-character strings so they read like a
// hardware manual: `x` = hit, `X` = accent, `.` = rest.

export const DRUM_PRESETS = [
  {
    name: 'FOUR FLOOR',
    tracks: {
      kick:  'X...x...X...x...',
      snare: '....X.......X...',
      hat:   '..x...x...x...x.',
      open:  '................',
      clap:  '....x.......x...',
      perc:  '................'
    }
  },
  {
    name: 'ACID 303',
    tracks: {
      kick:  'X...X...X...X...',
      snare: '................',
      hat:   'x.x.x.x.x.x.x.x.',
      open:  '..............x.',
      clap:  '....X.......X...',
      perc:  '...x......x.....'
    }
  },
  {
    name: 'BERLIN',
    tracks: {
      kick:  'X...X...X...X...',
      snare: '................',
      hat:   '..X...X...X...X.',
      open:  '......x.......x.',
      clap:  '................',
      perc:  'x...x...x.x.x...'
    }
  },
  {
    name: 'BREAK',
    tracks: {
      kick:  'X.....x.....X...',
      snare: '....X.......X..x',
      hat:   'x.xxx.x.x.xxx.x.',
      open:  '..........x.....',
      clap:  '................',
      perc:  '................'
    }
  },
  {
    name: 'ELECTRO',
    tracks: {
      kick:  'X.....X...X.....',
      snare: '....X.......X...',
      hat:   'x.x.x.x.x.x.x.x.',
      open:  '............x...',
      clap:  '....x...........',
      perc:  '..x....x..x....x'
    }
  },
  {
    name: 'HALFTIME',
    tracks: {
      kick:  'X.......x.......',
      snare: '........X.......',
      hat:   '....x.......x...',
      open:  '..............X.',
      clap:  '................',
      perc:  '...x...x...x...x'
    }
  },
  {
    name: 'TRIBAL',
    tracks: {
      kick:  'X..x..X...x..X..',
      snare: '................',
      hat:   '................',
      open:  '................',
      clap:  '........x.......',
      perc:  'x.xXx.xxx.xXx.xx'
    }
  },
  {
    name: 'MINIMAL',
    tracks: {
      kick:  'X...............',
      snare: '................',
      hat:   '........x.......',
      open:  '................',
      clap:  '................',
      perc:  '..............x.'
    }
  }
];

// 303 lines paired with the drum presets. `-` holds, digits are scale degrees,
// uppercase marks accent, `~` marks slide into the next note.
export const BASS_PRESETS = [
  { name: 'ROLLING', notes: '0-0-3~0-5-0-7~0-' },
  { name: 'STAB',    notes: '0---0---5---3---' },
  { name: 'CLIMB',   notes: '0-3-5-7-A-7-5-3-' },
  { name: 'DUB',     notes: '0-------5-------' },
  { name: 'CHATTER', notes: '00-30-50-70-30-0' },
  { name: 'OFFBEAT', notes: '-0--0--5--0--3--' }
];

export function parseDrumPreset(str) {
  return str.split('').map((c) => {
    if (c === 'X') return { velocity: 1, accent: true };
    if (c === 'x') return { velocity: 0.75 };
    return null;
  });
}

const DEGREE = { '0': 0, '3': 3, '5': 5, '7': 7, 'A': 10, 'C': 12 };

export function parseBassPreset(str, root = 36) {
  const out = new Array(str.length).fill(null);
  for (let i = 0; i < str.length; i++) {
    const c = str[i];
    if (c === '-' || c === '~') continue;
    const degree = DEGREE[c.toUpperCase()];
    if (degree === undefined) continue;
    out[i] = {
      note: root + degree,
      velocity: c === c.toUpperCase() && c !== '0' ? 1 : 0.85,
      accent: i % 4 === 0,
      slide: str[i + 1] === '~'
    };
  }
  return out;
}

// Sample-deck kits, synthesised on demand so nothing has to ship as audio.
export const SAMPLE_KITS = [
  {
    name: 'ACID KIT',
    slots: [
      { type: 'kick', tune: 1, decay: 1 },
      { type: 'kick-deep', tune: 0.9, decay: 1.4 },
      { type: 'snare', tune: 1, decay: 1 },
      { type: 'clap', tune: 1, decay: 1.2 },
      { type: 'hat-closed', tune: 1, decay: 1 },
      { type: 'hat-open', tune: 1, decay: 1 },
      { type: 'cowbell', tune: 1, decay: 1 },
      { type: 'crash', tune: 1, decay: 0.8 }
    ]
  },
  {
    name: 'TOMS',
    slots: [
      { type: 'tom-low', tune: 0.8, decay: 1.3 },
      { type: 'tom-low', tune: 1, decay: 1.1 },
      { type: 'tom-high', tune: 0.9, decay: 1 },
      { type: 'tom-high', tune: 1.2, decay: 0.9 },
      { type: 'rimshot', tune: 1, decay: 1 },
      { type: 'clave', tune: 1, decay: 1 },
      { type: 'perc', tune: 0.8, decay: 1.4 },
      { type: 'shaker', tune: 1, decay: 1 }
    ]
  },
  {
    name: 'INDUSTRIAL',
    slots: [
      { type: 'kick-deep', tune: 0.7, decay: 2 },
      { type: 'kick', tune: 1.4, decay: 0.6 },
      { type: 'snare', tune: 0.6, decay: 2 },
      { type: 'snare', tune: 1.8, decay: 0.5 },
      { type: 'perc', tune: 0.5, decay: 2.2 },
      { type: 'crash', tune: 0.6, decay: 1.6 },
      { type: 'rimshot', tune: 0.5, decay: 2 },
      { type: 'hat-open', tune: 0.7, decay: 1.8 }
    ]
  }
];

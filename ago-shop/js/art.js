// Placeholder product artwork: comic-style garment drawings in SVG,
// so the store looks finished before real product photos are added.
// Give a product an `image` in data.js and that photo is used instead.

const INK = "#111";
const GOLD = "#ffcc1a";

const SHAPES = {
  zip: `M128 118 Q132 62 200 58 Q268 62 272 118 L304 128 Q330 210 352 318 L314 328 L284 212 L284 438 L116 438 L116 212 L86 328 L48 318 Q70 210 96 128 Z`,
  tee: `M122 96 L164 78 Q200 104 236 78 L278 96 L346 160 L308 200 L282 176 L282 424 L118 424 L118 176 L92 200 L54 160 Z`,
  pants: `M132 66 L268 66 L292 446 L222 446 L200 176 L178 446 L108 446 Z`,
  beanie: `M120 300 Q118 150 200 140 Q282 150 280 300 Z`,
};

const TRIM = {
  zip: `M100 124 Q70 210 48 318 L86 328 L116 212 L116 132 Z M300 124 Q330 210 352 318 L314 328 L284 212 L284 132 Z
        M128 118 Q132 62 200 58 Q268 62 272 118 Q236 134 200 134 Q164 134 128 118 Z M116 416 L284 416 L284 438 L116 438 Z`,
  tee: `M122 96 L54 160 L92 200 L118 176 Z M278 96 L346 160 L308 200 L282 176 Z`,
  pants: `M132 66 L268 66 L269 90 L131 90 Z`,
  beanie: `M116 250 L284 250 L284 306 L116 306 Z`,
};

const CENTER = { zip: [200, 230], tee: [200, 200], pants: [200, 160], beanie: [200, 150] };

// Spider-web lines: spokes from a center point, joined by sagging rings.
function web(cx, cy) {
  const n = 16, rings = 11, step = 30;
  const pt = (a, r) => [cx + Math.cos(a) * r, cy + Math.sin(a) * r].map((v) => v.toFixed(1));
  let d = "";
  for (let i = 0; i < n; i++) d += `M${cx} ${cy} L${pt((i / n) * Math.PI * 2, 360).join(" ")} `;
  for (let r = 1; r <= rings; r++) {
    for (let i = 0; i < n; i++) {
      const a0 = (i / n) * Math.PI * 2, a1 = ((i + 1) / n) * Math.PI * 2;
      const [x0, y0] = pt(a0, r * step), [x1, y1] = pt(a1, r * step), [qx, qy] = pt((a0 + a1) / 2, r * step * 0.86);
      d += `M${x0} ${y0} Q${qx} ${qy} ${x1} ${y1} `;
    }
  }
  return d;
}

function star(cx, cy, r) {
  let d = "";
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5, rr = i % 2 ? r * 0.45 : r;
    d += `${i ? "L" : "M"}${(cx + Math.cos(a) * rr).toFixed(1)} ${(cy + Math.sin(a) * rr).toFixed(1)} `;
  }
  return d + "Z";
}

const EMBLEM = { zip: [200, 200, 34], tee: [200, 170, 34], pants: [150, 130, 16], beanie: [200, 278, 20] };

let uid = 0;
export function productArt(p, sideIndex = 0, back = false) {
  const s = p.sides[sideIndex] || p.sides[0];
  const t = SHAPES[p.type] ? p.type : "tee";
  const id = `a${++uid}`;
  const [cx, cy] = CENTER[t];
  const webColor = s.web || INK;
  const view = t === "beanie" ? "60 100 280 240" : "0 20 400 460";
  const [ex, ey, er] = EMBLEM[t];
  const label = `${p.name}, ${s.name}${back ? ", back" : ""}`;

  return `<svg viewBox="${view}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${label}">
    <defs><clipPath id="${id}"><path d="${SHAPES[t]}"/></clipPath></defs>
    <g clip-path="url(#${id})">
      <path d="${SHAPES[t]}" fill="${s.base}"/>
      <path d="${TRIM[t]}" fill="${s.trim}"/>
      ${s.pattern === "web" ? `<path d="${web(cx, cy)}" fill="none" stroke="${webColor}" stroke-width="2.2" opacity=".8"/>` : ""}
      <path d="${TRIM[t]}" fill="none" stroke="${INK}" stroke-width="3" stroke-linejoin="round"/>
      <path d="${SHAPES[t]}" fill="none" stroke="#fff" stroke-opacity=".18" stroke-width="22" transform="translate(-8 -8)"/>
    </g>
    ${t === "zip" && !back ? `<path d="M200 128 L200 438" stroke="${INK}" stroke-width="5"/><path d="M200 128 L200 438" stroke="#d9d9d9" stroke-width="2" stroke-dasharray="3 3"/>
      <rect x="194" y="150" width="12" height="22" rx="3" fill="#d9d9d9" stroke="${INK}" stroke-width="3"/>` : ""}
    ${s.pattern === "star" && !back ? `<circle cx="${ex}" cy="${ey}" r="${er}" fill="${GOLD}" stroke="${INK}" stroke-width="4"/>
      <path d="${star(ex, ey, er * 0.72)}" fill="${s.trim === s.base ? "#d42a2a" : s.trim}" stroke="${INK}" stroke-width="3" stroke-linejoin="round"/>` : ""}
    ${s.eyes ? `<path d="M148 214 Q156 172 194 200 Q180 232 148 214Z M252 214 Q244 172 206 200 Q220 232 252 214Z" fill="#fff" stroke="${INK}" stroke-width="6" stroke-linejoin="round"/>` : ""}
    ${back && t !== "beanie" ? `<text x="200" y="${t === "pants" ? 150 : 270}" text-anchor="middle" font-family="Bangers, Impact, sans-serif" font-size="${t === "pants" ? 34 : 96}" fill="${GOLD}" stroke="${INK}" stroke-width="4" paint-order="stroke" letter-spacing="3">AGO</text>` : ""}
    <path d="${SHAPES[t]}" fill="none" stroke="${INK}" stroke-width="5" stroke-linejoin="round"/>
  </svg>`;
}

// What shows on hover: the other side for reversible pieces, the back for everything else.
export function media(p, alt = false) {
  const src = alt ? p.imageBack : p.image;
  if (src) return `<img src="${src}" alt="${p.name}${alt ? ", back" : ""}" loading="lazy">`;
  if (alt && p.reversible) return productArt(p, 1);
  return productArt(p, 0, alt);
}

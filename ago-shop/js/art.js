// Placeholder product artwork: flat garment silhouettes drawn as SVG,
// so the store looks finished before real product photos are added.
// Give a product an `image` in data.js and that photo is used instead.

const SHAPES = {
  hoodie: `M128 118 Q132 62 200 58 Q268 62 272 118 L304 128 Q330 210 352 318 L314 328 L284 212 L284 438 L116 438 L116 212 L86 328 L48 318 Q70 210 96 128 Z`,
  crew: `M122 104 Q160 92 200 112 Q240 92 278 104 L310 118 Q334 210 352 318 L314 328 L284 212 L284 430 L116 430 L116 212 L86 328 L48 318 Q66 210 90 118 Z`,
  tee: `M122 96 L164 78 Q200 104 236 78 L278 96 L346 160 L308 200 L282 176 L282 424 L118 424 L118 176 L92 200 L54 160 Z`,
  pants: `M132 66 L268 66 L292 446 L222 446 L200 176 L178 446 L108 446 Z`,
  shorts: `M128 150 L272 150 L296 336 L218 336 L200 226 L182 336 L104 336 Z`,
  cap: `M108 270 Q106 158 200 150 Q294 158 292 270 Z`,
  beanie: `M120 300 Q118 150 200 140 Q282 150 280 300 Z`,
};

const DETAILS = {
  hoodie: (ink, back) => back
    ? `<path d="M150 70 Q200 40 250 70 Q262 110 200 124 Q138 110 150 70Z" fill="rgba(0,0,0,.18)"/>`
    : `<ellipse cx="200" cy="118" rx="44" ry="22" fill="rgba(0,0,0,.35)"/>
       <path d="M182 136 L180 190 M218 136 L220 190" stroke="${ink}" stroke-width="3" stroke-linecap="round"/>
       <path d="M146 330 L254 330 L268 392 L132 392 Z" fill="rgba(0,0,0,.14)"/>`,
  crew: () => `<path d="M160 100 Q200 128 240 100" stroke="rgba(0,0,0,.3)" stroke-width="8" fill="none"/>
       <rect x="116" y="410" width="168" height="20" fill="rgba(0,0,0,.14)"/>`,
  tee: () => `<path d="M166 80 Q200 112 234 80" stroke="rgba(0,0,0,.28)" stroke-width="7" fill="none"/>`,
  pants: (ink) => `<rect x="132" y="66" width="136" height="20" fill="rgba(0,0,0,.2)"/>
       <rect x="112" y="250" width="40" height="56" rx="4" fill="rgba(0,0,0,.16)"/>
       <rect x="248" y="250" width="40" height="56" rx="4" fill="rgba(0,0,0,.16)"/>
       <path d="M108 430 L178 430 M222 430 L292 430" stroke="${ink}" stroke-width="3"/>`,
  shorts: (ink) => `<rect x="128" y="150" width="144" height="18" fill="rgba(0,0,0,.2)"/>
       <path d="M108 300 L104 336 M292 300 L296 336" stroke="${ink}" stroke-width="6"/>`,
  cap: () => `<path d="M84 268 Q200 246 340 284 Q312 306 200 290 Q128 284 84 268Z" fill="rgba(0,0,0,.28)"/>
       <circle cx="200" cy="152" r="7" fill="rgba(0,0,0,.3)"/>`,
  beanie: () => `<rect x="114" y="250" width="172" height="62" rx="8" fill="rgba(0,0,0,.18)"/>`,
};

function logo(type, ink, back) {
  if (back) {
    const y = { hoodie: 270, crew: 260, tee: 260, pants: 0, shorts: 0, cap: 0, beanie: 0 }[type];
    if (!y) return "";
    return `<text x="200" y="${y}" text-anchor="middle" font-family="Anton, Impact, sans-serif" font-size="92" fill="${ink}" letter-spacing="2">AGO</text>
            <text x="200" y="${y + 34}" text-anchor="middle" font-family="Inter, Arial, sans-serif" font-size="13" font-weight="700" fill="${ink}" letter-spacing="6">WORLDWIDE</text>`;
  }
  const pos = {
    hoodie: [200, 222, 34], crew: [200, 190, 40], tee: [200, 180, 40],
    pants: [150, 140, 18], shorts: [150, 200, 18], cap: [200, 232, 40], beanie: [200, 290, 26],
  }[type];
  return `<text x="${pos[0]}" y="${pos[1]}" text-anchor="middle" font-family="Anton, Impact, sans-serif" font-size="${pos[2]}" fill="${ink}" letter-spacing="1">AGO</text>`;
}

export function productArt(p, back = false) {
  const shape = SHAPES[p.type] || SHAPES.tee;
  const detail = (DETAILS[p.type] || (() => ""))(p.ink, back);
  const view = p.type === "cap" || p.type === "beanie" ? "0 40 400 340" : "0 20 400 460";
  return `<svg viewBox="${view}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${p.name} in ${p.color}${back ? ", back" : ""}">
    <defs><linearGradient id="sh-${p.id}-${back ? 1 : 0}" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#fff" stop-opacity=".10"/><stop offset="1" stop-color="#000" stop-opacity=".22"/></linearGradient></defs>
    <path d="${shape}" fill="${p.hex}"/>
    <path d="${shape}" fill="url(#sh-${p.id}-${back ? 1 : 0})"/>
    ${detail}
    ${logo(p.type, p.ink, back)}
  </svg>`;
}

// Front / back media for a product: a real photo if one is set, otherwise the artwork.
export function media(p, back = false) {
  const src = back ? p.imageBack : p.image;
  if (src) return `<img src="${src}" alt="${p.name} in ${p.color}${back ? ", back" : ""}" loading="lazy">`;
  return productArt(p, back);
}

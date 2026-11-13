// Everything painted on a canvas: placeholder art, wall text, labels, signs, plaques, posters,
// banners, the rug, the clock face.
import * as THREE from 'three';
import { canvasTexture, seededRandom, shade, wrapText, FONT, SERIF } from './util.js';

// Generated abstract art for a titled exhibit that has no photo yet.
export function artTexture(title, accent) {
  return canvasTexture(512, 512, (ctx, w, h) => {
    const rand = seededRandom(title);
    const base = new THREE.Color(accent).offsetHSL(rand() - 0.5, 0, 0);
    const hue = (o) => '#' + base.clone().offsetHSL(o, (rand() - 0.5) * 0.3, (rand() - 0.5) * 0.4).getHexString();
    const grad = ctx.createLinearGradient(0, 0, w * rand(), h);
    grad.addColorStop(0, hue(0));
    grad.addColorStop(1, hue(0.5));
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 14; i++) {
      ctx.globalAlpha = 0.35 + rand() * 0.5;
      ctx.fillStyle = hue(rand() * 0.6 - 0.3);
      const x = rand() * w;
      const y = rand() * h;
      const s = 30 + rand() * 180;
      ctx.beginPath();
      if (rand() > 0.5) ctx.arc(x, y, s / 2, 0, Math.PI * 2);
      else ctx.rect(x - s / 2, y - s / 2, s, s * (0.3 + rand()));
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  });
}

// An empty frame waiting for its exhibit.
export function emptySlotTexture() {
  return canvasTexture(512, 512, (ctx, w, h) => {
    ctx.fillStyle = '#ecebe7';
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = '#b9b7b0';
    ctx.lineWidth = 4;
    ctx.setLineDash([18, 14]);
    ctx.strokeRect(28, 28, w - 56, h - 56);
    ctx.fillStyle = '#9a978f';
    ctx.font = `28px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.fillText('Exhibit coming soon', w / 2, h / 2 + 10);
  });
}

// Wall text. Wider panels get a sharper canvas, and the body font shrinks until the text fits.
// With a photo, the photo takes the right part of the panel and the words wrap in the rest.
export function textPanelTexture(title, text, widthMeters, aspect, accent, photo = null) {
  const W = Math.round(THREE.MathUtils.clamp((1024 * widthMeters) / 3, 1024, 2048));
  const H = Math.round(W / aspect);
  const k = W / 1024;
  const textW = photo ? W * 0.56 : W;
  return canvasTexture(W, H, (ctx) => {
    ctx.fillStyle = '#27231f';
    ctx.fillRect(0, 0, W, H);
    if (photo) {
      const box = { x: textW, y: 48 * k, w: W - textW - 48 * k, h: H - 96 * k };
      const s = Math.min(box.w / photo.naturalWidth, box.h / photo.naturalHeight);
      const dw = photo.naturalWidth * s;
      const dh = photo.naturalHeight * s;
      ctx.drawImage(photo, box.x + (box.w - dw) / 2, box.y + (box.h - dh) / 2, dw, dh);
    }
    ctx.fillStyle = accent;
    ctx.fillRect(48 * k, 48 * k, 10 * k, H - 96 * k);
    ctx.fillStyle = '#f4efe6';
    ctx.font = `bold ${64 * k}px ${FONT}`;
    ctx.fillText(title, 90 * k, 116 * k, textW - 140 * k);
    const top = 186 * k;
    if (!text) {
      ctx.font = `italic ${36 * k}px ${FONT}`;
      ctx.fillStyle = '#8f877c';
      ctx.fillText('Text coming soon', 90 * k, top);
      return;
    }
    const bottom = H - 56 * k;
    let size = 40 * k;
    let lines;
    for (; size > 14 * k; size -= 2 * k) {
      ctx.font = `${size}px ${FONT}`;
      lines = wrapText(ctx, text, textW - 160 * k);
      if (lines.length * size * 1.4 <= bottom - top + size) break;
    }
    ctx.fillStyle = '#d6cfc2';
    lines.forEach((line, i) => ctx.fillText(line, 90 * k, top + i * size * 1.4));
  });
}

// The small card beside a painting.
export function labelTexture(title, subtitle) {
  return canvasTexture(512, 160, (ctx, w) => {
    ctx.fillStyle = '#f3efe7';
    ctx.fillRect(0, 0, w, 160);
    ctx.fillStyle = '#1b1b1b';
    ctx.font = `bold 44px ${FONT}`;
    ctx.fillText(title, 24, 64, w - 48);
    ctx.font = `italic 30px ${FONT}`;
    ctx.fillStyle = '#555';
    ctx.fillText(subtitle || 'Click to learn more', 24, 116, w - 48);
  });
}

// The sign above a doorway naming the room it leads to.
export function signTexture(text, accent) {
  return canvasTexture(1024, 160, (ctx, w, h) => {
    ctx.fillStyle = '#211d19';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = accent;
    ctx.fillRect(0, h - 10, w, 10);
    ctx.fillStyle = '#f4efe6';
    ctx.font = `bold 64px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, w / 2, h / 2 - 4, w - 40);
  });
}

// Gold lettering on a dark plaque (desk, donation box, doors, the statue's plinth).
export function plaqueTexture(text) {
  return canvasTexture(512, 104, (ctx, w, h) => {
    ctx.fillStyle = '#1d1712';
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = '#b8913a';
    ctx.lineWidth = 4;
    ctx.strokeRect(8, 8, w - 16, h - 16);
    ctx.fillStyle = '#d9b45a';
    ctx.font = `600 46px ${SERIF}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, w / 2, h / 2 + 2, w - 40);
  });
}

// The green EXIT sign (one shared texture).
let exitTex = null;
export function exitTexture() {
  exitTex ??= canvasTexture(256, 96, (ctx, w, h) => {
    ctx.fillStyle = '#0b8a3e';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#f2fff4';
    ctx.font = `bold 64px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('EXIT', w / 2, h / 2 + 3);
  });
  return exitTex;
}

// Fire alarm pull station or horn-strobe face.
export function fireAlarmTexture(kind) {
  return canvasTexture(128, 160, (ctx, w, h) => {
    ctx.fillStyle = kind === 'strobe' ? '#f2f2ee' : '#c3201d';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = kind === 'strobe' ? '#c3201d' : '#ffffff';
    ctx.textAlign = 'center';
    ctx.font = `bold 34px ${FONT}`;
    ctx.fillText('FIRE', w / 2, kind === 'strobe' ? h - 22 : 44);
    if (kind !== 'strobe') {
      ctx.font = `bold 16px ${FONT}`;
      ctx.fillText('PULL DOWN', w / 2, h - 18);
    }
  });
}

// Roman-numeral clock dial.
export const CLOCK_FACE = canvasTexture(256, 256, (ctx, w, h) => {
  ctx.fillStyle = '#f2ead8';
  ctx.beginPath();
  ctx.arc(w / 2, h / 2, w / 2, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#1b1712';
  ctx.font = `600 26px ${SERIF}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ['XII', 'I', 'II', 'III', 'IIII', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI'].forEach((n, k) => {
    const a = (k / 12) * Math.PI * 2;
    ctx.fillText(n, w / 2 + Math.sin(a) * 96, h / 2 - Math.cos(a) * 96);
  });
  for (let k = 0; k < 60; k++) {
    const a = (k / 60) * Math.PI * 2;
    const r1 = k % 5 ? 118 : 112;
    ctx.fillRect(w / 2 + Math.sin(a) * r1 - 1, h / 2 - Math.cos(a) * r1 - 1, 2, 2);
  }
});

// Framed exhibition posters: the show's poster, or Mr. Micawber's famous rule on debt.
export function posterTexture(design) {
  return canvasTexture(640, 912, (ctx, w, h) => {
    ctx.textAlign = 'center';
    if (design === 'micawber') {
      ctx.fillStyle = '#1f3a2e';
      ctx.fillRect(0, 0, w, h);
      ctx.strokeStyle = '#c9a24a';
      ctx.lineWidth = 3;
      ctx.strokeRect(26, 26, w - 52, h - 52);
      ctx.strokeRect(36, 36, w - 72, h - 72);
      ctx.fillStyle = '#c9a24a';
      ctx.font = `bold 150px ${SERIF}`;
      ctx.fillText('“', w / 2, 210);
      ctx.fillStyle = '#efe6d2';
      ctx.font = `italic 36px ${SERIF}`;
      const quote = 'Annual income twenty pounds, annual expenditure nineteen nineteen and six, result happiness. Annual income twenty pounds, annual expenditure twenty pounds ought and six, result misery.';
      const lines = wrapText(ctx, quote, w - 130);
      lines.forEach((line, i) => ctx.fillText(line, w / 2, 260 + i * 50));
      const y = 260 + lines.length * 50 + 40;
      ctx.fillStyle = '#c9a24a';
      ctx.fillRect(w / 2 - 60, y, 120, 3);
      ctx.font = `600 30px ${SERIF}`;
      ctx.fillText('MR. MICAWBER', w / 2, y + 60);
      ctx.font = `italic 26px ${SERIF}`;
      ctx.fillStyle = '#d9cfb8';
      ctx.fillText('David Copperfield, Chapter 12', w / 2, y + 100);
      return;
    }
    ctx.fillStyle = '#efe6d2';
    ctx.fillRect(0, 0, w, h);
    const r = seededRandom('poster');
    for (let i = 0; i < 5000; i++) {
      ctx.fillStyle = `rgba(90,70,40,${r() * 0.06})`; // paper grain
      ctx.fillRect(r() * w, r() * h, 2, 2);
    }
    ctx.fillStyle = '#6e1b21';
    ctx.font = `600 24px ${FONT}`;
    if ('letterSpacing' in ctx) ctx.letterSpacing = '6px';
    ctx.fillText('AN EXHIBITION IN FOUR GALLERIES', w / 2, 90);
    if ('letterSpacing' in ctx) ctx.letterSpacing = '0px';
    ctx.fillStyle = '#1d1a17';
    ctx.font = `bold 108px ${SERIF}`;
    ['WHAT', 'TRYING', 'COSTS'].forEach((word, i) => ctx.fillText(word, w / 2, 220 + i * 112));
    // a gold sovereign
    const cy = 610;
    ctx.fillStyle = '#c9a24a';
    ctx.beginPath();
    ctx.arc(w / 2, cy, 92, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#8a6a26';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.arc(w / 2, cy, 78, 0, Math.PI * 2);
    ctx.stroke();
    for (let k = 0; k < 60; k++) {
      const a = (k / 60) * Math.PI * 2;
      ctx.beginPath();
      ctx.moveTo(w / 2 + Math.cos(a) * 84, cy + Math.sin(a) * 84);
      ctx.lineTo(w / 2 + Math.cos(a) * 90, cy + Math.sin(a) * 90);
      ctx.stroke();
    }
    ctx.fillStyle = '#5a4316';
    ctx.font = `bold 80px ${SERIF}`;
    ctx.fillText('£', w / 2, cy + 28);
    ctx.fillStyle = '#6e1b21';
    ctx.font = `italic 32px ${SERIF}`;
    wrapText(ctx, 'Debt and its price in Charles Dickens’s David Copperfield', w - 120).forEach((line, i) => ctx.fillText(line, w / 2, 765 + i * 42));
    ctx.fillStyle = '#1d1a17';
    ctx.font = `600 22px ${FONT}`;
    ctx.fillText('THE ROTUNDA  →  GALLERIES 1–4', w / 2, h - 50);
  });
}

// Fabric exhibition banner.
export function bannerTexture(title, subtitle, accent) {
  return canvasTexture(512, 1104, (ctx, w, h) => {
    const g = ctx.createLinearGradient(0, 0, w, 0);
    g.addColorStop(0, shade(accent, -0.18));
    g.addColorStop(0.5, accent);
    g.addColorStop(1, shade(accent, -0.18));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#d6b25e';
    ctx.fillRect(40, 70, w - 80, 4);
    ctx.fillRect(40, h - 110, w - 80, 4);
    ctx.textAlign = 'center';
    ctx.font = `600 26px ${FONT}`;
    ctx.fillText('AN EXHIBITION', w / 2, 130);
    ctx.fillStyle = '#f6efe0';
    ctx.font = `bold 92px ${SERIF}`;
    const words = title.toUpperCase().split(' ');
    words.forEach((word, i) => ctx.fillText(word, w / 2, 280 + i * 108, w - 60));
    const below = 280 + words.length * 108;
    ctx.fillStyle = '#d6b25e';
    ctx.beginPath();
    ctx.moveTo(w / 2, below - 20);
    ctx.lineTo(w / 2 + 16, below - 4);
    ctx.lineTo(w / 2, below + 12);
    ctx.lineTo(w / 2 - 16, below - 4);
    ctx.fill();
    ctx.fillRect(w / 2 - 120, below - 5, 90, 2);
    ctx.fillRect(w / 2 + 30, below - 5, 90, 2);
    ctx.fillStyle = '#efe4c8';
    ctx.font = `italic 34px ${SERIF}`;
    wrapText(ctx, subtitle, w - 90).forEach((line, i) => ctx.fillText(line, w / 2, below + 80 + i * 46));
    for (let y = 0; y < h; y += 3) {
      ctx.fillStyle = `rgba(0,0,0,${0.03 + (y % 6 ? 0.02 : 0)})`; // woven texture
      ctx.fillRect(0, y, w, 1);
    }
  });
}

// A Persian-style rug: madder-red field with a central medallion, corner pieces and a navy border.
export function rugTexture(seed) {
  return canvasTexture(1024, 640, (ctx, w, h) => {
    const r = seededRandom(seed);
    const red = '#6b1c1a';
    const navy = '#1a2238';
    const ivory = '#ddd0b2';
    const gold = '#b08640';
    ctx.fillStyle = red;
    ctx.fillRect(0, 0, w, h);
    for (let y = 0; y < h; y += 4) {
      ctx.fillStyle = `rgba(${r() > 0.5 ? '40,10,8' : '150,60,50'},${0.04 + r() * 0.05})`; // abrash: hand-dyed wool
      ctx.fillRect(0, y, w, 4);
    }
    const B = 70; // border
    ctx.fillStyle = navy;
    ctx.fillRect(0, 0, w, B);
    ctx.fillRect(0, h - B, w, B);
    ctx.fillRect(0, 0, B, h);
    ctx.fillRect(w - B, 0, B, h);
    const motif = (x, y, s) => {
      ctx.fillStyle = gold;
      ctx.beginPath();
      ctx.moveTo(x, y - s);
      ctx.lineTo(x + s, y);
      ctx.lineTo(x, y + s);
      ctx.lineTo(x - s, y);
      ctx.fill();
      ctx.fillStyle = red;
      ctx.beginPath();
      ctx.arc(x, y, s * 0.4, 0, Math.PI * 2);
      ctx.fill();
    };
    for (let x = B / 2; x < w; x += 46) {
      motif(x, B / 2, 16);
      motif(x, h - B / 2, 16);
    }
    for (let y = B / 2 + 46; y < h - B; y += 46) {
      motif(B / 2, y, 16);
      motif(w - B / 2, y, 16);
    }
    ctx.strokeStyle = ivory;
    ctx.lineWidth = 5;
    ctx.strokeRect(B + 6, B + 6, w - 2 * B - 12, h - 2 * B - 12);
    ctx.strokeStyle = gold;
    ctx.lineWidth = 3;
    ctx.strokeRect(4, 4, w - 8, h - 8);
    ctx.strokeRect(B - 3, B - 3, w - 2 * B + 6, h - 2 * B + 6);
    for (let i = 0; i < 160; i++) {
      const x = B + 20 + r() * (w - 2 * B - 40);
      const y = B + 20 + r() * (h - 2 * B - 40);
      ctx.fillStyle = [ivory, gold, navy, '#2f5d4a'][Math.floor(r() * 4)];
      ctx.globalAlpha = 0.75;
      for (let p = 0; p < 4; p++) {
        ctx.beginPath();
        ctx.arc(x + Math.cos(p * 1.57) * 5, y + Math.sin(p * 1.57) * 5, 3.5, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    }
    const corner = (cx, cy, sx, sy) => {
      ctx.fillStyle = navy;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx + sx * 190, cy);
      ctx.quadraticCurveTo(cx + sx * 120, cy + sy * 40, cx + sx * 110, cy + sy * 110);
      ctx.quadraticCurveTo(cx + sx * 40, cy + sy * 120, cx, cy + sy * 170);
      ctx.fill();
      ctx.strokeStyle = gold;
      ctx.lineWidth = 3;
      ctx.stroke();
    };
    corner(B + 12, B + 12, 1, 1);
    corner(w - B - 12, B + 12, -1, 1);
    corner(B + 12, h - B - 12, 1, -1);
    corner(w - B - 12, h - B - 12, -1, -1);
    const cx = w / 2;
    const cy = h / 2;
    const lozenge = (rx, ry, fill) => {
      ctx.fillStyle = fill;
      ctx.beginPath();
      for (let k = 0; k < 16; k++) {
        const a = (k / 16) * Math.PI * 2;
        const rr = k % 2 ? 0.82 : 1;
        ctx.lineTo(cx + Math.cos(a) * rx * rr, cy + Math.sin(a) * ry * rr);
      }
      ctx.closePath();
      ctx.fill();
    };
    lozenge(250, 170, ivory);
    lozenge(238, 160, navy);
    lozenge(170, 110, red);
    lozenge(120, 78, gold);
    lozenge(70, 46, navy);
    for (const s of [-1, 1]) {
      ctx.fillStyle = navy;
      ctx.fillRect(cx + s * 250 - 22, cy - 22, 44, 44);
      ctx.fillStyle = gold;
      ctx.fillRect(cx + s * 250 - 10, cy - 10, 20, 20);
    }
    for (let i = 0; i < 9000; i++) {
      ctx.fillStyle = `rgba(${r() > 0.5 ? '0,0,0' : '255,240,220'},${r() * 0.06})`; // wear and wool
      ctx.fillRect(r() * w, r() * h, 2, 2);
    }
  });
}

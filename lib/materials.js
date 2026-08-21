// كتالوج مواد الجدران/الأرضيات — كل مادة نقش procedural يُرسم على قماش (canvas) وقت التشغيل فوق
// لون الغرفة/الجدار المختار أصلاً (hex)، بلا أي صورة أو ملف خارجي — نفس فلسفة كل هندسة
// البرنامج ثلاثية الأبعاد (بلا أصول جاهزة). دوال صرفة بلا أي اعتماد على Three.js أو React —
// build3d.js بيلف الناتج بـ THREE.CanvasTexture لحاله (نفس مبدأ فصل planGeometry.js عن React)

export const MATERIALS = {
  plaster: { label: "طلاء ناعم" },
  brick: { label: "طوب" },
  tile: { label: "بلاط" },
  wood: { label: "خشب" },
  marble: { label: "رخام" },
  concrete: { label: "خرسانة مكشوفة" },
};

function clamp(v, a, b) {
  return Math.min(b, Math.max(a, v));
}

function hexToRgb(hex) {
  const c = hex.replace("#", "");
  return {
    r: parseInt(c.substring(0, 2), 16) || 0,
    g: parseInt(c.substring(2, 4), 16) || 0,
    b: parseInt(c.substring(4, 6), 16) || 0,
  };
}

function shadeStr(rgb, factor, alpha) {
  const r = clamp(rgb.r * factor, 0, 255) | 0;
  const g = clamp(rgb.g * factor, 0, 255) | 0;
  const b = clamp(rgb.b * factor, 0, 255) | 0;
  return `rgba(${r},${g},${b},${alpha})`;
}

// شدة الضجيج العشوائي الأساسي (speckle) قبل ما ينضاف نقش المادة المميز فوقه — لكل مادة نسيجها
// الخام المناسب (خرسانة أخشن بكتير من رخام أملس مثلاً)
export function speckleAmplitude(kind, material) {
  if (material === "concrete") return 30;
  if (material === "marble") return 6;
  if (material === "tile") return 4;
  return kind === "roof" ? 26 : kind === "wall" ? 18 : 8;
}

// خشونة السطح (roughness) المعدّلة حسب المادة — رخام وبلاط ألمع من الأساس (roughness أقل)
export function adjustRoughness(material, base) {
  if (material === "marble") return Math.max(0.2, base - 0.45);
  if (material === "tile") return Math.max(0.3, base - 0.3);
  return base;
}

function paintBrick(ctx, hex, size) {
  const rgb = hexToRgb(hex);
  const rowH = size / 8;
  const brickW = size / 4;
  ctx.strokeStyle = shadeStr(rgb, 0.5, 0.9);
  ctx.lineWidth = 3;
  for (let y = 0; y <= size; y += rowH) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(size, y);
    ctx.stroke();
  }
  let row = 0;
  for (let y = 0; y < size; y += rowH) {
    const offset = row % 2 === 0 ? 0 : brickW / 2;
    for (let x = -brickW; x <= size + brickW; x += brickW) {
      ctx.beginPath();
      ctx.moveTo(x + offset, y);
      ctx.lineTo(x + offset, y + rowH);
      ctx.stroke();
    }
    row++;
  }
}

function paintTile(ctx, hex, size) {
  const rgb = hexToRgb(hex);
  const cell = size / 4;
  ctx.strokeStyle = shadeStr(rgb, 1.35, 0.85);
  ctx.lineWidth = 3;
  for (let i = 0; i <= 4; i++) {
    ctx.beginPath();
    ctx.moveTo(i * cell, 0);
    ctx.lineTo(i * cell, size);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, i * cell);
    ctx.lineTo(size, i * cell);
    ctx.stroke();
  }
}

function paintWood(ctx, hex, size) {
  const rgb = hexToRgb(hex);
  const plankH = size / 6;
  for (let y = 0; y < size; y += plankH) {
    ctx.strokeStyle = shadeStr(rgb, 0.55, 0.85);
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(size, y);
    ctx.stroke();
    // ألياف الخشب (grain) — خطوط طولية قصيرة عشوائية داخل كل لوح
    for (let g = 0; g < 5; g++) {
      const gy = y + Math.random() * plankH;
      const factor = 0.85 + Math.random() * 0.35;
      ctx.strokeStyle = shadeStr(rgb, factor, 0.35);
      ctx.lineWidth = 1;
      ctx.beginPath();
      const startX = Math.random() * size * 0.6;
      ctx.moveTo(startX, gy);
      ctx.lineTo(startX + size * (0.2 + Math.random() * 0.3), gy);
      ctx.stroke();
    }
  }
}

function paintMarble(ctx, hex, size) {
  const rgb = hexToRgb(hex);
  for (let v = 0; v < 4; v++) {
    const factor = v % 2 === 0 ? 1.4 : 0.7;
    ctx.strokeStyle = shadeStr(rgb, factor, 0.4);
    ctx.lineWidth = 1 + Math.random() * 1.5;
    ctx.beginPath();
    let x = Math.random() * size;
    let y = 0;
    ctx.moveTo(x, y);
    while (y < size) {
      const nx = x + (Math.random() - 0.5) * size * 0.3;
      const ny = y + size / 6;
      ctx.quadraticCurveTo(x + (Math.random() - 0.5) * 20, (y + ny) / 2, nx, ny);
      x = nx;
      y = ny;
    }
    ctx.stroke();
  }
}

// نقش المادة الإضافي فوق القماش (بعد ملء اللون الأساسي + الضجيج العشوائي بواسطة الاستدعاء) —
// plaster/concrete بلا نقش إضافي (ضجيج فقط، نفس السلوك الافتراضي الأصلي)
export function paintMaterialPattern(ctx, hex, material, size) {
  if (material === "brick") paintBrick(ctx, hex, size);
  else if (material === "tile") paintTile(ctx, hex, size);
  else if (material === "wood") paintWood(ctx, hex, size);
  else if (material === "marble") paintMarble(ctx, hex, size);
}

import * as THREE from "three";

export function computeCenter(rooms, wallHeight = 2.7) {
  if (!rooms.length) return { x: 10, z: 8, radius: 12, targetY: 1 };
  let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity, topFloor = 0;
  rooms.forEach((r) => {
    minX = Math.min(minX, r.gx); maxX = Math.max(maxX, r.gx + r.gw);
    minZ = Math.min(minZ, r.gy); maxZ = Math.max(maxZ, r.gy + r.gh);
    topFloor = Math.max(topFloor, r.floor ?? 0);
  });
  const floorBaseYMap = computeFloorBaseYMap(rooms, wallHeight);
  const topFloorHeight = rooms.find((r) => (r.floor ?? 0) === topFloor)?.wall_height ?? wallHeight;
  const buildingHeight = floorBaseYMap.get(topFloor) + topFloorHeight + ROOF_T;
  const footprintSpan = Math.max(maxX - minX, maxZ - minZ);
  return {
    x: (minX + maxX) / 2,
    z: (minZ + maxZ) / 2,
    radius: Math.max(footprintSpan, buildingHeight) * 1.5 + 4,
    targetY: Math.max(1, buildingHeight * 0.55),
  };
}

// مجموع تراكمي لارتفاع القاعدة (Y) لكل طابق — بيمشي على كل رقم طابق من 0 لأعلى طابق موجود
// (حتى لو فاضي بلا غرف، لنفس سلوك الفجوات القديم)، وياخذ ارتفاع كل طابق من أول غرفة فيه
// (room.wall_height لو محدد، وإلا الارتفاع الافتراضي للمشروع) — بيعمم floorNum * (h+ROOF_T)
// القديم (يفترض ارتفاع موحّد) لحالة ارتفاعات مختلفة لكل طابق
function computeFloorBaseYMap(rooms, defaultWallHeight) {
  const topFloor = Math.max(0, ...rooms.map((r) => r.floor ?? 0));
  const map = new Map();
  let cumulative = 0;
  for (let f = 0; f <= topFloor; f++) {
    map.set(f, cumulative);
    const roomOnFloor = rooms.find((r) => (r.floor ?? 0) === f);
    const h = roomOnFloor?.wall_height ?? defaultWallHeight;
    cumulative += h + ROOF_T;
  }
  return map;
}

function clamp(v, a, b) {
  return Math.min(b, Math.max(a, v));
}

const WALL_T = 0.15;
export const DOOR_W = 1.0;
const DOOR_H = 2.05;
export const WIN_W = 0.9;
const WIN_SILL = 0.9;
const WIN_MARGIN = 0.4;
const WIN_MIN_GAP = 0.6;
const ROOF_T = 0.18;
const ROOF_OVERHANG = 0.22;
const PARAPET_H = 0.35;

// جدران أول شي، بعدين السقف "يحط" فوقها، وبالآخر الأبواب والنوافذ تاخذ مكانها، وبالنهاية الأثاث
const WALL_DELAY = 0;
const ROOF_DELAY = 0.55;
const FIXTURE_DELAY = 0.75;
const FURNITURE_DELAY = 0.85;

// كتالوج الأثاث الجاهز — أبعاد كل قطعة (w على المحور المحلي x، d على المحور المحلي z) قبل أي دوران.
// مصدر وحيد للأبعاد يشترك فيه بناء ثلاثي الأبعاد (build3d.js) وتفاعل المخطط 2D (ArchitectStudio.jsx)
export const FURNITURE_KINDS = {
  bed: { label: "سرير", w: 1.6, d: 2.0 },
  sofa: { label: "أريكة", w: 1.8, d: 0.85 },
  table: { label: "طاولة", w: 1.4, d: 0.8 },
  wardrobe: { label: "خزانة", w: 1.2, d: 0.6 },
  sink: { label: "مغسلة", w: 0.9, d: 0.55 },
};

function makeSpeckleTexture(hex, kind) {
  const size = 256;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  const base = new THREE.Color(hex);
  ctx.fillStyle = `#${base.getHexString()}`;
  ctx.fillRect(0, 0, size, size);

  const amplitude = kind === "roof" ? 26 : kind === "wall" ? 18 : 8;
  const imgData = ctx.getImageData(0, 0, size, size);
  const data = imgData.data;
  for (let i = 0; i < data.length; i += 4) {
    const n = (Math.random() - 0.5) * amplitude;
    data[i] = clamp(data[i] + n, 0, 255);
    data[i + 1] = clamp(data[i + 1] + n, 0, 255);
    data[i + 2] = clamp(data[i + 2] + n, 0, 255);
  }
  ctx.putImageData(imgData, 0, 0);

  if (kind === "roof") {
    ctx.strokeStyle = "rgba(0,0,0,0.12)";
    ctx.lineWidth = 1;
    for (let y = 0; y <= size; y += 32) {
      ctx.beginPath();
      ctx.moveTo(0, y + 0.5);
      ctx.lineTo(size, y + 0.5);
      ctx.stroke();
    }
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.needsUpdate = true;
  return tex;
}

function getBaseTexture(textureCache, hex, kind) {
  const key = `${kind}:${hex}`;
  let tex = textureCache.get(key);
  if (!tex) {
    tex = makeSpeckleTexture(hex, kind);
    textureCache.set(key, tex);
  }
  return tex;
}

function texturedMaterial(textureCache, hex, kind, segW, segH, roughness) {
  const base = getBaseTexture(textureCache, hex, kind);
  const tex = base.clone();
  tex.needsUpdate = true;
  const repeatUnit = 1.2;
  tex.repeat.set(Math.max(1, Math.round(segW / repeatUnit)), Math.max(1, Math.round(segH / repeatUnit)));
  return new THREE.MeshStandardMaterial({ map: tex, roughness });
}

function addGrowBox(group, animState, w, h, d, x, bottomY, z, material, delay) {
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(Math.max(w, 0.03), Math.max(h, 0.03), Math.max(d, 0.03)),
    material
  );
  mesh.position.set(x, bottomY + h / 2, z);
  mesh.scale.y = 0.001;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  group.add(mesh);
  animState.meshes.push({ mesh, height: h, baseY: bottomY, delay });
  return mesh;
}

// نافذة أو نافذتين حسب طول الجدار، أو باب بالمنتصف — بدون أي بيانات إضافية بقاعدة البيانات
function computeWallOpenings(wallLength, wallHeight, isDoorWall) {
  if (isDoorWall) {
    if (wallLength <= DOOR_W + 0.4) return [];
    const start = (wallLength - DOOR_W) / 2;
    return [{ start, width: DOOR_W, sill: 0, openH: DOOR_H, isDoor: true }];
  }

  const openH = clamp(1.3, 0.3, wallHeight - WIN_SILL - 0.25);
  if (openH <= 0.3) return [];

  const usable = wallLength - 2 * WIN_MARGIN;
  let count = 0;
  if (usable >= 2 * WIN_W + WIN_MIN_GAP) count = 2;
  else if (usable >= WIN_W) count = 1;
  if (count === 0) return [];

  const totalW = count * WIN_W + (count - 1) * WIN_MIN_GAP;
  const startAll = (wallLength - totalW) / 2;
  const openings = [];
  for (let i = 0; i < count; i++) {
    openings.push({
      start: startAll + i * (WIN_W + WIN_MIN_GAP),
      width: WIN_W,
      sill: WIN_SILL,
      openH,
      isDoor: false,
    });
  }
  return openings;
}

const ADJ_EPS = 1e-6;
const near = (a, b) => Math.abs(a - b) < ADJ_EPS;
const OVERLAP_EPS = 0.01; // بالمتر — حد أدنى لطول تراكب يستاهل جدار مشترك (يستبعد التلامس بزاوية بس)

// بيلاقي كل زوج غرف (بنفس الطابق) بينهم تلامس على ضلع (بغض النظر عن تطابق الطول) —
// وبيرجع فترة التراكب الفعلية بينهم (بإحداثيات مطلقة) عشان يُبنى جدار مشترك بس على الجزء المتراكب
export function computeSharedBoundaries(rooms) {
  const out = [];
  for (let i = 0; i < rooms.length; i++) {
    const a = rooms[i], af = a.floor ?? 0;
    for (let j = i + 1; j < rooms.length; j++) {
      const b = rooms[j];
      if ((b.floor ?? 0) !== af) continue;

      if (near(b.gx, a.gx + a.gw) || near(a.gx, b.gx + b.gw)) {
        const ovStart = Math.max(a.gy, b.gy);
        const ovEnd = Math.min(a.gy + a.gh, b.gy + b.gh);
        if (ovEnd - ovStart > OVERLAP_EPS) {
          if (near(b.gx, a.gx + a.gw)) {
            out.push({ a: { room: a, wall: "right" }, b: { room: b, wall: "left" }, start: ovStart, end: ovEnd });
          } else {
            out.push({ a: { room: a, wall: "left" }, b: { room: b, wall: "right" }, start: ovStart, end: ovEnd });
          }
        }
      }

      if (near(b.gy, a.gy + a.gh) || near(a.gy, b.gy + b.gh)) {
        const ovStart = Math.max(a.gx, b.gx);
        const ovEnd = Math.min(a.gx + a.gw, b.gx + b.gw);
        if (ovEnd - ovStart > OVERLAP_EPS) {
          if (near(b.gy, a.gy + a.gh)) {
            out.push({ a: { room: a, wall: "bottom" }, b: { room: b, wall: "top" }, start: ovStart, end: ovEnd });
          } else {
            out.push({ a: { room: a, wall: "top" }, b: { room: b, wall: "bottom" }, start: ovStart, end: ovEnd });
          }
        }
      }
    }
  }
  return out;
}

// دمج فترات محلية متراكبة/متجاورة على نفس ضلع الغرفة (ممكن يلمسها أكتر من جار وحد)
function mergeLocalRanges(ranges) {
  if (!ranges.length) return [];
  const sorted = ranges.slice().sort((a, b) => a.start - b.start);
  const out = [{ ...sorted[0] }];
  for (let i = 1; i < sorted.length; i++) {
    const cur = sorted[i], last = out[out.length - 1];
    if (cur.start <= last.end + ADJ_EPS) last.end = Math.max(last.end, cur.end);
    else out.push({ ...cur });
  }
  return out;
}

// الأجزاء المتبقية من [0, fullLen] بعد طرح الفترات المشتركة (المدموجة مسبقاً) — نفس نمط
// تتبع cursor المستخدم بالأسفل جوا buildWall لبناء الأعمدة حوالين فتحات الأبواب/النوافذ
function complementRanges(mergedRanges, fullLen, minSeg = 0.02) {
  const out = [];
  let cursor = 0;
  mergedRanges.forEach((r) => {
    if (r.start > cursor + minSeg) out.push({ start: cursor, end: r.start });
    cursor = Math.max(cursor, r.end);
  });
  if (fullLen > cursor + minSeg) out.push({ start: cursor, end: fullLen });
  return out;
}

// خريطة "room-id:wall" → فترات محلية مشتركة (بإحداثي الغرفة، نفس مرجع rawPosition/position) —
// تفيد لبناء الجزء المتبقي بس من كل جدار، وللتحقق (بالواجهة) هل موضع معيّن على الجدار مشترك
export function sharedWallRanges(boundaries) {
  const raw = new Map();
  const add = (roomId, wall, start, end) => {
    const key = `${roomId}:${wall}`;
    if (!raw.has(key)) raw.set(key, []);
    raw.get(key).push({ start, end });
  };
  boundaries.forEach((bnd) => {
    const { room: ra, wall: wallA } = bnd.a;
    const { room: rb, wall: wallB } = bnd.b;
    const baseA = (wallA === "left" || wallA === "right") ? ra.gy : ra.gx;
    const baseB = (wallB === "left" || wallB === "right") ? rb.gy : rb.gx;
    add(ra.id, wallA, bnd.start - baseA, bnd.end - baseA);
    add(rb.id, wallB, bnd.start - baseB, bnd.end - baseB);
  });
  const out = new Map();
  raw.forEach((ranges, key) => out.set(key, mergeLocalRanges(ranges)));
  return out;
}

function dedupeDoorShapes(shapes) {
  const out = [];
  shapes.forEach((s) => {
    if (!out.some((o) => Math.abs(o.start - s.start) < 0.05)) out.push(s);
  });
  return out;
}

// يحوّل صف فتحة مخزّن بقاعدة البيانات (wall/kind/position) لشكل buildWall الداخلي
function openingRowToShape(o, wallLength, wallHeight) {
  const isDoor = o.kind === "door";
  const width = isDoor ? DOOR_W : WIN_W;
  const sill = isDoor ? 0 : WIN_SILL;
  const openH = isDoor ? DOOR_H : clamp(1.3, 0.3, wallHeight - WIN_SILL - 0.25);
  const start = clamp(Number(o.position) - width / 2, 0, Math.max(0, wallLength - width));
  return { start, width, sill, openH, isDoor };
}

// بيستخدم فتحات الغرفة المخزّنة لهاد الجدار إذا وجدت، وإلا بيرجع للحساب التلقائي
// (يغطي الغرف يلي انرسمت قبل إضافة جدول openings)
function resolveWallOpenings(roomOpenings, wall, wallLength, wallHeight, isDoorWallFallback) {
  // الاحتياطي التلقائي بس لغرفة ما إلها بيانات فتحات محفوظة إطلاقاً (غرف قديمة من قبل جدول
  // openings) — لو الغرفة إلها بيانات (حتى لو صفر فتحة على هاد الجدار تحديداً، مثلاً بعد ما
  // المستخدم حذف آخر فتحة فيه)، ما لازم نرجع نولّد فتحة تلقائية بديلة
  if (roomOpenings == null) return computeWallOpenings(wallLength, wallHeight, isDoorWallFallback);
  return roomOpenings.filter((o) => o.wall === wall).map((o) => openingRowToShape(o, wallLength, wallHeight));
}

// بيبني جدار واحد كقطع (أعمدة + عتبات فوق/تحت الفتحات) حوالين فتحات الأبواب/النوافذ،
// بدل جدار صلب واحد — نفس فكرة فجوة الباب الأصلية بس معمّمة لأكثر من فتحة
function buildWall(group, animState, textureCache, wallColorHex, opts) {
  const { axis, u0, fixed, wallLength, wallHeight, openings, floorBaseY = 0 } = opts;
  const worldPos = (u) => (axis === "x" ? { x: u0 + u, z: fixed } : { x: fixed, z: u0 + u });

  const sorted = openings.slice().sort((a, b) => a.start - b.start);

  let cursor = 0;
  const pillars = [];
  sorted.forEach((o) => {
    if (o.start > cursor + 0.02) pillars.push({ start: cursor, end: o.start });
    cursor = Math.max(cursor, o.start + o.width);
  });
  if (cursor < wallLength - 0.02) pillars.push({ start: cursor, end: wallLength });

  pillars.forEach((p) => {
    const segLen = p.end - p.start;
    if (segLen <= 0.02) return;
    const midU = (p.start + p.end) / 2;
    const pos = worldPos(midU);
    const w = axis === "x" ? segLen : WALL_T;
    const d = axis === "x" ? WALL_T : segLen;
    const mat = texturedMaterial(textureCache, wallColorHex, "wall", segLen, wallHeight, 0.85);
    addGrowBox(group, animState, w, wallHeight, d, pos.x, floorBaseY, pos.z, mat, WALL_DELAY);
  });

  sorted.forEach((o) => {
    const midU = o.start + o.width / 2;
    const pos = worldPos(midU);
    const w = axis === "x" ? o.width : WALL_T;
    const d = axis === "x" ? WALL_T : o.width;

    if (o.sill > 0.02) {
      const sillMat = texturedMaterial(textureCache, wallColorHex, "wall", o.width, o.sill, 0.85);
      addGrowBox(group, animState, w, o.sill, d, pos.x, floorBaseY, pos.z, sillMat, WALL_DELAY);
    }
    const headerBottom = o.sill + o.openH;
    const headerH = wallHeight - headerBottom;
    if (headerH > 0.02) {
      const headerMat = texturedMaterial(textureCache, wallColorHex, "wall", o.width, headerH, 0.85);
      addGrowBox(group, animState, w, headerH, d, pos.x, floorBaseY + headerBottom, pos.z, headerMat, WALL_DELAY);
    }

    if (o.isDoor) {
      const doorMat = new THREE.MeshStandardMaterial({ color: 0x8b5a2b, roughness: 0.7 });
      const dw = axis === "x" ? o.width - 0.06 : 0.05;
      const dd = axis === "x" ? 0.05 : o.width - 0.06;
      addGrowBox(group, animState, dw, o.openH, dd, pos.x, floorBaseY, pos.z, doorMat, FIXTURE_DELAY);
    } else {
      const glassMat = new THREE.MeshStandardMaterial({
        color: 0x9fd8e8, transparent: true, opacity: 0.35, roughness: 0.05, metalness: 0.1, side: THREE.DoubleSide,
      });
      const gw = axis === "x" ? o.width - 0.05 : 0.03;
      const gd = axis === "x" ? 0.03 : o.width - 0.05;
      const mesh = addGrowBox(group, animState, gw, o.openH - 0.05, gd, pos.x, floorBaseY + o.sill, pos.z, glassMat, FIXTURE_DELAY);
      mesh.castShadow = false;
    }
  });
}

// بلاطة سقف/أرضية بين الطوابق لكل غرفة (دايماً، تسدّ الفجوة مع الطابق يلي فوق) — وحافة
// (parapet) ظاهرة بس لو الغرفة عندها سطح مفعّل (has_roof)؛ الغرفة بلا سطح تظهر مكشوفة
// من فوق (شرفة/تراس) بس تضل البلاطة السفلية موجودة فما في فجوة بصرية
function buildRoomRoof(group, animState, textureCache, room, wallHeight, floorBaseY, wallColorHex, cx, cz, withParapet) {
  const roofColor = new THREE.Color(wallColorHex).multiplyScalar(0.72);
  const roofHex = `#${roofColor.getHexString()}`;

  const slabW = room.gw + ROOF_OVERHANG * 2;
  const slabD = room.gh + ROOF_OVERHANG * 2;
  const slabMat = texturedMaterial(textureCache, roofHex, "roof", slabW, slabD, 0.95);
  addGrowBox(group, animState, slabW, ROOF_T, slabD, cx, floorBaseY + wallHeight, cz, slabMat, ROOF_DELAY);

  if (!withParapet) return;

  const pw = room.gw + WALL_T, pd = room.gh + WALL_T;
  const parapetBottom = floorBaseY + wallHeight + ROOF_T;
  const x0 = cx - room.gw / 2, x1 = cx + room.gw / 2;
  const z0 = cz - room.gh / 2, z1 = cz + room.gh / 2;

  const nsMat = texturedMaterial(textureCache, roofHex, "roof", pw, PARAPET_H, 0.95);
  const ewMat = texturedMaterial(textureCache, roofHex, "roof", pd, PARAPET_H, 0.95);

  addGrowBox(group, animState, pw, PARAPET_H, WALL_T, cx, parapetBottom, z0, nsMat, ROOF_DELAY);
  addGrowBox(group, animState, pw, PARAPET_H, WALL_T, cx, parapetBottom, z1, nsMat, ROOF_DELAY);
  addGrowBox(group, animState, WALL_T, PARAPET_H, pd, x0, parapetBottom, cz, ewMat, ROOF_DELAY);
  addGrowBox(group, animState, WALL_T, PARAPET_H, pd, x1, parapetBottom, cz, ewMat, ROOF_DELAY);
}

// دوران محلي بمضاعفات 90° بالضبط (بلا أي دوال مثلثية) — يدوّر نقطة حوالين مركز القطعة
function rotateLocal(x, z, rotation) {
  switch (rotation) {
    case 90: return { x: -z, z: x };
    case 180: return { x: -x, z: -z };
    case 270: return { x: z, z: -x };
    default: return { x, z };
  }
}

// بيبني صندوق واحد من تركيبة قطعة أثاث — يدوّر مركز الصندوق المحلي (cx,cz) حوالين مركز
// القطعة، وبيبدّل عرض/عمق الصندوق (w/d) لو الدوران 90 أو 270 (تدوير صندوق محاذي للمحاور
// بزاوية قائمة بينتج صندوق محاذي جديد بأبعاد مبدّلة، بلا أي تقريب أو حاجة لمثلثات)
function addFurnitureBox(group, animState, textureCache, item, worldX, worldZ, floorBaseY, spec) {
  const rotation = item.rotation || 0;
  const { x: lx, z: lz } = rotateLocal(spec.cx, spec.cz, rotation);
  const swapped = rotation === 90 || rotation === 270;
  const w = swapped ? spec.d : spec.w;
  const d = swapped ? spec.w : spec.d;
  const mat = texturedMaterial(textureCache, spec.color, "wall", w, spec.h, 0.75);
  addGrowBox(group, animState, w, spec.h, d, worldX + lx, floorBaseY + spec.bottomY, worldZ + lz, mat, FURNITURE_DELAY);
}

function buildBed(group, animState, textureCache, item, worldX, worldZ, floorBaseY) {
  const box = (spec) => addFurnitureBox(group, animState, textureCache, item, worldX, worldZ, floorBaseY, spec);
  box({ cx: 0, cz: 0, w: 1.6, d: 2.0, h: 0.35, bottomY: 0, color: "#8B5A2B" });
  box({ cx: 0, cz: 0, w: 1.5, d: 1.9, h: 0.18, bottomY: 0.35, color: "#EDE7DC" });
  box({ cx: 0, cz: -0.96, w: 1.6, d: 0.08, h: 0.55, bottomY: 0.35, color: "#8B5A2B" });
}

function buildSofa(group, animState, textureCache, item, worldX, worldZ, floorBaseY) {
  const box = (spec) => addFurnitureBox(group, animState, textureCache, item, worldX, worldZ, floorBaseY, spec);
  box({ cx: 0, cz: 0, w: 1.8, d: 0.85, h: 0.4, bottomY: 0, color: "#3B4454" });
  box({ cx: 0, cz: -0.35, w: 1.8, d: 0.15, h: 0.35, bottomY: 0.4, color: "#3B4454" });
  box({ cx: -0.825, cz: 0, w: 0.15, d: 0.85, h: 0.55, bottomY: 0, color: "#2C3444" });
  box({ cx: 0.825, cz: 0, w: 0.15, d: 0.85, h: 0.55, bottomY: 0, color: "#2C3444" });
}

function buildTable(group, animState, textureCache, item, worldX, worldZ, floorBaseY) {
  const box = (spec) => addFurnitureBox(group, animState, textureCache, item, worldX, worldZ, floorBaseY, spec);
  box({ cx: 0, cz: 0, w: 1.4, d: 0.8, h: 0.05, bottomY: 0.7, color: "#6B4A32" });
  const legOffsets = [[-0.65, -0.35], [0.65, -0.35], [-0.65, 0.35], [0.65, 0.35]];
  legOffsets.forEach(([cx, cz]) => box({ cx, cz, w: 0.06, d: 0.06, h: 0.7, bottomY: 0, color: "#3A2A1E" }));
}

function buildWardrobe(group, animState, textureCache, item, worldX, worldZ, floorBaseY) {
  const box = (spec) => addFurnitureBox(group, animState, textureCache, item, worldX, worldZ, floorBaseY, spec);
  box({ cx: 0, cz: 0, w: 1.2, d: 0.6, h: 1.85, bottomY: 0, color: "#C9A876" });
  box({ cx: 0, cz: 0, w: 1.2, d: 0.6, h: 0.05, bottomY: 1.85, color: "#A9895C" });
}

function buildSink(group, animState, textureCache, item, worldX, worldZ, floorBaseY) {
  const box = (spec) => addFurnitureBox(group, animState, textureCache, item, worldX, worldZ, floorBaseY, spec);
  box({ cx: 0, cz: 0, w: 0.9, d: 0.55, h: 0.82, bottomY: 0, color: "#E8ECF0" });
  box({ cx: 0, cz: -0.05, w: 0.55, d: 0.35, h: 0.08, bottomY: 0.75, color: "#B9C2CC" });
  box({ cx: 0, cz: -0.25, w: 0.9, d: 0.05, h: 0.35, bottomY: 0.82, color: "#E8ECF0" });
}

// بتوزّع كل قطعة أثاث على دالة البناء المناسبة — كل الصناديق تنضاف كأطفال مباشرين لـ group
// (بلا Three.Group وسيطة)، فحلقة التنظيف بأول rebuildGroup بتتخلص منها عادي بلا أي تسريب
export function buildFurnitureItem(group, animState, textureCache, item, worldX, worldZ, floorBaseY) {
  switch (item.kind) {
    case "bed": return buildBed(group, animState, textureCache, item, worldX, worldZ, floorBaseY);
    case "sofa": return buildSofa(group, animState, textureCache, item, worldX, worldZ, floorBaseY);
    case "table": return buildTable(group, animState, textureCache, item, worldX, worldZ, floorBaseY);
    case "wardrobe": return buildWardrobe(group, animState, textureCache, item, worldX, worldZ, floorBaseY);
    case "sink": return buildSink(group, animState, textureCache, item, worldX, worldZ, floorBaseY);
    default: return;
  }
}

const WALL_SIDES = [
  { wall: "top", axis: "x", doorFallback: false },
  { wall: "bottom", axis: "x", doorFallback: true },
  { wall: "left", axis: "z", doorFallback: false },
  { wall: "right", axis: "z", doorFallback: false },
];

export function rebuildGroup(group, rooms, wallHeight, wallColor, center, animState, textureCache) {
  while (group.children.length) {
    const child = group.children.pop();
    child.geometry?.dispose();
    if (child.material) {
      child.material.map?.dispose();
      child.material.dispose();
    }
  }
  animState.meshes = [];

  const boundaries = computeSharedBoundaries(rooms);
  const sharedRanges = sharedWallRanges(boundaries);
  const floorBaseYMap = computeFloorBaseYMap(rooms, wallHeight);

  rooms.forEach((r) => {
    const floorNum = r.floor ?? 0;
    const floorBaseY = floorBaseYMap.get(floorNum);
    const roomWallHeight = r.wall_height ?? wallHeight;
    const roomWallColor = r.wall_color ?? wallColor;
    const cx = r.gx + r.gw / 2 - center.x;
    const cz = r.gy + r.gh / 2 - center.z;

    const floorMat = texturedMaterial(textureCache, r.color, "floor", r.gw, r.gh, 0.9);
    const floor = new THREE.Mesh(new THREE.BoxGeometry(r.gw, 0.06, r.gh), floorMat);
    floor.position.set(cx, floorBaseY + 0.03, cz);
    floor.receiveShadow = true;
    group.add(floor);

    const x0 = r.gx - center.x, x1 = r.gx + r.gw - center.x;
    const z0 = r.gy - center.z, z1 = r.gy + r.gh - center.z;

    // كل ضلع من الغرفة: نبني بس الأجزاء غير المشتركة (remainder) — الجزء المتراكب مع
    // جار بيتبنى مرة وحدة بس بالحلقة تحت (boundaries.forEach)، مش هون كمان
    WALL_SIDES.forEach(({ wall, axis, doorFallback }) => {
      const trueFullLen = axis === "x" ? r.gw : r.gh;
      const baseWorld = axis === "x" ? x0 : z0;
      const fixedWorld = wall === "top" ? z0 : wall === "bottom" ? z1 : wall === "left" ? x0 : x1;

      const shared = sharedRanges.get(`${r.id}:${wall}`) || [];
      const remainder = complementRanges(shared, trueFullLen);
      if (remainder.length === 0) return; // الضلع كامل مشترك — بيتبنى بالحلقة تحت

      const resolved = resolveWallOpenings(r.openings, wall, trueFullLen, roomWallHeight, doorFallback);

      remainder.forEach((seg) => {
        // تمديد نصف سماكة الجدار بس عند طرف يلامس فعلياً زاوية الغرفة الحقيقية (0 أو الطول
        // الكامل) — مش عند نقطة قطع داخلية جديدة سببها حد مشترك جزئي (وإلا بيصير تراكب/فجوة)
        const leftExt = seg.start <= ADJ_EPS ? WALL_T / 2 : 0;
        const rightExt = seg.end >= trueFullLen - ADJ_EPS ? WALL_T / 2 : 0;
        const wallLength = (seg.end - seg.start) + leftExt + rightExt;
        const u0 = baseWorld + seg.start - leftExt;

        const segOpenings = resolved
          .filter((o) => o.start >= seg.start - 0.02 && o.start + o.width <= seg.end + 0.02)
          .map((o) => ({ ...o, start: o.start - seg.start + leftExt }));

        buildWall(group, animState, textureCache, roomWallColor, {
          axis, u0, fixed: fixedWorld, wallLength, wallHeight: roomWallHeight, floorBaseY, openings: segOpenings,
        });
      });
    });

    buildRoomRoof(group, animState, textureCache, r, roomWallHeight, floorBaseY, roomWallColor, cx, cz, !!r.has_roof);

    (r.furniture || []).forEach((f) => {
      buildFurnitureItem(group, animState, textureCache, f, r.gx + Number(f.x) - center.x, r.gy + Number(f.y) - center.z, floorBaseY);
    });
  });

  // جدار واحد مشترك لكل جزء متراكب فعلياً بين غرفتين — الأبواب من الغرفتين تضل ظاهرة، النوافذ بتختفي
  boundaries.forEach((bnd) => {
    const { room: ra, wall: wallA } = bnd.a;
    const { room: rb, wall: wallB } = bnd.b;
    const floorBaseY = floorBaseYMap.get(ra.floor ?? 0);
    const roomWallHeight = ra.wall_height ?? wallHeight;
    const roomWallColor = ra.wall_color ?? wallColor;
    const x0 = ra.gx - center.x, x1 = ra.gx + ra.gw - center.x;
    const z0 = ra.gy - center.z, z1 = ra.gy + ra.gh - center.z;

    const axis = (wallA === "left" || wallA === "right") ? "z" : "x";
    const trueFullLenA = axis === "z" ? ra.gh : ra.gw;
    const trueFullLenB = axis === "z" ? rb.gh : rb.gw;
    const baseA = axis === "z" ? ra.gy : ra.gx;
    const baseB = axis === "z" ? rb.gy : rb.gx;
    const baseWorld = axis === "z" ? z0 : x0;
    const fixed = axis === "z" ? (wallA === "right" ? x1 : x0) : (wallA === "bottom" ? z1 : z0);

    const ovStartLocal = bnd.start - baseA;
    const ovEndLocal = bnd.end - baseA;
    const leftExt = ovStartLocal <= ADJ_EPS ? WALL_T / 2 : 0;
    const rightExt = ovEndLocal >= trueFullLenA - ADJ_EPS ? WALL_T / 2 : 0;
    const wallLength = (ovEndLocal - ovStartLocal) + leftExt + rightExt;
    const u0 = baseWorld + ovStartLocal - leftExt;

    // أبواب الغرفتين على هاد الضلع، بس يلي مركزها واقع فعلياً جوا الجزء المشترك (مش أي باب
    // على نفس الضلع — ممكن يكون فيه باب تاني بالجزء المتبقي غير المشترك)
    const doorsIn = (room, wall, base, trueFullLen) =>
      (room.openings || [])
        .filter((o) => o.wall === wall && o.kind === "door")
        .filter((o) => {
          const absCenter = base + Number(o.position);
          return absCenter - DOOR_W / 2 >= bnd.start - 0.02 && absCenter + DOOR_W / 2 <= bnd.end + 0.02;
        })
        .map((o) => {
          const shape = openingRowToShape(o, trueFullLen, roomWallHeight);
          return { ...shape, start: base + shape.start - bnd.start + leftExt };
        });

    const merged = dedupeDoorShapes([
      ...doorsIn(ra, wallA, baseA, trueFullLenA),
      ...doorsIn(rb, wallB, baseB, trueFullLenB),
    ]);

    buildWall(group, animState, textureCache, roomWallColor, { axis, u0, fixed, wallLength, wallHeight: roomWallHeight, floorBaseY, openings: merged });
  });

  animState.progress = 0;
  animState.playing = true;
}

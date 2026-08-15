import * as THREE from "three";

export function computeCenter(rooms, wallHeight = 2.7) {
  if (!rooms.length) return { x: 10, z: 8, radius: 12, targetY: 1 };
  let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity, topFloor = 0;
  rooms.forEach((r) => {
    minX = Math.min(minX, r.gx); maxX = Math.max(maxX, r.gx + r.gw);
    minZ = Math.min(minZ, r.gy); maxZ = Math.max(maxZ, r.gy + r.gh);
    topFloor = Math.max(topFloor, r.floor ?? 0);
  });
  const buildingHeight = (topFloor + 1) * (wallHeight + ROOF_T);
  const footprintSpan = Math.max(maxX - minX, maxZ - minZ);
  return {
    x: (minX + maxX) / 2,
    z: (minZ + maxZ) / 2,
    radius: Math.max(footprintSpan, buildingHeight) * 1.5 + 4,
    targetY: Math.max(1, buildingHeight * 0.55),
  };
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

// جدران أول شي، بعدين السقف "يحط" فوقها، وبالآخر الأبواب والنوافذ تاخذ مكانها
const WALL_DELAY = 0;
const ROOF_DELAY = 0.55;
const FIXTURE_DELAY = 0.75;

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

function shiftOpenings(list, offset) {
  return list.map((o) => ({ ...o, start: o.start + offset }));
}

const ADJ_EPS = 1e-6;
const near = (a, b) => Math.abs(a - b) < ADJ_EPS;

// بيلاقي كل زوج غرف (بنفس الطابق) حدّهم متطابق بالضبط (نفس الطول والمحاذاة) —
// هدول بس اللي بيستاهلوا جدار مشترك واحد بدل جدارين مضاعفين
export function computeSharedBoundaries(rooms) {
  const out = [];
  for (let i = 0; i < rooms.length; i++) {
    const a = rooms[i], af = a.floor ?? 0;
    for (let j = i + 1; j < rooms.length; j++) {
      const b = rooms[j];
      if ((b.floor ?? 0) !== af) continue;
      if (near(b.gx, a.gx + a.gw) && near(a.gy, b.gy) && near(a.gh, b.gh)) {
        out.push({ a: { room: a, wall: "right" }, b: { room: b, wall: "left" } });
      } else if (near(a.gx, b.gx + b.gw) && near(a.gy, b.gy) && near(a.gh, b.gh)) {
        out.push({ a: { room: a, wall: "left" }, b: { room: b, wall: "right" } });
      }
      if (near(b.gy, a.gy + a.gh) && near(a.gx, b.gx) && near(a.gw, b.gw)) {
        out.push({ a: { room: a, wall: "bottom" }, b: { room: b, wall: "top" } });
      } else if (near(a.gy, b.gy + b.gh) && near(a.gx, b.gx) && near(a.gw, b.gw)) {
        out.push({ a: { room: a, wall: "top" }, b: { room: b, wall: "bottom" } });
      }
    }
  }
  return out;
}

// مجموعة "room-id:wall" لكل جدار صار جزء من حد مشترك — تفيد لتفادي بناء الجدار
// لحاله كمان، وللتحقق (بالواجهة) هل الجدار داخلي قبل قبول إضافة نافذة عليه
export function sharedWallKeySet(boundaries) {
  const set = new Set();
  boundaries.forEach((bnd) => {
    set.add(`${bnd.a.room.id}:${bnd.a.wall}`);
    set.add(`${bnd.b.room.id}:${bnd.b.wall}`);
  });
  return set;
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
  const rows = (roomOpenings || []).filter((o) => o.wall === wall);
  if (rows.length > 0) return rows.map((o) => openingRowToShape(o, wallLength, wallHeight));
  return computeWallOpenings(wallLength, wallHeight, isDoorWallFallback);
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

// بلاطة سقف/أرضية بين الطوابق لكل غرفة، وحافة (parapet) ظاهرة بس إذا كانت هاي الغرفة
// على أعلى طابق بالمبنى (الطوابق يلي تحتها بتاخذ بلاطة تسدّ الفجوة معها بس بلا حافة ظاهرة)
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

  const topFloor = Math.max(0, ...rooms.map((r) => r.floor ?? 0));
  const boundaries = computeSharedBoundaries(rooms);
  const suppressed = sharedWallKeySet(boundaries);

  rooms.forEach((r) => {
    const floorNum = r.floor ?? 0;
    const floorBaseY = floorNum * (wallHeight + ROOF_T);
    const cx = r.gx + r.gw / 2 - center.x;
    const cz = r.gy + r.gh / 2 - center.z;

    const floorMat = texturedMaterial(textureCache, r.color, "floor", r.gw, r.gh, 0.9);
    const floor = new THREE.Mesh(new THREE.BoxGeometry(r.gw, 0.06, r.gh), floorMat);
    floor.position.set(cx, floorBaseY + 0.03, cz);
    floor.receiveShadow = true;
    group.add(floor);

    const x0 = r.gx - center.x, x1 = r.gx + r.gw - center.x;
    const z0 = r.gy - center.z, z1 = r.gy + r.gh - center.z;
    const extLenX = r.gw + WALL_T;
    const extLenZ = r.gh + WALL_T;

    if (!suppressed.has(`${r.id}:top`)) {
      buildWall(group, animState, textureCache, wallColor, {
        axis: "x", u0: x0 - WALL_T / 2, fixed: z0, wallLength: extLenX, wallHeight, floorBaseY,
        openings: shiftOpenings(resolveWallOpenings(r.openings, "top", r.gw, wallHeight, false), WALL_T / 2),
      });
    }
    if (!suppressed.has(`${r.id}:bottom`)) {
      buildWall(group, animState, textureCache, wallColor, {
        axis: "x", u0: x0 - WALL_T / 2, fixed: z1, wallLength: extLenX, wallHeight, floorBaseY,
        openings: shiftOpenings(resolveWallOpenings(r.openings, "bottom", r.gw, wallHeight, true), WALL_T / 2),
      });
    }
    if (!suppressed.has(`${r.id}:left`)) {
      buildWall(group, animState, textureCache, wallColor, {
        axis: "z", u0: z0 - WALL_T / 2, fixed: x0, wallLength: extLenZ, wallHeight, floorBaseY,
        openings: shiftOpenings(resolveWallOpenings(r.openings, "left", r.gh, wallHeight, false), WALL_T / 2),
      });
    }
    if (!suppressed.has(`${r.id}:right`)) {
      buildWall(group, animState, textureCache, wallColor, {
        axis: "z", u0: z0 - WALL_T / 2, fixed: x1, wallLength: extLenZ, wallHeight, floorBaseY,
        openings: shiftOpenings(resolveWallOpenings(r.openings, "right", r.gh, wallHeight, false), WALL_T / 2),
      });
    }

    buildRoomRoof(group, animState, textureCache, r, wallHeight, floorBaseY, wallColor, cx, cz, floorNum === topFloor);
  });

  // جدار واحد مشترك لكل حد متطابق — الأبواب من الغرفتين تضل ظاهرة، النوافذ بتختفي
  boundaries.forEach((bnd) => {
    const { room: ra, wall: wallA } = bnd.a;
    const { room: rb, wall: wallB } = bnd.b;
    const floorBaseY = (ra.floor ?? 0) * (wallHeight + ROOF_T);
    const x0 = ra.gx - center.x, x1 = ra.gx + ra.gw - center.x;
    const z0 = ra.gy - center.z, z1 = ra.gy + ra.gh - center.z;

    let axis, u0, fixed, wallLength, rawLen;
    if (wallA === "right" || wallA === "left") {
      axis = "z"; wallLength = ra.gh + WALL_T; rawLen = ra.gh;
      u0 = z0 - WALL_T / 2; fixed = wallA === "right" ? x1 : x0;
    } else {
      axis = "x"; wallLength = ra.gw + WALL_T; rawLen = ra.gw;
      u0 = x0 - WALL_T / 2; fixed = wallA === "bottom" ? z1 : z0;
    }

    const doorsA = (ra.openings || []).filter((o) => o.wall === wallA && o.kind === "door").map((o) => openingRowToShape(o, rawLen, wallHeight));
    const doorsB = (rb.openings || []).filter((o) => o.wall === wallB && o.kind === "door").map((o) => openingRowToShape(o, rawLen, wallHeight));
    const merged = shiftOpenings(dedupeDoorShapes([...doorsA, ...doorsB]), WALL_T / 2);

    buildWall(group, animState, textureCache, wallColor, { axis, u0, fixed, wallLength, wallHeight, floorBaseY, openings: merged });
  });

  animState.progress = 0;
  animState.playing = true;
}

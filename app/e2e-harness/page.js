"use client";

// صفحة اختبار E2E دائمة — بديل رسمي عن صفحات "test-*" المؤقتة يلي كانت تُبنى وتُحذف يدوياً
// كل ميزة هالجلسة. بتحاكي Supabase بالذاكرة (بلا اتصال حقيقي)، عشان اختبارات Playwright
// (مجلد e2e/) تقدر تتفاعل مع البرنامج الحقيقي كامل بلا حاجة لقاعدة بيانات فعلية.
//
// **آمنة بالإنتاج**: بترجع 404 مباشرة لو NODE_ENV=production — بيئات CI/التطوير المحلي
// بتشغّل "next dev" (NODE_ENV=development)، فالصفحة شغالة هناك بس، ومحذوفة فعلياً من
// أي بناء إنتاج حقيقي (Vercel بيبني ويشغّل بـ NODE_ENV=production دايماً).
import { useState } from "react";
import { notFound } from "next/navigation";
import ArchitectStudio from "../../components/ArchitectStudio";
import { supabase } from "../../lib/supabaseClient";

const USERS = {
  owner: { id: "00000000-0000-0000-0000-0000000000a1", email: "owner@e2e.local" },
  editor: { id: "00000000-0000-0000-0000-0000000000b2", email: "editor@e2e.local" },
  viewer: { id: "00000000-0000-0000-0000-0000000000c3", email: "viewer@e2e.local" },
};

function uuid() {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
}

const TABLE_DEFAULTS = {
  projects: { client: "", land_type: "", city: "", width: 20, depth: 15, wall_height: 2.7, wall_color: "#EDE7DC", wall_material: "plaster" },
  rooms: { color: "#C7714E", floor: 0, has_roof: true, roof_type: "flat", floor_material: "plaster", points: null },
  project_members: { role: "editor", user_id: null },
};

// قاعدة بيانات وهمية بالذاكرة — مشتركة بين كل "المستخدمين" المحاكين بنفس تحميل الصفحة
// (لاختبارات التعاون: مالك يدعو، المدعو يطالب بدعوته... إلخ، بلا حاجة لقاعدة بيانات فعلية)
const DB = { projects: [], phases: [], subtasks: [], rooms: [], openings: [], furniture: [], stairs: [], project_members: [] };

let currentUserId = USERS.owner.id;
let currentUserEmail = USERS.owner.email;

function visibleProjectIds() {
  const owned = DB.projects.filter((p) => p.user_id === currentUserId).map((p) => p.id);
  const member = DB.project_members.filter((m) => m.user_id === currentUserId).map((m) => m.project_id);
  return new Set([...owned, ...member]);
}

function canRead(table, row) {
  if (table === "projects") return visibleProjectIds().has(row.id);
  if (table === "project_members") {
    if (visibleProjectIds().has(row.project_id)) return true;
    if (row.user_id === currentUserId) return true;
    return row.user_id === null && row.invited_email?.toLowerCase() === currentUserEmail?.toLowerCase();
  }
  if ("project_id" in row) return visibleProjectIds().has(row.project_id);
  if ("room_id" in row) {
    const room = DB.rooms.find((r) => r.id === row.room_id);
    return room ? visibleProjectIds().has(room.project_id) : false;
  }
  if ("phase_id" in row) {
    const phase = DB.phases.find((p) => p.id === row.phase_id);
    return phase ? visibleProjectIds().has(phase.project_id) : false;
  }
  return true;
}

function canWrite(projectId) {
  const proj = DB.projects.find((p) => p.id === projectId);
  if (proj && proj.user_id === currentUserId) return true;
  const m = DB.project_members.find((x) => x.project_id === projectId && x.user_id === currentUserId);
  return m ? m.role === "editor" : false;
}

function rowProjectId(table, row) {
  if (table === "projects") return row.id;
  if ("project_id" in row) return row.project_id;
  if ("room_id" in row) return DB.rooms.find((r) => r.id === row.room_id)?.project_id;
  if ("phase_id" in row) return DB.phases.find((p) => p.id === row.phase_id)?.project_id;
  return null;
}

class QueryBuilder {
  constructor(table) {
    this.table = table;
    this.filters = [];
    this._select = null;
    this._insert = null;
    this._update = null;
    this._delete = false;
    this._single = false;
  }
  select(cols) { this._select = cols || "*"; return this; }
  insert(row) { this._insert = Array.isArray(row) ? row : [row]; return this; }
  update(patch) { this._update = patch; return this; }
  delete() { this._delete = true; return this; }
  eq(col, val) { this.filters.push((r) => r[col] === val); return this; }
  is(col, val) { this.filters.push((r) => r[col] === val); return this; }
  order() { return this; }
  single() { this._single = true; return this; }

  _matchRows() {
    return DB[this.table].filter((r) => this.filters.every((f) => f(r)));
  }

  async _exec() {
    const table = this.table;
    if (this._insert) {
      const created = [];
      for (const row of this._insert) {
        const projectId = table === "projects" ? undefined : row.project_id ?? rowProjectId(table, row);
        if (table !== "projects" && !canWrite(projectId)) {
          return { data: null, error: { message: "new row violates row-level security policy" } };
        }
        const full = { id: uuid(), created_at: new Date().toISOString(), ...TABLE_DEFAULTS[table], ...row };
        if (table === "projects") full.user_id = currentUserId;
        if (table === "rooms") { full.openings = []; full.furniture = []; }
        DB[table].push(full);
        created.push(full);
      }
      const data = this._single ? created[0] : created;
      return { data, error: null };
    }
    if (this._update) {
      const rows = this._matchRows();
      for (const row of rows) {
        const projectId = rowProjectId(table, row);
        const isSelfClaim = table === "project_members" && row.user_id === null && Object.keys(this._update).length === 1 && "user_id" in this._update && this._update.user_id === currentUserId;
        const isOwnerAction = table === "project_members" && DB.projects.find((p) => p.id === row.project_id)?.user_id === currentUserId;
        if (!isSelfClaim && !isOwnerAction && !canWrite(projectId)) {
          return { data: null, error: { message: "new row violates row-level security policy" } };
        }
        Object.assign(row, this._update);
      }
      const visible = rows.filter((r) => canRead(table, r));
      const data = this._single ? (visible[0] || null) : visible;
      return { data, error: null };
    }
    if (this._delete) {
      const rows = this._matchRows();
      for (const row of rows) {
        const projectId = rowProjectId(table, row);
        const isSelfLeave = table === "project_members" && row.user_id === currentUserId;
        const isOwnerAction = DB.projects.find((p) => p.id === row.project_id)?.user_id === currentUserId;
        if (!isSelfLeave && !isOwnerAction && !canWrite(projectId)) {
          return { data: null, error: { message: "new row violates row-level security policy" } };
        }
        DB[table] = DB[table].filter((r) => r.id !== row.id);
      }
      return { data: rows, error: null };
    }
    let rows = this._matchRows().filter((r) => canRead(table, r));
    if (table === "rooms" && this._select && this._select.includes("openings")) {
      rows = rows.map((r) => ({ ...r, openings: DB.openings.filter((o) => o.room_id === r.id), furniture: DB.furniture.filter((f) => f.room_id === r.id) }));
    }
    if (table === "phases" && this._select && this._select.includes("subtasks")) {
      rows = rows.map((p) => ({ ...p, subtasks: DB.subtasks.filter((s) => s.phase_id === p.id) }));
    }
    const data = this._single ? (rows[0] || null) : rows;
    return { data, error: null };
  }
  then(resolve, reject) { return this._exec().then(resolve, reject); }
}

// حماية أساسية: التبديل نفسه بيصير بس لو مو NODE_ENV=production — بهيك حتى لو حدا زار
// هاد المسار غلط بموقع إنتاج فعلي (بيشوف 404 من الكومبوننت تحت)، ما في أي أثر جانبي حقيقي
// عالـ supabase client المشترك بنفس التبويب
if (process.env.NODE_ENV !== "production") {
  supabase.from = (table) => new QueryBuilder(table);
  supabase.auth.signOut = async () => ({ error: null });
}

function makeSession(u) {
  return { user: { id: u.id, email: u.email } };
}

export default function E2eHarnessPage() {
  if (process.env.NODE_ENV === "production") {
    notFound();
  }

  const [activeUser, setActiveUser] = useState(USERS.owner);
  const [key, setKey] = useState(0);

  function switchTo(name) {
    const u = USERS[name];
    currentUserId = u.id;
    currentUserEmail = u.email;
    setActiveUser(u);
    setKey((k) => k + 1); // فرض إعادة تركيب ArchitectStudio بالكامل (محاكاة "إعادة تحميل الصفحة")
  }

  return (
    <div>
      <div
        data-testid="e2e-user-switcher"
        style={{ position: "fixed", top: 0, left: 0, zIndex: 9999, background: "#000", padding: 8, display: "flex", gap: 8 }}
      >
        {Object.keys(USERS).map((name) => (
          <button
            key={name}
            data-testid={`switch-${name}`}
            onClick={() => switchTo(name)}
            style={{ color: activeUser.id === USERS[name].id ? "#0ff" : "#fff" }}
          >
            {name}
          </button>
        ))}
      </div>
      <div style={{ paddingTop: 40 }}>
        <ArchitectStudio key={key} session={makeSession(activeUser)} />
      </div>
    </div>
  );
}

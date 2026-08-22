"use client";

import { useState, useEffect } from "react";
import {
  MapPin, PencilRuler, Building2, FileCheck2, HardHat, ClipboardCheck, KeyRound,
  CheckCircle2, Circle, Clock3, ChevronDown, X, Plus, CalendarDays, UserRound,
} from "lucide-react";
import { supabase } from "../lib/supabaseClient";

const statusMeta = {
  not_started: { label: "لم تبدأ", color: "text-slate-500", bg: "bg-slate-800", Icon: Circle },
  in_progress: { label: "قيد التنفيذ", color: "text-amber-400", bg: "bg-amber-500/15", Icon: Clock3 },
  done: { label: "مكتملة", color: "text-emerald-400", bg: "bg-emerald-500/15", Icon: CheckCircle2 },
};

// أيقونة كل مرحلة حسب رقمها الثابت (المحتوى نفسه بينشئه Trigger داخل قاعدة البيانات)
const PHASE_ICONS = {
  1: MapPin,
  2: PencilRuler,
  3: Building2,
  4: FileCheck2,
  5: HardHat,
  6: ClipboardCheck,
  7: KeyRound,
};

function PhaseCard({ phase, expanded, onToggleExpand, onCycleStatus, onFieldCommit, onToggleSubtask, onAddSubtask, onRemoveSubtask, designProgress, onOpenDesign }) {
  const [newTask, setNewTask] = useState("");
  const [local, setLocal] = useState({ owner: phase.owner || "", notes: phase.notes || "" });
  const meta = statusMeta[phase.status];
  const Icon = PHASE_ICONS[phase.phase_key];
  const StatusIcon = meta.Icon;
  const doneSub = phase.subtasks.filter((s) => s.done).length;

  useEffect(() => {
    setLocal({ owner: phase.owner || "", notes: phase.notes || "" });
  }, [phase.owner, phase.notes]);

  function addSubtask() {
    const text = newTask.trim();
    if (!text) return;
    onAddSubtask(phase.id, text, phase.subtasks.length);
    setNewTask("");
  }

  return (
    <div className="bg-slate-900/50 border border-slate-800 rounded-xl overflow-hidden">
      <div className="flex items-start gap-3 p-3.5 cursor-pointer" onClick={onToggleExpand}>
        <div className="w-9 h-9 rounded-lg bg-slate-800 flex items-center justify-center shrink-0 mt-0.5">
          <Icon size={16} className="text-slate-300" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-sm font-bold">{phase.title}</p>
            {phase.links_to_design && (
              <button onClick={(e) => { e.stopPropagation(); onOpenDesign(); }} className="text-[11px] text-cyan-700 hover:text-cyan-600 underline underline-offset-2">
                فتح أداة التصميم
              </button>
            )}
          </div>
          <p className="text-xs text-slate-500 mt-0.5">{phase.description}</p>
          <p className="text-[11px] font-mono text-slate-500 mt-1">
            {doneSub}/{phase.subtasks.length} مهام فرعية
            {phase.links_to_design && designProgress > 0 ? ` · ${designProgress} غرفة مرسومة` : ""}
          </p>
        </div>
        <button
          onClick={(e) => { e.stopPropagation(); onCycleStatus(); }}
          className={`flex items-center gap-1.5 text-xs font-semibold rounded-full px-3 py-1.5 shrink-0 transition-colors ${meta.bg} ${meta.color}`}
        >
          <StatusIcon size={13} /> {meta.label}
        </button>
        <ChevronDown size={16} className={`text-slate-500 shrink-0 mt-1.5 transition-transform ${expanded ? "rotate-180" : ""}`} />
      </div>

      {expanded && (
        <div className="border-t border-slate-800 p-3.5 space-y-4">
          <div>
            <p className="text-[11px] font-semibold text-slate-400 mb-1.5">المهام الفرعية</p>
            <div className="space-y-1.5">
              {phase.subtasks.map((s) => (
                <div key={s.id} className="flex items-center gap-2 group">
                  <button onClick={() => onToggleSubtask(s.id, !s.done)} className="shrink-0">
                    {s.done ? <CheckCircle2 size={16} className="text-emerald-400" /> : <Circle size={16} className="text-slate-500" />}
                  </button>
                  <span className={`text-xs flex-1 ${s.done ? "text-slate-500 line-through" : "text-slate-200"}`}>{s.text}</span>
                  <button onClick={() => onRemoveSubtask(s.id)} className="opacity-0 group-hover:opacity-100 text-slate-500 hover:text-red-400 transition-opacity">
                    <X size={13} />
                  </button>
                </div>
              ))}
              {phase.subtasks.length === 0 && <p className="text-[11px] text-slate-500">لا توجد مهام فرعية.</p>}
            </div>
            <div className="flex items-center gap-2 mt-2">
              <input
                value={newTask}
                onChange={(e) => setNewTask(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && addSubtask()}
                placeholder="أضف مهمة فرعية..."
                className="flex-1 bg-slate-950 border border-slate-700 rounded-md px-2.5 py-1.5 text-xs outline-none focus:border-cyan-500"
              />
              <button onClick={addSubtask} className="flex items-center gap-1 text-xs font-semibold bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-md px-2.5 py-1.5">
                <Plus size={13} />
              </button>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[11px] text-slate-400 flex items-center gap-1 mb-1"><CalendarDays size={12} /> تاريخ البدء</label>
              <input type="date" value={phase.start_date || ""} onChange={(e) => onFieldCommit(phase.id, "start_date", e.target.value)} className="w-full bg-slate-950 border border-slate-700 rounded-md px-2 py-1.5 text-xs outline-none focus:border-cyan-500 font-mono" />
            </div>
            <div>
              <label className="text-[11px] text-slate-400 flex items-center gap-1 mb-1"><CalendarDays size={12} /> الانتهاء المتوقع</label>
              <input type="date" value={phase.end_date || ""} onChange={(e) => onFieldCommit(phase.id, "end_date", e.target.value)} className="w-full bg-slate-950 border border-slate-700 rounded-md px-2 py-1.5 text-xs outline-none focus:border-cyan-500 font-mono" />
            </div>
          </div>

          <div>
            <label className="text-[11px] text-slate-400 flex items-center gap-1 mb-1"><UserRound size={12} /> المسؤول عن هذه المرحلة</label>
            <input
              value={local.owner}
              onChange={(e) => setLocal((l) => ({ ...l, owner: e.target.value }))}
              onBlur={(e) => onFieldCommit(phase.id, "owner", e.target.value)}
              placeholder="مثال: المهندس الإنشائي - سامر"
              className="w-full bg-slate-950 border border-slate-700 rounded-md px-2.5 py-1.5 text-xs outline-none focus:border-cyan-500"
            />
          </div>

          <div>
            <label className="text-[11px] text-slate-400 block mb-1">ملاحظات</label>
            <textarea
              value={local.notes}
              onChange={(e) => setLocal((l) => ({ ...l, notes: e.target.value }))}
              onBlur={(e) => onFieldCommit(phase.id, "notes", e.target.value)}
              rows={2}
              placeholder="أي تفاصيل إضافية عن هذه المرحلة..."
              className="w-full bg-slate-950 border border-slate-700 rounded-md px-2.5 py-1.5 text-xs outline-none focus:border-cyan-500 resize-none"
            />
          </div>
        </div>
      )}
    </div>
  );
}

export default function PhaseTracker({ phases, setPhases, designProgress, onOpenDesign, notifyError }) {
  const [expandedId, setExpandedId] = useState(null);

  async function cycleStatus(phase) {
    const next = phase.status === "not_started" ? "in_progress" : phase.status === "in_progress" ? "done" : "not_started";
    setPhases((prev) => prev.map((p) => (p.id === phase.id ? { ...p, status: next } : p)));
    const { error } = await supabase.from("phases").update({ status: next }).eq("id", phase.id);
    if (error) notifyError("تحديث حالة المرحلة", error);
  }

  async function fieldCommit(phaseId, field, value) {
    setPhases((prev) => prev.map((p) => (p.id === phaseId ? { ...p, [field]: value } : p)));
    const payload = { [field]: value === "" && (field === "start_date" || field === "end_date") ? null : value };
    const { error } = await supabase.from("phases").update(payload).eq("id", phaseId);
    if (error) notifyError("تحديث بيانات المرحلة", error);
  }

  async function toggleSubtask(subtaskId, done) {
    setPhases((prev) => prev.map((p) => ({
      ...p,
      subtasks: p.subtasks.map((s) => (s.id === subtaskId ? { ...s, done } : s)),
    })));
    const { error } = await supabase.from("subtasks").update({ done }).eq("id", subtaskId);
    if (error) notifyError("تحديث المهمة الفرعية", error);
  }

  async function addSubtask(phaseId, text, sortOrder) {
    const { data, error } = await supabase
      .from("subtasks")
      .insert({ phase_id: phaseId, text, sort_order: sortOrder })
      .select()
      .single();
    if (error) { notifyError("إضافة المهمة الفرعية", error); return; }
    setPhases((prev) => prev.map((p) => (p.id === phaseId ? { ...p, subtasks: [...p.subtasks, data] } : p)));
  }

  async function removeSubtask(subtaskId) {
    setPhases((prev) => prev.map((p) => ({ ...p, subtasks: p.subtasks.filter((s) => s.id !== subtaskId) })));
    const { error } = await supabase.from("subtasks").delete().eq("id", subtaskId);
    if (error) notifyError("حذف المهمة الفرعية", error);
  }

  const totalSub = phases.reduce((s, p) => s + p.subtasks.length, 0);
  const doneSub = phases.reduce((s, p) => s + p.subtasks.filter((t) => t.done).length, 0);
  const pct = totalSub === 0 ? 0 : Math.round((doneSub / totalSub) * 100);

  return (
    <main className="flex-1 overflow-y-auto p-5">
      <div className="max-w-2xl mx-auto space-y-5">
        <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-4">
          <div className="flex items-center justify-between mb-2">
            <p className="text-sm font-bold">التقدم العام</p>
            <p className="text-sm font-mono text-cyan-700">{pct}%</p>
          </div>
          <div className="w-full h-2 bg-slate-800 rounded-full overflow-hidden">
            <div className="h-full bg-cyan-500 transition-all duration-500" style={{ width: `${pct}%` }} />
          </div>
          <p className="text-[11px] text-slate-500 mt-1.5">{doneSub} من {totalSub} مهمة فرعية مكتملة عبر كل المراحل</p>
        </div>

        <div className="space-y-2.5">
          {phases.map((p) => (
            <PhaseCard
              key={p.id}
              phase={p}
              expanded={expandedId === p.id}
              onToggleExpand={() => setExpandedId((cur) => (cur === p.id ? null : p.id))}
              onCycleStatus={() => cycleStatus(p)}
              onFieldCommit={fieldCommit}
              onToggleSubtask={toggleSubtask}
              onAddSubtask={addSubtask}
              onRemoveSubtask={removeSubtask}
              designProgress={designProgress}
              onOpenDesign={onOpenDesign}
            />
          ))}
        </div>
      </div>
    </main>
  );
}

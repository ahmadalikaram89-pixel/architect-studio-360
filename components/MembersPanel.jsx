"use client";

import { useState } from "react";
import { Users, X, UserPlus, Trash2, LogOut, Eye, Pencil, Crown } from "lucide-react";

export const ROLE_LABEL = { editor: "محرّر", viewer: "مُشاهد" };

// لوحة "أعضاء المشروع" — دعوة/إدارة أعضاء بصلاحيات، بلا مزامنة حية (التغييرات تظهر عند
// إعادة تحميل/دخول الطرف التاني، مو فوراً). المالك بس يدعو/يبدّل دور/يحذف عضو؛ أي عضو
// يقدر يغادر المشروع بنفسه
export default function MembersPanel({ members, isOwner, myUserId, onInvite, onRemove, onChangeRole, onLeave, onClose }) {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("editor");
  const [submitting, setSubmitting] = useState(false);

  async function handleInvite(e) {
    e.preventDefault();
    const trimmed = email.trim();
    if (!trimmed) return;
    setSubmitting(true);
    await onInvite(trimmed, role);
    setSubmitting(false);
    setEmail("");
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="members-panel-title"
        className="bg-slate-950 border border-slate-800 rounded-lg shadow-xl w-full max-w-md max-h-[85vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-4 border-b border-slate-800 sticky top-0 bg-slate-950">
          <h2 id="members-panel-title" className="text-base font-bold flex items-center gap-2">
            <Users size={16} /> أعضاء المشروع
          </h2>
          <button onClick={onClose} title="إغلاق" aria-label="إغلاق" className="text-slate-500 hover:text-slate-300">
            <X size={18} />
          </button>
        </div>

        <div className="p-4 space-y-4">
          <p className="text-[11px] text-slate-500 leading-relaxed">
            دعوة بالإيميل مباشرة — بدون مزامنة حية: التغييرات بتظهر للطرف المدعو لما يسجّل دخول أو يعيد تحميل الصفحة. المحرّر (editor) يقدر يعدّل المخطط متل المالك تماماً؛ المُشاهد (viewer) قراءة بس.
          </p>

          {isOwner && (
            <form onSubmit={handleInvite} className="flex flex-col gap-2 bg-slate-900 border border-slate-800 rounded-md p-3">
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="إيميل الشخص المدعو"
                className="bg-slate-800 border border-slate-700 rounded-md px-2.5 py-1.5 text-xs text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-cyan-500"
              />
              <div className="flex items-center gap-2">
                <select
                  value={role}
                  aria-label="صلاحية العضو المدعو"
                  onChange={(e) => setRole(e.target.value)}
                  className="flex-1 bg-slate-800 border border-slate-700 rounded-md px-2.5 py-1.5 text-xs text-slate-100 focus:outline-none focus:border-cyan-500"
                >
                  <option value="editor">محرّر — يقدر يعدّل</option>
                  <option value="viewer">مُشاهد — قراءة بس</option>
                </select>
                <button
                  type="submit"
                  disabled={submitting || !email.trim()}
                  className="flex items-center gap-1.5 text-xs font-semibold bg-cyan-500 text-slate-100 rounded-md px-3 py-1.5 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-cyan-400"
                >
                  <UserPlus size={13} /> دعوة
                </button>
              </div>
            </form>
          )}

          <div className="space-y-1.5">
            {members.length === 0 && (
              <p className="text-[11px] text-slate-500">ما في أعضاء مدعوّين بعد.</p>
            )}
            {members.map((m) => (
              <div key={m.id} className="flex items-center justify-between gap-2 bg-slate-900 border border-slate-800 rounded-md px-3 py-2">
                <div className="min-w-0">
                  <p className="text-xs font-semibold text-slate-200 truncate">{m.invited_email}</p>
                  <p className="text-[10px] text-slate-500 flex items-center gap-1 mt-0.5">
                    {m.role === "editor" ? <Pencil size={10} /> : <Eye size={10} />}
                    {ROLE_LABEL[m.role] || m.role}
                    {!m.user_id && " · بانتظار قبول الدعوة"}
                  </p>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  {isOwner && (
                    <>
                      <select
                        value={m.role}
                        aria-label={`صلاحية ${m.invited_email}`}
                        onChange={(e) => onChangeRole(m.id, e.target.value)}
                        className="bg-slate-800 border border-slate-700 rounded-md px-1.5 py-1 text-[10px] text-slate-200 focus:outline-none"
                      >
                        <option value="editor">محرّر</option>
                        <option value="viewer">مُشاهد</option>
                      </select>
                      <button onClick={() => onRemove(m.id)} title="إزالة العضو" className="text-slate-500 hover:text-red-400 p-1">
                        <Trash2 size={13} />
                      </button>
                    </>
                  )}
                  {!isOwner && m.user_id === myUserId && (
                    <button onClick={onLeave} title="مغادرة المشروع" className="flex items-center gap-1 text-[10px] font-semibold text-red-400 hover:text-red-300 px-2 py-1">
                      <LogOut size={12} /> مغادرة
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>

          {isOwner && (
            <p className="text-[10px] text-slate-500 flex items-center gap-1">
              <Crown size={11} /> أنت مالك المشروع — صلاحياتك كاملة دايماً، ما في داعي تضيف نفسك كعضو.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

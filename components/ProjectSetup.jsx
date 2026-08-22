"use client";

import { useState } from "react";
import { LogOut, Folders, FolderPlus, Loader2, ChevronLeft, AlertTriangle } from "lucide-react";
import { clamp } from "../lib/planGeometry";

const LAND_TYPES = ["فيلا سكنية", "شقة / سكني متعدد", "مبنى تجاري", "أرض فارغة"];

export default function ProjectSetup({ onCreate, onSignOut, userEmail, projectsList, onOpenProject }) {
  const [name, setName] = useState("");
  const [client, setClient] = useState("");
  const [landType, setLandType] = useState(LAND_TYPES[0]);
  const [city, setCity] = useState("");
  const [width, setWidth] = useState(20);
  const [depth, setDepth] = useState(15);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const canCreate = name.trim().length > 0 && !loading;

  async function handleCreate() {
    setLoading(true);
    setError("");
    try {
      await onCreate({ name: name.trim(), client: client.trim(), landType, city: city.trim(), width, depth });
    } catch (err) {
      setError(err.message || "صار خطأ أثناء إنشاء المشروع، حاول من جديد.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main dir="rtl" className="w-full h-screen flex items-center justify-center bg-slate-950 text-slate-100 px-4" style={{ fontFamily: "'Tajawal', sans-serif" }}>
      <div className="w-full max-w-md">
        <div className="flex items-center justify-between gap-2.5 mb-6">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-md overflow-hidden shrink-0">
              <img src="/logo.png" alt="مُخطِّط · استوديو 360" className="w-full h-full object-cover" />
            </div>
            <div>
              <h1 className="text-lg font-extrabold leading-none">مُخطِّط · استوديو 360</h1>
              <p className="text-[11px] text-slate-400 mt-0.5">تصميم معماري وديكور بتقنية ثلاثية الأبعاد</p>
            </div>
          </div>
          <button onClick={onSignOut} title="تسجيل الخروج" className="flex items-center gap-1.5 text-[11px] text-slate-500 hover:text-slate-300 shrink-0">
            <LogOut size={13} /> خروج
          </button>
        </div>

        {userEmail && <p className="text-[11px] text-slate-500 mb-3 -mt-3 font-mono truncate" dir="ltr">{userEmail}</p>}

        {projectsList && projectsList.length > 0 && (
          <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-4 mb-4">
            <p className="flex items-center gap-1.5 text-xs font-bold text-slate-300 mb-2"><Folders size={14} /> مشاريعك السابقة</p>
            <div className="space-y-1.5 max-h-48 overflow-y-auto">
              {projectsList.map((p) => (
                <button key={p.id} onClick={() => onOpenProject(p.id)}
                  className="w-full text-right px-3 py-2 rounded-md text-xs bg-slate-800/60 hover:bg-slate-800 border border-slate-700 transition-colors">
                  <p className="font-semibold text-slate-100 truncate">{p.name}</p>
                  <p className="text-[10px] text-slate-500 font-mono truncate">{p.land_type} · {p.city || "—"}</p>
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-5 space-y-4">
          <div className="flex items-center gap-2 text-cyan-700 text-sm font-bold">
            <FolderPlus size={16} /> ابدأ مشروعاً جديداً من الصفر
          </div>

          <div>
            <label className="text-xs text-slate-400 block mb-1.5">اسم المشروع *</label>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="مثال: فيلا العائلة" className="w-full bg-slate-950 border border-slate-700 rounded-md px-3 py-2 text-sm outline-none focus:border-cyan-500" />
          </div>

          <div>
            <label className="text-xs text-slate-400 block mb-1.5">اسم العميل (اختياري)</label>
            <input value={client} onChange={(e) => setClient(e.target.value)} placeholder="مثال: أبو محمد" className="w-full bg-slate-950 border border-slate-700 rounded-md px-3 py-2 text-sm outline-none focus:border-cyan-500" />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-slate-400 block mb-1.5">نوع الأرض</label>
              <select value={landType} onChange={(e) => setLandType(e.target.value)} aria-label="نوع الأرض" className="w-full bg-slate-950 border border-slate-700 rounded-md px-2.5 py-2 text-sm outline-none focus:border-cyan-500">
                {LAND_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs text-slate-400 block mb-1.5">المدينة</label>
              <input value={city} onChange={(e) => setCity(e.target.value)} placeholder="مثال: عمّان" className="w-full bg-slate-950 border border-slate-700 rounded-md px-2.5 py-2 text-sm outline-none focus:border-cyan-500" />
            </div>
          </div>

          <div>
            <label className="text-xs text-slate-400 block mb-1.5">أبعاد الأرض (متر)</label>
            <div className="flex items-center gap-2">
              <input type="number" min="6" max="60" value={width} onChange={(e) => setWidth(clamp(parseFloat(e.target.value) || 6, 6, 60))} aria-label="عرض الأرض بالمتر" className="w-full bg-slate-950 border border-slate-700 rounded-md px-2.5 py-2 text-sm outline-none focus:border-cyan-500 font-mono" />
              <span className="text-slate-500 text-xs">×</span>
              <input type="number" min="6" max="60" value={depth} onChange={(e) => setDepth(clamp(parseFloat(e.target.value) || 6, 6, 60))} aria-label="عمق الأرض بالمتر" className="w-full bg-slate-950 border border-slate-700 rounded-md px-2.5 py-2 text-sm outline-none focus:border-cyan-500 font-mono" />
              <span className="text-slate-500 text-xs whitespace-nowrap">متر</span>
            </div>
            <p className="text-[11px] font-mono text-slate-500 mt-1">المساحة الإجمالية: {(width * depth).toFixed(0)} م²</p>
          </div>

          <button
            disabled={!canCreate}
            onClick={handleCreate}
            className="w-full flex items-center justify-center gap-2 bg-cyan-500 disabled:bg-slate-700 disabled:text-slate-400 text-slate-100 font-bold rounded-md py-2.5 mt-1 transition-colors"
          >
            {loading ? (
              <>جارِ الإنشاء... <Loader2 size={16} className="animate-spin" /></>
            ) : (
              <>إنشاء المشروع <ChevronLeft size={16} /></>
            )}
          </button>

          {error && (
            <p className="flex items-center gap-1.5 text-xs text-red-400 bg-red-950/40 border border-red-900 rounded-md px-2.5 py-2">
              <AlertTriangle size={13} className="shrink-0" /> {error}
            </p>
          )}
        </div>
      </div>
    </main>
  );
}

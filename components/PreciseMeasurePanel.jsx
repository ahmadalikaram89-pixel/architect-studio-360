"use client";

import { useState, useEffect } from "react";
import { Ruler } from "lucide-react";

// لوحة قياسات دقيقة لغرفة مستطيلة محددة — 4 حقول رقمية تكتب مباشرة على gx/gy/gw/gh
// (بدل السحب بس)؛ حالة محلية بتنعكس من الغرفة عند تغيّر id/قيمها (نفس نمط owner/notes
// بـ PhaseCard)، والكتابة الفعلية لقاعدة البيانات تصير عند الخروج من الحقل (onBlur)
export default function PreciseMeasurePanel({ room, onCommit }) {
  const [local, setLocal] = useState({ gx: room.gx, gy: room.gy, gw: room.gw, gh: room.gh });

  useEffect(() => {
    setLocal({ gx: room.gx, gy: room.gy, gw: room.gw, gh: room.gh });
  }, [room.id, room.gx, room.gy, room.gw, room.gh]);

  function field(label, key, min) {
    return (
      <div>
        <label className="text-[11px] text-slate-400 block mb-1">{label}</label>
        <input
          type="number"
          step="0.05"
          min={min}
          value={local[key]}
          onChange={(e) => setLocal((l) => ({ ...l, [key]: e.target.value }))}
          onBlur={(e) => {
            const v = Math.max(min, parseFloat(e.target.value) || min);
            setLocal((l) => ({ ...l, [key]: v }));
            if (v !== room[key]) onCommit(key, v);
          }}
          className="w-full bg-slate-950 border border-slate-700 rounded-md px-2 py-1.5 text-xs outline-none focus:border-cyan-500 font-mono"
        />
      </div>
    );
  }

  return (
    <div>
      <p className="text-xs font-semibold text-slate-400 mb-2 flex items-center gap-1.5"><Ruler size={13} /> قياسات دقيقة</p>
      <div className="grid grid-cols-2 gap-2">
        {field("X", "gx", 0)}
        {field("Y", "gy", 0)}
        {field("العرض", "gw", 0.3)}
        {field("العمق", "gh", 0.3)}
      </div>
    </div>
  );
}

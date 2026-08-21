"use client";

import { AlertTriangle, HardHat, X } from "lucide-react";
import { floorLabel } from "../lib/planGeometry";

// لوحة "تقدير إنشائي أولي" — عرض شاشة فقط، بلا كتابة لقاعدة البيانات. تحذير السلامة بارز
// ومتكرر عن قصد (مش سطر صغير بالأسفل) — هاد موضوع سلامة إنشائية فعلية، مو ميزة عادية
export default function StructuralPanel({ estimate, onClose }) {
  const byFloor = new Map();
  estimate.rooms.forEach((r) => {
    if (!byFloor.has(r.floor)) byFloor.set(r.floor, []);
    byFloor.get(r.floor).push(r);
  });
  const floors = [...byFloor.keys()].sort((a, b) => a - b);

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-slate-950 border border-slate-800 rounded-lg shadow-xl w-full max-w-2xl max-h-[85vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-4 border-b border-slate-800 sticky top-0 bg-slate-950">
          <h2 className="text-base font-bold flex items-center gap-2">
            <HardHat size={16} /> تقدير إنشائي أولي
          </h2>
          <button onClick={onClose} className="text-slate-500 hover:text-slate-300">
            <X size={18} />
          </button>
        </div>

        <div className="p-4">
          <div className="flex items-start gap-2 bg-red-950/40 border border-red-900 rounded-md px-3 py-2.5 mb-4">
            <AlertTriangle size={16} className="shrink-0 text-red-400 mt-0.5" />
            <p className="text-[11px] text-red-300 leading-relaxed">
              <strong>هاد مو تصميم إنشائي معتمد.</strong> القيم هون تقديرية جداً بقواعد إبهام سريعة (نسب باع/عمق معيارية) لغايات التصوّر المعماري المبكر بس — بلا حساب أحمال فعلي حسب كود بناء، بلا تسليح، وبلا اعتبار للتربة أو الزلازل أو الرياح.
              <strong> أي مشروع بناء فعلي لازم يمرّ بتصميم ومراجعة من مهندس إنشائي مرخّص قبل التنفيذ — بلا استثناء.</strong>
            </p>
          </div>

          {estimate.rooms.length === 0 && (
            <p className="text-[11px] text-slate-500">لا توجد غرف بالمشروع بعد.</p>
          )}

          {floors.map((floorNum) => (
            <div key={floorNum} className="mb-4">
              <p className="text-xs font-semibold text-slate-400 mb-2">{floorLabel(floorNum)}</p>
              <div className="overflow-x-auto">
                <table className="w-full text-xs min-w-[480px]">
                  <thead>
                    <tr className="border-b border-slate-800 text-slate-500">
                      <th className="text-right py-1.5 pl-2">الغرفة</th>
                      <th className="text-right py-1.5 px-2">الأبعاد</th>
                      <th className="text-right py-1.5 px-2">سماكة البلاطة</th>
                      <th className="text-right py-1.5 pr-2">أبعاد الكمرة المحيطية</th>
                    </tr>
                  </thead>
                  <tbody>
                    {byFloor.get(floorNum).map((r) => (
                      <tr key={r.roomId} className="border-b border-slate-900">
                        <td className="py-1.5 pl-2">{r.name}</td>
                        <td className="py-1.5 px-2 font-mono text-slate-600" dir="ltr">{r.shortSpan.toFixed(1)}×{r.longSpan.toFixed(1)} م</td>
                        <td className="py-1.5 px-2 font-mono">{r.slabThicknessMm} مم</td>
                        <td className="py-1.5 pr-2 font-mono" dir="ltr">{r.beamWidthMm}×{r.beamDepthMm} مم</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))}

          {estimate.column && (
            <div className="mt-2 bg-slate-900 border border-slate-800 rounded-md p-3">
              <p className="text-xs font-semibold text-slate-400 mb-1.5">عمود نموذجي توضيحي (مو مواقع أعمدة فعلية — البرنامج ما بيحدد مواقع الأعمدة)</p>
              <p className="text-sm font-mono font-bold" dir="ltr">{estimate.column.sideMm}×{estimate.column.sideMm} مم</p>
              <p className="text-[11px] text-slate-500 mt-1 leading-relaxed">
                مبني على أكبر فراغ بالمخطط ({estimate.column.basedOnAreaM2} م²) عبر {estimate.column.floorCount} طابق (حمل تقديري ≈ {estimate.column.loadKN} كيلونيوتن) — عمود يخدم فراغ بهاد الحجم تقريباً، بافتراض تبسيط شديد لمقاومة الخرسانة.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

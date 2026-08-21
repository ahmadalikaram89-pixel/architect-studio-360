"use client";

import { useMemo, useState } from "react";
import { Calculator, X, FileDown } from "lucide-react";

// لوحة جدول الكميات (BOQ) — عرض شاشة فقط (بلا كتابة لقاعدة البيانات، أسعار الوحدة حالة
// محلية مؤقتة فقط، لأنها بتفرق كتير حسب السوق المحلي ووقت التسعير، مو جزء من بيانات التصميم)
export default function BoqPanel({ items, onClose, projectName }) {
  const [prices, setPrices] = useState({});

  const grandTotal = useMemo(
    () => items.reduce((s, item) => s + item.quantity * (prices[item.key] ?? 0), 0),
    [items, prices]
  );

  function handleExportCsv() {
    const rows = [
      ["البند", "الوحدة", "الكمية", "سعر الوحدة", "الإجمالي"],
      ...items.map((item) => {
        const price = prices[item.key] ?? 0;
        return [item.label, item.unit, item.quantity, price, round2(item.quantity * price)];
      }),
      ["", "", "", "الإجمالي التقديري", round2(grandTotal)],
    ];
    const csv = rows.map((row) => row.map(csvCell).join(",")).join("\r\n");
    const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${projectName || "جدول_الكميات"}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-slate-950 border border-slate-800 rounded-lg shadow-xl w-full max-w-2xl max-h-[85vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-4 border-b border-slate-800 sticky top-0 bg-slate-950">
          <h2 className="text-base font-bold flex items-center gap-2">
            <Calculator size={16} /> جدول الكميات (تقدير أولي)
          </h2>
          <button onClick={onClose} className="text-slate-500 hover:text-slate-300">
            <X size={18} />
          </button>
        </div>

        <div className="p-4">
          <p className="text-xs text-slate-500 mb-3 leading-relaxed">
            كميات محسوبة تلقائياً من التصميم الحالي. عدّلي سعر الوحدة حسب سوقك المحلي — الإجمالي بيتحدث فوراً.
            هاد تقدير أولي بس لمساعدتك بالميزانية المبدئية، مو جدول كميات هندسي نهائي بديل عن مكتب حساب كميات.
          </p>

          <div className="overflow-x-auto">
            <table className="w-full text-xs min-w-[480px]">
              <thead>
                <tr className="border-b border-slate-800 text-slate-500">
                  <th className="text-right py-1.5 pl-2">البند</th>
                  <th className="text-right py-1.5 px-2">الوحدة</th>
                  <th className="text-right py-1.5 px-2">الكمية</th>
                  <th className="text-right py-1.5 px-2">سعر الوحدة</th>
                  <th className="text-right py-1.5 pr-2">الإجمالي</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr key={item.key} className="border-b border-slate-900">
                    <td className="py-1.5 pl-2">{item.label}</td>
                    <td className="py-1.5 px-2 text-slate-600">{item.unit}</td>
                    <td className="py-1.5 px-2 font-mono">{item.quantity.toLocaleString()}</td>
                    <td className="py-1.5 px-2">
                      <input
                        type="number"
                        min="0"
                        value={prices[item.key] ?? ""}
                        placeholder="0"
                        onChange={(e) => {
                          const v = parseFloat(e.target.value);
                          setPrices((p) => ({ ...p, [item.key]: Number.isFinite(v) ? v : 0 }));
                        }}
                        className="w-20 bg-slate-900 border border-slate-800 rounded px-1.5 py-0.5 font-mono"
                      />
                    </td>
                    <td className="py-1.5 pr-2 font-mono">{round2(item.quantity * (prices[item.key] ?? 0)).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={4} className="pt-3 text-sm font-bold">الإجمالي التقديري</td>
                  <td className="pt-3 text-sm font-bold font-mono">{round2(grandTotal).toLocaleString()}</td>
                </tr>
              </tfoot>
            </table>
          </div>

          <button
            onClick={handleExportCsv}
            className="mt-4 flex items-center gap-1.5 text-xs font-semibold bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-md px-3 py-2 transition-colors"
          >
            <FileDown size={13} /> تصدير CSV
          </button>
        </div>
      </div>
    </div>
  );
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

function csvCell(v) {
  const s = String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

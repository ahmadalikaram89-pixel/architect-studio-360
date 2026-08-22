"use client";

// حدود خطأ (error boundary) عامة لكل التطبيق — بلا هاد الملف، أي خطأ برمجي غير متوقّع
// (استثناء وقت التشغيل بمكان ما بشجرة React، مو خطأ Supabase معروف أصلاً محكي عنه بـ
// notifyError) كان بيبيّض الشاشة بالكامل بلا أي رسالة ولا طريقة تعافي غير إعادة تحميل يدوية.
// اتفاقية Next.js App Router: أي ملف error.js بيلف كل الصفحات تحته تلقائياً بحدود خطأ React.
import { useEffect } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";

export default function GlobalError({ error, reset }) {
  useEffect(() => {
    // eslint-disable-next-line no-console
    console.error("خطأ غير متوقّع بالتطبيق:", error);
  }, [error]);

  return (
    <main dir="rtl" className="w-full h-screen flex items-center justify-center bg-slate-950 text-slate-100 px-4" style={{ fontFamily: "'Tajawal', sans-serif" }}>
      <div className="w-full max-w-sm text-center space-y-4">
        <div className="flex items-center justify-center gap-2 text-red-400">
          <AlertTriangle size={22} />
          <h1 className="text-base font-bold">صار خطأ غير متوقّع</h1>
        </div>
        <p className="text-xs text-slate-400 leading-relaxed">
          البرنامج واجه مشكلة برمجية غير معروفة. بيانات مشروعك محفوظة أصلاً بقاعدة البيانات — جرّبي "حاول من جديد"، ولو ضلت المشكلة أعيدي تحميل الصفحة.
        </p>
        <div className="flex items-center justify-center gap-2 pt-1">
          <button
            onClick={() => reset()}
            className="flex items-center gap-1.5 bg-cyan-500 hover:bg-cyan-400 text-slate-100 font-bold rounded-md px-4 py-2 text-xs transition-colors"
          >
            <RefreshCw size={13} /> حاول من جديد
          </button>
          <button
            onClick={() => window.location.reload()}
            className="bg-slate-800 hover:bg-slate-700 text-slate-200 font-semibold rounded-md px-4 py-2 text-xs transition-colors"
          >
            إعادة تحميل الصفحة
          </button>
        </div>
      </div>
    </main>
  );
}

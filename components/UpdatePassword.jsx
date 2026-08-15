"use client";

import React, { useState } from "react";
import { Loader2, AlertTriangle, Lock, Eye, EyeOff } from "lucide-react";
import { supabase } from "../lib/supabaseClient";

const ERROR_MESSAGES = {
  "Password should be at least 6 characters.": "كلمة السر لازم تكون 6 أحرف على الأقل.",
};

function translateError(message) {
  return ERROR_MESSAGES[message] || message;
}

function PasswordField({ label, value, onChange, placeholder }) {
  const [show, setShow] = useState(false);
  return (
    <div>
      <label className="text-xs text-slate-400 flex items-center gap-1 mb-1.5"><Lock size={12} /> {label}</label>
      <div className="relative" dir="ltr">
        <input
          type={show ? "text" : "password"}
          required
          minLength={6}
          value={value}
          onChange={onChange}
          placeholder={placeholder}
          className="w-full bg-slate-950 border border-slate-700 rounded-md pl-3 pr-9 py-2 text-sm outline-none focus:border-cyan-500"
        />
        <button
          type="button"
          onClick={() => setShow((s) => !s)}
          tabIndex={-1}
          title={show ? "إخفاء كلمة السر" : "إظهار كلمة السر"}
          className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300"
        >
          {show ? <EyeOff size={15} /> : <Eye size={15} />}
        </button>
      </div>
    </div>
  );
}

export default function UpdatePassword({ onDone }) {
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const canSubmit = password.length >= 6 && password === confirmPassword && !loading;

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");

    if (password !== confirmPassword) {
      setError("كلمة السر وتأكيدها غير متطابقين.");
      return;
    }

    setLoading(true);
    try {
      const { error: updateError } = await supabase.auth.updateUser({ password });
      if (updateError) throw updateError;
      onDone();
    } catch (err) {
      setError(translateError(err.message) || "صار خطأ، حاول من جديد.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div dir="rtl" className="w-full h-screen flex items-center justify-center bg-slate-950 text-slate-100 px-4" style={{ fontFamily: "'Tajawal', sans-serif" }}>
      <div className="w-full max-w-md">
        <div className="flex items-center gap-2.5 mb-6">
          <div className="w-9 h-9 rounded-md overflow-hidden shrink-0">
            <img src="/logo.png" alt="مُخطِّط · استوديو 360" className="w-full h-full object-cover" />
          </div>
          <div>
            <h1 className="text-lg font-extrabold leading-none">مُخطِّط · استوديو 360</h1>
            <p className="text-[11px] text-slate-400 mt-0.5">تصميم معماري وديكور بتقنية ثلاثية الأبعاد</p>
          </div>
        </div>

        <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-5 space-y-4">
          <div>
            <h2 className="text-sm font-bold">تعيين كلمة سر جديدة</h2>
            <p className="text-[11px] text-slate-400 mt-0.5">حطي كلمة السر الجديدة لحسابك.</p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <PasswordField
              label="كلمة السر الجديدة"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="6 أحرف على الأقل"
            />

            <PasswordField
              label="تأكيد كلمة السر"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="أعيدي كتابة كلمة السر"
            />

            <button
              type="submit"
              disabled={!canSubmit}
              className="w-full flex items-center justify-center gap-2 bg-cyan-500 disabled:bg-slate-700 disabled:text-slate-400 text-slate-950 font-bold rounded-md py-2.5 mt-1 transition-colors"
            >
              {loading ? (
                <>جارِ الحفظ... <Loader2 size={16} className="animate-spin" /></>
              ) : (
                "حفظ كلمة السر"
              )}
            </button>

            {error && (
              <p className="flex items-center gap-1.5 text-xs text-red-400 bg-red-950/40 border border-red-900 rounded-md px-2.5 py-2">
                <AlertTriangle size={13} className="shrink-0" /> {error}
              </p>
            )}
          </form>
        </div>
      </div>
    </div>
  );
}

"use client";

import React, { useState } from "react";
import { Box, Loader2, AlertTriangle, CheckCircle2, Mail, Lock } from "lucide-react";
import { supabase } from "../lib/supabaseClient";

const ERROR_MESSAGES = {
  "Invalid login credentials": "الإيميل أو كلمة السر غير صحيحة.",
  "User already registered": "في حساب مسجّل بهذا الإيميل من قبل. جرّب تسجيل الدخول.",
  "Password should be at least 6 characters.": "كلمة السر لازم تكون 6 أحرف على الأقل.",
};

function translateError(message) {
  return ERROR_MESSAGES[message] || message;
}

export default function Auth() {
  const [mode, setMode] = useState("login"); // 'login' | 'signup'
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [checkEmail, setCheckEmail] = useState(false);

  const isSignup = mode === "signup";
  const canSubmit =
    email.trim().length > 0 &&
    password.length >= 6 &&
    (!isSignup || password === confirmPassword) &&
    !loading;

  function switchMode(next) {
    setMode(next);
    setError("");
    setCheckEmail(false);
    setPassword("");
    setConfirmPassword("");
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");

    if (isSignup && password !== confirmPassword) {
      setError("كلمة السر وتأكيدها غير متطابقين.");
      return;
    }

    setLoading(true);
    try {
      if (isSignup) {
        const { data, error: signUpError } = await supabase.auth.signUp({
          email: email.trim(),
          password,
        });
        if (signUpError) throw signUpError;
        if (data.session) {
          // تأكيد الإيميل معطّل على المشروع، صار الدخول تلقائياً
          return;
        }
        setCheckEmail(true);
      } else {
        const { error: signInError } = await supabase.auth.signInWithPassword({
          email: email.trim(),
          password,
        });
        if (signInError) throw signInError;
      }
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
          <div className="w-9 h-9 rounded-md bg-orange-500 flex items-center justify-center">
            <Box size={20} className="text-slate-950" />
          </div>
          <div>
            <h1 className="text-lg font-extrabold leading-none">مُخطِّط · استوديو 360</h1>
            <p className="text-[11px] text-slate-400 mt-0.5">تصميم معماري وديكور بتقنية ثلاثية الأبعاد</p>
          </div>
        </div>

        <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-5 space-y-4">
          <div className="flex items-center gap-2 bg-slate-800/70 rounded-lg p-1">
            <button
              type="button"
              onClick={() => switchMode("login")}
              className={`flex-1 px-3 py-1.5 rounded-md text-xs font-semibold transition-colors ${mode === "login" ? "bg-orange-500 text-slate-950" : "text-slate-300 hover:text-white"}`}
            >
              تسجيل الدخول
            </button>
            <button
              type="button"
              onClick={() => switchMode("signup")}
              className={`flex-1 px-3 py-1.5 rounded-md text-xs font-semibold transition-colors ${mode === "signup" ? "bg-orange-500 text-slate-950" : "text-slate-300 hover:text-white"}`}
            >
              حساب جديد
            </button>
          </div>

          {checkEmail ? (
            <p className="flex items-start gap-2 text-xs text-emerald-300 bg-emerald-950/40 border border-emerald-900 rounded-md px-3 py-2.5 leading-relaxed">
              <CheckCircle2 size={15} className="shrink-0 mt-0.5" />
              تم إنشاء الحساب! افتحي بريدك الإلكتروني واضغطي على رابط التأكيد قبل تسجيل الدخول.
            </p>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="text-xs text-slate-400 flex items-center gap-1 mb-1.5"><Mail size={12} /> الإيميل</label>
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="example@email.com"
                  dir="ltr"
                  className="w-full bg-slate-950 border border-slate-700 rounded-md px-3 py-2 text-sm outline-none focus:border-orange-500"
                />
              </div>

              <div>
                <label className="text-xs text-slate-400 flex items-center gap-1 mb-1.5"><Lock size={12} /> كلمة السر</label>
                <input
                  type="password"
                  required
                  minLength={6}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="6 أحرف على الأقل"
                  dir="ltr"
                  className="w-full bg-slate-950 border border-slate-700 rounded-md px-3 py-2 text-sm outline-none focus:border-orange-500"
                />
              </div>

              {isSignup && (
                <div>
                  <label className="text-xs text-slate-400 flex items-center gap-1 mb-1.5"><Lock size={12} /> تأكيد كلمة السر</label>
                  <input
                    type="password"
                    required
                    minLength={6}
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="أعيدي كتابة كلمة السر"
                    dir="ltr"
                    className="w-full bg-slate-950 border border-slate-700 rounded-md px-3 py-2 text-sm outline-none focus:border-orange-500"
                  />
                </div>
              )}

              <button
                type="submit"
                disabled={!canSubmit}
                className="w-full flex items-center justify-center gap-2 bg-orange-500 disabled:bg-slate-700 disabled:text-slate-400 text-slate-950 font-bold rounded-md py-2.5 mt-1 transition-colors"
              >
                {loading ? (
                  <>جارِ التحقق... <Loader2 size={16} className="animate-spin" /></>
                ) : isSignup ? (
                  "إنشاء الحساب"
                ) : (
                  "تسجيل الدخول"
                )}
              </button>

              {error && (
                <p className="flex items-center gap-1.5 text-xs text-red-400 bg-red-950/40 border border-red-900 rounded-md px-2.5 py-2">
                  <AlertTriangle size={13} className="shrink-0" /> {error}
                </p>
              )}
            </form>
          )}
        </div>
      </div>
    </div>
  );
}

"use client";

import React, { useState } from "react";
import { Box, Loader2, AlertTriangle, CheckCircle2, Mail, Lock, Eye, EyeOff } from "lucide-react";
import { supabase } from "../lib/supabaseClient";

const ERROR_MESSAGES = {
  "Invalid login credentials": "الإيميل أو كلمة السر غير صحيحة.",
  "User already registered": "في حساب مسجّل بهذا الإيميل من قبل. جرّب تسجيل الدخول.",
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

export default function Auth() {
  const [mode, setMode] = useState("login"); // 'login' | 'signup' | 'reset'
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [checkEmail, setCheckEmail] = useState(false);
  const [resetSent, setResetSent] = useState(false);

  const isSignup = mode === "signup";
  const isReset = mode === "reset";
  const canSubmit =
    email.trim().length > 0 &&
    (isReset || password.length >= 6) &&
    (!isSignup || password === confirmPassword) &&
    !loading;

  function switchMode(next) {
    setMode(next);
    setError("");
    setCheckEmail(false);
    setResetSent(false);
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
      if (isReset) {
        const { error: resetError } = await supabase.auth.resetPasswordForEmail(email.trim(), {
          redirectTo: window.location.origin,
        });
        if (resetError) throw resetError;
        setResetSent(true);
      } else if (isSignup) {
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
          <div className="w-9 h-9 rounded-md bg-cyan-500 flex items-center justify-center">
            <Box size={20} className="text-slate-950" />
          </div>
          <div>
            <h1 className="text-lg font-extrabold leading-none">مُخطِّط · استوديو 360</h1>
            <p className="text-[11px] text-slate-400 mt-0.5">تصميم معماري وديكور بتقنية ثلاثية الأبعاد</p>
          </div>
        </div>

        <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-5 space-y-4">
          {isReset ? (
            <div>
              <h2 className="text-sm font-bold">إعادة تعيين كلمة السر</h2>
              <p className="text-[11px] text-slate-400 mt-0.5">حطي إيميلك وبنبعتلك رابط لتعيين كلمة سر جديدة.</p>
            </div>
          ) : (
            <div className="flex items-center gap-2 bg-slate-800/70 rounded-lg p-1">
              <button
                type="button"
                onClick={() => switchMode("login")}
                className={`flex-1 px-3 py-1.5 rounded-md text-xs font-semibold transition-colors ${mode === "login" ? "bg-cyan-500 text-slate-950" : "text-slate-300 hover:text-white"}`}
              >
                تسجيل الدخول
              </button>
              <button
                type="button"
                onClick={() => switchMode("signup")}
                className={`flex-1 px-3 py-1.5 rounded-md text-xs font-semibold transition-colors ${mode === "signup" ? "bg-cyan-500 text-slate-950" : "text-slate-300 hover:text-white"}`}
              >
                حساب جديد
              </button>
            </div>
          )}

          {checkEmail ? (
            <p className="flex items-start gap-2 text-xs text-emerald-300 bg-emerald-950/40 border border-emerald-900 rounded-md px-3 py-2.5 leading-relaxed">
              <CheckCircle2 size={15} className="shrink-0 mt-0.5" />
              تم إنشاء الحساب! افتحي بريدك الإلكتروني واضغطي على رابط التأكيد قبل تسجيل الدخول.
            </p>
          ) : resetSent ? (
            <>
              <p className="flex items-start gap-2 text-xs text-emerald-300 bg-emerald-950/40 border border-emerald-900 rounded-md px-3 py-2.5 leading-relaxed">
                <CheckCircle2 size={15} className="shrink-0 mt-0.5" />
                تفقدي بريدك الإلكتروني — بعتنالك رابط لإعادة تعيين كلمة السر.
              </p>
              <button
                type="button"
                onClick={() => switchMode("login")}
                className="text-xs text-cyan-400 hover:text-cyan-300"
              >
                رجوع لتسجيل الدخول
              </button>
            </>
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
                  className="w-full bg-slate-950 border border-slate-700 rounded-md px-3 py-2 text-sm outline-none focus:border-cyan-500"
                />
              </div>

              {!isReset && (
                <PasswordField
                  label="كلمة السر"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="6 أحرف على الأقل"
                />
              )}

              {isSignup && (
                <PasswordField
                  label="تأكيد كلمة السر"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="أعيدي كتابة كلمة السر"
                />
              )}

              {mode === "login" && (
                <button
                  type="button"
                  onClick={() => switchMode("reset")}
                  className="text-xs text-cyan-400 hover:text-cyan-300 -mt-2"
                >
                  نسيت كلمة السر؟
                </button>
              )}

              <button
                type="submit"
                disabled={!canSubmit}
                className="w-full flex items-center justify-center gap-2 bg-cyan-500 disabled:bg-slate-700 disabled:text-slate-400 text-slate-950 font-bold rounded-md py-2.5 mt-1 transition-colors"
              >
                {loading ? (
                  <>جارِ التحقق... <Loader2 size={16} className="animate-spin" /></>
                ) : isReset ? (
                  "إرسال رابط إعادة التعيين"
                ) : isSignup ? (
                  "إنشاء الحساب"
                ) : (
                  "تسجيل الدخول"
                )}
              </button>

              {isReset && (
                <button
                  type="button"
                  onClick={() => switchMode("login")}
                  className="w-full text-center text-xs text-slate-400 hover:text-slate-200"
                >
                  رجوع لتسجيل الدخول
                </button>
              )}

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

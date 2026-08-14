"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { supabase } from "../lib/supabaseClient";
import Auth from "../components/Auth";
import ArchitectStudio from "../components/ArchitectStudio";

export default function Home() {
  const [session, setSession] = useState(undefined); // undefined = لسا بيتحقق

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: listener } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession);
    });
    return () => listener.subscription.unsubscribe();
  }, []);

  if (session === undefined) {
    return (
      <div className="w-full h-screen flex items-center justify-center bg-slate-950">
        <Loader2 size={24} className="text-orange-500 animate-spin" />
      </div>
    );
  }

  if (!session) {
    return <Auth />;
  }

  return <ArchitectStudio session={session} />;
}

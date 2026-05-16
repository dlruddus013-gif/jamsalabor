"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Mail, Lock, Loader2 } from "lucide-react";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [pw, setPw] = useState("");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    setLoading(true);
    // mock — 실제로는 supabase.auth.signInWithPassword({ email, password })
    await new Promise((r) => setTimeout(r, 800));
    if (!email || !pw) {
      setErr("이메일과 비밀번호를 입력해주세요.");
      setLoading(false);
      return;
    }
    router.push("/dashboard");
  };

  return (
    <div
      className="min-h-screen flex items-center justify-center p-4"
      style={{
        backgroundImage:
          "radial-gradient(1200px 600px at 20% 0%, #F4ECD8, #FAF6EC 60%)",
      }}
    >
      <div className="w-full max-w-sm">
        {/* 로고 */}
        <div className="text-center mb-8">
          <div className="w-14 h-14 rounded-full bg-accent text-cream flex items-center justify-center mx-auto mb-3">
            <span className="font-display text-2xl font-bold">잠</span>
          </div>
          <h1 className="font-display text-[24px] font-bold">jamsa-vito</h1>
          <p className="text-[12px] text-ink-mute mt-1">
            한국잠사박물관 통화 분석 시스템
          </p>
        </div>

        {/* 폼 */}
        <form
          onSubmit={onSubmit}
          className="rounded-2xl bg-paper border border-line p-6 space-y-4"
        >
          <div>
            <label className="block text-[11px] text-ink-soft mb-1.5">이메일</label>
            <div className="flex items-center gap-2 px-3 py-2.5 rounded-xl border border-line bg-cream focus-within:border-accent transition-colors">
              <Mail size={14} className="text-ink-mute" />
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="admin@jamsamuseum.co.kr"
                className="flex-1 bg-transparent outline-none text-[14px]"
                autoComplete="email"
              />
            </div>
          </div>

          <div>
            <label className="block text-[11px] text-ink-soft mb-1.5">비밀번호</label>
            <div className="flex items-center gap-2 px-3 py-2.5 rounded-xl border border-line bg-cream focus-within:border-accent transition-colors">
              <Lock size={14} className="text-ink-mute" />
              <input
                type="password"
                value={pw}
                onChange={(e) => setPw(e.target.value)}
                placeholder="••••••••"
                className="flex-1 bg-transparent outline-none text-[14px]"
                autoComplete="current-password"
              />
            </div>
          </div>

          {err && (
            <div className="px-3 py-2 rounded-lg bg-accent/10 text-accent text-[11px]">
              {err}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full py-3 rounded-xl bg-ink text-cream font-bold text-[14px] flex items-center justify-center gap-2 disabled:opacity-60"
          >
            {loading ? (
              <>
                <Loader2 size={14} className="animate-spin" /> 로그인 중…
              </>
            ) : (
              "로그인"
            )}
          </button>

          <div className="text-center">
            <button
              type="button"
              className="text-[11px] text-ink-mute hover:text-ink-soft"
            >
              비밀번호를 잊으셨나요?
            </button>
          </div>
        </form>

        <div className="mt-4 text-center text-[10px] text-ink-mute">
          mock 모드 · 아무 이메일/비밀번호로 로그인 가능
        </div>
      </div>
    </div>
  );
}

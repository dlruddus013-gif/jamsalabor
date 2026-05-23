"use client";

import { createBrowserClient } from "@supabase/ssr";

// ─────────────────────────────────────────────────────────
// Browser Supabase Client
//
// - anon key 사용 (RLS로 데이터 보호)
// - 클라이언트 컴포넌트, 'use client' 파일에서만 사용
// - SSR 시 cookies는 서버 클라이언트(server.ts)가 처리
// ─────────────────────────────────────────────────────────

let cached: any = null;

export function createSupabaseBrowserClient(): any {
  // 동일 페이지 내 중복 인스턴스 방지
  if (cached) return cached;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    throw new Error(
      "Supabase 환경변수가 누락되었습니다. .env.local 에 NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY 를 설정하거나, mock 모드로 동작시키려면 isUsingSupabase() 를 먼저 체크하세요."
    );
  }

  cached = createBrowserClient(url, anonKey);
  return cached;
}

/**
 * 현재 실행 환경이 Supabase 모드인지 여부.
 * mock 모드에서는 클라이언트 생성을 시도하지 않고 mock 데이터를 사용하세요.
 */
export function isUsingSupabase(): boolean {
  return (
    !!process.env.NEXT_PUBLIC_SUPABASE_URL &&
    !!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  );
}

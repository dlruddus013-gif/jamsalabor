import "server-only";

import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";

// ─────────────────────────────────────────────────────────
// Server Supabase Clients
//
// 이 파일은 'server-only' 패키지로 보호됩니다:
// 클라이언트 번들에 import 되면 빌드 타임에 즉시 에러를 발생시켜
// SUPABASE_SERVICE_ROLE_KEY 가 브라우저로 유출되는 것을 막습니다.
// ─────────────────────────────────────────────────────────

/**
 * 일반 SSR 클라이언트
 * - anon key 사용
 * - 사용자 세션 쿠키 자동 전달 → RLS 정책 적용됨
 * - Server Components, Route Handlers, Server Actions 에서 사용
 *
 * 사용 예:
 *   const supabase = await createSupabaseServerClient();
 *   const { data, error } = await supabase.from('recordings').select();
 */
export async function createSupabaseServerClient(): Promise<any> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    throw new Error(
      "Supabase 환경변수가 누락되었습니다. .env.local 의 NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY 를 확인하세요."
    );
  }

  const cookieStore = await cookies();

  return createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(
        cookiesToSet: {
          name: string;
          value: string;
          options?: Parameters<typeof cookieStore.set>[2];
        }[]
      ) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => {
            cookieStore.set(name, value, options);
          });
        } catch {
          // Server Component 컨텍스트에서 set 호출되면 무시 (middleware 권장)
        }
      },
    },
  });
}

// ─────────────────────────────────────────────────────────
// Admin Client (service role)
//
// ⚠️ 주의사항
// - RLS를 우회합니다. 절대 사용자 입력을 그대로 신뢰하지 마세요.
// - 다음 용도로만 사용:
//     · 백그라운드 워커 (STT 처리, AI 요약)
//     · 관리자 API 라우트 (권한 검증 후)
//     · 마이그레이션·시드 스크립트
//     · audit_logs 강제 기록
// - Route Handler 안에서 사용할 때는 반드시 사용자 권한 검증 후 호출
// ─────────────────────────────────────────────────────────

let cachedAdmin: any = null;

export function createSupabaseAdminClient(): any {
  if (cachedAdmin) return cachedAdmin;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceRoleKey) {
    throw new Error(
      "Admin Supabase 클라이언트 생성 실패: SUPABASE_SERVICE_ROLE_KEY 가 누락되었거나 클라이언트 환경에서 호출되었습니다."
    );
  }

  cachedAdmin = createClient(url, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });

  return cachedAdmin;
}

/**
 * 서버 환경에서 Supabase 모드인지 검사.
 * URL/KEY가 모두 있어야 true.
 */
export function isUsingSupabaseServer(): boolean {
  return (
    !!process.env.NEXT_PUBLIC_SUPABASE_URL &&
    !!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY &&
    !!process.env.SUPABASE_SERVICE_ROLE_KEY
  );
}

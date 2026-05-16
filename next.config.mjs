import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  typedRoutes: false,
  outputFileTracingRoot: __dirname,
  experimental: {
    // 오디오 업로드를 server action 으로 처리하기 위해 본문 크기 한도 상향.
    // 기본값 1MB 로는 100MB 오디오 파일을 받을 수 없습니다.
    //
    // 운영 환경(특히 Vercel)에서 100MB 파일을 함수로 통과시키는 것은
    // 비용·콜드스타트 관점에서 비효율적이므로, 추후 클라이언트가 직접
    // Supabase Storage 로 업로드(signed URL 또는 anon 클라이언트)하고
    // 서버 액션은 메타데이터만 받는 패턴으로 전환을 권장합니다.
    serverActions: {
      bodySizeLimit: "110mb",
    },
  },
};

export default nextConfig;

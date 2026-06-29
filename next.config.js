/** @type {import('next').NextConfig} */
// Next.js 런타임 서버로 구동(rookies2와 동일: build 후 `next start`).
// 문서 파싱·LLM 호출·비교·리포트는 여전히 전부 브라우저(클라이언트)에서 돈다 —
// 서버로 문서를 보내지 않고, 문서 처리용 API route/server action 도 두지 않는다.
const nextConfig = {
  reactStrictMode: true,
  images: {
    // next/image 최적화 서버(sharp) 의존을 피한다 — 이미지는 그대로 서빙.
    unoptimized: true,
  },
};

module.exports = nextConfig;

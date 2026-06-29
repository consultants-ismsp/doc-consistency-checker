import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "문서 정합성 검사기",
  description: "docx 문서 세트의 용어·수치·판정 정합성을 브라우저에서 검사.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <head>
        {/* 저장된 테마를 페인트 전에 적용(깜빡임 방지). 기본은 다크, 라이트는 opt-in. */}
        <script
          dangerouslySetInnerHTML={{
            __html:
              "try{if(localStorage.getItem('docchecker.theme')==='light')document.documentElement.classList.add('theme-light')}catch(e){}",
          }}
        />
      </head>
      <body>{children}</body>
    </html>
  );
}

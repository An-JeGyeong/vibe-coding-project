import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = { title: { default: "망가브릿지", template: "%s · 망가브릿지" } };

const BOOTSTRAP_CSS = "https://cdn.jsdelivr.net/npm/bootstrap@5.3.8/dist/css/bootstrap.min.css";
const PRETENDARD_CSS = "https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable-dynamic-subset.css";
const PRETENDARD_SRI = "sha384-2nNKoOPayicGa+aRguOQuiZP+RqQ4G3jalfDeOgftkKD7zBM2gJXTwcFqCZltdv0"; // a font only: if it cannot load, the system fonts are used
const BOOTSTRAP_SRI = "sha384-sRIl4kxILFvY47J16cr9ZwB07vP4J8+LH7qKQnuqkuIAvNWLzeN8tE5YBujZqJLB";

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="ko">
    <head>
      <link rel="stylesheet" href={BOOTSTRAP_CSS} integrity={BOOTSTRAP_SRI} crossOrigin="anonymous" />
      <link rel="stylesheet" href={PRETENDARD_CSS} integrity={PRETENDARD_SRI} crossOrigin="anonymous" />
    </head>
    <body className="bg-body-tertiary">{children}</body>
  </html>;
}

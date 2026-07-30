import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import "./globals.css";

const baseMetadata: Metadata = {
  title: "데굴데굴 시간공작소 | 3D 시대 수집 게임",
  description:
    "시간 구슬을 굴려 제조, 건설, 수송, 통신, 생명 아이템을 모으는 초등학생용 3D 시대 여행 게임입니다.",
  applicationName: "데굴데굴 시간공작소",
  category: "education",
  keywords: ["3D 게임", "초등학생", "제조", "건설", "수송", "통신", "생명", "시대"],
  openGraph: {
    title: "데굴데굴 시간공작소",
    description: "작은 손도구부터 미래 생태돔까지! 시간 구슬을 굴려 다섯 시대를 여행해요.",
    type: "website",
    locale: "ko_KR",
  },
};

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const host =
    requestHeaders.get("x-forwarded-host") ??
    requestHeaders.get("host") ??
    "localhost:3000";
  const protocol =
    requestHeaders.get("x-forwarded-proto") ??
    (host.startsWith("localhost") || host.startsWith("127.0.0.1") ? "http" : "https");
  const origin = `${protocol}://${host}`;
  const imageUrl = new URL("/og.png", origin).toString();

  return {
    ...baseMetadata,
    metadataBase: new URL(origin),
    openGraph: {
      ...baseMetadata.openGraph,
      url: origin,
      images: [
        {
          url: imageUrl,
          width: 1734,
          height: 907,
          alt: "시간정비 로봇 토리가 황금 시간 구슬을 굴리며 손도구 시대부터 미래 생태돔까지 여행하는 모습",
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title: "데굴데굴 시간공작소",
      description: "시간 구슬을 굴려 다섯 시대의 발명품을 모으는 3D 게임",
      images: [imageUrl],
    },
  };
}

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#f5c94b",
  colorScheme: "light",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}

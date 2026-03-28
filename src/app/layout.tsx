import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geist = Geist({
  subsets: ["latin"],
  variable: "--font-sans",
  display: "swap",
});

const geistMono = Geist_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
  display: "swap",
});

const siteUrl = "https://grabix.app";

export const metadata: Metadata = {
  title: "Grabix — Extraia mídias de qualquer página",
  description:
    "Cole uma URL e extraia todas as imagens e vídeos públicos. Baixe um por um ou tudo em ZIP. Sem cadastro, sem login.",
  metadataBase: new URL(siteUrl),
  openGraph: {
    title: "Grabix — Extraia mídias de qualquer página",
    description: "Cole uma URL e extraia todas as imagens e vídeos públicos. Baixe um por um ou tudo em ZIP.",
    url: siteUrl,
    siteName: "Grabix",
    locale: "pt_BR",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Grabix — Extraia mídias de qualquer página",
    description: "Cole uma URL e extraia todas as imagens e vídeos públicos. Baixe um por um ou tudo em ZIP.",
  },
  robots: {
    index: true,
    follow: true,
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="pt-BR" className={`${geist.variable} ${geistMono.variable}`}>
      <body
        suppressHydrationWarning
        className="min-h-screen bg-[var(--g-bg)] font-sans text-[var(--g-ink)] antialiased"
      >
        {children}
      </body>
    </html>
  );
}

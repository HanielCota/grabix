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

export const metadata: Metadata = {
  title: "Grabix, Extraia mídias de qualquer página",
  description: "Cole uma URL, analise o HTML e baixe imagens e vídeos públicos de forma organizada.",
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

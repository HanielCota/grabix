import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { AttributionCapture } from "@/components/analytics/attribution-capture";
import { AuthProvider } from "@/components/auth/session-provider";
import { SiteHeader } from "@/components/site-header";
import { ThemeProvider, themeInitScript } from "@/components/theme/theme-provider";
import { ProExpiryBanner } from "@/components/upgrade/pro-expiry-banner";
import { UpgradeProvider } from "@/components/upgrade/upgrade-context";
import "./globals.css";

const geist = Geist({
  subsets: ["latin"],
  variable: "--font-geist-sans",
  display: "swap",
});

const geistMono = Geist_Mono({
  subsets: ["latin"],
  variable: "--font-geist-mono",
  display: "swap",
});

const siteUrl = "https://grabix.app";

export const metadata: Metadata = {
  title: {
    default: "Grabix - Baixar imagens e videos de paginas publicas",
    template: "%s | Grabix",
  },
  description:
    "Cole uma URL publica e extraia imagens e videos encontrados no HTML aberto. Baixe um por um ou tudo em ZIP. Plano gratis e Pro.",
  metadataBase: new URL(siteUrl),
  applicationName: "Grabix",
  alternates: { canonical: "/" },
  openGraph: {
    title: "Grabix - Baixar imagens e videos de paginas publicas",
    description: "Cole uma URL publica, encontre imagens e videos e baixe um por um ou tudo em ZIP.",
    url: siteUrl,
    siteName: "Grabix",
    locale: "pt_BR",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Grabix - Baixar imagens e videos de paginas publicas",
    description: "Cole uma URL publica, encontre imagens e videos e baixe um por um ou tudo em ZIP.",
  },
  robots: {
    index: true,
    follow: true,
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="pt-BR" className={`${geist.variable} ${geistMono.variable}`} suppressHydrationWarning>
      <head>
        {/* biome-ignore lint/security/noDangerouslySetInnerHtml: inline theme initialization to prevent FOUC */}
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body
        suppressHydrationWarning
        className="min-h-screen bg-[var(--g-bg)] font-sans text-[var(--g-ink)] antialiased"
      >
        <a
          href="#conteudo"
          className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[100] focus:rounded-lg focus:bg-[var(--g-accent)] focus:px-4 focus:py-2 focus:text-sm focus:font-bold focus:text-[var(--g-accent-text)]"
        >
          Pular para o conteúdo
        </a>
        <ThemeProvider>
          <AuthProvider>
            <UpgradeProvider>
              <AttributionCapture />
              <SiteHeader />
              <ProExpiryBanner />
              {children}
            </UpgradeProvider>
          </AuthProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}

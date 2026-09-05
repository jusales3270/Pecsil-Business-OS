import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { ThemeProvider, themeBootstrapScript } from "../packages/design-system/theme";
import { PwaProvider } from "./components/pwa-provider";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Pecsil Business OS",
  description: "Ecossistema empresarial modular da Pecsil.",
  manifest: "/manifest.webmanifest",
  applicationName: "Pecsil Business OS",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "Pecsil OS",
  },
  other: {
    "codex-preview": "development",
    "mobile-web-app-capable": "yes",
  },
  icons: {
    icon: [
      { url: "/favicon.png", type: "image/png" },
      { url: "/favicon.ico", sizes: "any" },
      { url: "/favicon.svg", type: "image/svg+xml" },
    ],
    shortcut: "/favicon.png",
    apple: "/icons/apple-touch-icon.png",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
  userScalable: true,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f5f6f8" },
    { media: "(prefers-color-scheme: dark)", color: "#08090b" },
  ],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="pt-BR" suppressHydrationWarning>
      <head>
        <link rel="icon" href="/favicon.png" type="image/png" />
        <link rel="shortcut icon" href="/favicon.png" />
        <link rel="apple-touch-icon" href="/icons/apple-touch-icon.png" />
        {/* Aplica o tema salvo antes da primeira pintura, para a página não
            nascer clara e piscar para escura. Precisa ser síncrono. */}
        <script dangerouslySetInnerHTML={{ __html: themeBootstrapScript }} />
      </head>
      <body className={`${geistSans.variable} ${geistMono.variable} antialiased`}>
        <ThemeProvider>
          <PwaProvider>{children}</PwaProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}


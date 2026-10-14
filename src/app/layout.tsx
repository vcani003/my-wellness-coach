import type { Metadata, Viewport } from "next";
import { Nunito } from "next/font/google";
import type { ReactNode } from "react";
import { DEFAULT_LOCALE, getMessages } from "@/lib/i18n";
import { Providers } from "@/ui/app/Providers";
import { META_COLORS } from "@/ui/theme/meta-colors";
import "./globals.css";

/** Nunito (SIL OFL), downloaded at build time and self-hosted: no request to Google from the phone. */
const nunito = Nunito({ subsets: ["latin"], weight: ["400", "600", "700"], variable: "--font-nunito", display: "swap" });

const t = getMessages();

export const metadata: Metadata = {
  title: t.app.name,
  description: t.app.description,
  applicationName: t.app.name,
  appleWebApp: { capable: true, title: t.app.name, statusBarStyle: "default" },
};

/**
 * `viewport-fit=cover` + safe-area padding; `interactive-widget=resizes-content` makes Android
 * shrink the page above the keyboard. iOS ignores it, so src/ui/shell/viewport.ts handles iOS.
 */
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  interactiveWidget: "resizes-content",
  themeColor: META_COLORS.surfaceDefault,
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang={DEFAULT_LOCALE} className={nunito.variable}>
      <body className="bg-surface-default font-body text-body text-text-default antialiased">
        <Providers locale={DEFAULT_LOCALE} messages={getMessages()}>
          {children}
        </Providers>
      </body>
    </html>
  );
}

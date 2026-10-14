/** PWA manifest (0001, frontend.md §5). Icons are simple placeholders for now. */
import type { MetadataRoute } from "next";
import { getMessages } from "@/lib/i18n";
import { META_COLORS } from "@/ui/theme/meta-colors";

export default function manifest(): MetadataRoute.Manifest {
  const t = getMessages();
  return {
    name: t.app.name,
    short_name: t.app.name,
    description: t.app.description,
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: META_COLORS.surfaceDefault,
    theme_color: META_COLORS.surfaceDefault,
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}

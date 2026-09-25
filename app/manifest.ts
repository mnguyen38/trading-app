import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Trading Lab",
    short_name: "Trading Lab",
    description: "Two automated strategies competing head-to-head on Alpaca paper trading",
    start_url: "/",
    id: "/",
    display: "standalone",
    orientation: "any",
    background_color: "#0a0a0a",
    theme_color: "#0a0a0a",
    categories: ["finance"],
    icons: [
      {
        src: "/icon.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icon.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "maskable",
      },
      {
        src: "/icon.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
    ],
    shortcuts: [
      {
        name: "Performance",
        url: "/performance",
        description: "View strategy performance",
      },
      {
        name: "Strategies",
        url: "/strategies",
        description: "View strategy implementation",
      },
    ],
  };
}

import type { Metadata } from "next";
import Viewer from "./Viewer";

export const metadata: Metadata = {
  title: "Swish — Pitch",
  description: "Stripe for private payments on Solana",
  openGraph: {
    title: "Swish — Pitch",
    description: "Stripe for private payments on Solana",
    images: ["/assets/open-graph-main.png"],
  },
  twitter: {
    card: "summary_large_image",
    title: "Swish — Pitch",
    description: "Stripe for private payments on Solana",
    images: ["/assets/open-graph-main.png"],
  },
};

export default function PitchPage() {
  return <Viewer />;
}

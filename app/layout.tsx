import type { Metadata } from "next";
import { Jost } from "next/font/google";
import "./globals.css";
import Providers from "./providers";
import { Logo, Footer } from "@/components";


const jost = Jost({
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700"],
  variable: "--font-jost",
});

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_APP_URL || "https://swish.privacy.cash"),
  title: "Swish",
  description: "Venmo, but private",
  icons: {
    icon: "/assets/logo.svg",
  },
  openGraph: {
    title: "Swish",
    description: "Venmo, but private",
    images: ["/assets/open-graph-main.png"],
  },
  twitter: {
    card: "summary_large_image",
    title: "Swish",
    description: "Venmo, but private",
    images: ["/assets/open-graph-main.png"],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={`${jost.className} antialiased bg-[#121212] min-h-screen`}>
        <Providers>
          <div className="mx-auto w-full max-w-107.5 min-h-screen bg-[#fafafa] relative">
            <div className="min-h-screen flex flex-col">
              {/* Header with Logo */}
              <header className="flex justify-center pt-8 pb-4">
                <Logo />
              </header>

              {/* Main Content */}
              <div className="flex-1 flex items-center justify-center">
                {children}
              </div>

              {/* Footer Navigation */}
              <Footer />
            </div>
          </div>
        </Providers>
      </body>
    </html>
  );
}

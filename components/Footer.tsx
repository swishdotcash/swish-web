"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";

export function Footer() {
  const pathname = usePathname();

  const isHome = pathname === "/";
  const isProfile = pathname === "/p";

  return (
    <>
      <nav className="sticky bottom-0 z-10 flex justify-center pt-4 pb-6">
        <div
          className="flex items-center gap-1 px-2 py-2 rounded-full"
          style={{
            background: "rgba(18, 18, 18, 0.08)",
            backdropFilter: "blur(20px)",
            WebkitBackdropFilter: "blur(20px)",
            boxShadow: "0 4px 12px rgba(18, 18, 18, 0.1)",
          }}
        >
          <Link
            href="/"
            className={`py-1 px-2 rounded-full`}
          >
            <Image
              src="/assets/home-icon.svg"
              alt="Home"
              width={24}
              height={24}
              style={{ opacity: isHome ? 1 : 0.5 }}
            />
          </Link>
          <Link
            href="/p"
            className={`py-1 px-2 rounded-full`}
          >
            <Image
              src="/assets/profile-icon.svg"
              alt="Profile"
              width={24}
              height={24}
              style={{ opacity: isProfile ? 1 : 0.5 }}
            />
          </Link>
        </div>
      </nav>
      <div className="flex justify-center pb-4">
        <div className="flex items-center gap-2 text-xs text-[#121212]/40">
          <a
            href="https://docs.swish.cash"
            target="_blank"
            rel="noopener noreferrer"
            className="hover:text-[#121212]/70 transition-colors"
          >
            Docs
          </a>
          <span>·</span>
          <Link
            href="/privacy"
            className="hover:text-[#121212]/70 transition-colors"
          >
            Privacy
          </Link>
          <span>·</span>
          <Link
            href="/terms"
            className="hover:text-[#121212]/70 transition-colors"
          >
            Terms
          </Link>
        </div>
      </div>
    </>
  );
}

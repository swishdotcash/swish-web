"use client";

import { motion } from "motion/react";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";

const tabs = [
  { href: "/",  icon: "/assets/home-icon.svg",    label: "Home"    },
  { href: "/p", icon: "/assets/profile-icon.svg", label: "Profile" },
];

export function Footer() {
  const pathname = usePathname();

  return (
    <nav aria-label="Main navigation" className="flex justify-center pb-6">
      <div
        role="tablist"
        className="relative flex items-center gap-1 px-2 py-2 rounded-full"
        style={{
          background: "rgba(18, 18, 18, 0.08)",
          backdropFilter: "blur(20px)",
          WebkitBackdropFilter: "blur(20px)",
          boxShadow: "0 4px 12px rgba(18, 18, 18, 0.1)",
        }}
      >
        {tabs.map(({ href, icon, label }) => {
          const active = pathname === href;
          return (
            <Link
              key={href}
              href={href}
              role="tab"
              aria-selected={active}
              aria-current={active ? "page" : undefined}
              className="relative py-1.5 px-3 rounded-full flex items-center gap-1.5 justify-center"
            >
              {active && (
                <motion.div
                  layoutId="footer-pill"
                  className="absolute inset-0 rounded-full bg-[#121212]/10"
                  transition={{ type: "spring", damping: 28, stiffness: 350 }}
                />
              )}
              <motion.div
                animate={{ opacity: active ? 1 : 0.45 }}
                transition={{ duration: 0.18 }}
                className="relative z-10 flex items-center gap-1.5"
              >
                <Image src={icon} alt="" aria-hidden="true" width={20} height={20} />
                <motion.span
                  animate={{ opacity: active ? 1 : 0 }}
                  transition={{ duration: 0.15 }}
                  className="text-xs font-medium text-[#121212] overflow-hidden"
                  style={{ width: active ? "auto" : 0, maxWidth: active ? 48 : 0 }}
                >
                  {label}
                </motion.span>
              </motion.div>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}

"use client";

import { motion } from "motion/react";

export function PrivacyBadge() {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
      className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-[#121212]/5 border border-[#121212]/8"
      aria-label="Privacy Mode is active"
      title="Your wallet address is not revealed to recipients"
    >
      <svg
        width="12"
        height="14"
        viewBox="0 0 12 14"
        fill="none"
        aria-hidden="true"
        className="text-[#121212]/70"
      >
        <path
          d="M6 0.5L0.5 2.75V6.5C0.5 9.7 2.9 12.7 6 13.5C9.1 12.7 11.5 9.7 11.5 6.5V2.75L6 0.5Z"
          fill="currentColor"
          fillOpacity="0.7"
        />
      </svg>
      <span className="text-xs font-medium text-[#121212]/70 tracking-wide">
        Private
      </span>
    </motion.div>
  );
}

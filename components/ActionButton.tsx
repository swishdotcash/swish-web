"use client";

import { motion } from "motion/react";
import Image from "next/image";

interface ActionButtonProps {
  variant: "send" | "receive";
  onClick?: () => void;
  disabled?: boolean;
}

const LABELS: Record<ActionButtonProps["variant"], { text: string; icon: string }> = {
  send:    { text: "Send",    icon: "/assets/send.svg"    },
  receive: { text: "Receive", icon: "/assets/receive.svg" },
};

export function ActionButton({ variant, onClick, disabled }: ActionButtonProps) {
  const { text, icon } = LABELS[variant];

  return (
    <motion.button
      onClick={onClick}
      disabled={disabled}
      aria-label={text}
      whileHover={
        disabled
          ? {}
          : { scale: 1.03, transition: { type: "spring", damping: 20, stiffness: 400 } }
      }
      whileTap={
        disabled
          ? {}
          : { scale: 0.95, transition: { type: "spring", damping: 18, stiffness: 500 } }
      }
      className="w-full h-11 bg-[#121212] rounded-full flex items-center justify-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed shadow-[0_4px_12px_rgba(18,18,18,0.15)]"
    >
      <Image src={icon} alt="" aria-hidden="true" width={20} height={14} />
      <span className="text-[#fafafa] text-sm font-semibold">{text}</span>
    </motion.button>
  );
}

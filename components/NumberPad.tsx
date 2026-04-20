"use client";

import { motion } from "motion/react";
import Image from "next/image";

interface NumberPadProps {
  onNumberPress: (num: string) => void;
  onBackspace: () => void;
}

const keyVariants = {
  rest: { scale: 1, backgroundColor: "rgba(18,18,18,0)" },
  hover: {
    backgroundColor: "rgba(18,18,18,0.05)",
    transition: { duration: 0.12 },
  },
  tap: {
    scale: 0.86,
    backgroundColor: "rgba(18,18,18,0.1)",
    transition: { type: "spring" as const, damping: 18, stiffness: 500 },
  },
};

export function NumberPad({ onNumberPress, onBackspace }: NumberPadProps) {
  const keys = ["1", "2", "3", "4", "5", "6", "7", "8", "9", ".", "0"];

  return (
    <div className="grid grid-cols-3 gap-y-2 gap-x-4 w-full">
      {keys.map((num) => (
        <motion.button
          key={num}
          onClick={() => onNumberPress(num)}
          variants={keyVariants}
          initial="rest"
          whileHover="hover"
          whileTap="tap"
          className="h-14 text-2xl font-medium text-[#121212] rounded-xl"
        >
          {num}
        </motion.button>
      ))}
      <motion.button
        onClick={onBackspace}
        variants={keyVariants}
        initial="rest"
        whileHover="hover"
        whileTap="tap"
        className="h-14 flex items-center justify-center rounded-xl"
      >
        <Image src="/assets/delete.svg" alt="Delete" width={28} height={19} />
      </motion.button>
    </div>
  );
}

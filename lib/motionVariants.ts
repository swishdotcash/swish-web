import type { Variants, Transition } from "motion/react";

export const SPRING: Transition = {
  type: "spring",
  damping: 25,
  stiffness: 300,
};

export const SPRING_SOFT: Transition = {
  type: "spring",
  damping: 20,
  stiffness: 220,
};

export const SPRING_SNAPPY: Transition = {
  type: "spring",
  damping: 18,
  stiffness: 500,
};

export const EASE_OUT_EXPO = [0.16, 1, 0.3, 1] as const;
export const EASE_IN_EXPO = [0.7, 0, 0.84, 0] as const;

export const fadeUp: Variants = {
  hidden: { opacity: 0, y: 16 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { type: "spring" as const, damping: 25, stiffness: 300 },
  },
  exit: {
    opacity: 0,
    y: 8,
    transition: { duration: 0.15, ease: [0.7, 0, 0.84, 0] as const },
  },
};

export const scaleIn: Variants = {
  hidden: { opacity: 0, scale: 0.9 },
  visible: {
    opacity: 1,
    scale: 1,
    transition: { type: "spring" as const, damping: 22, stiffness: 300 },
  },
  exit: {
    opacity: 0,
    scale: 0.95,
    transition: { duration: 0.12, ease: [0.7, 0, 0.84, 0] as const },
  },
};

export const staggerContainer: Variants = {
  hidden: {},
  visible: {
    transition: {
      staggerChildren: 0.055,
      delayChildren: 0.05,
    },
  },
};

export const staggerItem: Variants = {
  hidden: { opacity: 0, y: 12 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { type: "spring" as const, damping: 22, stiffness: 280 },
  },
};

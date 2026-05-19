"use client";

import { getDisabledProviderIds } from "@/lib/providers/maintenance";

const LABEL_MAP: Record<string, string> = {
  "privacy-cash": "Privacy Cash",
  "magicblock-per": "MagicBlock",
  umbra: "Umbra",
};

export function MaintenanceBanner() {
  const disabled = getDisabledProviderIds();
  if (disabled.length === 0) return null;

  const names = disabled.map((id) => LABEL_MAP[id] ?? id);
  const subject =
    names.length === 1
      ? `${names[0]} is`
      : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]} are`;

  return (
    <div className="bg-amber-50 border-b border-amber-200/60 px-4 py-2 text-center text-xs text-[#121212]">
      {subject} undergoing scheduled maintenance — temporarily unavailable.
      Other protocols continue to work normally.
    </div>
  );
}

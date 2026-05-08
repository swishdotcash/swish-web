import Image from "next/image";
import type { ProviderId } from "@/lib/providers/types";

const ICON_MAP: Record<ProviderId, string> = {
  "privacy-cash": "/assets/privacy-cash-logo.svg",
  "magicblock-per": "/assets/MagicBlock-Logomark-White-bg.png",
  umbra: "/assets/Umbra-Logo-1.png",
};

const LABEL_MAP: Record<ProviderId, string> = {
  "privacy-cash": "Privacy Cash",
  "magicblock-per": "MagicBlock",
  umbra: "Umbra",
};

interface ProtocolBadgeProps {
  providerId: ProviderId;
  iconSize?: number;
  showLabel?: boolean;
  className?: string;
}

export function ProtocolBadge({
  providerId,
  iconSize = 16,
  showLabel = true,
  className = "",
}: ProtocolBadgeProps) {
  return (
    <span className={`inline-flex items-center gap-1.5 ${className}`}>
      <Image
        src={ICON_MAP[providerId]}
        alt={showLabel ? "" : LABEL_MAP[providerId]}
        width={iconSize}
        height={iconSize}
      />
      {showLabel && <span>{LABEL_MAP[providerId]}</span>}
    </span>
  );
}

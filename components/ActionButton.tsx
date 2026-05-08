interface ActionButtonProps {
  variant: "send" | "receive";
  onClick?: () => void;
  disabled?: boolean;
}

export function ActionButton({ variant, onClick, disabled }: ActionButtonProps) {
  const label = variant === "send" ? "Send" : "Request";

  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="w-full h-10 bg-[#121212] rounded-full flex items-center justify-center text-[#fafafa] font-semibold hover:bg-[#121212]/90 active:scale-[0.98] transition-all disabled:opacity-40 disabled:cursor-not-allowed shadow-[0_4px_12px_rgba(18,18,18,0.15)]"
    >
      {label}
    </button>
  );
}

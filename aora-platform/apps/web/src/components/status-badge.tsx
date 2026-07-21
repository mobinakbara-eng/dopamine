interface StatusBadgeProps {
  label: string;
  tone?: "success" | "warning" | "neutral";
}

export function StatusBadge({
  label,
  tone = "neutral",
}: StatusBadgeProps) {
  return (
    <span className="status-badge" data-tone={tone}>
      {label}
    </span>
  );
}

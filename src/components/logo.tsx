/** Product logo. Decorative by default; pass a label when it stands alone. */
export function Logo({ size = 48, label, className = "" }: { size?: number; label?: string; className?: string }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src="/brand/logo.svg"
      width={size}
      height={size}
      alt={label ?? ""}
      aria-hidden={label ? undefined : true}
      className={`shrink-0 drop-shadow-sm ${className}`}
    />
  );
}

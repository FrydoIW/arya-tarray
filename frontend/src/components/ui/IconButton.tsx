import type { ButtonHTMLAttributes, ReactNode } from "react";

type IconButtonVariant = "default" | "danger";

type IconButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  label: string;
  icon: ReactNode;
  variant?: IconButtonVariant;
};

export function IconButton({
  label,
  icon,
  variant = "default",
  className = "",
  ...props
}: IconButtonProps) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={`ui-icon-button ui-icon-button-${variant} ${className}`.trim()}
      {...props}
    >
      {icon}
    </button>
  );
}

import type { ButtonHTMLAttributes, ReactNode } from "react";
import Link from "next/link";

export type ButtonVariant =
  | "primary"
  | "secondary"
  | "dark"
  | "success"
  | "danger"
  | "ghost";

export type ButtonSize = "sm" | "md" | "lg";

const VARIANTS: Record<ButtonVariant, string> = {
  primary:
    "bg-accent text-white shadow-btn hover:bg-accent-deep focus-visible:outline-ink",
  secondary:
    "border border-line-strong bg-white text-ink hover:border-[#B9AC98] focus-visible:outline-accent",
  dark: "bg-ink text-white hover:bg-ink-2 focus-visible:outline-accent",
  success:
    "bg-success text-white hover:bg-success-deep focus-visible:outline-ink",
  danger:
    "border border-danger-line bg-white text-danger hover:bg-danger-tint focus-visible:outline-danger",
  ghost: "text-ink hover:bg-line-soft focus-visible:outline-accent",
};

const SIZES: Record<ButtonSize, string> = {
  sm: "min-h-9 rounded-[9px] px-3.5 text-[13.5px]",
  md: "min-h-11 rounded-[10px] px-5 text-[14.5px]",
  lg: "min-h-12 rounded-[11px] px-6.5 text-base",
};

export function buttonClasses(
  variant: ButtonVariant = "primary",
  size: ButtonSize = "md",
  className = "",
) {
  return `inline-flex cursor-pointer items-center justify-center gap-2 font-semibold no-underline transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-45 ${VARIANTS[variant]} ${SIZES[size]} ${className}`;
}

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
};

export function Button({
  variant = "primary",
  size = "md",
  className = "",
  type = "button",
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      className={buttonClasses(variant, size, className)}
      {...rest}
    />
  );
}

export function ButtonLink({
  href,
  variant = "primary",
  size = "md",
  className = "",
  children,
}: {
  href: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
  className?: string;
  children: ReactNode;
}) {
  return (
    <Link href={href} className={buttonClasses(variant, size, className)}>
      {children}
    </Link>
  );
}

import type { ReactNode } from "react";

export function inputClasses(hasError = false, className = "") {
  return `w-full min-h-11 rounded-[10px] border bg-white px-3.5 py-2.5 text-[15px] text-ink outline-none transition-[border-color,box-shadow] placeholder:text-ink-faint focus:border-accent focus:shadow-[0_0_0_3px_rgba(168,67,26,0.12)] ${
    hasError ? "border-danger" : "border-line-input"
  } ${className}`;
}

export function Field({
  label,
  htmlFor,
  error,
  help,
  optional = false,
  children,
  className = "",
}: {
  label: string;
  htmlFor?: string;
  error?: string | null;
  help?: string;
  optional?: boolean;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={className}>
      <label
        htmlFor={htmlFor}
        className="mb-1.5 block text-[13.5px] font-semibold text-ink-2"
      >
        {label}
        {optional ? (
          <span className="ml-1.5 font-normal text-ink-muted">Optional</span>
        ) : null}
      </label>
      {children}
      {error ? (
        <p className="mt-1.5 text-[13px] font-medium text-danger">{error}</p>
      ) : help ? (
        <p className="mt-1.5 text-[13px] text-ink-muted">{help}</p>
      ) : null}
    </div>
  );
}

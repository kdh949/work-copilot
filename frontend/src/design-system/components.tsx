import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from "react";
import "./components.css";

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost" | "danger";
  size?: "sm" | "md";
  leadingIcon?: ReactNode;
};

export function Button({
  variant = "primary",
  size = "md",
  leadingIcon,
  className = "",
  children,
  ...props
}: ButtonProps) {
  return (
    <button
      className={`ds-button ds-button--${variant} ds-button--${size} ${className}`.trim()}
      {...props}
    >
      {leadingIcon ? <span className="ds-button__icon">{leadingIcon}</span> : null}
      <span>{children}</span>
    </button>
  );
}
type IconButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  label: string;
  children: ReactNode;
  inverse?: boolean;
};

export function IconButton({
  label,
  inverse = false,
  className = "",
  children,
  ...props
}: IconButtonProps) {
  return (
    <button
      aria-label={label}
      title={label}
      className={`ds-icon-button ${inverse ? "ds-icon-button--inverse" : ""} ${className}`.trim()}
      {...props}
    >
      {children}
    </button>
  );
}

type CheckboxProps = Omit<InputHTMLAttributes<HTMLInputElement>, "type"> & {
  label: ReactNode;
  description?: string;
};

export function Checkbox({ label, description, className = "", ...props }: CheckboxProps) {
  return (
    <label className={`ds-checkbox ${className}`.trim()}>
      <input type="checkbox" {...props} />
      <span className="ds-checkbox__control" aria-hidden="true" />
      <span className="ds-checkbox__copy">
        <span>{label}</span>
        {description ? <small>{description}</small> : null}
      </span>
    </label>
  );
}

export function StatusIndicator({
  tone,
  children,
}: {
  tone: "success" | "warning" | "neutral";
  children: ReactNode;
}) {
  return (
    <span className={`ds-status ds-status--${tone}`}>
      <span aria-hidden="true" />
      {children}
    </span>
  );
}

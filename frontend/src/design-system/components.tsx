import type {
  ButtonHTMLAttributes,
  HTMLAttributes,
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from "react";
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
      className={["ds-button", "ds-button--" + variant, "ds-button--" + size, className]
        .filter(Boolean)
        .join(" ")}
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
      className={["ds-icon-button", inverse ? "ds-icon-button--inverse" : "", className]
        .filter(Boolean)
        .join(" ")}
      {...props}
    >
      {children}
    </button>
  );
}

export function TextInput({ className = "", ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={["ds-input", className].filter(Boolean).join(" ")} {...props} />;
}

export function Select({ className = "", ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={["ds-select", className].filter(Boolean).join(" ")} {...props} />;
}

export function TextArea({ className = "", ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={["ds-textarea", className].filter(Boolean).join(" ")} {...props} />;
}

type CheckboxProps = Omit<InputHTMLAttributes<HTMLInputElement>, "type"> & {
  label: ReactNode;
  description?: string;
};

export function Checkbox({ label, description, className = "", ...props }: CheckboxProps) {
  return (
    <label className={["ds-checkbox", className].filter(Boolean).join(" ")}>
      <input type="checkbox" {...props} />
      <span className="ds-checkbox__control" aria-hidden="true" />
      <span className="ds-checkbox__copy">
        <span>{label}</span>
        {description ? <small>{description}</small> : null}
      </span>
    </label>
  );
}

type AlertProps = HTMLAttributes<HTMLDivElement> & {
  tone?: "info" | "success" | "warning" | "danger";
};

export function Alert({
  tone = "info",
  className = "",
  role,
  children,
  ...props
}: AlertProps) {
  return (
    <div
      role={role ?? (tone === "danger" ? "alert" : "status")}
      className={["ds-alert", "ds-alert--" + tone, className].filter(Boolean).join(" ")}
      {...props}
    >
      {children}
    </div>
  );
}

type BadgeProps = HTMLAttributes<HTMLSpanElement> & {
  tone?: "neutral" | "info" | "success" | "warning" | "danger";
};

export function Badge({ tone = "neutral", className = "", children, ...props }: BadgeProps) {
  return (
    <span
      className={["ds-badge", "ds-badge--" + tone, className].filter(Boolean).join(" ")}
      {...props}
    >
      {children}
    </span>
  );
}

export function StatusIndicator({
  tone = "neutral",
  children,
}: {
  tone?: "success" | "warning" | "danger" | "info" | "neutral";
  children: ReactNode;
}) {
  return (
    <span className={["ds-status", "ds-status--" + tone].join(" ")}>
      <span aria-hidden="true" />
      {children}
    </span>
  );
}

export function Card({ className = "", children, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={["ds-card", className].filter(Boolean).join(" ")} {...props}>
      {children}
    </div>
  );
}

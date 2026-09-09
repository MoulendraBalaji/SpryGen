import React from "react";
import "./design-system.css";

type DivProps = React.HTMLAttributes<HTMLDivElement>;

export function ClayCard({
  pressed,
  large,
  eyebrow,
  children,
  ...rest
}: DivProps & { pressed?: boolean; large?: boolean; eyebrow?: string }) {
  const cls = [
    "console-card",
    pressed ? "console-card--pressed" : "",
    large ? "console-card--lg" : ""
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <div className={cls} {...rest}>
      {eyebrow && <div className="console-eyebrow">{eyebrow}</div>}
      {children}
    </div>
  );
}

type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "default" | "primary" | "accent" | "ghost";
};

export const ClayButton = React.forwardRef<HTMLButtonElement, ButtonProps>(
  function ClayButton({ variant = "default", children, ...rest }, ref) {
    const cls = ["console-btn", variant !== "default" ? `console-btn--${variant}` : ""].filter(Boolean).join(" ");
    return (
      <button ref={ref} className={cls} {...rest}>
        {children}
      </button>
    );
  }
);

export const ClayInput = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  function ClayInput(props, ref) {
    return <input ref={ref} className="console-input" {...props} />;
  }
);

type ToggleProps = Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "onChange"> & {
  on: boolean;
  onChange: () => void;
};

export const ClayToggle = React.forwardRef<HTMLButtonElement, ToggleProps>(
  function ClayToggle({ on, onChange, ...rest }, ref) {
    return (
      <button
        ref={ref}
        className={`console-toggle ${on ? "console-toggle--on" : ""}`}
        onClick={onChange}
        type="button"
        aria-pressed={on}
        {...rest}
      >
        <span className="console-toggle__knob" />
      </button>
    );
  }
);

export function ClayBadge({
  status,
  children
}: {
  status: "healthy" | "degraded" | "dead" | "unauthenticated";
  children: React.ReactNode;
}) {
  return (
    <span className={`console-badge console-badge--${status}`}>
      <span className="console-badge__dot" />
      {children}
    </span>
  );
}

export function ClayModal({
  open,
  onClose,
  title,
  children
}: {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: React.ReactNode;
}) {
  const panelRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (!open) return;

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);

    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const restoreFocus = document.activeElement as HTMLElement | null;

    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = prevOverflow;
      if (restoreFocus && typeof restoreFocus.focus === "function") restoreFocus.focus();
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="console-modal__backdrop" onClick={onClose} role="presentation">
      <div
        ref={panelRef}
        className="console-modal__panel"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
      >
        {title && <h3 style={{ margin: "0 0 16px", color: "var(--console-text)" }}>{title}</h3>}
        {children}
      </div>
    </div>
  );
}
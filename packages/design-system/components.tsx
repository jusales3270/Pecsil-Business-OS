import type { ButtonHTMLAttributes, HTMLAttributes, ReactNode } from "react";

export function Button({ variant = "primary", className = "", ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "ghost" }) {
  return <button className={`ds-button ${variant} ${className}`} {...props} />;
}

export function Card({ className = "", children, ...props }: HTMLAttributes<HTMLElement> & { children: ReactNode }) {
  return <section className={`ds-card ${className}`} {...props}>{children}</section>;
}

export function Status({ tone = "neutral", children }: { tone?: "success" | "attention" | "danger" | "info" | "neutral"; children: ReactNode }) {
  return <span className={`ds-status ${tone}`}>{children}</span>;
}

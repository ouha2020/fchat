"use client";

import { forwardRef, type HTMLAttributes } from "react";

import { cx } from "./classNames";

type CardVariant = "default" | "section" | "action" | "empty";

const variantClassName: Record<CardVariant, string> = {
  default: "card",
  section: "section-card",
  action: "action-card",
  empty: "empty-state",
};

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  variant?: CardVariant;
  compact?: boolean;
}

const Card = forwardRef<HTMLDivElement, CardProps>(
  (
    {
      variant = "default",
      compact = false,
      className,
      children,
      ...props
    },
    ref,
  ) => (
    <div
      ref={ref}
      className={cx(
        variantClassName[variant],
        compact && "card-compact",
        className,
      )}
      {...props}
    >
      {children}
    </div>
  ),
);

Card.displayName = "Card";

export default Card;

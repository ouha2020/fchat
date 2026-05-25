"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { HTMLAttributes } from "react";

import { cx } from "./classNames";

export interface BottomTabBarItem {
  href: string;
  label: string;
  iconSrc: string;
  active?: boolean;
  disabled?: boolean;
  badge?: boolean;
  badgeLabel?: string;
  onClick?: () => void;
}

export interface BottomTabBarProps extends HTMLAttributes<HTMLElement> {
  items: BottomTabBarItem[];
  label?: string;
}

export default function BottomTabBar({
  items,
  label = "底部导航",
  className,
  ...props
}: BottomTabBarProps) {
  const pathname = usePathname();

  return (
    <nav
      aria-label={label}
      className={cx("bottom-tab-bar", className)}
      {...props}
    >
      <div className="bottom-tab-list">
        {items.map((item) => {
          const active =
            item.active ??
            (pathname === item.href ||
              (item.href !== "/" && pathname.startsWith(`${item.href}/`)));

          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? "page" : undefined}
              aria-disabled={item.disabled || undefined}
              aria-label={item.label}
              title={item.label}
              className={cx(
                "bottom-tab-item native-press",
                active && "bottom-tab-item-active",
                item.disabled && "pointer-events-none opacity-50",
              )}
              onClick={(event) => {
                if (item.disabled) {
                  event.preventDefault();
                  return;
                }
                item.onClick?.();
              }}
            >
              <span className="bottom-tab-icon-wrap" aria-hidden="true">
                <Image
                  src={item.iconSrc}
                  alt=""
                  width={24}
                  height={24}
                  className="bottom-tab-icon"
                />
                {item.badge ? (
                  <span className="bottom-tab-badge">
                    <span className="sr-only">
                      {item.badgeLabel ?? item.label}
                    </span>
                  </span>
                ) : null}
              </span>
              <span className="bottom-tab-label">{item.label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}

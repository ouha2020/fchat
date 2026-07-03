"use client";

import { useMemo } from "react";

import { linkifyText } from "@/lib/linkify";

interface Props {
  text: string;
  /** Color classes for links; underline and wrapping come built in. */
  linkClassName?: string;
}

export default function LinkifiedText({ text, linkClassName = "" }: Props) {
  const segments = useMemo(() => linkifyText(text), [text]);

  return (
    <>
      {segments.map((segment, index) =>
        segment.type === "link" && segment.href ? (
          <a
            key={index}
            href={segment.href}
            target="_blank"
            rel="noopener noreferrer"
            className={`break-all font-medium underline underline-offset-2 ${linkClassName}`}
            // Keep bubble-level click handlers (effect replay) out of link
            // taps; long-press suppression still works via the container's
            // capture-phase handler.
            onClick={(e) => e.stopPropagation()}
          >
            {segment.value}
          </a>
        ) : (
          <span key={index}>{segment.value}</span>
        ),
      )}
    </>
  );
}

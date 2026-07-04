"use client";

import type { LocalSession } from "@/lib/authLocal";
import { useResolvedMediaUrl } from "@/lib/mediaClient";

interface Props {
  session: LocalSession | null;
  avatarRef: string | null;
  name: string;
  /** Shell size/colors/rounding, e.g. "h-11 w-11 rounded-full bg-slate-200 text-base text-slate-700". */
  className?: string;
  /** Set when the member's name is already visible right next to the avatar. */
  ariaHidden?: boolean;
}

export default function MemberAvatarCircle({
  session,
  avatarRef,
  name,
  className = "",
  ariaHidden,
}: Props) {
  const avatarUrl = useResolvedMediaUrl(session, avatarRef);
  // Spread iterates code points, so emoji nicknames keep their first glyph
  // intact instead of a broken surrogate half.
  const placeholder = ([...name][0] ?? "?").toUpperCase();

  return (
    <div
      aria-hidden={ariaHidden}
      className={`flex shrink-0 items-center justify-center overflow-hidden ${className}`}
    >
      {avatarUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={avatarUrl}
          alt=""
          className="h-full w-full object-cover"
          draggable={false}
        />
      ) : (
        placeholder
      )}
    </div>
  );
}

"use client";

import { useState } from "react";

import type { LocalSession } from "@/lib/authLocal";
import { useCachedImage } from "@/lib/imageCache";

interface Props {
  session: LocalSession | null;
  avatarRef: string | null;
  name: string;
  /** Shell size/colors/rounding, e.g. "h-11 w-11 rounded-full bg-slate-200 text-base text-slate-700". */
  className?: string;
  /** Set when the member's name is already visible right next to the avatar. */
  ariaHidden?: boolean;
  mediaActive?: boolean;
}

export default function MemberAvatarCircle({
  session,
  avatarRef,
  name,
  className = "",
  ariaHidden,
  mediaActive = true,
}: Props) {
  // Avatars read from the local image cache: once loaded (or seeded on
  // upload) they show instantly and never re-download.
  const avatarUrl = useCachedImage(session, avatarRef, { enabled: mediaActive }).url;
  const [failedAvatarUrl, setFailedAvatarUrl] = useState<string | null>(null);
  const showAvatar = Boolean(avatarUrl && avatarUrl !== failedAvatarUrl);
  // Spread iterates code points, so emoji nicknames keep their first glyph
  // intact instead of a broken surrogate half.
  const placeholder = ([...name][0] ?? "?").toUpperCase();

  return (
    <div
      aria-hidden={ariaHidden}
      className={`flex shrink-0 items-center justify-center overflow-hidden rounded-full ${className}`}
    >
      {showAvatar ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={avatarUrl ?? undefined}
          alt=""
          className="block h-full w-full rounded-full object-cover"
          draggable={false}
          onError={() => setFailedAvatarUrl(avatarUrl)}
        />
      ) : (
        placeholder
      )}
    </div>
  );
}

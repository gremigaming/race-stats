import { useState } from "react";
import { cn } from "../utils/cn";
import { getTrackCountryCode } from "../utils/tracks";

type TrackFlagSize = "tiny" | "smaller" | "small" | "medium" | "large";

interface TrackFlagProps {
  track: string;
  size?: TrackFlagSize;
  className?: string;
  /**
   * Show every flag with about the same area: the real flag, never cropped,
   * sized by its own aspect ratio. Near-square flags (Belgium, Monaco) are
   * drawn at the usual 3:2 so they don't read as squares. Value = area in px².
   */
  uniformArea?: number;
}

const SIZE_CLASSES: Record<TrackFlagSize, string> = {
  tiny: "h-2 w-3",
  smaller: "h-3 w-4",
  small: "h-3.5 w-5",
  medium: "h-4 w-6",
  large: "h-6 w-8",
};

// flagcdn widths chosen so the 2x asset comfortably covers retina at each size.
const SIZE_WIDTHS: Record<TrackFlagSize, { base: number; retina: number }> = {
  tiny: { base: 20, retina: 40 },
  smaller: { base: 40, retina: 80 },
  // FlagCDN only serves its fixed width set; CSS scales this 40/80px asset to
  // the in-between 20×14px display size.
  small: { base: 40, retina: 80 },
  medium: { base: 80, retina: 160 },
  large: { base: 160, retina: 320 },
};

export function TrackFlag({
  track,
  size = "smaller",
  className = "",
  uniformArea,
}: TrackFlagProps) {
  const [ratio, setRatio] = useState<number | null>(null);
  const code = getTrackCountryCode(track);
  if (!code) return null;

  const { base, retina } = SIZE_WIDTHS[size];
  const src = `https://flagcdn.com/w${base}/${code}.png`;
  const srcSet = `https://flagcdn.com/w${retina}/${code}.png 2x`;

  return (
    <img
      src={src}
      srcSet={srcSet}
      alt=""
      loading="lazy"
      onLoad={
        uniformArea
          ? (event) => {
              const img = event.currentTarget;
              if (img.naturalWidth && img.naturalHeight) {
                setRatio(img.naturalWidth / img.naturalHeight);
              }
            }
          : undefined
      }
      style={
        uniformArea
          ? (() => {
              const r = Math.max(ratio ?? 1.5, 1.5);
              const width = Math.round(Math.sqrt(uniformArea * r));
              return { width, height: Math.round(width / r) };
            })()
          : undefined
      }
      className={cn(
        "inline-block rounded-[2px] object-cover",
        SIZE_CLASSES[size],
        className,
      )}
    />
  );
}

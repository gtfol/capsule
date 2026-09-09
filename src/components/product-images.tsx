"use client";
import { useState } from "react";
import { imageSource } from "@/lib/images";
import { getProductPreviewImages } from "@/lib/product-preview";
import type { Item } from "@/lib/types";

export function ProductImages({ item }: { item: Item }) {
  const { primary, secondary } = getProductPreviewImages(item);
  const frontSource = primary ? imageSource(primary) : null;
  const hoverSource = secondary ? imageSource(secondary) : null;
  const [loadedHover, setLoadedHover] = useState<string | null>(null);
  const [failedFront, setFailedFront] = useState<string | null>(null);
  const hoverReady = !!hoverSource && loadedHover === hoverSource;
  const frontUnavailable = !frontSource || failedFront === frontSource;
  return <div className="product-image" data-back-ready={hoverReady} data-front-unavailable={frontUnavailable} data-unavailable={frontUnavailable && !hoverReady ? "Image unavailable" : undefined}>
    {/* eslint-disable-next-line @next/next/no-img-element */}
    {frontSource && <img key={`primary:${frontSource}`} className="product-image-front" src={frontSource} alt={item.name} loading="lazy" decoding="async" onLoad={() => setFailedFront((current) => current === frontSource ? null : current)} onError={() => setFailedFront(frontSource)} />}
    {/* eslint-disable-next-line @next/next/no-img-element */}
    {hoverSource && <img key={`alternate:${hoverSource}`} className="product-image-back" src={hoverSource} alt="" aria-hidden="true" loading="lazy" decoding="async" onLoad={(event) => { if (event.currentTarget.naturalWidth > 0) setLoadedHover(hoverSource); }} onError={() => setLoadedHover((current) => current === hoverSource ? null : current)} />}
  </div>;
}

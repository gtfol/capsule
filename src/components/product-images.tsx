"use client";
import { useState } from "react";
import { imageSource } from "@/lib/images";
import type { Item } from "@/lib/types";

export function ProductImages({ item }: { item: Item }) {
  const frontSource = imageSource(item);
  const candidateBackSource = item.backImageData || item.backImageUrl ? imageSource({ imageUrl: item.backImageUrl ?? "", imageData: item.backImageData }) : null;
  const candidateSideSource = item.sideImageData || item.sideImageUrl ? imageSource({ imageUrl: item.sideImageUrl ?? "", imageData: item.sideImageData }) : null;
  const hoverSource = [candidateBackSource, candidateSideSource].find((source) => source && source !== frontSource) ?? null;
  const [loadedHover, setLoadedHover] = useState<string | null>(null);
  const [failedFront, setFailedFront] = useState<string | null>(null);
  const hoverReady = !!hoverSource && loadedHover === hoverSource;
  const frontUnavailable = failedFront === frontSource;
  return <div className="product-image" data-back-ready={hoverReady} data-front-unavailable={frontUnavailable} data-unavailable={frontUnavailable && !hoverReady ? "Image unavailable" : undefined}>
    {/* eslint-disable-next-line @next/next/no-img-element */}
    <img key={`front:${frontSource}`} className="product-image-front" src={frontSource} alt={item.name} loading="lazy" decoding="async" onLoad={() => setFailedFront(null)} onError={() => setFailedFront(frontSource)} />
    {/* eslint-disable-next-line @next/next/no-img-element */}
    {hoverSource && <img key={`alternate:${hoverSource}`} className="product-image-back" src={hoverSource} alt="" aria-hidden="true" loading="lazy" decoding="async" onLoad={(event) => { if (event.currentTarget.naturalWidth > 0) setLoadedHover(hoverSource); }} onError={() => setLoadedHover((current) => current === hoverSource ? null : current)} />}
  </div>;
}

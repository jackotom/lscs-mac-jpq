import { useState } from "react";
import { cardArtworkSources, type CardInfo } from "../../shared/cardDatabase";

interface CardThumbnailProps {
  card?: Pick<CardInfo, "cardId" | "imageUrl" | "cropImageUrl">;
  fallbackUrl?: string;
  className?: string;
  loading?: "lazy" | "eager";
}

export function CardThumbnail({ card, fallbackUrl, ...props }: CardThumbnailProps) {
  const sources = [...cardArtworkSources(card ?? {}, "image-first"), ...(fallbackUrl ? [fallbackUrl] : [])]
    .filter((source, index, values) => values.indexOf(source) === index);
  return <ThumbnailImage key={sources.join("\n")} sources={sources} {...props} />;
}

function ThumbnailImage({ sources, className, loading = "lazy" }: {
  sources: readonly string[];
  className?: string;
  loading?: "lazy" | "eager";
}) {
  const [index, setIndex] = useState(0);
  const source = sources[index];
  return source ? <img className={className} src={source} alt="" loading={loading}
    onError={() => setIndex(current => current + 1)} /> : null;
}

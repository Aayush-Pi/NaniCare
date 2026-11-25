import { useState } from "react";
import { Pill } from "lucide-react";

interface StripImageProps {
  src: string;
  alt: string;
  title: string;
  className?: string;
}

export function StripImage({ src, alt, title, className = "" }: StripImageProps) {
  const [failed, setFailed] = useState(false);

  if (!src || failed) {
    return (
      <div
        className={`flex flex-col items-center justify-center gap-2 bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 p-4 text-center ${className}`}
        role="img"
        aria-label={alt}
      >
        <Pill className="w-8 h-8 text-teal-700 dark:text-teal-400" aria-hidden="true" />
        <span className="text-sm font-semibold">{title}</span>
      </div>
    );
  }

  return (
    <img
      src={src}
      alt={alt}
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
      className={`object-cover ${className}`}
    />
  );
}

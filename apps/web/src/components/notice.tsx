"use client";
import { useEffect, useState, type ReactNode } from "react";

export function Notice({ autoDismiss, onDismiss, role, children }: { autoDismiss: boolean; onDismiss: () => void; role: "alert" | "status"; children: ReactNode }) {
  const [dismissing, setDismissing] = useState(false);
  useEffect(() => {
    if (!autoDismiss) return;
    const timer = window.setTimeout(() => setDismissing(true), 3000);
    return () => window.clearTimeout(timer);
  }, [autoDismiss]);
  return <div className="notice" role={role} data-dismissing={dismissing} onAnimationEnd={(event) => {
    if (dismissing && event.target === event.currentTarget && event.animationName === "notice-out") onDismiss();
  }}>{children}</div>;
}

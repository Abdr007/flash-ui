"use client";

import { useEffect } from "react";

export default function LandingLayout({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    // Override root layout's viewport-lock for scrollable landing page
    const html = document.documentElement;
    const body = document.body;

    const prevHtmlHeight = html.style.height;
    const prevBodyOverflow = body.style.overflow;
    const prevBodyHeight = body.className;

    html.style.height = "auto";
    body.style.overflow = "auto";
    body.style.height = "auto";

    return () => {
      html.style.height = prevHtmlHeight;
      body.style.overflow = prevBodyOverflow;
      body.style.height = "";
    };
  }, []);

  return <>{children}</>;
}

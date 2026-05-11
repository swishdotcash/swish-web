"use client";

import { useEffect, useRef, useState } from "react";
import { Document, Page, pdfjs } from "react-pdf";
import "react-pdf/dist/Page/AnnotationLayer.css";

pdfjs.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;

const PDF_FILE = "/pitch.pdf";
const MAX_WIDTH = 1280;

export default function Viewer() {
  const [numPages, setNumPages] = useState<number | null>(null);
  const [width, setWidth] = useState<number>(MAX_WIDTH);
  const slideRefs = useRef<(HTMLDivElement | null)[]>([]);
  const currentSlide = useRef<number>(0);

  useEffect(() => {
    const updateWidth = () => {
      const w = Math.min(window.innerWidth * 0.92, MAX_WIDTH);
      setWidth(w);
    };
    updateWidth();
    window.addEventListener("resize", updateWidth);
    return () => window.removeEventListener("resize", updateWidth);
  }, []);

  useEffect(() => {
    if (!numPages) return;

    const goTo = (idx: number) => {
      const clamped = Math.max(0, Math.min(idx, numPages - 1));
      if (clamped === currentSlide.current) return;
      currentSlide.current = clamped;
      slideRefs.current[clamped]?.scrollIntoView({
        behavior: "smooth",
        block: "center",
      });
    };

    const handleKey = (e: KeyboardEvent) => {
      if (["ArrowDown", "ArrowRight", "PageDown", " "].includes(e.key)) {
        e.preventDefault();
        goTo(currentSlide.current + 1);
      } else if (["ArrowUp", "ArrowLeft", "PageUp"].includes(e.key)) {
        e.preventDefault();
        goTo(currentSlide.current - 1);
      } else if (e.key === "Home") {
        e.preventDefault();
        goTo(0);
      } else if (e.key === "End") {
        e.preventDefault();
        goTo(numPages - 1);
      }
    };

    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [numPages]);

  return (
    <div className="fixed inset-0 z-50 bg-neutral-100 overflow-y-auto scroll-smooth">
      <Document
        file={PDF_FILE}
        onLoadSuccess={({ numPages }) => setNumPages(numPages)}
        externalLinkTarget="_blank"
        externalLinkRel="noopener noreferrer"
        loading={
          <div className="mt-32 text-sm text-neutral-400 tracking-wide">
            Loading deck…
          </div>
        }
        error={
          <div className="mt-32 text-sm text-red-400 tracking-wide">
            Failed to load deck.
          </div>
        }
        className={"flex flex-col items-center py-16 gap-16 min-h-full"}
      >
        {Array.from({ length: numPages || 0 }, (_, i) => (
          <div
            key={i}
            ref={(el) => {
              slideRefs.current[i] = el;
            }}
            className="shadow-2xl rounded-xl overflow-hidden bg-white"
            style={{ width }}
          >
            <Page
              pageNumber={i + 1}
              width={width}
              renderAnnotationLayer={true}
              renderTextLayer={false}
            />
          </div>
        ))}
      </Document>
    </div>
  );
}

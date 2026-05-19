"use client";
import { useState, useRef, useEffect } from "react";
import { CONCEPTS, type ConceptId, type Concept } from "@/src/lib/teaching";

type Props = {
  id: ConceptId;
  children: React.ReactNode;
};

export function ConceptTip({ id, children }: Props) {
  const concept = CONCEPTS[id];
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: PointerEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  return (
    <span ref={ref} className="relative inline-flex items-baseline gap-0.5">
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        className="inline-flex items-baseline gap-0.5 border-b border-dashed border-neutral-500 text-inherit hover:border-orange-400 hover:text-orange-400"
      >
        {children}
        <span className="relative -top-0.5 text-[9px] text-neutral-500">?</span>
      </button>

      {open && (
        <>
          {/* Mobile: bottom sheet backdrop */}
          <span
            className="fixed inset-0 z-40 bg-black/60 sm:hidden"
            onClick={() => setOpen(false)}
          />

          {/* Mobile: bottom sheet */}
          <span className="fixed bottom-0 left-0 right-0 z-50 rounded-t-2xl border-t border-neutral-800 bg-neutral-950 px-5 pb-8 pt-5 sm:hidden">
            <SheetContent concept={concept} onClose={() => setOpen(false)} />
          </span>

          {/* Desktop: popover */}
          <span className="absolute bottom-full left-1/2 z-50 mb-2 hidden w-72 -translate-x-1/2 rounded-xl border border-neutral-800 bg-neutral-950 p-4 shadow-xl sm:block">
            <PopoverContent concept={concept} onClose={() => setOpen(false)} />
          </span>
        </>
      )}
    </span>
  );
}

function SheetContent({ concept, onClose }: { concept: Concept; onClose: () => void }) {
  return (
    <>
      <div className="mb-1 flex items-center justify-between">
        <span className="text-[10px] uppercase tracking-widest text-neutral-600">
          {"★".repeat(concept.tier)}{"☆".repeat(3 - concept.tier)}
        </span>
        <button onClick={onClose} className="text-neutral-500 hover:text-white">✕</button>
      </div>
      <p className="mb-1 font-semibold">{concept.label}</p>
      <p className="mb-3 text-sm text-neutral-400">{concept.short}</p>
      <p className="rounded-lg bg-neutral-900 px-3 py-2.5 text-xs leading-relaxed text-neutral-400">
        <span className="font-medium text-neutral-300">Example: </span>
        {concept.example}
      </p>
      {concept.learnMore && (
        <p className="mt-3 text-xs text-orange-400">Read the lesson →</p>
      )}
    </>
  );
}

function PopoverContent({ concept, onClose }: { concept: Concept; onClose: () => void }) {
  return (
    <>
      <div className="mb-2 flex items-start justify-between gap-2">
        <p className="font-semibold leading-tight">{concept.label}</p>
        <button onClick={onClose} className="shrink-0 text-xs text-neutral-600 hover:text-white">✕</button>
      </div>
      <p className="mb-2.5 text-sm text-neutral-400">{concept.short}</p>
      <p className="rounded-lg bg-neutral-900 px-3 py-2 text-xs leading-relaxed text-neutral-400">
        <span className="font-medium text-neutral-300">Example: </span>
        {concept.example}
      </p>
      {concept.learnMore && (
        <p className="mt-2.5 text-xs text-orange-400">Read the lesson →</p>
      )}
    </>
  );
}

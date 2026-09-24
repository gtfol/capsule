"use client";

import { useRef } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { Button } from "./ui/button";

export function UnsavedChangesDialog({ open, onOpenChange, onDiscard, onSave, canSave = true, isNew = false }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDiscard: () => void;
  onSave: () => void;
  canSave?: boolean;
  isNew?: boolean;
}) {
  const keepEditing = useRef<HTMLButtonElement>(null);
  return <Dialog.Root open={open} onOpenChange={onOpenChange}><Dialog.Portal>
    <Dialog.Overlay className="fixed inset-0 z-[70] bg-black/20 dark:bg-black/70" />
    <Dialog.Content role="alertdialog" className="fixed left-1/2 top-1/2 z-[80] w-[calc(100%_-_40px)] max-w-[390px] -translate-x-1/2 -translate-y-1/2 border border-border bg-background p-7 text-foreground shadow-sm outline-none" onOpenAutoFocus={(event) => { event.preventDefault(); keepEditing.current?.focus(); }}>
      <button ref={keepEditing} type="button" aria-label="Keep editing" className="absolute right-4 top-4 p-2 text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground" onClick={() => onOpenChange(false)}><X size={14} strokeWidth={1.4} /></button>
      <Dialog.Title className="pr-8 text-[14px] font-normal">{isNew ? "Save this piece?" : "Save changes?"}</Dialog.Title>
      <Dialog.Description className="mt-3 text-[12px] leading-relaxed text-muted-foreground">Your changes haven’t been saved.</Dialog.Description>
      <div className="mt-6 flex flex-col gap-2">
        <Button type="button" className="w-full text-[12px]" disabled={!canSave} onClick={onSave}>{isNew ? "Save piece" : "Save changes"}</Button>
        <button type="button" className="mt-1 self-center px-3 py-2 text-[12px] text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-foreground" onClick={onDiscard}>Discard changes</button>
      </div>
    </Dialog.Content>
  </Dialog.Portal></Dialog.Root>;
}

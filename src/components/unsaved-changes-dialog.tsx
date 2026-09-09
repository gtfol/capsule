"use client";

import { useRef } from "react";
import * as Dialog from "@radix-ui/react-dialog";
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
      <Dialog.Title className="text-[14px] font-normal">{isNew ? "Save this piece?" : "Save changes?"}</Dialog.Title>
      <Dialog.Description className="mt-3 text-[12px] leading-relaxed text-muted-foreground">Your changes haven’t been saved.</Dialog.Description>
      <div className="mt-7 flex items-center justify-between gap-5"><button ref={keepEditing} type="button" className="py-2 text-[12px] text-muted-foreground hover:text-foreground" onClick={() => onOpenChange(false)}>Keep editing</button><button type="button" className="py-2 text-[12px] text-muted-foreground hover:text-foreground" onClick={onDiscard}>Discard changes</button></div>
      <Button type="button" className="mt-3 w-full" disabled={!canSave} onClick={onSave}>{isNew ? "Save piece" : "Save changes"}</Button>
    </Dialog.Content>
  </Dialog.Portal></Dialog.Root>;
}

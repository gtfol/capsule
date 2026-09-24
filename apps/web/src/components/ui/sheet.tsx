"use client";
import * as React from "react";
import * as Primitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
export const Sheet = Primitive.Root;
export const SheetTitle = Primitive.Title;
export const SheetDescription = Primitive.Description;
export function SheetContent({ className, children, ...props }: React.ComponentProps<typeof Primitive.Content>) { return <Primitive.Portal><Primitive.Overlay className="fixed inset-0 z-50 bg-black/15 dark:bg-black/65 data-[state=open]:animate-in" /><Primitive.Content className={cn("detail-sheet fixed inset-y-0 right-0 z-[60] w-full max-w-[540px] overflow-y-auto bg-background text-foreground px-7 pb-8 pt-6 outline-none sm:px-9", className)} {...props}>{children}<Primitive.Close className="sheet-close absolute right-6 top-5 p-2 text-muted-foreground hover:text-foreground" aria-label="Close panel"><X size={15} strokeWidth={1.5} /></Primitive.Close></Primitive.Content></Primitive.Portal>; }

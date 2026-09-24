"use client";
import * as React from "react";
import * as Primitive from "@radix-ui/react-popover";
import { cn } from "@/lib/utils";
export const Popover = Primitive.Root;
export const PopoverTrigger = Primitive.Trigger;
export const PopoverAnchor = Primitive.Anchor;
export function PopoverContent({ className, align = "center", sideOffset = 4, ...props }: React.ComponentProps<typeof Primitive.Content>) { return <Primitive.Portal><Primitive.Content align={align} sideOffset={sideOffset} className={cn("z-[70] w-72 rounded-md border border-border bg-popover text-foreground p-4 text-[13px] shadow-md outline-none", className)} {...props} /></Primitive.Portal>; }

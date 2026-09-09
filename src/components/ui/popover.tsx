"use client";
import * as React from "react";
import * as Primitive from "@radix-ui/react-popover";
import { cn } from "@/lib/utils";
export const Popover = Primitive.Root;
export const PopoverTrigger = Primitive.Trigger;
export function PopoverContent({ className, align = "center", sideOffset = 12, ...props }: React.ComponentProps<typeof Primitive.Content>) { return <Primitive.Portal><Primitive.Content align={align} sideOffset={sideOffset} className={cn("z-[70] w-72 border border-neutral-200 bg-white p-5 text-[13px] shadow-[0_5px_30px_rgba(0,0,0,0.06)] outline-none", className)} {...props} /></Primitive.Portal>; }

import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";
const buttonVariants = cva("inline-flex items-center justify-center gap-2 whitespace-nowrap text-[13px] transition-opacity disabled:pointer-events-none disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-foreground", { variants: { variant: { default: "bg-foreground text-background px-4 h-10 hover:opacity-75", ghost: "text-foreground hover:opacity-55", outline: "border border-border px-4 h-10 hover:border-foreground" } }, defaultVariants: { variant: "default" } });
export function Button({ className, variant, asChild = false, ...props }: React.ComponentProps<"button"> & VariantProps<typeof buttonVariants> & { asChild?: boolean }) { const Comp = asChild ? Slot : "button"; return <Comp data-slot="button" className={cn(buttonVariants({ variant, className }))} {...props} />; }

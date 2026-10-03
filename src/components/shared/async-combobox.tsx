"use client";

import { useEffect, useState, useTransition } from "react";
import { Check, ChevronsUpDown, Loader2, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

export type AsyncComboboxProps<T extends { id: string }> = {
  id: string;
  value: T | null;
  onChange: (value: T | null) => void;
  /** Server-side search (a Server Action). Called with "" when opened. */
  search: (term: string) => Promise<T[]>;
  getLabel: (option: T) => string;
  renderOption?: (option: T) => React.ReactNode;
  placeholder: string;
  searchPlaceholder?: string;
  emptyText?: string;
  disabled?: boolean;
  invalid?: boolean;
  describedBy?: string;
  clearable?: boolean;
  className?: string;
  /** Accessible name when no <label> points at `id` (role=combobox does not take its name from content). */
  ariaLabel?: string;
};

/** Searchable select backed by a server search; controlled by the parent. */
export function AsyncCombobox<T extends { id: string }>({
  id,
  value,
  onChange,
  search,
  getLabel,
  renderOption,
  placeholder,
  searchPlaceholder = "Search…",
  emptyText = "No results found.",
  disabled,
  invalid,
  describedBy,
  clearable,
  className,
  ariaLabel,
}: AsyncComboboxProps<T>) {
  const [open, setOpen] = useState(false);
  const [term, setTerm] = useState("");
  const [options, setOptions] = useState<T[]>([]);
  const [pending, startTransition] = useTransition();

  // Debounced server search while the list is open.
  useEffect(() => {
    if (!open) return;
    const timer = setTimeout(() => {
      startTransition(async () => setOptions(await search(term)));
    }, 250);
    return () => clearTimeout(timer);
  }, [open, term, search]);

  return (
    <div className={cn("flex gap-1", className)}>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            id={id}
            type="button"
            variant="outline"
            role="combobox"
            aria-expanded={open}
            aria-label={ariaLabel}
            aria-invalid={invalid || undefined}
            aria-describedby={describedBy}
            disabled={disabled}
            className="h-10 min-w-0 flex-1 justify-between font-normal"
          >
            <span className={cn("truncate", !value && "text-muted-foreground")}>
              {value ? getLabel(value) : placeholder}
            </span>
            <ChevronsUpDown className="opacity-50" aria-hidden />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-(--radix-popover-trigger-width) min-w-72 p-0" align="start">
          <Command shouldFilter={false}>
            <CommandInput placeholder={searchPlaceholder} value={term} onValueChange={setTerm} />
            <CommandList>
              {pending ? (
                <div className="flex items-center justify-center gap-2 py-6 text-sm text-muted-foreground">
                  <Loader2 className="size-4 animate-spin" aria-hidden /> Searching…
                </div>
              ) : (
                <CommandEmpty>{emptyText}</CommandEmpty>
              )}
              <CommandGroup>
                {options.map((option) => (
                  <CommandItem
                    key={option.id}
                    value={option.id}
                    onSelect={() => {
                      onChange(option);
                      setOpen(false);
                    }}
                  >
                    <Check className={cn(value?.id === option.id ? "opacity-100" : "opacity-0")} aria-hidden />
                    {renderOption ? renderOption(option) : <span className="truncate">{getLabel(option)}</span>}
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
      {clearable && value && (
        <Button type="button" variant="ghost" size="icon" className="size-10" onClick={() => onChange(null)} aria-label="Clear selection">
          <X aria-hidden />
        </Button>
      )}
    </div>
  );
}

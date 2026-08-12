"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

type NeutralSelectChangeEvent = {
  target: { value: string };
  currentTarget: { value: string };
};

type OptionItem =
  | { kind: "group"; key: string; label: React.ReactNode }
  | { kind: "option"; key: string; value: string; label: React.ReactNode; disabled: boolean };

type NeutralSelectProps = Omit<
  React.SelectHTMLAttributes<HTMLSelectElement>,
  "onChange" | "size" | "multiple"
> & {
  onChange?: (event: NeutralSelectChangeEvent) => void;
};

function sanitizeDropdownClassName(className?: string): string | undefined {
  if (!className) return className;
  return className
    .split(/\s+/)
    .filter((token) => {
      if (!token) return false;
      if (/(?:^|:)(?:ring|border|bg|text)-(?:primary|blue|sky|cyan|indigo|violet|purple)/.test(token)) return false;
      if (/^(?:bg|text|border|ring|shadow)-(?:[a-z-]+)(?:\/\d+)?$/.test(token)) return false;
      if (/^(?:p|px|py|pt|pr|pb|pl|m|mx|my|mt|mr|mb|ml|h|min-h|max-h|leading|tracking)-/.test(token)) return false;
      if (/^text-(?:xs|sm|base|lg|xl|2xl|3xl|\[[^\]]+\])$/.test(token)) return false;
      return true;
    })
    .join(" ");
}

function optionLabelToString(node: React.ReactNode): string {
  if (node === null || node === undefined || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(optionLabelToString).join("");
  if (React.isValidElement<{ children?: React.ReactNode }>(node)) {
    return optionLabelToString(node.props.children);
  }
  return "";
}

function flattenOptions(children: React.ReactNode): OptionItem[] {
  const items: OptionItem[] = [];

  React.Children.forEach(children, (child, index) => {
    if (!React.isValidElement(child)) return;
    const type = child.type;
    const props = child.props as {
      value?: string | number;
      label?: React.ReactNode;
      disabled?: boolean;
      children?: React.ReactNode;
    };

    if (type === "optgroup") {
      items.push({
        kind: "group",
        key: `group-${index}-${optionLabelToString(props.label)}`,
        label: props.label,
      });
      items.push(...flattenOptions(props.children));
      return;
    }

    if (type !== "option") return;
    const fallback = optionLabelToString(props.children);
    const value = props.value === undefined ? fallback : String(props.value);
    items.push({
      kind: "option",
      key: `option-${index}-${value}`,
      value,
      label: props.children,
      disabled: Boolean(props.disabled),
    });
  });

  return items;
}

export default function NeutralSelect({
  value,
  defaultValue,
  onChange,
  className,
  children,
  disabled,
  title,
  "aria-label": ariaLabel,
  name,
  id,
}: NeutralSelectProps) {
  const buttonRef = React.useRef<HTMLButtonElement>(null);
  const menuRef = React.useRef<HTMLDivElement>(null);
  const [open, setOpen] = React.useState(false);
  const [internalValue, setInternalValue] = React.useState(defaultValue === undefined ? "" : String(defaultValue));
  const [mounted, setMounted] = React.useState(false);
  const [menuStyle, setMenuStyle] = React.useState<React.CSSProperties>({});

  React.useEffect(() => setMounted(true), []);

  const items = React.useMemo(() => flattenOptions(children), [children]);
  const optionItems = React.useMemo(
    () => items.filter((item): item is Extract<OptionItem, { kind: "option" }> => item.kind === "option"),
    [items],
  );
  const currentValue = value === undefined ? internalValue : String(value);
  const selected = optionItems.find((item) => item.value === currentValue) || optionItems.find((item) => !item.disabled);
  const neutralClassName = React.useMemo(() => sanitizeDropdownClassName(className), [className]);
  const widestOptionLabelLength = React.useMemo(
    () => Math.max(0, ...optionItems.map((item) => optionLabelToString(item.label).length)),
    [optionItems],
  );

  const updateMenuPosition = React.useCallback(() => {
    const button = buttonRef.current;
    if (!button) return;
    const rect = button.getBoundingClientRect();
    const viewportHeight = window.innerHeight;
    const viewportWidth = window.innerWidth;
    const maxHeight = Math.min(208, Math.max(96, viewportHeight - 24));
    const below = viewportHeight - rect.bottom - 8;
    const above = rect.top - 8;
    const estimatedHeight = Math.min(maxHeight, Math.max(88, Math.min(208, items.length * 22 + 8)));
    const opensUp = below < 140 && above > below;
    const top = opensUp ? Math.max(8, rect.top - estimatedHeight - 4) : Math.min(rect.bottom + 4, viewportHeight - estimatedHeight - 8);
    const menuWidth = Math.min(
      Math.max(rect.width, 180, Math.min(304, widestOptionLabelLength * 6 + 52)),
      viewportWidth - 16,
    );
    const left = Math.min(Math.max(8, rect.left), Math.max(8, viewportWidth - menuWidth - 8));
    setMenuStyle({
      position: "fixed",
      top,
      left,
      width: menuWidth,
      maxHeight: estimatedHeight,
      zIndex: 9999,
    });
  }, [items.length, widestOptionLabelLength]);

  React.useLayoutEffect(() => {
    if (!open) return;
    updateMenuPosition();
  }, [open, updateMenuPosition]);

  React.useEffect(() => {
    if (!open) return;
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (buttonRef.current?.contains(target) || menuRef.current?.contains(target)) return;
      setOpen(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("resize", updateMenuPosition);
    window.addEventListener("scroll", updateMenuPosition, true);
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("resize", updateMenuPosition);
      window.removeEventListener("scroll", updateMenuPosition, true);
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open, updateMenuPosition]);

  const selectValue = React.useCallback(
    (nextValue: string) => {
      const event: NeutralSelectChangeEvent = {
        target: { value: nextValue },
        currentTarget: { value: nextValue },
      };
      onChange?.(event);
      if (value === undefined) setInternalValue(String(event.target.value ?? nextValue));
      setOpen(false);
    },
    [onChange, value],
  );

  return (
    <>
      {name ? <input type="hidden" name={name} value={currentValue} /> : null}
      <button
        id={id}
        ref={buttonRef}
        type="button"
        title={title}
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => {
          if (disabled) return;
          setOpen((next) => !next);
        }}
        className={cn(
          "inline-flex h-8 min-h-8 items-center justify-between gap-1.5 rounded-md border border-border bg-muted px-2.5 text-left text-[11px] leading-none text-foreground outline-none transition-colors hover:border-border-secondary hover:bg-muted focus-visible:border-border-secondary focus-visible:ring-1 focus-visible:ring-border-secondary/30 disabled:cursor-not-allowed disabled:opacity-50",
          neutralClassName,
          open && "border-border-secondary ring-1 ring-border-secondary/35",
        )}
      >
        <span className="min-w-0 flex-1 truncate">{selected?.label || ""}</span>
        <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground/80" />
      </button>

      {mounted && open
        ? createPortal(
            <div
              ref={menuRef}
              role="listbox"
              style={menuStyle}
              className="overflow-y-auto rounded-xl border border-border bg-popover p-1 text-popover-foreground shadow-app-card"
            >
              {items.map((item) => {
                if (item.kind === "group") {
                  return (
                    <div key={item.key} className="px-2 py-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground/80">
                      {item.label}
                    </div>
                  );
                }
                const isSelected = item.value === currentValue;
                return (
                  <button
                    key={item.key}
                    role="option"
                    aria-selected={isSelected}
                    disabled={item.disabled}
                    onClick={() => selectValue(item.value)}
                  className={cn(
                      "flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[11px] transition-colors",
                      isSelected ? "bg-muted text-foreground" : "text-foreground hover:bg-muted",
                      item.disabled && "cursor-not-allowed opacity-50",
                    )}
                  >
                    <span className="flex-1 truncate">{item.label}</span>
                    {isSelected ? <Check className="h-3.5 w-3.5 shrink-0" /> : null}
                  </button>
                );
              })}
            </div>,
            document.body,
          )
        : null}
    </>
  );
}

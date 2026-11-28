import { Check, ChevronDown } from "lucide-react";
import { type KeyboardEvent, useState } from "react";
import { useTranslation } from "react-i18next";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { FONT_SUGGESTIONS, type FontRole, familyStack } from "@/lib/fonts";
import { cn } from "@/lib/utils";

/**
 * Font family picker: the suggestions, each shown in its own font, plus any installed font typed in the
 * search box. The choice applies only once picked, so the popover never moves while the page re-lays out
 * in the new font (the native datalist did, and flickered).
 */
export function FontPicker({
	role,
	value,
	onChange,
	ariaLabel,
}: {
	role: FontRole;
	/** Empty: the default stack. */
	value: string;
	onChange: (family: string) => void;
	ariaLabel: string;
}) {
	const { t } = useTranslation();
	const [open, setOpen] = useState(false);
	const [query, setQuery] = useState("");
	const [active, setActive] = useState(0);

	const typed = query.trim();
	const needle = typed.toLowerCase();
	// A family typed earlier stays listed next to the suggestions.
	const known =
		value && !FONT_SUGGESTIONS[role].includes(value) ? [value, ...FONT_SUGGESTIONS[role]] : FONT_SUGGESTIONS[role];
	const matches = known.filter((name) => name.toLowerCase().includes(needle));
	// "" is the system default; a typed family that is not a suggestion comes first so Enter picks it.
	const custom = typed !== "" && !matches.some((name) => name.toLowerCase() === needle);
	const options = [...(custom ? [typed] : []), ...(typed ? [] : [""]), ...matches];

	const choose = (family: string) => {
		setOpen(false);
		if (family !== value) onChange(family);
	};
	const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
		if (e.nativeEvent.isComposing) return;
		if (e.key === "ArrowDown" || e.key === "ArrowUp") {
			e.preventDefault();
			if (options.length === 0) return;
			const step = e.key === "ArrowDown" ? 1 : -1;
			setActive((i) => (i + step + options.length) % options.length);
		} else if (e.key === "Enter") {
			e.preventDefault();
			const family = options[active];
			if (family !== undefined) choose(family);
		}
	};

	return (
		<Popover
			open={open}
			onOpenChange={(next) => {
				setOpen(next);
				if (next) {
					setQuery("");
					setActive(Math.max(0, ["", ...known].indexOf(value)));
				}
			}}
		>
			<PopoverTrigger
				aria-label={ariaLabel}
				className="flex h-8 w-44 items-center gap-1.5 rounded-md border bg-transparent px-2.5 text-sm shadow-xs outline-none hover:bg-muted focus-visible:ring-[3px] focus-visible:ring-ring/50 data-[state=open]:bg-muted dark:bg-input/30"
			>
				<span
					className={cn("min-w-0 flex-1 truncate text-left", !value && "text-muted-foreground")}
					style={value ? { fontFamily: familyStack(role, value) } : undefined}
					title={value || undefined}
				>
					{value || t("settings.general.fontDefault")}
				</span>
				<ChevronDown className="size-4 shrink-0 opacity-50" />
			</PopoverTrigger>
			<PopoverContent align="end" className="w-64 p-0">
				<div className="border-b px-3">
					<input
						value={query}
						onChange={(e) => {
							setQuery(e.target.value);
							setActive(0);
						}}
						onKeyDown={onKeyDown}
						placeholder={t("settings.general.fontSearch")}
						aria-label={t("settings.general.fontSearch")}
						role="combobox"
						aria-expanded
						aria-controls={`font-list-${role}`}
						aria-activedescendant={options[active] !== undefined ? `font-option-${role}-${active}` : undefined}
						className="h-9 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
						spellCheck={false}
						autoFocus
					/>
				</div>
				<div id={`font-list-${role}`} role="listbox" className="max-h-72 overflow-y-auto p-1">
					{options.map((family, i) => {
						const selected = family === value;
						return (
							<div
								key={family || "\0default"}
								id={`font-option-${role}-${i}`}
								role="option"
								aria-selected={selected}
								tabIndex={-1}
								onMouseMove={() => setActive(i)}
								onClick={() => choose(family)}
								onKeyDown={() => undefined}
								className={cn(
									"flex cursor-default items-center gap-2 rounded-md px-2 py-1.5 text-sm",
									i === active && "bg-accent text-accent-foreground",
								)}
							>
								<span
									className={cn("min-w-0 flex-1 truncate", !family && "text-muted-foreground")}
									style={family ? { fontFamily: familyStack(role, family) } : undefined}
								>
									{family === ""
										? t("settings.general.fontDefault")
										: custom && i === 0
											? t("settings.general.fontUse", { name: family })
											: family}
								</span>
								{selected && <Check className="size-4 shrink-0" />}
							</div>
						);
					})}
				</div>
			</PopoverContent>
		</Popover>
	);
}

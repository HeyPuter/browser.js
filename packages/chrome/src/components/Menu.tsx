import { css, Pointer, type FC } from "dreamland/core";
import { Checkbox } from "@components/Checkbox";
import { Icon } from "@components/Icon";
import type { IconDescription } from "../icons";
import { emToPx } from "../util";
import { requestUnfocusFrames } from "@components/Shell";

let activeMenuClose: (() => void) | null = null;
export function closeMenu() {
	activeMenuClose?.();
}

export type PositionConstraints = {
	left?: number;
	right?: number;
	top?: number;
	bottom?: number;
};

export function Menu(
	this: FC<
		{
			position: PositionConstraints;
			items?: MenuItem[];
			custom?: HTMLElement;
		},
		{
			closing: boolean;
			x: number;
			y: number;
			transformOriginX: string;
			transformOriginY: string;
		}
	>
) {
	this.closing = true;
	const openingFrame = requestAnimationFrame(() => {
		this.closing = false;
	});
	this.x = 0;
	this.y = 0;
	this.transformOriginX = "left";
	this.transformOriginY = "top";

	const [lock, unlock] = requestUnfocusFrames();
	let closed = false;
	const previousFocus = document.activeElement;
	const menuItems = () => [
		...this.root.querySelectorAll<HTMLElement>(
			'[role="menuitem"]:not(:disabled), [role="menuitemcheckbox"]:not(:disabled)'
		),
	];

	const close = () => {
		if (closed) return;
		closed = true;
		cancelAnimationFrame(openingFrame);
		if (activeMenuClose === close) activeMenuClose = null;
		if (activeMenu === this.root) activeMenu = null;
		unlock();
		if (
			this.root.contains(document.activeElement) &&
			previousFocus instanceof HTMLElement &&
			previousFocus.isConnected
		)
			previousFocus.focus({ preventScroll: true });

		window.removeEventListener("mousedown", ev, { capture: true });
		window.removeEventListener("contextmenu", ev, { capture: true });
		window.removeEventListener("click", ev, { capture: true });

		this.closing = true;
		this.root.inert = true;
		this.root.setAttribute("aria-hidden", "true");
		// A menu closed before its first paint has no transitionend event.
		setTimeout(() => this.root.remove(), 150);
	};
	activeMenuClose = close;

	const ev = (e: MouseEvent) => {
		// Don't close if the click is over the menu
		if (this.root.contains(e.target as Node)) {
			return;
		}

		close();
		e.stopImmediatePropagation();
		e.preventDefault();
	};

	this.cx.mount = () => {
		lock();
		document.body.appendChild(this.root);
		const { width, height } = this.root.getBoundingClientRect();
		const docWidth = document.documentElement.clientWidth;
		const docHeight = document.documentElement.clientHeight;
		const padding = emToPx(1);

		if (this.position.left !== undefined) {
			this.x = this.position.left;
		} else if (this.position.right !== undefined) {
			this.x = this.position.right - width;
		}

		if (this.position.top !== undefined) {
			this.y = this.position.top;
		} else if (this.position.bottom !== undefined) {
			this.y = this.position.bottom - height;
		}

		const maxX = docWidth - width - padding;
		const maxY = docHeight - height - padding;
		if (this.x > maxX) {
			this.x = maxX;
			this.transformOriginX = "right";
		}
		if (this.y > maxY) {
			this.y = maxY;
			this.transformOriginY = "bottom";
		}
		if (this.x < padding) this.x = padding;
		if (this.y < padding) this.y = padding;

		window.addEventListener("mousedown", ev, { capture: true });
		window.addEventListener("contextmenu", ev, {
			capture: true,
		});
		window.addEventListener("click", ev, { capture: true });

		this.root.addEventListener("mousedown", (e) => {
			e.stopPropagation();
		});
		(this.items ? (menuItems()[0] ?? this.root) : this.root).focus({
			preventScroll: true,
		});
	};
	let search = "";
	let searchTime = 0;
	const onKeyDown = (event: KeyboardEvent) => {
		if (event.key === "Escape") {
			close();
			event.preventDefault();
			event.stopPropagation();
			return;
		}
		if (event.key === "Tab") {
			close();
			return;
		}
		if (!this.items || event.altKey || event.ctrlKey || event.metaKey) return;
		const items = menuItems();
		if (!items.length) return;
		const current = items.indexOf(document.activeElement as HTMLElement);
		let next: HTMLElement | undefined;
		if (event.key === "ArrowDown") next = items[(current + 1) % items.length];
		else if (event.key === "ArrowUp")
			next = items[(current - 1 + items.length) % items.length];
		else if (event.key === "Home") next = items[0];
		else if (event.key === "End") next = items.at(-1);
		else if (
			event.key === "Enter" &&
			event.target instanceof HTMLInputElement
		) {
			event.target.click();
			event.preventDefault();
			event.stopPropagation();
			return;
		} else if (event.key.length === 1 && event.key !== " ") {
			const now = performance.now();
			search = now - searchTime > 700 ? event.key : search + event.key;
			searchTime = now;
			const query = [...search].every((char) => char === search[0])
				? search[0]
				: search;
			next = [...items.slice(current + 1), ...items.slice(0, current + 1)].find(
				(item) =>
					item
						.closest(".item")
						?.textContent?.trim()
						.toLocaleLowerCase()
						.startsWith(query.toLocaleLowerCase())
			);
		}
		if (next) {
			next.focus({ preventScroll: true });
			event.preventDefault();
			event.stopPropagation();
		}
	};
	return (
		<div
			role={this.items ? "menu" : undefined}
			tabIndex={-1}
			on:keydown={onKeyDown}
			style={use`--x: ${this.x}px; --y: ${this.y}px; --transform-origin-x: ${this.transformOriginX}; --transform-origin-y: ${this.transformOriginY};`}
			class:closing={use(this.closing)}
		>
			{this.items
				? use(this.items).mapEach((item) =>
						item == null ? (
							""
						) : item == "-" ? (
							<div class="separator" role="separator" />
						) : item.checkbox ? (
							<label class="item">
								<Checkbox
									value={item.checkbox}
									disabled={item.disabled ?? false}
									role="menuitemcheckbox"
									tabIndex={-1}
								></Checkbox>
								{item.label}
							</label>
						) : (
							<button
								type="button"
								role="menuitem"
								tabIndex={-1}
								class="item"
								disabled={item.disabled ?? false}
								on:click={(e: MouseEvent) => {
									close();
									item.action?.();
									e.stopPropagation();
								}}
							>
								{item.image ? (
									<img src={item.image}></img>
								) : item.icon ? (
									<Icon icon={item.icon}></Icon>
								) : (
									<div class="pad" />
								)}
								<span>{item.label}</span>
							</button>
						)
					)
				: this.custom}
		</div>
	);
}
Menu.style = css`
	:scope {
		position: absolute;
		top: var(--y);
		left: var(--x);
		background-color: var(--popup);
		border: 1px solid var(--popup_border);
		border-radius: var(--radius-md);
		box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
		z-index: 1000;
		display: flex;
		flex-direction: column;
		min-width: 15em;
		overflow: hidden;

		transition:
			opacity 0.1s ease,
			transform 0.12s var(--ease-popup);
		opacity: 1;
		transform: scaleX(100%) scaleY(100%);
		transform-origin: var(--transform-origin-x) var(--transform-origin-y);
	}
	.separator {
		border-top: 1px solid var(--text-20);
	}
	:scope.closing {
		transform: scaleX(95%) scaleY(87%);
		opacity: 0;
	}
	.item {
		background: none;
		border: none;
		font-size: 0.8em;
		padding: var(--space-lg) var(--space-xxl);
		text-align: left;
		color: var(--toolbar_text);

		display: flex;
		align-items: center;
		gap: var(--space-xl);
	}

	img {
		width: 16px;
		height: 16px;
	}

	.pad {
		width: 1em;
	}

	input[type="checkbox"] {
		width: 1em;
		height: 1em;
		padding: 0;
		margin: 0;

		background: var(--toolbar_field);
		border: 1px solid var(--text-20);
	}
	.item:hover,
	.item:focus-visible,
	.item:has(input:focus-visible) {
		background: var(--text-10);
	}
	.item:disabled,
	.item:has(input:disabled) {
		opacity: 0.5;
	}
`;

let activeMenu: HTMLElement | null = null;

type MenuItem =
	| {
			label: string;
			disabled?: boolean;
			action?: () => void;
			checkbox?: Pointer<boolean>;
			icon?: IconDescription;
			image?: string;
	  }
	| "-";

export function setContextMenu(elm: HTMLElement, items: MenuItem[]) {
	elm.oncontextmenu = (e) => {
		e.preventDefault();
		e.stopPropagation();
		createMenu({ left: e.clientX, top: e.clientY }, items);
	};
}

export function createMenu(
	position: PositionConstraints,
	items: MenuItem[]
): HTMLElement {
	// if (isPuter) {
	// 	puter.ui.contextMenu({
	// 		items: items.map((i) =>
	// 			i == "-"
	// 				? i
	// 				: {
	// 						label: i.label,
	// 						action: i.action,
	// 					}
	// 		),
	// 	});

	// 	return undefined as any;
	// }

	if (activeMenu) {
		closeMenu();
	}

	let menu = (<Menu position={position} items={items} />) as HTMLElement;
	activeMenu = menu;

	return menu;
}

export function createMenuCustom(
	position: PositionConstraints,
	custom: HTMLElement
): HTMLElement {
	if (activeMenu) {
		closeMenu();
	}

	let menu = (<Menu position={position} custom={custom} />) as HTMLElement;
	activeMenu = menu;

	return menu;
}

import { createDelegate, css, Pointer, type FC } from "dreamland/core";
import { Checkbox } from "@components/Checkbox";
import { Icon } from "@components/Icon";
import type { IconifyIcon } from "@iconify/types";
import { emToPx } from "../util";
import { isPuter } from "..";
import { requestUnfocusFrames } from "@components/Shell";

export const closeMenu = createDelegate<void>();

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
	requestAnimationFrame(() => {
		this.closing = false;
	});
	this.x = 0;
	this.y = 0;
	this.transformOriginX = "left";
	this.transformOriginY = "top";

	const [lock, unlock] = requestUnfocusFrames();

	const close = () => {
		unlock();

		window.removeEventListener("mousedown", ev, { capture: true });
		window.removeEventListener("contextmenu", ev, { capture: true });
		window.removeEventListener("click", ev, { capture: true });

		this.closing = true;
		this.root.addEventListener("transitionend", () => {
			this.root.remove();
		});
	};
	closeMenu.listen(close);

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
	};
	return (
		<div
			style={use`--x: ${this.x}px; --y: ${this.y}px; --transform-origin-x: ${this.transformOriginX}; --transform-origin-y: ${this.transformOriginY};`}
			class:closing={use(this.closing)}
		>
			{this.items
				? use(this.items).mapEach((item) =>
						item == null ? (
							""
						) : item == "-" ? (
							<div class="separator" />
						) : item.checkbox ? (
							<button
								class="item"
								on:click={(e: MouseEvent) => {
									if (!item.checkbox) return;
									item.checkbox.value = !item.checkbox.value;

									e.preventDefault();
									e.stopPropagation();
								}}
							>
								<Checkbox value={item.checkbox}></Checkbox>
								{item.label}
							</button>
						) : (
							<button
								class="item"
								on:click={(e: MouseEvent) => {
									item.action?.();
									close();
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
		border-radius: var(--radius);
		box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
		z-index: 1000;
		display: flex;
		flex-direction: column;
		min-width: 15em;
		overflow: hidden;

		transition:
			opacity 0.1s ease,
			transform 0.12s cubic-bezier(0.35, 0.15, 0, 1.8);
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
		padding: 0.75em 1.25em;
		text-align: left;
		color: var(--toolbar_text);

		display: flex;
		align-items: center;
		gap: 1em;
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
	.item:hover {
		background: var(--text-10);
	}
`;

let activeMenu: HTMLElement | null = null;

type MenuItem =
	| {
			label: string;
			action?: () => void;
			checkbox?: Pointer<boolean>;
			icon?: IconifyIcon;
			image?: string;
	  }
	| "-";

export function setContextMenu(elm: HTMLElement, items: MenuItem[]) {
	elm.addEventListener("contextmenu", (e) => {
		e.preventDefault();
		e.stopPropagation();
		createMenu({ left: e.clientX, top: e.clientY }, items);
	});
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

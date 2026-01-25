import { css, type FC } from "dreamland/core";
import { Favicon } from "@components/Favicon";
import { Icon } from "@components/Icon";
import { SiteOptionsButton } from "@components/Omnibar/SiteOptionsButton";
import { iconForwards, iconSearch } from "../../icons";
import { splitUrl } from "../../utils";
import { INTERNAL_URL_PROTOCOL } from "../../consts";
import { OmnibarButton } from "@components/Omnibar/OmnibarButton";
import { BookmarkButton } from "@components/Omnibar/BookmarkButton";

export function UrlInput(
	this: FC<{
		active: boolean;
		favicon: string | null;
		url: URL;
		value: string;
		input: HTMLInputElement;

		onkeydown?: (e: KeyboardEvent) => void;
		onkeyup?: (e: KeyboardEvent) => void;
		oninput?: (e: InputEvent) => void;
		doSearch?: () => void;
	}>
) {
	return (
		<div class:active={use(this.active)}>
			<div class="lefticon">
				{use(this.active)
					.and(
						use(this.favicon)
							.and(<Favicon url={this.favicon}></Favicon>)
							.or(<Icon icon={iconSearch}></Icon>)
					)
					.or(<SiteOptionsButton></SiteOptionsButton>)}
			</div>
			{use(this.active).and(
				<input
					spellcheck="false"
					this={use(this.input)}
					value={use(this.value)}
					on:keydown={(e: KeyboardEvent) => {
						this.onkeydown?.(e);
					}}
					on:keyup={(e: KeyboardEvent) => {
						this.onkeyup?.(e);
					}}
					on:input={(e: InputEvent) => {
						this.oninput?.(e);
					}}
				></input>
			)}

			{use(this.active, this.url, this.value)
				.map(
					([active, url, value]) =>
						!active &&
						!(!value && url.href == `${INTERNAL_URL_PROTOCOL}//newtab`)
				)
				.and(
					<span class="inactiveurl">
						{use(this.value)
							.and(<span class="domain">{use(this.value)}</span>)
							.or(
								use(this.url)
									.map(
										(u) =>
											u.protocol === INTERNAL_URL_PROTOCOL ||
											u.protocol === "about:"
									)
									.and(
										<>
											<span class="subdomain">
												{use(this.url).map((t) =>
													t.protocol === INTERNAL_URL_PROTOCOL
														? `${INTERNAL_URL_PROTOCOL}//`
														: "about:"
												)}
											</span>
											<span class="domain">
												{use(this.url).map((t) => t.hostname)}
											</span>
											<span class="rest">
												{use(this.url).map(
													(t) => t.pathname + t.search + t.hash
												)}
											</span>
										</>
									)
									.or(
										<>
											<span class="subdomain">
												{use(this.url).map((t) => splitUrl(t)[0])}
											</span>
											<span class="domain">
												{use(this.url).map((t) => splitUrl(t)[1])}
											</span>
											<span class="rest">
												{use(this.url).map((t) => splitUrl(t)[2])}
											</span>
										</>
									)
							)}
					</span>
				)}
			{use(this.active, this.url, this.value)
				.map(
					([active, url, value]) =>
						!value && !active && url.href == `${INTERNAL_URL_PROTOCOL}//newtab`
				)
				.and(
					<span class="placeholder">Search with Google or enter address</span>
				)}

			{use(this.active).or(
				<BookmarkButton url={use(this.url)}></BookmarkButton>
			)}
			{use(this.active).and(
				<OmnibarButton
					click={(e: MouseEvent) => {
						this.doSearch?.();
						e.stopPropagation();
						e.preventDefault();
					}}
					icon={iconForwards}
				></OmnibarButton>
			)}
		</div>
	);
}
UrlInput.style = css`
	:scope {
		position: absolute;
		width: 100%;
		height: 100%;
		display: flex;
		z-index: 1;
		align-items: center;
		padding-left: 0.25em;
		padding-right: 0.25em;
	}

	input,
	.inactiveurl,
	.placeholder {
		background: none;
		border: none;
		outline: none;
		font-size: 1em;
		height: 100%;
		width: 100%;
		text-wrap: nowrap;
		overflow: hidden;
		font-family: var(--font);
		color: var(--toolbar_text);
		cursor: text;
	}
	.inactiveurl {
		display: flex;
		align-items: center;
		color: var(--toolbar_text);
	}
	.inactiveurl .subdomain,
	.inactiveurl .rest {
		opacity: 0.7;
		color: var(--toolbar_text);
	}

	.placeholder {
		color: var(--toolbar_text);
		opacity: 0.5;
		display: flex;
		align-items: center;
	}

	.lefticon {
		font-size: 1.15em;
		color: var(--toolbar_text);
		display: flex;
		margin: 0.25em;

		align-self: stretch;
		align-items: center;
	}
	.active .lefticon {
		margin-right: 0.5em;
		margin-left: 0.5em;
	}
`;

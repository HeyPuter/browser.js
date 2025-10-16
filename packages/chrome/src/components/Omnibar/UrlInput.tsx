import { css, type Component } from "dreamland/core";
import { Favicon } from "../Favicon";
import { Icon } from "../Icon";
import { SiteOptionsButton } from "./SiteOptionsButton";
import { iconForwards, iconSearch } from "../../icons";
import { splitUrl } from "../../utils";
import { OmnibarButton } from "./OmnibarButton";
import { BookmarkButton } from "./BookmarkButton";

export const UrlInput: Component<
	{
		active: boolean;
		favicon: string | null;
		url: URL;
		value: string;
		input: HTMLInputElement;

		onkeydown: (e: KeyboardEvent) => void;
		onkeyup: (e: KeyboardEvent) => void;
		oninput: (e: InputEvent) => void;
		doSearch: () => void;
	},
	{}
> = function (cx) {
	return (
		<div class:active={use(this.active)}>
			<div class="lefticon">
				{use(this.active).andThen(
					use(this.favicon).andThen(
						<Favicon url={this.favicon}></Favicon>,
						<Icon icon={iconSearch}></Icon>
					),
					<SiteOptionsButton></SiteOptionsButton>
				)}
			</div>
			{use(this.active).andThen(
				<input
					spellcheck="false"
					this={use(this.input)}
					value={use(this.value)}
					on:keydown={(e: KeyboardEvent) => {
						this.onkeydown(e);
					}}
					on:keyup={(e: KeyboardEvent) => {
						this.onkeyup(e);
					}}
					on:input={(e: InputEvent) => {
						this.oninput(e);
					}}
				></input>
			)}
			{use(this.active, this.url)
				.map(([active, url]) => !active && url.href != "puter://newtab")
				.andThen(
					<span class="inactiveurl">
						<span class="subdomain">
							{use(this.url).map((t) => splitUrl(t)[0])}
						</span>
						<span class="domain">
							{use(this.url).map((t) => splitUrl(t)[1])}
						</span>
						<span class="rest">{use(this.url).map((t) => splitUrl(t)[2])}</span>
					</span>
				)}
			{use(this.active, this.url)
				.map(([active, url]) => !active && url.href == "puter://newtab")
				.andThen(
					<span class="placeholder">Search with Google or enter address</span>
				)}

			{use(this.active)
				.map((a) => !a)
				.andThen(<BookmarkButton url={use(this.url)}></BookmarkButton>)}
			{use(this.active).andThen(
				<OmnibarButton
					click={(e: MouseEvent) => {
						this.doSearch();
						e.stopPropagation();
						e.preventDefault();
					}}
					icon={iconForwards}
				></OmnibarButton>
			)}
		</div>
	);
};
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
		color: var(--fg);
		cursor: text;
	}
	.inactiveurl {
		display: flex;
		align-items: center;
		color: var(--fg);
	}
	.inactiveurl .subdomain,
	.inactiveurl .rest {
		opacity: 0.7;
		color: var(--fg2);
	}

	.placeholder {
		color: var(--fg4);
		display: flex;
		align-items: center;
	}

	.lefticon {
		font-size: 1.15em;
		color: var(--fg2);
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

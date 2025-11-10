import { css } from "dreamland/core";
import { type OmniboxResult, AVAILABLE_SEARCH_ENGINES } from "./suggestions";
import { iconSearch, iconTrendingUp } from "../../icons";
import { browser } from "../../Browser";
import { Icon } from "../Icon";
import { Favicon } from "../Favicon";
import { trimUrl } from "./utils";

const renderResultHighlight = (title: string, inputValue: string) => {
	if (title.toLowerCase().startsWith(inputValue.toLowerCase())) {
		return (
			<>
				<span>{title.substring(0, inputValue.length)}</span>
				<span style="font-weight: normal; opacity: 0.7;">
					{title.substring(inputValue.length)}
				</span>
			</>
		);
	}
	return <span style="font-weight: normal; opacity: 0.7;">{title}</span>;
};

export function Suggestion(props: {
	item: OmniboxResult;
	input: HTMLInputElement;
	focused: boolean;

	onClick: (e: MouseEvent) => void;
}) {
	let item = props.item;

	return (
		<div
			class="overflowitem"
			on:click={props.onClick}
			class:focused={use(props.focused)}
			title={item.url.href}
		>
			<div class="result-icon">
				{item.kind === "search" || item.kind === "directsearch" ? (
					<Icon icon={iconSearch}></Icon>
				) : item.kind === "trending" ? (
					<Icon icon={iconTrendingUp}></Icon>
				) : (
					<Favicon url={item.favicon}></Favicon>
				)}
			</div>
			<div
				class="result-content"
				class:single={
					item.kind === "directsearch" ||
					item.title == null ||
					item.title === "" ||
					item.title === trimUrl(item.url)
				}
			>
				{item.kind !== "directsearch"
					? (item.title && (
							<span class="description">
								{renderResultHighlight(item.title, props.input.value)}
							</span>
						)) || <span class="description">{trimUrl(item.url)}</span>
					: null}
				{item.kind != "search" &&
				item.kind != "directsearch" &&
				item.kind != "trending" &&
				item.title ? (
					<span class="url">{trimUrl(item.url)}</span>
				) : null}

				{item.kind === "directsearch" ? (
					<span>
						{item.title}
						<span style="font-weight: normal; opacity: 0.7">
							{" "}
							-{" "}
							{
								AVAILABLE_SEARCH_ENGINES[browser.settings.defaultSearchEngine]
									.name
							}{" "}
							Search
						</span>
					</span>
				) : null}
			</div>
		</div>
	);
}
Suggestion.style = css`
	:scope {
		display: flex;
		align-items: center;
		/*height: 2.5em;*/
		cursor: pointer;
		gap: 1em;

		margin-left: 0.5em;
		padding-left: 0.5em;

		margin-right: 0.5em;

		margin-top: 0.25em;
		padding-top: 0.25em;
		margin-bottom: 0.25em;
		padding-bottom: 0.25em;

		white-space: nowrap;
		color: var(--fg);
		overflow: hidden;

		border-radius: var(--radius);
	}

	.result-content {
		display: flex;
		flex-direction: column;
		flex: 1;
		min-width: 0;
		gap: 2px;
	}
	.result-content.single {
		display: block;
	}

	.url,
	.description {
		text-overflow: ellipsis;
		text-wrap: nowrap;
		word-wrap: nowrap;
		overflow: hidden;
		line-height: 1.2;
	}

	.description {
		font-size: 1em;
		min-width: 0;
		font-weight: 500;
	}

	.url {
		color: var(--fg20);
		font-size: 0.85em;
		min-width: 0;
		opacity: 0.6;
		white-space: nowrap;
		text-overflow: ellipsis;
		overflow: hidden;
	}
	:scope.focused,
	:scope.focused:hover {
		background: var(--bg20);
	}
	:scope:hover {
		background: var(--bg04);
	}

	.focused .description {
		color: var(--highlight);
	}
`;

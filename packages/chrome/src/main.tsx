import "./reset.css";
import "./style.css";

// temp fix for vite not working
import.meta.hot?.accept(() => location.reload());

import { initBrowser } from "./Browser";
let app = document.getElementById("app")!;
import { Shell } from "./components/Shell";
import { App } from "./App";
import { css } from "dreamland/core";
import { setWispUrl } from "./proxy/wisp";

if (import.meta.env.VITE_PUTER_BRANDING) {
	let promises = [];

	let puterSdk = <script src="https://js.puter.com/v2/"></script>;
	document.head.append(puterSdk);
	promises.push(
		new Promise<void>((res) => {
			puterSdk.onload = () => res();
		})
	);

	if (import.meta.env.VITE_SENTRY_URL) {
		let sentrySdk = (
			<script
				src={import.meta.env.VITE_SENTRY_URL}
				crossorigin="anonymous"
			></script>
		);
		document.head.append(sentrySdk);
		promises.push(
			new Promise<void>((res, rej) => {
				sentrySdk.onload = () => res();
				sentrySdk.onerror = () => {
					console.error("Error loading Sentry (adblocker?)");
					res();
				};
			})
		);
	}

	await Promise.all(promises);
}

export const isPuter =
	import.meta.env.VITE_PUTER_BRANDING && puter.env == "app";

export function LoadInterstitial(s: { status: string }) {
	return (
		<dialog class="signin">
			<h1>Loading</h1>
			<p>{use(s.status)}</p>
		</dialog>
	);
}
LoadInterstitial.style = css`
	:scope {
		transition: opacity 0.4s ease;
		width: 50%;
		height: 20%;
		border: none;
		border-radius: 1em;
		text-align: center;
	}
	h1 {
		text-align: center;
		font-weight: bold;
		font-size: 2em;
	}
	:modal[open] {
		animation: fade 0.4s ease normal;
	}

	:modal::backdrop {
		backdrop-filter: blur(3px);
	}
`;

export async function mount(): Promise<HTMLElement> {
	try {
		let shell = <Shell></Shell>;
		await initBrowser();

		let built = <App>{shell}</App>;
		app.replaceWith(built);
		built.addEventListener("contextmenu", (e) => {
			e.preventDefault();
		});

		if (import.meta.env.VITE_PUTER_BRANDING) {
			if (!puter.auth.isSignedIn()) {
				await puter.auth.signIn();
			}

			let wisp = await puter.net.generateWispV1URL();
			setWispUrl(wisp);
		} else {
			setWispUrl(import.meta.env.VITE_WISP_URL);
		}
		return built;
	} catch (e) {
		let err = e as any;
		app.replaceWith(
			document.createTextNode(
				`Error mounting: ${"message" in err ? err.message : err}`
			)
		);
		console.error(err);
		throw e;
	}
}

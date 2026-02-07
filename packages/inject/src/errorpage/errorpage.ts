//@ts-expect-error
import rawErrorHtml from "./errorpage.html";
//@ts-expect-error
import rawErrorCss from "./errorpage.css";
import { ThemeDefinition } from "../../../chrome/src/themes";

let themeStyle: HTMLStyleElement;
export function applyTheme(theme: ThemeDefinition) {
	themeStyle.innerHTML = `:root {
		--font: "Inter", system-ui, sans-serif;
		--bg: ${theme.tokens.ntp_background};
		--text: ${theme.tokens.ntp_text};
		--muted: color-mix(in srgb, ${theme.tokens.ntp_text} 55%, transparent);
		--accent: ${theme.tokens.tab_line};
		--button-bg: ${theme.tokens.tab_line};
		--button-text: ${theme.tokens.ntp_background};
	}`;
}

export function loadErrorPage(errormeta: {
	message: string;
	stack: string;
	theme: ThemeDefinition;
}) {
	let initialStyle = document.createElement("style");
	initialStyle.innerHTML = rawErrorCss;
	document.head.appendChild(initialStyle);

	themeStyle = document.createElement("style");
	document.head.appendChild(themeStyle);
	applyTheme(errormeta.theme);

	document.open();
	document.write(rawErrorHtml);
	document.close();

	let reloadBtn = document.getElementById("reloadBtn")!;
	let toggleBtn = document.getElementById("toggleBtn")!;
	let details = document.getElementById("details")!;
	let copyBtn = document.getElementById("copyBtn")!;
	let errorMessage = document.getElementById("errorMessage")!;

	reloadBtn.addEventListener("click", () => location.reload());

	let error = `Error: ${errormeta.message}\n\n${errormeta.stack}`;

	errorMessage.innerText = errormeta.message;
	details.innerText = errormeta.stack;
	toggleBtn.addEventListener("click", () => {
		if (details.style.display === "none") {
			details.style.display = "block";
			toggleBtn.textContent = "Hide details";
		} else {
			details.style.display = "none";
			toggleBtn.textContent = "Show details";
		}
	});

	copyBtn.addEventListener("click", () => {
		const text = error;
		const textarea = document.createElement("textarea");
		textarea.value = text;
		textarea.style.position = "fixed";
		textarea.style.opacity = "0";
		document.body.appendChild(textarea);
		textarea.select();
		document.execCommand("copy");
		document.body.removeChild(textarea);

		const originalText = copyBtn.textContent;
		copyBtn.textContent = "Copied!";
		setTimeout(() => {
			copyBtn.textContent = originalText;
		}, 2000);
	});
}

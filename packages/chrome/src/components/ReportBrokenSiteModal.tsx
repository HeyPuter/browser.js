import { css, type FC } from "dreamland/core";
import { Button } from "@components/Button";
import { Icon } from "@components/Icon";
import { iconClose, iconError, iconCheckmark } from "../icons";
import { versionInfo } from "@mercuryworkshop/scramjet/bundled";
import { Input } from "@components/Input";
import { tabsService } from "..";

export function ReportBrokenSiteModal(
	this: FC<
		{ onClose: () => void },
		{
			url: string;
			version: string;
			ua: string;
			email: string;
			description: string;
			status: "idle" | "loading" | "success" | "error";
			statusMessage: string;
		}
	>
) {
	this.url = tabsService.activetab.url.href;
	this.version = `${versionInfo.version} (${versionInfo.build})`;
	this.ua = navigator.userAgent;
	this.description = "";
	this.email = "";
	this.status = "idle" as "idle" | "loading" | "success" | "error";
	this.statusMessage = "";

	this.cx.mount = () => {
		document.body.appendChild(this.root);
	};

	const close = () => {
		this.root.remove();
		this.onClose();
	};

	const sendReport = async () => {
		this.status = "loading";
		this.statusMessage = "";

		try {
			let resp = await puter.workers.exec(
				"https://browser.puter.work/api/report",
				{
					method: "POST",
					body: JSON.stringify({
						email: this.email,
						siteUrl: this.url,
						scramjetVersion: this.version,
						userAgent: this.ua,
						description: this.description,
					}),
				}
			);

			const isSuccess = resp && resp.status === 200;

			if (isSuccess) {
				this.status = "success";
				this.statusMessage = "Report sent successfully!";
				setTimeout(() => {
					close();
				}, 1500);
			} else {
				this.status = "error";
				this.statusMessage =
					resp.error || "Failed to send report. Please try again.";
			}
		} catch (error) {
			this.status = "error";
			this.statusMessage =
				error instanceof Error
					? error.message
					: "Failed to send report. Please try again.";
		}
	};

	return (
		<div class="backdrop" on:click={close}>
			<div class="modal" on:click={(e: Event) => e.stopPropagation()}>
				<div class="header">
					<span>Report Broken Site</span>
					<Button
						variant="icon"
						on:click={close}
						disabled={use(this.status).map((s) => s === "loading")}
					>
						<Icon icon={iconClose} />
					</Button>
				</div>
				<div class="content">
					{use(this.status)
						.map((s) => s === "idle" || s === "loading")
						.and(
							<>
								<p>Is this site not working correctly?</p>
								<Input label="Page URL" value={use(this.url)} disabled={true} />
								<Input
									label="Scramjet Version"
									value={use(this.version)}
									disabled={true}
								/>
								<Input
									label="User Agent"
									value={use(this.ua)}
									disabled={true}
								/>
								<Input
									label="Email (optional)"
									value={use(this.email)}
									disabled={use(this.status).map((s) => s === "loading")}
								/>
								<textarea
									value={use(this.description)}
									placeholder="Describe the issue..."
									disabled={use(this.status).map((s) => s === "loading")}
								></textarea>
							</>
						)
						.or(
							<div class="status-container">
								{use(this.status)
									.map((s) => s === "success")
									.and(
										<div class="status-icon success">
											<Icon icon={iconCheckmark} width="64px" height="64px" />
										</div>
									)
									.or(
										<div class="status-icon error">
											<Icon icon={iconError} width="64px" height="64px" />
										</div>
									)}
								<p class="status-message">{use(this.statusMessage)}</p>
							</div>
						)}
				</div>
				<div class="footer">
					{use(this.status)
						.map((s) => s === "idle" || s === "loading")
						.and(
							<>
								<Button
									on:click={close}
									disabled={use(this.status).map((s) => s === "loading")}
								>
									Cancel
								</Button>
								<Button
									variant="primary"
									on:click={sendReport}
									disabled={use(this.status).map((s) => s === "loading")}
								>
									{use(this.status)
										.map((s) => s === "loading")
										.and("Sending...")
										.or("Send Report")}
								</Button>
							</>
						)
						.or(
							<Button variant="primary" on:click={close}>
								{use(this.status)
									.map((s) => s === "success")
									.and("Close")
									.or("Try Again")}
							</Button>
						)}
				</div>
			</div>
		</div>
	);
}

ReportBrokenSiteModal.style = css`
	.backdrop {
		position: fixed;
		top: 0;
		left: 0;
		width: 100%;
		height: 100%;
		background: rgba(0, 0, 0, 0.5);
		display: flex;
		align-items: center;
		justify-content: center;
		z-index: 2000;
	}
	.modal {
		background: var(--frame);
		border: 1px solid var(--popup_border);
		border-radius: 8px;
		width: 500px;
		display: flex;
		flex-direction: column;
		box-shadow: 0 4px 16px rgba(0, 0, 0, 0.2);
		color: var(--toolbar_text);
	}
	.header {
		padding: 1em;
		display: flex;
		justify-content: space-between;
		align-items: center;
		border-bottom: 1px solid var(--popup_border);
		font-weight: bold;
	}
	.content {
		padding: 1em;
		display: flex;
		flex-direction: column;
		gap: 0.5em;
	}
	textarea {
		width: 100%;
		height: 100px;
		background: var(--toolbar_field);
		border: 1px solid var(--popup_border);
		color: var(--toolbar_text);
		padding: 0.5em;
		border-radius: var(--radius);
		resize: none;
		font-family: inherit;
	}
	.footer {
		padding: 1em;
		display: flex;
		justify-content: flex-end;
		gap: 0.5em;
		border-top: 1px solid var(--popup_border);
	}
	.status-container {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		padding: 2em 1em;
		gap: 1em;
	}
	.status-icon {
		display: flex;
		align-items: center;
		justify-content: center;
		animation: scaleIn 0.3s ease-out;
	}
	.status-icon.success {
		color: #4caf50;
	}
	.status-icon.error {
		color: #f44336;
	}
	.status-message {
		text-align: center;
		font-size: 1.1em;
		margin: 0;
		animation: fadeIn 0.3s ease-out;
	}
	@keyframes scaleIn {
		from {
			transform: scale(0);
			opacity: 0;
		}
		to {
			transform: scale(1);
			opacity: 1;
		}
	}
	@keyframes fadeIn {
		from {
			opacity: 0;
			transform: translateY(-10px);
		}
		to {
			opacity: 1;
			transform: translateY(0);
		}
	}
`;

// easing curves ripped from the chromium src
export type EasingToken =
	/**
	 * Tab reorder / reflow. `TabContainerImpl::AnimateViewTo` drives all tab
	 * slot movement through a `views::BoundsAnimator`
	 * (`chrome/browser/ui/views/tabs/tab_container_impl.cc:1121`), which
	 * defaults to `gfx::Tween::EASE_OUT`
	 * (`ui/views/animation/bounds_animator.h:207`).
	 */
	| "--ease-tab-move"
	/** Tab open. Same `BoundsAnimator` path as `--ease-tab-move`. */
	| "--ease-tab-open"
	/** Tab close. Same `BoundsAnimator` path as `--ease-tab-move`. */
	| "--ease-tab-close"
	/**
	 * Hover card fade. `views::WidgetFadeAnimator` defaults to
	 * `gfx::Tween::FAST_OUT_SLOW_IN`
	 * (`ui/views/animation/widget_fade_animator.h:145`).
	 */
	| "--ease-hovercard-fade"
	/**
	 * Hover card slide between tabs. `views::BubbleSlideAnimator` defaults to
	 * `gfx::Tween::FAST_OUT_SLOW_IN`
	 * (`ui/views/animation/bubble_slide_animator.h:118`).
	 */
	| "--ease-hovercard-slide"
	/**
	 * Menu / popup reveal. Chromium's native menus don't scale in; the nearest
	 * analog is the omnibox popup, which uses `gfx::Tween::FAST_OUT_SLOW_IN`
	 * (`chrome/browser/ui/views/omnibox/omnibox_popup_view_views.cc:220`).
	 */
	| "--ease-popup"
	/**
	 * Omnibox width change. See `--ease-popup`; the omnibox popup animator uses
	 * `FAST_OUT_SLOW_IN`.
	 */
	| "--ease-omnibox"
	/**
	 * Small control state changes (checkbox, toggle). Chromium's ink drop
	 * highlight animates with `gfx::Tween::EASE_IN_OUT`
	 * (`ui/views/animation/ink_drop_host.cc` → `ink_drop_highlight.cc:138`).
	 */
	| "--ease-control"
	/**
	 * Hover / background fades. `gfx::SlideAnimation` defaults to
	 * `gfx::Tween::EASE_OUT` (`ui/gfx/animation/slide_animation.h:108`); this is
	 * what `LocationBarView`'s hover animation uses.
	 */
	| "--ease-hover";

let cache: Partial<Record<EasingToken, string>> = {};
let cacheKey = "";

export function easing(token: EasingToken): string {
	const key = document.body.className;
	if (key !== cacheKey) {
		cache = {};
		cacheKey = key;
	}

	let value = cache[token];
	if (value === undefined) {
		value = getComputedStyle(document.body).getPropertyValue(token).trim();
		cache[token] = value;
	}
	return value;
}

/**
 * Animation easing curves, mirrored from Chromium.
 *
 * The `--tween-*` custom properties in `style.css` are 1:1 ports of the curves
 * in Chromium's `gfx::Tween` table (`ui/gfx/animation/tween.cc`). Semantic
 * `--ease-*` tokens point at the project's own bouncy curves by default, and
 * are remapped onto the `--tween-*` values under `body.anim-smooth` — the
 * "smooth" animations tweak — so the UI animates the way Chromium actually
 * does.
 *
 * Notably, *not one* curve in Chromium's entire tween table overshoots: every
 * bezier control point has y within [0, 1]. Chromium has no bouncy UI motion
 * outside of a couple of ChromeOS/ash-specific "lead into a bounce" helpers.
 *
 * Two of Chromium's tweens are polynomials rather than beziers. Both convert
 * exactly to a cubic bezier by degree-elevating the quadratic to a cubic and
 * placing the x control points at 1/3 and 2/3 (which makes x(t) = t exactly):
 *
 *   EASE_OUT: 1-(1-t)^2  ==  cubic-bezier(0.33, 0.67, 0.67, 1)   (error 0)
 *   EASE_IN:  t^2        ==  cubic-bezier(0.33, 0, 0.67, 0.33)   (error 0)
 *
 * EASE_IN_OUT is piecewise quadratic and therefore has no exact single-bezier
 * form; cubic-bezier(0.45, 0, 0.55, 1) fits it to within 0.005.
 */

/**
 * Semantic easing tokens. Each maps to a CSS custom property whose value
 * switches between the bouncy and Chromium curve sets via `body.anim-smooth`.
 *
 * Each entry documents the Chromium code that decides the curve for the
 * equivalent native animation.
 */
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

/**
 * Resolves an easing token to a concrete `cubic-bezier(...)` string for use
 * with the Web Animations API, which (unlike CSS) can't take a `var()`.
 *
 * Values are read from the computed style of `document.body` so JS and CSS
 * always agree, and are cached until the body's class list changes — which is
 * what switching the animations tweak does.
 */
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

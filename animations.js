window.addEventListener("load", () => {
  if (typeof gsap === "undefined") return;
  const hasScrollTrigger = typeof ScrollTrigger !== "undefined";
  if (hasScrollTrigger) gsap.registerPlugin(ScrollTrigger);

  const root = document.documentElement;

  /* =========================================================
     SHARED CONSTANTS
     One editorial easing pair for every hover / touch / scroll
     highlight, one set of timings for the card peel.
     ========================================================= */
  const ENTER = { duration: 0.28, ease: "power3.out" };
  const LEAVE = { duration: 0.32, ease: "power3.inOut" };
  const TOUCH_HOLD = 0.55; // seconds a touch flash stays lit
  const SCRUB_HOLD = 0.07; // scrubbed highlight: pause between in and out
  const SCRUB_STEP = 0.22; // scrubbed highlight: stagger between targets

    const PEEL = {
    out: (mobile) =>
      mobile
        ? { yPercent: -15, scale: 1.04, rotation: -2, duration: 0.5, ease: "power2.inOut" }
        : { xPercent: -15, scale: 1.04, rotation: -2, duration: 0.5, ease: "power2.inOut" },
    tuck: { xPercent: 0, yPercent: 0, scale: 1, rotation: 0, duration: 0.42, ease: "power3.inOut" },
    lift: 65,
    releaseAt: 0.48,
  };

  const HIGHLIGHT_PROPS = "backgroundColor,boxShadow,color";
  const SURFACE_PROPS = "backgroundColor";

  /* ---------- Colour tokens come from CSS, never duplicated here ---------- */
  const rootStyle = getComputedStyle(root);
  const token = (name, fallback) => {
    const value = rootStyle.getPropertyValue(name).trim();
    return /^#[0-9a-f]{6}$/i.test(value) ? value : fallback;
  };
  const withAlpha = (hex, alpha) => {
    const n = parseInt(hex.slice(1), 16);
    return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
  };

  const INK = token("--ink", "#0A1629");
  const PAPER = token("--paper", "#F7F8F7");
  const BLUE = token("--blue", "#134E8E");
  const PINK = token("--pink", "#d05a7d");
  const INK_CLEAR = withAlpha(INK, 0);

  /* Function-valued so they re-evaluate on invalidate / refresh and always
     follow the element's current em. */
  const highlightStates = {
    on: {
      backgroundColor: INK,
      boxShadow: (i, el) => `0 0 0 ${parseFloat(getComputedStyle(el).fontSize) * 0.2}px ${INK}`,
      color: PAPER,
    },
    off: {
      backgroundColor: INK_CLEAR,
      boxShadow: () => `0 0 0 0px ${INK_CLEAR}`,
      color: PINK,
    },
  };
  const surfaceStates = {
    on: { backgroundColor: INK },
    off: { backgroundColor: BLUE },
  };

  /* ---------- Canonical title, cached once before any slicing ---------- */
  const headerTitle = document.getElementById("header-left");
  const FULL_TITLE = headerTitle
    ? headerTitle.dataset.fullText || headerTitle.textContent.trim()
    : "";
  if (headerTitle) headerTitle.dataset.fullText = FULL_TITLE;

  /* =========================================================
     TOGGLE FACTORY
     A pointer-driven on/off state with exactly one live tween per
     element, so a resize or breakpoint change can always find and
     kill it (tweens created from event handlers are not tracked by
     gsap.matchMedia()).
     ========================================================= */
  const createToggle = (targets, states, clearProps) => {
    const live = new Map();

    const track = (el, animation) => {
      live.get(el)?.kill();
      live.set(el, animation);
      return animation;
    };

    return {
      targets,
      states,
      clearProps,

      enter: (el) => track(el, gsap.to(el, { ...states.on, ...ENTER })),

      leave: (el) =>
        track(el, gsap.to(el, { ...states.off, ...LEAVE, clearProps })),

      /* Touch: light up, hold, fade out, as one cancellable timeline. */
      flash: (el) =>
        track(
          el,
          gsap
            .timeline({ onComplete: () => gsap.set(el, { clearProps }) })
            .to(el, { ...states.on, ...ENTER })
            .to(el, { ...states.off, ...LEAVE, clearProps }, `+=${TOUCH_HOLD}`)
        ),

      reset: () => {
        live.forEach((animation) => animation.kill());
        live.clear();
        gsap.set(targets, { clearProps });
      },
    };
  };

  /* Pointer wiring; returns a remover. */
  const bindPointer = (toggle) => {
    const removers = [];
    toggle.targets.forEach((el) => {
      const onEnter = (e) => e.pointerType === "mouse" && toggle.enter(el);
      const onLeave = (e) => e.pointerType === "mouse" && toggle.leave(el);
      const onDown = (e) => e.pointerType !== "mouse" && toggle.flash(el);

      el.addEventListener("pointerenter", onEnter);
      el.addEventListener("pointerleave", onLeave);
      el.addEventListener("pointerdown", onDown, { passive: true });
      removers.push(() => {
        el.removeEventListener("pointerenter", onEnter);
        el.removeEventListener("pointerleave", onLeave);
        el.removeEventListener("pointerdown", onDown);
      });
    });
    return () => removers.forEach((remove) => remove());
  };

  /* Scroll-scrubbed highlight (mobile). Values are functions and the
     trigger re-evaluates them on refresh, so em-based spread stays right. */
  const createScrub = (trigger, toggle, range) => {
    const tl = gsap.timeline({
      scrollTrigger: {
        trigger,
        start: range.start,
        end: range.end,
        scrub: 0.6,
        invalidateOnRefresh: true,
      },
    });
    toggle.targets.forEach((el, i) => {
      const at = i * SCRUB_STEP;
      tl.to(el, { ...toggle.states.on, duration: ENTER.duration, ease: ENTER.ease }, at).to(
        el,
        { ...toggle.states.off, duration: LEAVE.duration, ease: LEAVE.ease },
        at + ENTER.duration + SCRUB_HOLD
      );
    });
    return tl;
  };

  /* =========================================================
     MATCH-MEDIA LIFECYCLE
     ========================================================= */
  const mm = gsap.matchMedia();

  mm.add(
    {
      isDesktop: "(min-width: 768px)",
      isMobile: "(max-width: 767px)",
      reduceMotion: "(prefers-reduced-motion: reduce)",
    },
    (context) => {
      const { isDesktop, isMobile, reduceMotion } = context.conditions;
      if (reduceMotion) return;

      const cleanups = [];
      root.classList.add("js-gsap");
      cleanups.push(() => root.classList.remove("js-gsap"));

      /* -------------------------------------------------------
         1. LIVE-TYPE "KRITIKA GOEL" (tablet & up: load + hover)
         ------------------------------------------------------- */
      if (isDesktop && headerTitle) {
        let typeTween = null;

        const restoreTitle = () => {
          typeTween?.kill();
          typeTween = null;
          headerTitle.textContent = FULL_TITLE;
        };

        const typeTitle = () => {
          restoreTitle();
          const proxy = { count: 0 };
          headerTitle.textContent = "";
          typeTween = gsap.to(proxy, {
            count: FULL_TITLE.length,
            duration: 0.95,
            ease: "power2.out",
            onUpdate: () => {
              headerTitle.textContent = FULL_TITLE.slice(0, Math.ceil(proxy.count));
            },
            onComplete: restoreTitle,
          });
        };

        const onTitleEnter = (e) => {
          if (e.pointerType !== "mouse") return;
          if (typeTween?.isActive()) return; // never restart or truncate mid-type
          typeTitle();
        };

        typeTitle();
        headerTitle.addEventListener("pointerenter", onTitleEnter);
        cleanups.push(() => {
          headerTitle.removeEventListener("pointerenter", onTitleEnter);
          restoreTitle();
        });
      }

      /* -------------------------------------------------------
         2. INK HIGHLIGHT: .header-subtitle (all sizes) &
            #detail span (tablet & up only)
            (paint-only: background + box-shadow, no layout shift)
         ------------------------------------------------------- */
      const highlightTargets = [
        document.querySelector(".header-subtitle"),
        ...(isDesktop ? document.querySelectorAll("#detail span") : []),
      ].filter(Boolean);
      const highlights = createToggle(highlightTargets, highlightStates, HIGHLIGHT_PROPS);
      cleanups.push(bindPointer(highlights));

      /* -------------------------------------------------------
         3. .closeup-text: --blue -> --ink on hover / touch / scroll
         ------------------------------------------------------- */
      const closeupTargets = [...document.querySelectorAll(".closeup-text")];
      const closeups = createToggle(closeupTargets, surfaceStates, SURFACE_PROPS);
      cleanups.push(bindPointer(closeups));

      const scrubs = [];
      if (isMobile && highlightTargets.length) {
        const introTimer = gsap.delayedCall(0.45, () => {
          highlightTargets.forEach((el) => highlights.flash(el));
        });
        cleanups.push(() => introTimer.kill());
      }

      if (isMobile && hasScrollTrigger && closeupTargets.length) {
        scrubs.push(
          createScrub(closeupTargets[0], closeups, { start: "top 80%", end: "bottom 30%" })
        );
      }


      /* Resize: drop every interrupted tween and orphaned inline style, then
         let any live scroll scrub repaint its true state. */
      const resetInteractive = () => {
        highlights.reset();
        closeups.reset();
        scrubs.forEach((tl) => tl.invalidate().render(tl.time(), true, true));
      };

      let lastW = window.innerWidth;
      let lastH = window.innerHeight;
      const onResize = () => {
        if (window.innerWidth === lastW && window.innerHeight === lastH) return;
        lastW = window.innerWidth;
        lastH = window.innerHeight;
        resetInteractive();
      };
      window.addEventListener("resize", onResize, { passive: true });
      cleanups.push(() => window.removeEventListener("resize", onResize));

      cleanups.push(() => {
        const targets = [...highlightTargets, ...closeupTargets];
        gsap.killTweensOf(targets);
        highlights.reset();
        closeups.reset();
        gsap.set(targets, { clearProps: "all" });
      });

      /* -------------------------------------------------------
         4. CARD STACK (.deck-container): single leftward peel
            Geometry, margins and click handling are CSS / [ARCH 5].
         ------------------------------------------------------- */
      const deck = document.querySelector(".deck-container");
      const wrapper = deck?.querySelector(".stack-wrapper");
      const radios = deck ? [...deck.querySelectorAll(".deck-radio")] : [];

      if (deck && wrapper && radios.length) {
        const layers = {
          "slide-1": wrapper.querySelector(".card-1"),
          "slide-2": wrapper.querySelector(".card-2"),
          "slide-4": wrapper.querySelector(".card-4"),
          "slide-5": wrapper.querySelector(".card-5"),
        };
        const layerList = Object.values(layers).filter(Boolean);
        const imgList = layerList.map((layer) => layer.querySelector("img")).filter(Boolean);

        let activeId = radios.find((r) => r.checked)?.id || "slide-2";
        let peel = null;

        /* Rapid re-clicks: cancel the running peel and hand every card back
           to its CSS role before starting the next one. */
        const settle = () => {
          peel?.kill();
          peel = null;
          gsap.killTweensOf([...layerList, ...imgList]);
          gsap.set(layerList, { clearProps: "zIndex" });
          gsap.set(imgList, { clearProps: "transform" });
        };

                const onDeckChange = ({ target }) => {
          if (!target?.classList.contains("deck-radio") || !target.checked) return;
          if (target.id === activeId) return;

          const outLayer = layers[activeId];
          const inLayer = layers[target.id];
          const outImg = outLayer?.querySelector("img");
          const inImg = inLayer?.querySelector("img");
          activeId = target.id;

          settle();
          if (!outLayer || !outImg) return;

          gsap.set(outLayer, { zIndex: PEEL.lift });

          peel = gsap
            .timeline({
              onComplete: () => {
                gsap.set(outLayer, { clearProps: "zIndex" });
                gsap.set([outImg, inImg].filter(Boolean), { clearProps: "transform" });
                peel = null;
              },
            })
            .to(outImg, { ...PEEL.out(isMobile), ease: "power2.inOut" }, 0)
            .add(() => gsap.set(outLayer, { clearProps: "zIndex" }), PEEL.releaseAt)
            .to(outImg, PEEL.tuck, PEEL.releaseAt);

          if (inImg) {
            peel.fromTo(
              inImg,
              { scale: 0.93 },
              { scale: 1, duration: 0.48, ease: "power3.out" },
              0.12
            );
          }
        };


        deck.addEventListener("change", onDeckChange);
        cleanups.push(() => {
          deck.removeEventListener("change", onDeckChange);
          settle();
        });
      }

      /* -------------------------------------------------------
         5. .question INK-RISE: scroll only drives --ink-rise;
            the gradient itself lives in CSS (html.js-gsap .question)
         ------------------------------------------------------- */
      const question = document.querySelector(".question");
      if (question && hasScrollTrigger) {
        gsap.fromTo(
          question,
          { "--ink-rise": "-2%" },
          {
            "--ink-rise": "105%",
            ease: "power3.out",
            scrollTrigger: {
              trigger: root,
              start: "top top",
              end: "18% top",
              scrub: 1.4,
            },
          }
        );
      }

      /* Full teardown when a breakpoint or motion preference flips. */
      return () => {
        for (let i = cleanups.length - 1; i >= 0; i--) cleanups[i]();
      };
    }
  );
});

(function () {
  const SITE_CONFIG_PATH =
    window.__SITE_CONFIG_PATH__ ||
    document.documentElement?.getAttribute("data-site-config-path") ||
    "./data/site.json";
  const THEME_KEY = "vb_theme";

  let siteConfigPromise = null;
  let activeSiteConfig = null;
  let navAutoHideBound = false;

  function normalizeCssSize(value, fallback) {
    if (typeof value === "number" && Number.isFinite(value) && value > 0) {
      return `${value}px`;
    }

    if (typeof value !== "string") return fallback;
    const text = value.trim();
    if (!text) return fallback;

    if (/^\d+(\.\d+)?(px|rem|em|vw|vh|%)$/i.test(text)) return text;
    if (/^(clamp|calc|min|max)\(.+\)$/i.test(text)) return text;
    return fallback;
  }

  function normalizeCssNumberOrPercent(value, fallback) {
    if (typeof value === "number" && Number.isFinite(value) && value > 0) {
      return String(value);
    }
    if (typeof value !== "string") return fallback;
    const text = value.trim();
    if (!text) return fallback;
    if (/^\d+(\.\d+)?%?$/.test(text)) return text;
    return fallback;
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function isLocalPreviewEnv() {
    const protocol = String(window.location?.protocol || "").toLowerCase();
    if (protocol === "file:") return true;

    const host = String(window.location?.hostname || "").toLowerCase();
    return host === "localhost" || host === "127.0.0.1" || host === "::1";
  }

  function getAssetCdnConfig(config) {
    const raw = config?.assetCdn && typeof config.assetCdn === "object" ? config.assetCdn : {};
    const base = typeof raw.base === "string" ? raw.base.trim().replace(/\/+$/, "") : "";
    const enabled = raw.enabled !== false;
    const useOnLocal = raw.useOnLocal === true;
    return { base, enabled, useOnLocal };
  }

  function normalizeAssetPath(pathname) {
    let value = String(pathname || "").trim().replaceAll("\\", "/");
    if (!value) return "";

    while (value.startsWith("../")) {
      value = value.slice(3);
    }
    if (value.startsWith("./")) {
      value = value.slice(2);
    }
    if (value.startsWith("/")) {
      value = value.slice(1);
    }
    if (!/^assets\//i.test(value)) {
      return "";
    }
    return value.replace(/\/{2,}/g, "/");
  }

  function resolveAssetUrl(rawUrl, options = {}) {
    const input = String(rawUrl || "").trim();
    if (!input) return input;
    if (/^(https?:|data:|blob:|mailto:|tel:|#|\/\/)/i.test(input)) return input;

    const match = input.match(/^([^?#]*)([?#].*)?$/);
    const pathname = match ? match[1] : input;
    const suffix = match ? match[2] || "" : "";
    const normalized = normalizeAssetPath(pathname);
    if (!normalized) return input;

    const config = options?.config || activeSiteConfig;
    const cdn = getAssetCdnConfig(config);
    if (!cdn.enabled || !cdn.base) return input;
    if (isLocalPreviewEnv() && !cdn.useOnLocal) return input;

    return `${cdn.base}/${normalized}${suffix}`;
  }

  function rgbaFromColor(color, alpha, fallback) {
    const rgb = parseColorToRgb(color);
    if (!rgb) return fallback;
    const a = clamp(Number(alpha), 0, 1);
    return `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${a.toFixed(3)})`;
  }

  function applyBrandConfig(config) {
    const root = document.documentElement.style;
    const brand = config?.brand && typeof config.brand === "object" ? config.brand : {};

    const fromFlat = typeof config?.brandIcon === "string" ? config.brandIcon.trim() : "";
    const fromNested = typeof brand.icon === "string" ? brand.icon.trim() : "";
    const iconPath = resolveAssetUrl(fromFlat || fromNested, { config });
    if (iconPath) {
      const safePath = iconPath.replaceAll('"', '\\"');
      root.setProperty("--brand-icon-url", `url("${safePath}")`);
    }

    const textSize = normalizeCssSize(brand.textSize ?? config?.brandTextSize, "1.08rem");
    const logoSize = normalizeCssSize(
      brand.logoSize ?? brand.iconSize ?? config?.brandLogoSize ?? config?.brandIconSize,
      "22px"
    );
    const brandGap = normalizeCssSize(brand.gap ?? config?.brandGap, "8px");

    root.setProperty("--brand-text-size", textSize);
    root.setProperty("--brand-icon-size", logoSize);
    root.setProperty("--brand-gap", brandGap);

    // —— 像素描边：整像素多方向 text-shadow 拼成方块外框（-webkit-text-stroke 是平滑抗锯齿，
    //    不贴合像素风）。宽度取整像素，默认读 CSS 变量 --brand-text-stroke-width，可被 site.json 覆盖。
    const parsePxNumber = (value) => {
      if (typeof value === "number") {
        return Number.isFinite(value) && value > 0 ? value : 0;
      }
      if (typeof value !== "string") return null;
      const m = /^(\d+(?:\.\d+)?)\s*px$/i.exec(value.trim());
      if (!m) return null;
      return Math.max(0, Number(m[1]));
    };

    const configStrokeWidth = normalizeCssSize(
      brand.textStrokeWidth ?? brand.strokeWidth ?? config?.brandTextStrokeWidth,
      null
    );
    const rootStrokeWidth =
      getComputedStyle(document.documentElement).getPropertyValue("--brand-text-stroke-width") || "";
    const strokeColor =
      (typeof brand.textStrokeColor === "string" && brand.textStrokeColor.trim()) ||
      (typeof config?.brandTextStrokeColor === "string" && config?.brandTextStrokeColor.trim()) ||
      (getComputedStyle(document.documentElement).getPropertyValue("--brand-text-stroke-color") || "").trim() ||
      "#0000ff";

    const parsedStroke = parsePxNumber(configStrokeWidth);
    const parsedRoot = parsePxNumber(rootStrokeWidth);
    const strokeWidthPx = parsedStroke !== null ? parsedStroke : parsedRoot !== null ? parsedRoot : 1;
    const strokeWidthBlocks = Math.round(strokeWidthPx);

    let pixelShadow = "";
    if (strokeWidthBlocks > 0) {
      const shadows = [];
      for (let t = 1; t <= strokeWidthBlocks; t += 1) {
        for (let dy = -t; dy <= t; dy += 1) {
          for (let dx = -t; dx <= t; dx += 1) {
            // 正方形环：max(|dx|,|dy|) == t → 方块外扩，无斜切缺口，保持像素块一致
            if (Math.max(Math.abs(dx), Math.abs(dy)) === t) {
              shadows.push(`${dx}px ${dy}px 0 ${strokeColor}`);
            }
          }
        }
      }
      pixelShadow = shadows.join(",");
    }

    document.querySelectorAll(".brand").forEach((el) => {
      el.style.textShadow = pixelShadow;
    });

    const brandText =
      (typeof brand.text === "string" && brand.text.trim()) ||
      (typeof config?.brandText === "string" && config?.brandText.trim());
    if (brandText) {
      document.querySelectorAll(".brand").forEach((el) => {
        el.textContent = brandText;
      });
    }
  }

  function normalizeNavItems(config) {
    const fallback = [
      { key: "blog", label: "Blog", href: "./blog.html" },
      { key: "game", label: "Game", href: "./game.html" },
      { key: "art", label: "Art", href: "./art.html" },
      { key: "about", label: "About", href: "./about.html" },
      { key: "lab", label: "Lab", href: "./lab.html" },
    ];

    const flatItems = Array.isArray(config?.navItems) ? config.navItems : [];
    const nestedItems = Array.isArray(config?.nav?.items) ? config.nav.items : [];
    const source = flatItems.length ? flatItems : nestedItems;
    if (!source.length) return fallback;

    const normalized = source
      .map((item) => {
        const key = typeof item?.key === "string" ? item.key.trim() : "";
        const label = typeof item?.label === "string" ? item.label.trim() : "";
        const href = typeof item?.href === "string" ? item.href.trim() : "";
        if (!label || !href) return null;
        return {
          key,
          label,
          href,
        };
      })
      .filter(Boolean);

    return normalized.length ? normalized : fallback;
  }

  function applyNavConfig(config) {
    const navRoot = document.querySelector(".top-nav nav");
    if (!navRoot) return;

    const items = normalizeNavItems(config);
    navRoot.replaceChildren();

    items.forEach((item) => {
      const anchor = document.createElement("a");
      anchor.href = item.href;
      anchor.textContent = item.label;
      if (item.key) {
        anchor.dataset.nav = item.key;
      }
      navRoot.appendChild(anchor);
    });
  }

  function applyNavGlassConfig(config) {
    const root = document.documentElement.style;
    const nestedNav = config?.nav && typeof config.nav === "object" ? config.nav : {};
    const nestedGlass = nestedNav?.glass && typeof nestedNav.glass === "object" ? nestedNav.glass : {};
    const flatGlass = config?.navGlass && typeof config.navGlass === "object" ? config.navGlass : {};
    const glass = Object.keys(flatGlass).length ? flatGlass : nestedGlass;
    const quick = config?.navGlassQuick && typeof config.navGlassQuick === "object" ? config.navGlassQuick : {};

    const setColorVar = (name, value) => {
      if (typeof value !== "string") return;
      const text = value.trim();
      if (!text) return;
      // 导航色变量在 styles.css 里同时挂在 html[data-theme] 与 body[data-theme]，
      // 而主题切换只更新 body 的 data-theme，因此必须把配置值同时写到 html 和 body，
      // 否则 body 上较新的主题声明会盖住 html 上传给后代的内联配置（navInk 等不生效）。
      root.setProperty(name, text);
      if (document.body) document.body.style.setProperty(name, text);
    };

    // Quick mode: user adjusts only 4 knobs in site.json, detailed values are auto-derived.
    if (Object.keys(quick).length) {
      const quickColor = typeof quick.color === "string" ? quick.color.trim() : "#ffffff";
      const rawOpacity = Number(quick.opacity);
      const opacity = Number.isFinite(rawOpacity) ? clamp(rawOpacity, 0, 1) : 0.1;

      setColorVar("--nav-glass-base", rgbaFromColor(quickColor, opacity, "rgba(255, 255, 255, 0.1)"));
      setColorVar(
        "--nav-glass-tint",
        rgbaFromColor(quickColor, clamp(opacity * 0.42, 0.08, 0.45), "rgba(255, 255, 255, 0.08)")
      );
      setColorVar(
        "--nav-glass-glow",
        rgbaFromColor(quickColor, clamp(opacity * 0.9, 0.22, 0.9), "rgba(255, 255, 255, 0.22)")
      );
      setColorVar("--nav-glass-border", `rgba(255, 255, 255, ${clamp(opacity * 0.58, 0.18, 0.5).toFixed(3)})`);
      setColorVar("--nav-ink", "#ffffff");
      setColorVar("--nav-muted-ink", `rgba(255, 255, 255, ${clamp(opacity * 0.9, 0.7, 0.95).toFixed(3)})`);
      setColorVar("--nav-pill-bg", `rgba(255, 255, 255, ${clamp(opacity * 0.2, 0.08, 0.2).toFixed(3)})`);
      setColorVar("--nav-pill-active-bg", "#ffffff");
      setColorVar("--nav-pill-active-ink", rgbaFromColor(quickColor, 1, "#ffffff"));
      root.setProperty("--nav-blur", normalizeCssSize(quick.blur, "16px"));
      root.setProperty("--nav-saturate", normalizeCssNumberOrPercent(quick.saturate, "100%"));
    }

    setColorVar("--nav-glass-base", glass.base ?? config?.navGlassBase);
    setColorVar("--nav-glass-tint", glass.tint ?? config?.navGlassTint);
    setColorVar("--nav-glass-glow", glass.glow ?? config?.navGlassGlow);
    setColorVar("--nav-glass-border", glass.border ?? config?.navGlassBorder);
    setColorVar("--nav-ink", glass.ink ?? config?.navInk);
    setColorVar("--nav-muted-ink", glass.mutedInk ?? config?.navMutedInk);
    setColorVar("--nav-pill-bg", glass.pill ?? glass.pillBg ?? config?.navPillBg);
    setColorVar("--nav-pill-active-bg", glass.pillActive ?? config?.navPillActiveBg);
    setColorVar("--nav-pill-active-ink", glass.pillActiveInk ?? config?.navPillActiveInk);

    root.setProperty("--nav-blur", normalizeCssSize(glass.blur ?? config?.navBlur, "16px"));
    root.setProperty(
      "--nav-saturate",
      normalizeCssNumberOrPercent(glass.saturate ?? config?.navSaturate, "180%")
    );

    // 导航噪点颗粒贴图：确定性伪随机生成一张透明底的“雪花”颗粒平铺图，
    // 叠加在玻璃底色上，形成轻模糊 + 像素噪点（与头图静态噪点语言一致）。
    var NOISE_TILE = 96;
    var NOISE_CELL = 4;
    function grainRnd(i, c) {
      var x = (i * 374761393) + (c * 668265263);
      x = (x ^ (x >> 13)) | 0;
      x = (Math.imul(x, 1274126177)) | 0;
      x = (x ^ (x >> 16)) >>> 0;
      return x / 4294967296;
    }
    var cols = NOISE_TILE / NOISE_CELL;
    var parts = [];
    for (var gy = 0; gy < cols; gy++) {
      for (var gx = 0; gx < cols; gx++) {
        if (grainRnd(gy, gx) >= 0.5) continue;
        var dark = grainRnd(gy, gx + 1000) < 0.55;
        var alpha = (0.04 + grainRnd(gy, gx + 2000) * 0.07).toFixed(3);
        parts.push(
          '<rect x="' + (gx * NOISE_CELL) + '" y="' + (gy * NOISE_CELL) +
          '" width="' + NOISE_CELL + '" height="' + NOISE_CELL +
          '" fill="' + (dark ? "#000" : "#fff") + '" fill-opacity="' + alpha + '"/>'
        );
      }
    }
    var noiseSvg =
      '<svg xmlns="http://www.w3.org/2000/svg" width="' + NOISE_TILE +
      '" height="' + NOISE_TILE + '" viewBox="0 0 ' + NOISE_TILE + " " + NOISE_TILE + '">' +
      parts.join("") + "</svg>";
    var noiseUrl = 'url("data:image/svg+xml,' + encodeURIComponent(noiseSvg) + '")';
    root.setProperty("--nav-noise-url", noiseUrl);
    root.setProperty("--nav-noise-size", NOISE_TILE + "px");
  }

  function setupBackToTop() {
    if (document.getElementById("back-to-top-btn")) return;

    const btn = document.createElement("button");
    btn.id = "back-to-top-btn";
    btn.className = "back-to-top";
    btn.type = "button";
    btn.textContent = "";
    btn.setAttribute("aria-label", "返回页面顶部");
    document.body.appendChild(btn);

    const updateBackToTopTop = () => {
      const isMobile = window.matchMedia("(max-width: 900px)").matches;
      const fallbackTop = isMobile ? 88 : 96;
      const nav = document.querySelector(".top-nav");
      const root = document.documentElement?.style;
      if (!root) return;

      if (!nav) {
        root.setProperty("--back-to-top-top", `calc(${fallbackTop}px + env(safe-area-inset-top, 0px))`);
        return;
      }

      const rect = nav.getBoundingClientRect();
      const navBottom = Math.max(0, rect.bottom);
      const gap = isMobile ? 10 : 12;
      const top = Math.ceil(navBottom + gap);
      root.setProperty("--back-to-top-top", `calc(${top}px + env(safe-area-inset-top, 0px))`);
      // 导航在文档流里占用的高度：让头图负边距能精准贴齐，浮到导航下方
      const navHeight = Math.max(0, Math.round(rect.height));
      root.setProperty("--topnav-height", `${navHeight}px`);
    };

    const updateVisibility = () => {
      if (window.scrollY > 260) {
        btn.classList.add("visible");
      } else {
        btn.classList.remove("visible");
      }
    };

    btn.addEventListener("click", () => {
      window.scrollTo({
        top: 0,
        behavior: "smooth",
      });
    });

    updateBackToTopTop();
    updateVisibility();
    window.addEventListener("resize", updateBackToTopTop, { passive: true });
    window.addEventListener("scroll", updateVisibility, { passive: true });
    window.addEventListener("resize", updateBackToTopTop, { passive: true });
  }

  function setupAutoHideNav(config) {
    const nav = document.querySelector(".top-nav");
    if (!nav) return;

    const pageKey = String(document.body?.dataset?.page || "").trim().toLowerCase();
    const pathname = String(window.location?.pathname || "").trim().toLowerCase();
    const isBlogPostPage = /(^|\/)blog-post\.html$/.test(pathname);
    const isLabPage = pageKey === "lab" || /(^|\/)lab\.html$/.test(pathname);
    const pageAllowed = isBlogPostPage || isLabPage;
    if (!pageAllowed) {
      nav.classList.remove("is-auto-hidden");
      return;
    }

    const navConfig = config?.nav && typeof config.nav === "object" ? config.nav : {};
    const enabledRaw = navConfig.autoHide ?? config?.navAutoHide;
    const enabled = enabledRaw === undefined ? true : enabledRaw !== false;

    if (!enabled) {
      nav.classList.remove("is-auto-hidden");
      return;
    }

    if (navAutoHideBound) return;
    navAutoHideBound = true;

    const minYRaw = Number(navConfig.autoHideMinY ?? config?.navAutoHideMinY);
    const deltaRaw = Number(navConfig.autoHideDelta ?? config?.navAutoHideDelta);
    const minY = Number.isFinite(minYRaw) ? Math.max(0, minYRaw) : 90;
    const minDelta = Number.isFinite(deltaRaw) ? Math.max(1, deltaRaw) : 8;

    let lastY = Math.max(0, window.scrollY || 0);
    let ticking = false;

    const applyByScroll = () => {
      const y = Math.max(0, window.scrollY || 0);
      const delta = y - lastY;

      if (y <= minY) {
        nav.classList.remove("is-auto-hidden");
        lastY = y;
        return;
      }

      if (Math.abs(delta) < minDelta) {
        lastY = y;
        return;
      }

      if (delta > 0) {
        nav.classList.add("is-auto-hidden");
      } else {
        nav.classList.remove("is-auto-hidden");
      }

      lastY = y;
    };

    const onScroll = () => {
      if (ticking) return;
      ticking = true;
      window.requestAnimationFrame(() => {
        applyByScroll();
        ticking = false;
      });
    };

    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener(
      "resize",
      () => {
        if ((window.scrollY || 0) <= minY) {
          nav.classList.remove("is-auto-hidden");
        }
      },
      { passive: true }
    );

    applyByScroll();
  }

  async function loadSiteConfig() {
    if (!siteConfigPromise) {
      siteConfigPromise = fetch(SITE_CONFIG_PATH, { cache: "no-store" })
        .then((res) => {
          if (!res.ok) {
            throw new Error(`加载站点配置失败: ${res.status}`);
          }
          return res.text().then((text) => JSON.parse(text.replace(/^\uFEFF/, "")));
        })
        .catch(() => ({
          title: "nino",
          brandIcon: "./assets/Home_Toy/M_0.png",
          brand: {
            icon: "./assets/Home_Site/ninocatlogo.png",
            textSize: "3.0rem",
            logoSize: "48px",
            gap: "8px",
          },
          navItems: [
            { key: "blog", label: "Blog", href: "./blog.html" },
            { key: "game", label: "Game", href: "./game.html" },
            { key: "art", label: "Art", href: "./art.html" },
            { key: "about", label: "About", href: "./about.html" },
            { key: "lab", label: "Lab", href: "./lab.html" },
          ],
          navGlass: {
            base: "rgba(255, 255, 255, 0.1)",
            tint: "rgba(255, 255, 255, 0.08)",
            glow: "rgba(255, 255, 255, 0.22)",
            border: "rgba(255, 255, 255, 0.18)",
            ink: "#ffffff",
            mutedInk: "rgba(255, 255, 255, 0.9)",
            pill: "rgba(255, 255, 255, 0.14)",
            pillActive: "#ffffff",
            pillActiveInk: "#111111",
            blur: "16px",
            saturate: "100%",
          },
          navGlassQuick: {
            color: "#ffffff",
            opacity: 0.1,
            blur: "16px",
            saturate: "100%",
          },
          assetCdn: {
            enabled: false,
            base: "",
            useOnLocal: false,
          },
          eyebrow: "eyebrow",
          subtitle: "subtitle",
          defaultTheme: "light",
          themes: {
            light: {
              bg: "#f2f2f2",
              surface: "#ffffff",
              surfaceAlt: "#e6e6e6",
              text: "#111111",
              muted: "#555555",
              accent: "#000000",
            },
            dark: {
              bg: "#0d0d0d",
              surface: "#1c1c1c",
              surfaceAlt: "#2a2a2a",
              text: "#f5f5f5",
              muted: "#b3b3b3",
              accent: "#ffffff",
            },
          },
          selection: {
            light: {
              bg: "rgba(68, 127, 255, 0.28)",
              text: "#0f172a",
            },
            dark: {
              bg: "rgba(110, 167, 255, 0.38)",
              text: "#f8fbff",
            },
          },
          footer: {
            line1: "Copyright © 2026 Nino",
            line2: "All rights reserved.",
          },
          headerImages: {
            default: "./assets/hero-home.svg",
          },
        }))
        .then((config) => {
          activeSiteConfig = config || null;
          applyBrandConfig(config);
          applyNavGlassConfig(config);
          applyNavConfig(config);
          applyGalleryButton(config);
          applyAboutButton(config);
          applyThemeToggleButton(config);
          setupAutoHideNav(config);
          setupBackToTop();
          applyPageHeroText(config);
          return config;
        });
    }
    return siteConfigPromise;
  }

  function setThemeVariables(themeName, values) {
    const root = document.documentElement.style;
    root.setProperty(`--${themeName}-bg`, values.bg);
    root.setProperty(`--${themeName}-surface`, values.surface);
    root.setProperty(`--${themeName}-surface-alt`, values.surfaceAlt);
    root.setProperty(`--${themeName}-text`, values.text);
    root.setProperty(`--${themeName}-muted`, values.muted);
    root.setProperty(`--${themeName}-accent`, values.accent);
    root.setProperty(
      `--${themeName}-surface-alt-ink`,
      values.surfaceAltText || pickReadableTextColor(values.surfaceAlt, values.text)
    );
    root.setProperty(`--${themeName}-accent-ink`, values.accentText || pickReadableTextColor(values.accent, values.bg));

    const selection = values?.selection && typeof values.selection === "object" ? values.selection : {};
    const defaultSelectionBg = themeName === "light" ? "rgba(68, 127, 255, 0.28)" : "rgba(110, 167, 255, 0.38)";
    const defaultSelectionText = themeName === "light" ? "#0f172a" : "#f8fbff";
    const selectionBg =
      (typeof selection.bg === "string" && selection.bg.trim()) ||
      (typeof values.selectionBg === "string" && values.selectionBg.trim()) ||
      defaultSelectionBg;
    const selectionTextCandidate =
      (typeof selection.text === "string" && selection.text.trim()) ||
      (typeof values.selectionText === "string" && values.selectionText.trim()) ||
      "";
    const selectionText = selectionTextCandidate || pickReadableTextColor(selectionBg, defaultSelectionText);

    root.setProperty(`--${themeName}-selection-bg`, selectionBg);
    root.setProperty(`--${themeName}-selection-text`, selectionText);

    const stripText = values?.homeStripText && typeof values.homeStripText === "object" ? values.homeStripText : {};
    const defaultStripText = values?.text || (themeName === "light" ? "#111111" : "#f5f5f5");
    const stripTitle =
      (typeof stripText.title === "string" && stripText.title.trim()) ||
      (typeof values.homeStripTitle === "string" && values.homeStripTitle.trim()) ||
      defaultStripText;
    const stripDesc =
      (typeof stripText.desc === "string" && stripText.desc.trim()) ||
      (typeof stripText.description === "string" && stripText.description.trim()) ||
      (typeof values.homeStripDesc === "string" && values.homeStripDesc.trim()) ||
      defaultStripText;
    const stripIndex =
      (typeof stripText.index === "string" && stripText.index.trim()) ||
      (typeof stripText.no === "string" && stripText.no.trim()) ||
      (typeof values.homeStripIndex === "string" && values.homeStripIndex.trim()) ||
      defaultStripText;

    root.setProperty(`--${themeName}-home-strip-title`, stripTitle);
    root.setProperty(`--${themeName}-home-strip-desc`, stripDesc);
    root.setProperty(`--${themeName}-home-strip-index`, stripIndex);
  }

  function parseColorToRgb(value) {
    if (typeof value !== "string") return null;
    const color = value.trim();

    const hex = color.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
    if (hex) {
      const raw = hex[1];
      if (raw.length === 3) {
        return {
          r: parseInt(raw[0] + raw[0], 16),
          g: parseInt(raw[1] + raw[1], 16),
          b: parseInt(raw[2] + raw[2], 16),
        };
      }
      return {
        r: parseInt(raw.slice(0, 2), 16),
        g: parseInt(raw.slice(2, 4), 16),
        b: parseInt(raw.slice(4, 6), 16),
      };
    }

    const rgb = color.match(/^rgba?\(([^)]+)\)$/i);
    if (!rgb) return null;
    const parts = rgb[1].split(",").map((part) => part.trim());
    if (parts.length < 3) return null;

    const toChannel = (input) => {
      if (input.endsWith("%")) {
        const pct = Number(input.slice(0, -1));
        if (!Number.isFinite(pct)) return null;
        return Math.round((Math.max(0, Math.min(100, pct)) / 100) * 255);
      }
      const n = Number(input);
      if (!Number.isFinite(n)) return null;
      return Math.round(Math.max(0, Math.min(255, n)));
    };

    const r = toChannel(parts[0]);
    const g = toChannel(parts[1]);
    const b = toChannel(parts[2]);
    if (r === null || g === null || b === null) return null;
    return { r, g, b };
  }

  function relativeLuminance({ r, g, b }) {
    const toLinear = (channel) => {
      const v = channel / 255;
      return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    };
    return 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
  }

  function pickReadableTextColor(backgroundColor, fallback) {
    const rgb = parseColorToRgb(backgroundColor);
    if (!rgb) return fallback || "#111111";

    const luminance = relativeLuminance(rgb);
    const contrastWithDark = (luminance + 0.05) / 0.05;
    const contrastWithLight = 1.05 / (luminance + 0.05);
    return contrastWithDark >= contrastWithLight ? "#111111" : "#f5f5f5";
  }

  function applyThemeConfig(config) {
    const light = config?.themes?.light;
    const dark = config?.themes?.dark;
    const lightGlobalSelection =
      config?.selection?.light && typeof config.selection.light === "object" ? config.selection.light : null;
    const darkGlobalSelection =
      config?.selection?.dark && typeof config.selection.dark === "object" ? config.selection.dark : null;
    const lightGlobalHomeStripText =
      config?.homeStripText?.light && typeof config.homeStripText.light === "object" ? config.homeStripText.light : null;
    const darkGlobalHomeStripText =
      config?.homeStripText?.dark && typeof config.homeStripText.dark === "object" ? config.homeStripText.dark : null;

    if (light) {
      const lightLocalSelection = light?.selection && typeof light.selection === "object" ? light.selection : null;
      const lightLocalHomeStripText =
        light?.homeStripText && typeof light.homeStripText === "object" ? light.homeStripText : null;
      setThemeVariables("light", {
        ...light,
        selection: {
          ...(lightGlobalSelection || {}),
          ...(lightLocalSelection || {}),
        },
        homeStripText: {
          ...(lightGlobalHomeStripText || {}),
          ...(lightLocalHomeStripText || {}),
        },
      });
    }
    if (dark) {
      const darkLocalSelection = dark?.selection && typeof dark.selection === "object" ? dark.selection : null;
      const darkLocalHomeStripText =
        dark?.homeStripText && typeof dark.homeStripText === "object" ? dark.homeStripText : null;
      setThemeVariables("dark", {
        ...dark,
        selection: {
          ...(darkGlobalSelection || {}),
          ...(darkLocalSelection || {}),
        },
        homeStripText: {
          ...(darkGlobalHomeStripText || {}),
          ...(darkLocalHomeStripText || {}),
        },
      });
    }
  }

  function setTheme(theme) {
    document.body.dataset.theme = theme === "light" ? "light" : "dark";
    try {
      sessionStorage.setItem(THEME_KEY, document.body.dataset.theme);
    } catch (error) {
      console.warn("无法存储主题偏好。", error);
    }
  }

  function getTheme() {
    return document.body.dataset.theme === "light" ? "light" : "dark";
  }

  function initTheme(config) {
    let selected = config?.defaultTheme === "light" ? "light" : "dark";
    try {
      const saved = sessionStorage.getItem(THEME_KEY);
      if (saved === "light" || saved === "dark") {
        selected = saved;
      }
    } catch (error) {
      console.warn("无法读取主题偏好。", error);
    }
    setTheme(selected);
  }

  function syncThemeToggleIcon(btn) {
    const img = btn.querySelector(".theme-toggle-icon");
    if (!img) return;
    const images = btn._themeToggleImages;
    if (!images) return;
    const current = getTheme();
    const src = current === "dark" ? images.dark || images.light : images.light || images.dark;
    if (!src) return;
    if (img.getAttribute("src") !== src) {
      img.src = src;
    }
    if (img.hidden) {
      img.hidden = false;
    }
  }

  function setupThemeToggle() {
    const btn = document.getElementById("theme-toggle");
    if (!btn) return;
    const img = btn.querySelector(".theme-toggle-icon");
    const text = btn.querySelector(".theme-toggle-text");

    const sync = () => {
      const current = getTheme();
      const label = current === "dark" ? "切换到浅色主题" : "切换到深色主题";
      btn.setAttribute("aria-label", label);
      btn.title = label;

      if (btn._themeToggleImages && (btn._themeToggleImages.light || btn._themeToggleImages.dark)) {
        if (text) text.hidden = true;
        syncThemeToggleIcon(btn);
      } else {
        // 未配图：隐藏文字与 img，回退到默认的 ::before 月亮图标按钮
        if (img) img.hidden = true;
        if (text) text.hidden = true;
      }
    };

    btn.addEventListener("click", () => {
      setTheme(getTheme() === "dark" ? "light" : "dark");
      sync();
    });

    sync();
  }

  function applyThemeToggleButton(config) {
    const btn = document.getElementById("theme-toggle");
    if (!btn) return;

    const cfg =
      config?.themeToggleButton && typeof config.themeToggleButton === "object"
        ? config.themeToggleButton
        : {};
    const img = btn.querySelector(".theme-toggle-icon");
    const text = btn.querySelector(".theme-toggle-text");
    btn._themeToggleImages = null;
    btn.classList.remove("image-mode");

    const resolve = (value) => {
      if (typeof value !== "string" || !value.trim()) return "";
      const url = resolveAssetUrl(value.trim(), { config });
      return url || "";
    };
    const fallback = resolve(cfg.image);
    const lightSrc = resolve(cfg.images?.light) || fallback;
    const darkSrc = resolve(cfg.images?.dark) || fallback;

    if (cfg.enabled === false || (!lightSrc && !darkSrc)) {
      if (img) {
        img.hidden = true;
        img.removeAttribute("src");
      }
      if (text) text.hidden = true; // 回退到默认 ::before 月亮图标按钮
      return;
    }

    btn._themeToggleImages = { light: lightSrc, dark: darkSrc };
    btn.classList.add("image-mode");
    if (text) text.hidden = true;

    // 尺寸 / 裁切：写成 CSS 变量，交给 CSS 统一渲染
    const setProp = (name, value) => {
      if (typeof value === "string" && value.trim()) {
        btn.style.setProperty(name, value.trim());
      }
    };
    setProp("--ttbtn-size", cfg.size);
    setProp("--ttbtn-fit", cfg.fit);

    syncThemeToggleIcon(btn);
  }

  function applyHeaderImage(config) {
    const pages = document.body.dataset.page || "default";
    const fallback = { src: "./assets/hero-home.svg", fit: "cover", position: "center", ratio: "21 / 8" };

    const parseHeaderEntry = (entry) => {
      if (!entry) return null;
      if (typeof entry === "string") {
        return { src: entry };
      }
      if (typeof entry !== "object") return null;

      const resolved = {
        src: entry.src || entry.url || "",
        fit: entry.fit,
        position: entry.position,
        ratio: entry.ratio,
      };
      return resolved;
    };

    const sanitizeFit = (value) => (value === "contain" ? "contain" : "cover");
    const sanitizePosition = (value) => (typeof value === "string" && value.trim() ? value.trim() : "center");
    const sanitizeRatio = (value) => {
      if (typeof value === "number" && Number.isFinite(value) && value > 0) {
        return String(value);
      }
      if (typeof value !== "string") return "21 / 8";
      const ratioText = value.trim();
      if (/^\d+(\.\d+)?\s*\/\s*\d+(\.\d+)?$/.test(ratioText)) return ratioText;
      if (/^\d+(\.\d+)?$/.test(ratioText)) return ratioText;
      return "21 / 8";
    };

    // Support SPA: apply to all hero images with matching page
    document.querySelectorAll("[data-hero-image]").forEach(function (heroImage) {
      var parentSection = heroImage.closest("[data-page]");
      var pageKey = parentSection ? parentSection.getAttribute("data-page") : pages;
      var pageEntry = parseHeaderEntry(config?.headerImages?.[pageKey]);
      var defaultEntry = parseHeaderEntry(config?.headerImages?.default);
      var merged = Object.assign({}, fallback, defaultEntry || {}, pageEntry || {});
      heroImage.src = resolveAssetUrl(merged.src || fallback.src, { config });
      heroImage.style.setProperty("--hero-fit", sanitizeFit(merged.fit));
      heroImage.style.setProperty("--hero-position", sanitizePosition(merged.position));
      heroImage.style.setProperty("--hero-ratio", sanitizeRatio(merged.ratio));
    });
  }

  function applyPageHeroText(config) {
    const flatTexts = config?.pageHeroTexts && typeof config.pageHeroTexts === "object" ? config.pageHeroTexts : {};
    const nestedTexts =
      config?.pages?.heroTexts && typeof config.pages.heroTexts === "object" ? config.pages.heroTexts : {};
    const texts = Object.keys(flatTexts).length ? flatTexts : nestedTexts;

    if (document.getElementById("spa-main")) {
      // SPA mode: apply text to each section's hero
      document.querySelectorAll("[data-page]").forEach(function (section) {
        var pageKey = section.getAttribute("data-page");
        var pt = texts[pageKey];
        if (!pt || typeof pt !== "object") return;
        var sectionHero = section.querySelectorAll("[data-page-hero]");
        if (!sectionHero.length) return;
        var setHero = function (slot, value) {
          if (typeof value !== "string") return;
          var t = value.trim();
          if (!t) return;
          section.querySelectorAll('[data-page-hero="' + slot + '"]').forEach(function (el) {
            el.textContent = t;
          });
        };
        setHero("eyebrow", pt.eyebrow);
        setHero("title", pt.title);
        setHero("description", pt.description ?? pt.desc);
      });
    } else {
      // Legacy mode: single page
      var page = document.body?.dataset?.page;
      if (!page) return;
      var pageText = texts[page];
      if (!pageText || typeof pageText !== "object") return;
      var setHero = function (slot, value) {
        if (typeof value !== "string") return;
        var t = value.trim();
        if (!t) return;
        document.querySelectorAll('[data-page-hero="' + slot + '"]').forEach(function (el) {
          el.textContent = t;
        });
      };
      setHero("eyebrow", pageText.eyebrow);
      setHero("title", pageText.title);
      setHero("description", pageText.description ?? pageText.desc);
    }
  }

  function applySiteText(config) {
    const setSiteText = (key, value) => {
      if (typeof value !== "string") return;
      const text = value.trim();
      if (!text) return;
      document.querySelectorAll(`[data-site='${key}']`).forEach((el) => {
        el.textContent = text;
      });
    };

    setSiteText("title", config.title);
    setSiteText("eyebrow", config.eyebrow);
    setSiteText("subtitle", config.subtitle);

    const footer = config?.footer && typeof config.footer === "object" ? config.footer : {};
    setSiteText("footer-line1", footer.line1 ?? config?.footerLine1);
    setSiteText("footer-line2", footer.line2 ?? config?.footerLine2);
  }

  // 导航栏上的图片按钮（画廊 / 关于）共用一套：无背景块无描边，只显示图片本体，
  // 图片、尺寸、裁切、链接都读 data/site.json 里的同名字段。
  function applyImageNavButton(selector, siteConfig, buttonCfg, fallbackLabel) {
    const buttons = document.querySelectorAll(selector);
    if (!buttons.length) return;

    buttons.forEach((btn) => {
      if (buttonCfg?.enabled === false) {
        btn.hidden = true;
        return;
      }

      if (typeof buttonCfg?.href === "string" && buttonCfg.href.trim()) {
        btn.href = buttonCfg.href.trim();
      }

      const img = btn.querySelector("img");
      const imageValue = typeof buttonCfg?.image === "string" ? buttonCfg.image.trim() : "";
      if (img) {
        const url = resolveAssetUrl(imageValue, { config: siteConfig });
        if (url) {
          img.src = url;
          img.alt = "";
        }
      }

      // 图标按钮没有文字，label 用作可访问名 + 悬浮提示
      const labelText =
        (typeof buttonCfg?.label === "string" && buttonCfg.label.trim()) ||
        btn.getAttribute("aria-label") ||
        fallbackLabel;
      btn.setAttribute("aria-label", labelText);
      btn.setAttribute("title", labelText);

      // 尺寸 / 裁切：写成 CSS 变量，交给 CSS 统一渲染，改 site.json 即可换样式
      const setProp = (name, value) => {
        if (typeof value === "string" && value.trim()) {
          btn.style.setProperty(name, value.trim());
        }
      };
      setProp("--gbtn-size", buttonCfg?.size);
      setProp("--gbtn-fit", buttonCfg?.fit);
    });
  }

  function asConfigObject(value) {
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
  }

  function applyGalleryButton(config) {
    applyImageNavButton(".nav-gallery-btn", config, asConfigObject(config?.galleryButton), "画廊");
  }

  function applyAboutButton(config) {
    applyImageNavButton(".nav-about-btn", config, asConfigObject(config?.aboutButton), "关于");
  }

  function markActiveNav() {
    const page = document.body.dataset.page;
    if (!page) return;
    const nav = document.querySelector(`[data-nav='${page}']`);
    if (nav) nav.classList.add("active");
  }

  function escapeHtml(input) {
    return input
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  }

  function parseFrontMatter(markdown) {
    const trimmed = markdown.replace(/^\uFEFF/, "");
    if (!trimmed.startsWith("---\n")) {
      return { meta: {}, body: trimmed };
    }

    const end = trimmed.indexOf("\n---", 4);
    if (end < 0) {
      return { meta: {}, body: trimmed };
    }

    const header = trimmed.slice(4, end).trim();
    const body = trimmed.slice(end + 4).trimStart();
    const meta = {};

    header.split(/\r?\n/).forEach((line) => {
      const sep = line.indexOf(":");
      if (sep < 0) return;
      const key = line.slice(0, sep).trim();
      const value = line.slice(sep + 1).trim();
      meta[key] = value;
    });

    return { meta, body };
  }

  function createMathPlaceholder(latexRaw, displayMode) {
    const latex = String(latexRaw || "").trim();
    if (!latex) return "";
    const escapedLatex = escapeHtml(latex);
    const cls = displayMode ? "math-block" : "math-inline";
    return `<span class="${cls}" data-latex="${escapedLatex}">${escapedLatex}</span>`;
  }

  function extractInlineMathPlaceholders(text) {
    const placeholders = [];
    const replaced = String(text || "").replace(/(^|[^\\])\$(?!\$)([^\n$]+?)\$(?!\$)/g, (m, prefix, expr) => {
      const placeholder = `\uE110${placeholders.length}\uE111`;
      placeholders.push(createMathPlaceholder(expr, false));
      return `${prefix}${placeholder}`;
    });
    return { text: replaced, placeholders };
  }

  function inlineMarkdown(raw) {
    const extracted = extractInlineMathPlaceholders(raw);
    let rendered = extracted.text
      .replace(/->([\s\S]*?)<-/g, '<div class="center-wrap">$1</div>')
      .replace(/-&gt;([\s\S]*?)&lt;-/g, '<div class="center-wrap">$1</div>')
      .replace(/(?:!\[([^\]]*)\])?\+\>([\s\S]*?)\<\+/g, (_m, summary, content) => {
        const label = (summary || '').trim() || '展开折叠内容';
        return '<details class="foldable"><summary>' + label + '</summary>' + content + '</details>';
      })
      .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_m, alt, src) => {
        const resolvedSrc = escapeHtml(resolveAssetUrl(src));
        const isVideo = /\.(mp4|webm|mov)$/i.test(src);
        if (isVideo) {
          return `<video controls preload="metadata" class="video-embed" src="${resolvedSrc}#t=0.001"></video>`;
        }
        return `<img src="${resolvedSrc}" alt="${alt}" loading="lazy" />`;
      })
      .replace(/&lt;(https?:\/\/[^<>\s]+)&gt;/g, '<a href="$1" target="_blank" rel="noreferrer noopener">$1</a>')
      .replace(/`([^`]+)`/g, "<code>$1</code>")
      .replace(/==([^=]+)==/g, "<mark>$1</mark>")
      .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
      .replace(/\*([^*]+)\*/g, "<em>$1</em>")
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer noopener">$1</a>');

    extracted.placeholders.forEach((html, idx) => {
      rendered = rendered.replace(`\uE110${idx}\uE111`, html);
    });
    return rendered;
  }

  function normalizeCodeLang(raw) {
    const text = String(raw || "").trim().toLowerCase();
    if (!text) return "plain";
    if (text === "c#" || text === "cs" || text === "csharp") return "csharp";
    if (text === "c++" || text === "cpp" || text === "cc" || text === "cxx") return "cpp";
    if (text === "py" || text === "python") return "python";
    if (text === "htm" || text === "html" || text === "xml") return "html";
    if (text === "hlsl") return "hlsl";
    return text;
  }

  function escapeRegExp(input) {
    return String(input).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  function highlightCode(code, lang) {
    const normalizedLang = normalizeCodeLang(lang);

    if (typeof hljs !== "undefined" && normalizedLang !== "plain") {
      try {
        const result = hljs.highlight(code, { language: normalizedLang, ignoreIllegals: true });
        return result.value.replace(/<span class="(hljs-[^"]+)">/g, (_m, cls) => {
          const map = {
            "hljs-keyword": "tok-kw",
            "hljs-string": "tok-str",
            "hljs-number": "tok-num",
            "hljs-comment": "tok-comment",
            "hljs-built_in": "tok-kw",
            "hljs-type": "tok-kw",
            "hljs-literal": "tok-kw",
            "hljs-title": "tok-tag",
            "hljs-attr": "tok-attr",
            "hljs-meta": "tok-comment",
            "hljs-meta-keyword": "tok-kw",
            "hljs-meta-string": "tok-str",
            "hljs-symbol": "tok-str",
            "hljs-section": "tok-tag",
            "hljs-variable": "tok-kw",
            "hljs-template-variable": "tok-str",
            "hljs-doctag": "tok-comment",
            "hljs-addition": "tok-str",
            "hljs-deletion": "tok-str",
            "hljs-selector-tag": "tok-kw",
            "hljs-selector-id": "tok-tag",
            "hljs-selector-class": "tok-attr",
          };
          return map[cls] ? `<span class="${map[cls]}">` : "<span>";
        });
      } catch (_e) {
        // fall through to custom highlighter
      }
    }

    const protectedHtml = new Map();
    let tokenCounter = 0;
    let text = escapeHtml(code);

    const tokenKey = () => {
      const n = tokenCounter++;
      let x = n;
      let letters = "";
      do {
        letters = String.fromCharCode(65 + (x % 26)) + letters;
        x = Math.floor(x / 26) - 1;
      } while (x >= 0);
      return `\uE000${letters}\uE001`;
    };

    const protect = (pattern, cssToken) => {
      text = text.replace(pattern, (m) => {
        const key = tokenKey();
        protectedHtml.set(key, `<span class="tok-${cssToken}">${m}</span>`);
        return key;
      });
    };

    const highlightKeywords = (keywords) => {
      if (!keywords.length) return;
      const re = new RegExp(`\\b(${keywords.map(escapeRegExp).join("|")})\\b`, "g");
      text = text.replace(re, '<span class="tok-kw">$1</span>');
    };

    if (normalizedLang === "csharp") {
      protect(/\/\*[\s\S]*?\*\//g, "comment");
      protect(/\/\/[^\n]*/g, "comment");
      protect(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/g, "str");
      highlightKeywords([
        "public",
        "private",
        "protected",
        "internal",
        "class",
        "struct",
        "enum",
        "interface",
        "namespace",
        "using",
        "void",
        "int",
        "float",
        "double",
        "decimal",
        "string",
        "bool",
        "var",
        "new",
        "return",
        "if",
        "else",
        "switch",
        "case",
        "for",
        "foreach",
        "while",
        "do",
        "break",
        "continue",
        "null",
        "true",
        "false",
        "static",
        "readonly",
        "const",
        "this",
        "base",
      ]);
    } else if (normalizedLang === "cpp") {
      protect(/\/\*[\s\S]*?\*\//g, "comment");
      protect(/\/\/[^\n]*/g, "comment");
      protect(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/g, "str");
      highlightKeywords([
        "int",
        "float",
        "double",
        "char",
        "bool",
        "void",
        "class",
        "struct",
        "enum",
        "namespace",
        "template",
        "typename",
        "auto",
        "const",
        "constexpr",
        "static",
        "public",
        "private",
        "protected",
        "virtual",
        "override",
        "new",
        "delete",
        "return",
        "if",
        "else",
        "switch",
        "case",
        "for",
        "while",
        "do",
        "break",
        "continue",
        "nullptr",
        "true",
        "false",
      ]);
    } else if (normalizedLang === "hlsl") {
      protect(/\/\*[\s\S]*?\*\//g, "comment");
      protect(/\/\/[^\n]*/g, "comment");
      protect(/"(?:\\.|[^"\\])*"/g, "str");
      highlightKeywords([
        "float",
        "float2",
        "float3",
        "float4",
        "float3x3",
        "float4x4",
        "half",
        "int",
        "uint",
        "bool",
        "Texture2D",
        "SamplerState",
        "cbuffer",
        "struct",
        "return",
        "if",
        "else",
        "for",
        "while",
        "static",
        "const",
        "true",
        "false",
      ]);
    } else if (normalizedLang === "python") {
      protect(/#([^\n]*)/g, "comment");
      protect(/("""[\s\S]*?"""|'''[\s\S]*?'''|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')/g, "str");
      highlightKeywords([
        "def",
        "class",
        "import",
        "from",
        "as",
        "if",
        "elif",
        "else",
        "for",
        "while",
        "try",
        "except",
        "finally",
        "with",
        "return",
        "yield",
        "lambda",
        "pass",
        "break",
        "continue",
        "True",
        "False",
        "None",
      ]);
    } else if (normalizedLang === "html") {
      protect(/&lt;!--[\s\S]*?--&gt;/g, "comment");
      text = text.replace(/(&lt;\/?)([a-zA-Z][\w:-]*)([\s\S]*?)(\/?&gt;)/g, (_m, p1, name, attrs, p4) => {
        const highlightedAttrs = attrs
          .replace(/([a-zA-Z_:][\w:.-]*)(=)/g, '<span class="tok-attr">$1</span>$2')
          .replace(/(&quot;[^&]*?&quot;|'[^']*?')/g, '<span class="tok-str">$1</span>');
        return `${p1}<span class="tok-tag">${name}</span>${highlightedAttrs}${p4}`;
      });
    }

    for (const [key, value] of protectedHtml.entries()) {
      text = text.split(key).join(value);
    }

    return text;
  }

  function markdownToHtml(markdownText) {
    const text = String(markdownText || "").replace(/\r\n/g, "\n");

    // Pre-process foldable blocks: +>...<+ (multi-line, supports nesting)
    const foldableBlocks = [];
    let foldResult = '';
    let depth = 0;
    let segStart = 0;
    let foldLabel = '';
    let contentStart = -1;

    function foldFlush(end) {
      if (end > segStart) foldResult += text.slice(segStart, end);
    }

    for (let pos = 0; pos < text.length - 1; pos++) {
      if (text[pos] === '+' && text[pos + 1] === '>') {
        if (depth === 0) {
          foldFlush(pos);
          const lm = foldResult.match(/!\[([^\]]*)\]$/);
          foldLabel = lm ? lm[1].trim() : '展开折叠内容';
          if (lm) foldResult = foldResult.slice(0, -lm[0].length);
          contentStart = pos + 2;
        }
        depth++;
        pos++;
        continue;
      }
      if (text[pos] === '<' && text[pos + 1] === '+') {
        if (depth > 0) {
          depth--;
          if (depth === 0) {
            const inner = text.slice(contentStart, pos);
            const innerHtml = markdownToHtml(inner);
            const idx = foldableBlocks.length;
            foldableBlocks.push('<details class="foldable"><summary>' + foldLabel + '</summary>' + innerHtml + '</details>');
            foldResult += ' ' + idx + ' ';
            segStart = pos + 2;
          }
        }
        pos++;
        continue;
      }
    }
    foldFlush(text.length);
    const textWithoutFoldables = foldResult;

    const lines = textWithoutFoldables.split("\n");
    const out = [];
    let inCode = false;
    let codeLang = "plain";
    let codeBuffer = [];
    let inUl = false;
    let inOl = false;

    const parseTableRow = (row) => {
      const trimmed = row.trim();
      if (!trimmed.startsWith("|") || !trimmed.endsWith("|")) return [];
      const inner = trimmed.slice(1, -1);
      const cells = [];
      let current = "";
      let inCode = false;
      for (let i = 0; i < inner.length; i++) {
        const ch = inner[i];
        if (ch === "`") {
          inCode = !inCode;
          current += ch;
        } else if (ch === "|" && !inCode) {
          cells.push(current);
          current = "";
        } else {
          current += ch;
        }
      }
      cells.push(current);
      return cells;
    };

    const wrapCodeLines = (codeHtml) => {
      const lines = codeHtml.split("\n");
      if (lines.length > 1 && lines[lines.length - 1] === "") lines.pop();
      return lines.map((line) => `<span class="code-line">${line || " "}</span>`).join("\n");
    };

    const closeLists = () => {
      if (inUl) {
        out.push("</ul>");
        inUl = false;
      }
      if (inOl) {
        out.push("</ol>");
        inOl = false;
      }
    };

    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i];
      const safe = escapeHtml(line);
      const fenceMatch = line.match(/^```(.*)$/);

      if (fenceMatch) {
        closeLists();
        if (!inCode) {
          inCode = true;
          codeLang = normalizeCodeLang(fenceMatch[1]);
          codeBuffer = [];
        } else {
          const highlighted = highlightCode(codeBuffer.join("\n"), codeLang);
          out.push(`<pre class="code-block" data-lang="${codeLang}"><code class="language-${codeLang}">${wrapCodeLines(highlighted)}</code></pre>`);
          inCode = false;
          codeLang = "plain";
          codeBuffer = [];
        }
        continue;
      }

      if (inCode) {
        codeBuffer.push(line);
        continue;
      }

      const mathDelim =
        line.match(/^\s*\$\$(.*)$/) || line.match(/^\s*\\\[(.*)$/);
      if (mathDelim) {
        closeLists();
        const isBracketStyle = line.trimStart().startsWith("\\[");
        const endPattern = isBracketStyle ? /(.*)\\\]\s*$/ : /(.*)\$\$\s*$/;
        const first = mathDelim[1] || "";
        const mathLines = [];
        let closed = false;

        if (first && endPattern.test(first)) {
          const match = first.match(endPattern);
          mathLines.push((match && match[1]) || "");
          closed = true;
        } else if (first) {
          mathLines.push(first);
        }

        if (!closed) {
          while (i + 1 < lines.length) {
            i += 1;
            const current = lines[i];
            const endMatch = current.match(endPattern);
            if (endMatch) {
              if (endMatch[1]) {
                mathLines.push(endMatch[1]);
              }
              closed = true;
              break;
            }
            mathLines.push(current);
          }
        }

        out.push(createMathPlaceholder(mathLines.join("\n"), true));
        continue;
      }

      if (line.trim() === "") {
        closeLists();
        continue;
      }

      if (/^(\s*)([-*_])(?:\s*\2){2,}\s*$/.test(line)) {
        closeLists();
        out.push("<hr />");
        continue;
      }

      if (/^#{1,4}\s/.test(line)) {
        closeLists();
        const m = safe.match(/^(#{1,4})\s(.+)$/);
        if (m) {
          const level = m[1].length;
          out.push(`<h${level}>${inlineMarkdown(m[2])}</h${level}>`);
        }
        continue;
      }

      if (/^>\s?/.test(line)) {
        closeLists();
        const quoteLines = [];
        while (i < lines.length) {
          const current = lines[i];
          if (/^>\s?/.test(current)) {
            quoteLines.push(current.replace(/^>\s?/, ""));
            i += 1;
            continue;
          }
          if (current.trim() === "" && /^>\s?/.test(lines[i + 1] || "")) {
            quoteLines.push("");
            i += 1;
            continue;
          }
          break;
        }
        i -= 1;
        out.push(`<blockquote>${markdownToHtml(quoteLines.join("\n"))}</blockquote>`);
        continue;
      }

      if (/^\d+\.\s+/.test(line)) {
        if (!inOl) {
          closeLists();
          out.push("<ol>");
          inOl = true;
        }
        out.push(`<li>${inlineMarkdown(safe.replace(/^\d+\.\s+/, ""))}</li>`);
        continue;
      }

      if (/^[-*]\s+/.test(line)) {
        if (!inUl) {
          closeLists();
          out.push("<ul>");
          inUl = true;
        }
        out.push(`<li>${inlineMarkdown(safe.replace(/^[-*]\s+/, ""))}</li>`);
        continue;
      }

      if (/^\|.+\|$/.test(line)) {
        closeLists();
        const tableRows = [];
        while (i < lines.length) {
          const cur = lines[i];
          if (!/^\|.+\|$/.test(cur)) break;
          tableRows.push(cur);
          i += 1;
        }
        i -= 1;

        if (tableRows.length >= 2 && /^[\s:|,-]+$/.test(tableRows[1].replace(/\|/g, ""))) {
          const headerCells = parseTableRow(tableRows[0]);
          const alignRow = tableRows[1];
          const aligns = parseTableRow(alignRow).map((cell) => {
            const t = cell.trim();
            if (/^:-+:$/.test(t)) return '"center"';
            if (/^:-+$/.test(t)) return '"left"';
            if (/^-+:$/.test(t)) return '"right"';
            return '""';
          });

          out.push("<table>");
          out.push("<thead><tr>");
          headerCells.forEach((cell, idx) => {
            const a = aligns[idx] || '""';
            out.push(`<th align=${a}>${inlineMarkdown(escapeHtml(cell.trim()))}</th>`);
          });
          out.push("</tr></thead>");
          out.push("<tbody>");
          for (let r = 2; r < tableRows.length; r += 1) {
            const cells = parseTableRow(tableRows[r]);
            out.push("<tr>");
            cells.forEach((cell, idx) => {
              const a = aligns[idx] || '""';
              out.push(`<td align=${a}>${inlineMarkdown(escapeHtml(cell.trim()))}</td>`);
            });
            out.push("</tr>");
          }
          out.push("</tbody></table>");
        } else {
          // Not a valid table — render each row as a paragraph
          tableRows.forEach((row) => {
            out.push(`<p>${inlineMarkdown(escapeHtml(row))}</p>`);
          });
        }
        continue;
      }

      closeLists();
      out.push(`<p>${inlineMarkdown(safe)}</p>`);
    }

    if (inCode) {
      const highlighted = highlightCode(codeBuffer.join("\n"), codeLang);
      out.push(`<pre class="code-block" data-lang="${codeLang}"><code class="language-${codeLang}">${wrapCodeLines(highlighted)}</code></pre>`);
    }
    closeLists();
    var result = out.join("\n");
    // Restore foldable blocks
    if (foldableBlocks.length) {
      result = result.replace(/ (\d+) /g, function (_m, idx) {
        return foldableBlocks[parseInt(idx, 10)] || '';
      });
    }
    return result;
  }

  function tagsFromText(value) {
    if (!value) return [];
    return value
      .split(/[|,;/]/)
      .map((part) => part.trim())
      .filter(Boolean);
  }

  function parseTag(str) {
    var m = String(str || '').match(/^\[(#[\da-fA-F]{3,8})\](.*)/);
    if (m) return { name: m[2].trim(), color: m[1] };
    return { name: str, color: null };
  }

  function isHiddenMeta(value) {
    const n = Number.parseInt(String(value || "0").trim(), 10);
    return Number.isFinite(n) && n === 1;
  }

  function parseMiMeta(value) {
    const text = String(value || "").trim();
    if (!text) return null;
    const parts = text.split("|");
    const question = String(parts[0] || "").trim();
    const id = String(parts[1] || "").trim();
    if (!question || !id) return null;
    return { question, id, raw: `${question}|${id}` };
  }

  function createEmptyTip(text) {
    const node = document.createElement("div");
    node.className = "empty-tip";
    node.textContent = text;
    return node;
  }

  function ensureImageLightbox() {
    let mask = document.getElementById("image-lightbox");
    if (mask) return mask;

    mask = document.createElement("div");
    mask.id = "image-lightbox";
    mask.className = "image-lightbox";
    mask.setAttribute("aria-hidden", "true");

    const closeBtn = document.createElement("button");
    closeBtn.type = "button";
    closeBtn.className = "image-lightbox-close";
    closeBtn.setAttribute("aria-label", "关闭大图");
    closeBtn.textContent = "×";

    const prevBtn = document.createElement("button");
    prevBtn.type = "button";
    prevBtn.className = "image-lightbox-nav image-lightbox-prev";
    prevBtn.setAttribute("aria-label", "上一张");
    prevBtn.innerHTML = "‹";

    const nextBtn = document.createElement("button");
    nextBtn.type = "button";
    nextBtn.className = "image-lightbox-nav image-lightbox-next";
    nextBtn.setAttribute("aria-label", "下一张");
    nextBtn.innerHTML = "›";

    const img = document.createElement("img");
    img.className = "image-lightbox-img";
    img.alt = "";

    // 加载占位：缩略图铺在大图那一块矩形上（inset:0，尺寸严格等于大图），
    // 原图流式刷出来的部分会盖在它上面，没刷到的部分露出模糊底，不会空白。
    const ph = document.createElement("div");
    ph.className = "image-lightbox-ph";
    ph.setAttribute("aria-hidden", "true");
    ph.hidden = true;

    // 大图外层：包住图片，让右下角的 brandIcon 水印贴着「大图」自身定位
    const stage = document.createElement("div");
    stage.className = "image-lightbox-stage";
    stage.append(ph, img);

    const brandMark = document.createElement("span");
    brandMark.className = "image-lightbox-brand";
    brandMark.setAttribute("aria-hidden", "true");

    // 水印开关 / 大小 / 透明度：读 data/site.json → imageLightbox
    const brandCfg =
      activeSiteConfig?.imageLightbox && typeof activeSiteConfig.imageLightbox === "object"
        ? activeSiteConfig.imageLightbox
        : {};
    if (brandCfg.enabled === false) {
      brandMark.hidden = true;
    } else {
      const setBrandVar = (name, value) => {
        if (typeof value === "string" && value.trim()) {
          mask.style.setProperty(name, value.trim());
        } else if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
          mask.style.setProperty(name, String(value));
        }
      };
      setBrandVar("--lb-brand-size", brandCfg.size);
      setBrandVar("--lb-brand-opacity", brandCfg.opacity);
      setBrandVar("--lb-brand-offset", brandCfg.offset);
      stage.appendChild(brandMark);
    }

    const caption = document.createElement("p");
    caption.className = "image-lightbox-caption";
    caption.hidden = true;

    var gallerySources = [];
    var galleryIndex = 0;

    function updateNav() {
      var showNav = gallerySources.length > 1;
      prevBtn.style.display = showNav ? "" : "none";
      nextBtn.style.display = showNav ? "" : "none";
      if (showNav) {
        prevBtn.classList.toggle("disabled", galleryIndex <= 0);
        nextBtn.classList.toggle("disabled", galleryIndex >= gallerySources.length - 1);
      }
    }

    function showImage(index) {
      if (index < 0 || index >= gallerySources.length) return;
      galleryIndex = index;
      var entry = gallerySources[index];

      const fullSrc = String(entry.src || "").trim();
      const thumbSrc = String(entry.thumb || "").trim();

      // 缩略图铺在下面当底：它和原图同一块矩形，只负责填住还没刷出来的部分
      if (thumbSrc && thumbSrc !== fullSrc) {
        ph.style.backgroundImage = `url("${thumbSrc}")`;
        ph.classList.remove("is-done");
        ph.hidden = false;
      } else {
        ph.style.backgroundImage = "";
        ph.hidden = true;
      }

      // 关键：原图直接塞给 <img>，让浏览器自己流式解码，
      // 就能像普通网页那样自上而下一条一条刷出来，而不用等整张下完。
      // （之前用 new Image() 预载、完成后再换 src，反而把这个过程藏掉了。）
      img.onload = () => {
        ph.classList.add("is-done"); // 原图完整了，底下的模糊占位淡出
      };
      img.onerror = () => {
        ph.classList.remove("is-done"); // 原图失败就留着占位，至少不是空白
      };
      if (fullSrc) {
        img.src = fullSrc;
      } else {
        img.removeAttribute("src");
      }

      img.alt = entry.alt || "大图预览";
      if (entry.alt) {
        caption.textContent = entry.alt;
        caption.hidden = false;
      } else {
        caption.textContent = "";
        caption.hidden = true;
      }
      updateNav();
    }

    function goPrev() {
      if (galleryIndex > 0) showImage(galleryIndex - 1);
    }

    function goNext() {
      if (galleryIndex < gallerySources.length - 1) showImage(galleryIndex + 1);
    }

    mask.append(closeBtn, prevBtn, stage, nextBtn, caption);
    document.body.appendChild(mask);

    const close = () => {
      mask.classList.remove("open");
      mask.setAttribute("aria-hidden", "true");
      document.body.classList.remove("lightbox-open");
      img.removeAttribute("src");
      img.alt = "";
      img.onload = null;
      img.onerror = null;
      ph.hidden = true;
      ph.classList.remove("is-done");
      ph.style.backgroundImage = "";
      caption.textContent = "";
      caption.hidden = true;
      gallerySources = [];
      galleryIndex = 0;
    };

    closeBtn.addEventListener("click", close);
    mask.addEventListener("click", (event) => {
      if (event.target === mask) close();
    });
    prevBtn.addEventListener("click", goPrev);
    nextBtn.addEventListener("click", goNext);

    window.addEventListener("keydown", (event) => {
      if (!mask.classList.contains("open")) return;
      if (event.key === "Escape") { close(); }
      else if (event.key === "ArrowLeft") { goPrev(); }
      else if (event.key === "ArrowRight") { goNext(); }
    });

    mask.openImage = (src, alt, thumb) => {
      gallerySources = [{ src: src, alt: alt || "", thumb: thumb || "" }];
      galleryIndex = 0;
      showImage(0);
      mask.classList.add("open");
      mask.setAttribute("aria-hidden", "false");
      document.body.classList.add("lightbox-open");
    };

    mask.openGallery = (sources, startIndex) => {
      gallerySources = sources;
      galleryIndex = startIndex || 0;
      showImage(galleryIndex);
      mask.classList.add("open");
      mask.setAttribute("aria-hidden", "false");
      document.body.classList.add("lightbox-open");
    };

    return mask;
  }

  function canBindImageLightbox(img) {
    if (!(img instanceof HTMLImageElement)) return false;
    if (img.dataset.noLightbox === "1") return false;
    if (img.matches(".hero-image, [data-hero-image]")) return false;
    if (img.closest("a, button, .home-title-role-hit, .game-media, #image-lightbox")) return false;

    const src = String(img.currentSrc || img.src || "").trim();
    if (!src) return false;
    return true;
  }

  function setupImageLightbox(root = document) {
    if (!root || typeof root.querySelectorAll !== "function") return;
    const lightbox = ensureImageLightbox();

    root.querySelectorAll("img").forEach((img) => {
      if (img.dataset.lightboxBound === "1") return;
      if (!canBindImageLightbox(img)) return;

      img.dataset.lightboxBound = "1";
      img.classList.add("zoomable-image");
      if (!img.hasAttribute("tabindex")) {
        img.tabIndex = 0;
      }
      if (!img.hasAttribute("role")) {
        img.setAttribute("role", "button");
      }
      if (!img.getAttribute("aria-label")) {
        const hint = img.alt ? `${img.alt}（点击查看大图）` : "点击查看大图";
        img.setAttribute("aria-label", hint);
      }

      const open = (event) => {
        event.preventDefault();
        event.stopPropagation();
        // 大图优先用 data-full-src（网格里显示的是缩略图）；
        // data-thumb-src 作为大图加载期间的模糊占位
        const src = String(img.dataset.fullSrc || img.currentSrc || img.src || "").trim();
        if (!src) return;
        const thumb = String(img.dataset.thumbSrc || "").trim();
        lightbox.openImage(src, img.alt || "", thumb);
      };

      img.addEventListener("click", open);
      img.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") {
          open(event);
        }
      });
    });
  }

  function enhanceCodeBlocks(root = document) {
    if (!root || typeof root.querySelectorAll !== "function") return;

    root.querySelectorAll("pre.code-block").forEach((pre) => {
      if (pre.querySelector(".code-copy-btn")) return;

      const copyBtn = document.createElement("button");
      copyBtn.type = "button";
      copyBtn.className = "code-copy-btn";
      copyBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>';
      copyBtn.setAttribute("aria-label", "复制代码");

      let resetTimer = 0;
      copyBtn.addEventListener("click", async () => {
        const code = pre.querySelector("code");
        const text = code ? code.textContent || "" : "";
        if (!text) return;

        try {
          await navigator.clipboard.writeText(text);
          copyBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>';
        } catch (error) {
          copyBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="15" y1="9" x2="9" y2="15"></line><line x1="9" y1="9" x2="15" y2="15"></line></svg>';
        }

        if (resetTimer) window.clearTimeout(resetTimer);
        resetTimer = window.setTimeout(() => {
          copyBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>';
        }, 1400);
      });

      pre.insertBefore(copyBtn, pre.firstChild);
    });
  }

  function renderMath(root = document) {
    if (!root || typeof root.querySelectorAll !== "function") return;

    root.querySelectorAll(".math-inline[data-latex], .math-block[data-latex]").forEach((node) => {
      const latex = String(node.getAttribute("data-latex") || "");
      if (!latex) return;

      const displayMode = node.classList.contains("math-block");
      if (window.katex && typeof window.katex.render === "function") {
        try {
          window.katex.render(latex, node, {
            throwOnError: false,
            displayMode,
            strict: "ignore",
          });
          return;
        } catch (error) {
          console.warn("KaTeX 渲染失败。", error);
        }
      }

      node.textContent = displayMode ? `$$${latex}$$` : `$${latex}$`;
    });
  }

  window.SiteCommon = {
    loadSiteConfig,
    applyThemeConfig,
    initTheme,
    setupThemeToggle,
    applyHeaderImage,
    applyPageHeroText,
    applyNavGlassConfig,
    applyNavConfig,
    setupBackToTop,
    applySiteText,
    markActiveNav,
    parseFrontMatter,
    markdownToHtml,
    enhanceCodeBlocks,
    renderMath,
    setupImageLightbox,
    ensureImageLightbox,
    parseTag,
    tagsFromText,
    isHiddenMeta,
    parseMiMeta,
    createEmptyTip,
    applyBrandConfig,
    resolveAssetUrl,
    setTheme,
    getTheme,
  };
})();

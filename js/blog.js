const {
  loadSiteConfig,
  applyThemeConfig,
  initTheme,
  setupThemeToggle,
  applyHeaderImage,
  applySiteText,
  markActiveNav,
  createEmptyTip,
  parseFrontMatter,
  tagsFromText,
  parseTag,
  isHiddenMeta,
  parseMiMeta,
  resolveAssetUrl,
} = window.SiteCommon;

const POSTS_INDEX = "./content/blog/posts.json";
const DEFAULT_COVER = "./assets/hero-blog.svg";
const PAGE_SIZE = 5;
const ALL_TAG = "全部";

const grid = document.getElementById("blog-grid");
const pagination = document.getElementById("blog-pagination");
const prevBtn = document.getElementById("blog-prev");
const nextBtn = document.getElementById("blog-next");
const pageInfo = document.getElementById("blog-page-info");

const searchInput = document.getElementById("blog-search-input");
const searchClearBtn = document.getElementById("blog-search-clear");
const tagFilterRoot = document.getElementById("blog-tag-filter");
const filterMeta = document.getElementById("blog-filter-meta");

const state = {
  allPosts: [],
  posts: [],
  page: 1,
  query: "",
  tag: ALL_TAG,
};

function withCacheBust(url) {
  const u = new URL(String(url || ""), window.location.href);
  u.searchParams.set("_v", String(Date.now()));
  return u.toString();
}

function normalizeText(input) {
  return String(input || "").trim().toLowerCase();
}

function getFilterFromQuery() {
  const query = new URLSearchParams(window.location.search);
  const q = (query.get("q") || "").trim();
  const tag = (query.get("tag") || "").trim();
  const page = Number.parseInt(query.get("page") || "1", 10);
  return {
    q,
    tag: tag || ALL_TAG,
    page: Number.isFinite(page) ? page : 1,
  };
}

function syncUrlQuery() {
  const url = new URL(window.location.href);

  if (state.query) {
    url.searchParams.set("q", state.query);
  } else {
    url.searchParams.delete("q");
  }

  if (state.tag && state.tag !== ALL_TAG) {
    url.searchParams.set("tag", state.tag);
  } else {
    url.searchParams.delete("tag");
  }

  if (state.page > 1) {
    url.searchParams.set("page", String(state.page));
  } else {
    url.searchParams.delete("page");
  }

  window.history.replaceState(null, "", url);
}

function matchesPost(post) {
  if (state.tag !== ALL_TAG) {
    const matched = post.tags.some((t) => parseTag(t).name === state.tag);
    if (!matched) return false;
  }

  const q = normalizeText(state.query);
  if (!q) {
    return true;
  }

  const haystack = normalizeText(
    [post.title, post.summary, post.tags.join(" "), post.slug, post.date].join(" ")
  );
  return haystack.includes(q);
}

function getFilteredPosts() {
  return state.allPosts.filter(matchesPost);
}

function uniqueTags(posts) {
  const pool = new Set();
  posts.forEach((post) => post.tags.forEach((tag) => pool.add(parseTag(tag).name)));
  return [...pool].sort((a, b) => a.localeCompare(b, "zh-Hans-CN"));
}

function getTotalPages() {
  const total = Math.ceil(state.posts.length / PAGE_SIZE);
  return total > 0 ? total : 1;
}

function normalizePage(value) {
  const n = Number.parseInt(String(value || ""), 10);
  if (!Number.isFinite(n)) {
    return 1;
  }
  return Math.min(getTotalPages(), Math.max(1, n));
}

function setTagFilter(tag) {
  state.tag = tag || ALL_TAG;
  state.page = 1;
  applyFilters({ syncQuery: true });
}

function renderCard(post) {
  const card = document.createElement("a");
  card.className = "item-card item-card-link";
  card.href = `./blog-post.html?slug=${encodeURIComponent(post.slug)}`;
  card.setAttribute("aria-label", `打开文章：${post.title || post.slug}`);
  card.draggable = false;
  card.setAttribute("draggable", "false");
  card.addEventListener("dragstart", (event) => event.preventDefault());

  var cover = null;
  if (!post.hide_cover || post.hide_cover === "0") {
    cover = document.createElement("img");
    cover.className = "item-cover";
    cover.loading = "lazy";
    cover.alt = `${post.title || post.slug} 头图`;
    cover.src = resolveAssetUrl(post.cover || DEFAULT_COVER);
    cover.draggable = false;
    cover.setAttribute("draggable", "false");
    cover.crossOrigin = "anonymous";
  }

  const body = document.createElement("div");
  body.className = "item-body";

  const meta = document.createElement("p");
  meta.className = "item-meta";
  meta.textContent = post.date || "未填写日期";

  const title = document.createElement("h3");
  title.className = "item-title";
  title.textContent = post.title || post.slug;

  const desc = document.createElement("p");
  desc.className = "item-desc";
  desc.textContent = post.summary || "暂无摘要。";

  const tags = document.createElement("div");
  tags.className = "item-tags";
  if (post.encrypted) {
    const lockChip = document.createElement("span");
    lockChip.className = "blog-tag-chip blog-tag-lock";
    lockChip.textContent = "加密";
    tags.appendChild(lockChip);
  }
  post.tags.forEach((rawTag) => {
    const parsed = parseTag(rawTag);
    const chip = document.createElement("span");
    chip.className = "blog-tag-chip";
    chip.tabIndex = 0;
    chip.setAttribute("role", "button");
    chip.setAttribute("aria-label", `按标签筛选：${parsed.name}`);
    chip.textContent = parsed.name;
    if (parsed.color) chip.style.color = parsed.color;

    chip.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      setTagFilter(tag);
    });

    chip.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        event.stopPropagation();
        setTagFilter(tag);
      }
    });

    tags.appendChild(chip);
  });

  body.append(meta, title, desc, tags);
  if (cover) {
    card.classList.add("has-cover");
    const overlay = document.createElement("div");
    overlay.className = "item-overlay";
    overlay.append(meta, title, desc, tags);
    card.appendChild(cover);
    card.appendChild(overlay);
    // Auto-detect image brightness and set text color
    cover.addEventListener("load", function () {
      try {
        var c = document.createElement("canvas");
        c.width = 1; c.height = 1;
        var ctx = c.getContext("2d");
        ctx.drawImage(cover, 0, 0, 1, 1);
        var d = ctx.getImageData(0, 0, 1, 1).data;
        var brightness = (d[0] * 299 + d[1] * 587 + d[2] * 114) / 1000;
        overlay.classList.toggle("light", brightness > 160);
      } catch(e) {}
    });
    if (cover.complete) cover.dispatchEvent(new Event("load"));
  } else {
    card.appendChild(body);
  }
  return card;
}

async function loadPosts() {
  const indexRes = await fetch(withCacheBust(POSTS_INDEX), { cache: "no-store" });
  if (!indexRes.ok) {
    throw new Error("无法加载 posts.json");
  }

  const index = await indexRes.json();
  const files = Array.isArray(index.posts) ? index.posts : [];

  const loaded = await Promise.allSettled(
    files.map(async (item) => {
      const res = await fetch(withCacheBust(item.file), { cache: "no-store" });
      if (!res.ok) {
        throw new Error(`无法加载 Markdown 文件: ${item.file}`);
      }

      const raw = await res.text();
      const { meta, body } = parseFrontMatter(raw);
      if (isHiddenMeta(meta.hidden ?? item.hidden)) {
        return null;
      }

      const mi = parseMiMeta(meta.MI || meta.mi || "");
      const encRef = String(meta.encRef || item.encRef || "").trim();
      const encrypted = Boolean((item.encrypted || mi) && encRef);

      return {
        slug: item.slug,
        title: meta.title || item.slug,
        date: meta.date || "",
        summary:
          meta.summary ||
          (encrypted
            ? "这是一篇加密文章，请在详情页输入密码查看。"
            : body.slice(0, 120).replace(/\s+/g, " ")),
        tags: tagsFromText(meta.tags),
        cover: meta.cover || DEFAULT_COVER,
        hide_cover: meta.hide_cover,
        encrypted,
        encRef,
        miQuestion: mi?.question || item.miQuestion || "",
        miId: mi?.id || item.miId || "",
      };
    })
  );

  const visible = loaded
    .map((result) => {
      if (result.status === "fulfilled") {
        return result.value;
      }
      console.warn("[blog] 跳过加载失败文章：", result.reason);
      return null;
    })
    .filter(Boolean);
  visible.sort((a, b) => {
    const dateCmp = String(b.date).localeCompare(String(a.date));
    if (dateCmp !== 0) return dateCmp;
    // 同一天时按 slug 倒序（G101_4 排在 G101_3 前面）
    return String(b.slug).localeCompare(String(a.slug));
  });
  return visible;
}

function renderTagFilters() {
  if (!tagFilterRoot) {
    return;
  }

  tagFilterRoot.replaceChildren();
  const tags = uniqueTags(state.allPosts);
  const options = [ALL_TAG, ...tags];

  options.forEach((value) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = `filter-btn ${state.tag === value ? "active" : ""}`;
    btn.textContent = value;
    btn.addEventListener("click", () => setTagFilter(value));
    tagFilterRoot.appendChild(btn);
  });
}

function renderFilterMeta() {
  if (!filterMeta) {
    return;
  }

  const parts = [`共 ${state.posts.length} 篇`];
  if (state.tag !== ALL_TAG) {
    parts.push(`标签：${state.tag}`);
  }
  if (state.query) {
    parts.push(`搜索：${state.query}`);
  }

  filterMeta.textContent = parts.join(" · ");
}

function renderPagination() {
  if (!pagination || !prevBtn || !nextBtn || !pageInfo) {
    return;
  }

  const totalPages = getTotalPages();
  pagination.hidden = state.posts.length <= PAGE_SIZE;
  prevBtn.disabled = state.page <= 1;
  nextBtn.disabled = state.page >= totalPages;
  pageInfo.textContent = `第 ${state.page} / ${totalPages} 页`;
}

function renderCurrentPage() {
  if (!grid) {
    return;
  }

  grid.replaceChildren();

  if (!state.posts.length) {
    grid.appendChild(createEmptyTip("没有符合条件的文章。"));
    renderPagination();
    return;
  }

  const start = (state.page - 1) * PAGE_SIZE;
  const visible = state.posts.slice(start, start + PAGE_SIZE);
  visible.forEach((post) => {
    const wrap = document.createElement("div");
    wrap.className = "blog-card-wrap";
    var card = renderCard(post);
    var dot = document.createElement("div");
    dot.className = "blog-timeline-dot";
    card.appendChild(dot);
    wrap.appendChild(card);
    const divider = document.createElement("div");
    divider.className = "index-post-divider";
    wrap.appendChild(divider);
    grid.appendChild(wrap);
  });
  renderPagination();
}

function applyFilters(options = {}) {
  state.posts = getFilteredPosts();
  state.page = normalizePage(state.page);
  renderTagFilters();
  renderFilterMeta();
  renderCurrentPage();

  if (options.syncQuery !== false) {
    syncUrlQuery();
  }
}

function setPage(page, options = {}) {
  state.page = normalizePage(page);
  renderCurrentPage();

  if (options.syncQuery !== false) {
    syncUrlQuery();
  }
}

function bindPagination() {
  if (!prevBtn || !nextBtn) {
    return;
  }

  prevBtn.addEventListener("click", () => setPage(state.page - 1));
  nextBtn.addEventListener("click", () => setPage(state.page + 1));
}

function bindFilters() {
  if (searchInput) {
    searchInput.addEventListener("input", () => {
      state.query = searchInput.value.trim();
      state.page = 1;
      applyFilters({ syncQuery: true });
    });
  }

  if (searchClearBtn) {
    searchClearBtn.addEventListener("click", () => {
      state.query = "";
      if (searchInput) {
        searchInput.value = "";
      }
      state.page = 1;
      applyFilters({ syncQuery: true });
      if (searchInput) {
        searchInput.focus();
      }
    });
  }
}

async function init() {
  const config = await loadSiteConfig();
  applyThemeConfig(config);
  initTheme(config);
  setupThemeToggle();
  applyHeaderImage(config);
  applySiteText(config);
  markActiveNav();

  if (!grid) {
    return;
  }

  try {
    state.allPosts = await loadPosts();
    if (!state.allPosts.length) {
      grid.appendChild(createEmptyTip("还没有文章，请在 content/blog/*.md 中添加。"));
      if (pagination) {
        pagination.hidden = true;
      }
      return;
    }

    const fromQuery = getFilterFromQuery();
    state.query = fromQuery.q;
    state.tag = fromQuery.tag;
    state.page = fromQuery.page;

    if (searchInput) {
      searchInput.value = state.query;
    }

    if (state.tag !== ALL_TAG) {
      const tags = new Set(uniqueTags(state.allPosts));
      if (!tags.has(state.tag)) {
        state.tag = ALL_TAG;
      }
    }

    bindFilters();
    bindPagination();
    applyFilters({ syncQuery: false });
    syncUrlQuery();
  } catch (error) {
    console.error(error);
    grid.appendChild(createEmptyTip("博客加载失败，请检查 posts.json 与 Markdown 路径。"));
    if (pagination) {
      pagination.hidden = true;
    }
  }
}

init();




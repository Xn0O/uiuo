const {
  loadSiteConfig,
  applyThemeConfig,
  initTheme,
  setupThemeToggle,
  applyHeaderImage,
  applySiteText,
  markActiveNav,
  createEmptyTip,
  markdownToHtml,
  enhanceCodeBlocks,
  renderMath,
  parseFrontMatter,
  tagsFromText,
  isHiddenMeta,
  parseMiMeta,
  resolveAssetUrl,
  setupImageLightbox,
} = window.SiteCommon;

const POSTS_INDEX = "./content/blog/posts.json";
const titleNode = document.getElementById("post-title");
const metaNode = document.getElementById("post-meta");
const contentNode = document.getElementById("post-content");
const heroNode = document.querySelector("[data-hero-image]");
let tocResizeBound = false;

function withCacheBust(url) {
  const u = new URL(String(url || ""), window.location.href);
  u.searchParams.set("_v", String(Date.now()));
  return u.toString();
}

function getSlug() {
  const query = new URLSearchParams(location.search);
  return query.get("slug") || "";
}

async function findPostEntry(slug) {
  const res = await fetch(withCacheBust(POSTS_INDEX), { cache: "no-store" });
  if (!res.ok) throw new Error("无法加载 posts.json");
  const index = await res.json();
  return (index.posts || []).find((item) => item.slug === slug) || null;
}

async function loadMarkdown(file) {
  const res = await fetch(withCacheBust(file), { cache: "no-store" });
  if (!res.ok) throw new Error("无法加载文章 Markdown");
  return res.text();
}

async function loadEncryptedPayload(encRef) {
  const res = await fetch(withCacheBust(encRef), { cache: "no-store" });
  if (!res.ok) throw new Error("无法加载加密正文文件");
  return res.json();
}

function base64ToBytes(base64) {
  const text = String(base64 || "").trim();
  const binary = window.atob(text);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    out[i] = binary.charCodeAt(i);
  }
  return out;
}

async function deriveAesKey(password, kdf) {
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    encoder.encode(password),
    "PBKDF2",
    false,
    ["deriveKey"]
  );

  const iterations = Number.parseInt(String(kdf?.iterations || "0"), 10);
  if (!Number.isFinite(iterations) || iterations < 10000) {
    throw new Error("KDF 迭代参数非法");
  }

  const salt = base64ToBytes(kdf?.saltB64);
  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      hash: "SHA-256",
      salt,
      iterations,
    },
    keyMaterial,
    {
      name: "AES-GCM",
      length: 256,
    },
    false,
    ["decrypt"]
  );
}

async function decryptMarkdownBody(payload, password) {
  if (!payload || typeof payload !== "object") {
    throw new Error("加密正文数据为空");
  }
  const key = await deriveAesKey(password, payload.kdf);
  const iv = base64ToBytes(payload.ivB64);
  const ciphertext = base64ToBytes(payload.ciphertextB64);
  const tag = base64ToBytes(payload.tagB64);

  const combined = new Uint8Array(ciphertext.length + tag.length);
  combined.set(ciphertext, 0);
  combined.set(tag, ciphertext.length);

  const plainBuf = await crypto.subtle.decrypt(
    {
      name: "AES-GCM",
      iv,
      tagLength: 128,
    },
    key,
    combined
  );

  return new TextDecoder().decode(plainBuf);
}

function showUnlockDialog(question, errorText = "") {
  return new Promise((resolve) => {
    const mask = document.createElement("div");
    mask.className = "mi-unlock-mask";

    const panel = document.createElement("div");
    panel.className = "mi-unlock-panel";

    const title = document.createElement("h2");
    title.textContent = "加密文章";

    const q = document.createElement("p");
    q.className = "mi-unlock-question";
    q.textContent = question || "请输入密码查看文章内容";

    const form = document.createElement("form");
    form.className = "mi-unlock-form";

    const input = document.createElement("input");
    input.type = "password";
    input.className = "mi-unlock-input";
    input.placeholder = "请输入密码";
    input.autocomplete = "current-password";
    input.required = true;

    const error = document.createElement("p");
    error.className = "mi-unlock-error";
    error.textContent = errorText;
    error.hidden = !errorText;

    const actions = document.createElement("div");
    actions.className = "mi-unlock-actions";

    const cancelBtn = document.createElement("button");
    cancelBtn.type = "button";
    cancelBtn.className = "btn ghost";
    cancelBtn.textContent = "取消";

    const submitBtn = document.createElement("button");
    submitBtn.type = "submit";
    submitBtn.className = "btn";
    submitBtn.textContent = "解锁";

    actions.append(cancelBtn, submitBtn);
    form.append(input, error, actions);
    panel.append(title, q, form);
    mask.appendChild(panel);
    document.body.appendChild(mask);

    const close = (value) => {
      mask.remove();
      resolve(value);
    };

    cancelBtn.addEventListener("click", () => close(null));
    mask.addEventListener("click", (event) => {
      if (event.target === mask) close(null);
    });

    form.addEventListener("submit", (event) => {
      event.preventDefault();
      close(input.value);
    });

    window.setTimeout(() => input.focus(), 0);
  });
}

function appendMeta(meta, mi, charCount = 0) {
  metaNode.replaceChildren();

  const appendText = (text) => {
    const node = document.createElement("span");
    node.textContent = text;
    metaNode.appendChild(node);
  };

  if (meta.date) {
    appendText(meta.date);
  } else {
    appendText("未填写日期");
  }

  const tags = tagsFromText(meta.tags);
  if (tags.length) {
    appendText(" · ");
    tags.forEach(function (rawStr, index) {
      var parsed = SiteCommon.parseTag ? SiteCommon.parseTag(rawStr) : { name: rawStr, color: null };
      var link = document.createElement("a");
      link.href = './index.html?tag=' + encodeURIComponent(parsed.name);
      link.className = "post-tag-link";
      link.textContent = parsed.name;
      if (parsed.color) link.style.color = parsed.color;
      metaNode.appendChild(link);
      if (index < tags.length - 1) appendText(" / ");
    });
  }

  if (mi) {
    appendText(" · 加密");
  }

  if (charCount > 0) {
    appendText(` · 字数 ${charCount}`);
  }
}

function clearPostToc() {
  const toc = document.getElementById("post-toc");
  if (toc) toc.remove();
  const pageMain = document.querySelector("main.page-main");
  if (pageMain) pageMain.classList.remove("post-has-toc");
}

function slugifyHeading(text) {
  const raw = String(text || "").trim().toLowerCase();
  if (!raw) return "section";
  const cleaned = raw
    .replace(/[^\w\u4e00-\u9fff\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return cleaned || "section";
}

function buildPostToc() {
  clearPostToc();
  if (!contentNode) return;
  const pageMain = document.querySelector("main.page-main");
  if (!pageMain) return;

  const headings = Array.from(contentNode.querySelectorAll("h1, h2, h3, h4"));
  if (!headings.length) return;
  pageMain.classList.add("post-has-toc");

  const used = new Set();
  headings.forEach((heading, index) => {
    const level = Number.parseInt(heading.tagName.slice(1), 10) || 1;
    const base = slugifyHeading(heading.textContent || `section-${index + 1}`);
    let id = base;
    let serial = 2;
    while (used.has(id) || document.getElementById(id)) {
      id = `${base}-${serial}`;
      serial += 1;
    }
    used.add(id);
    heading.id = id;
    heading.dataset.tocLevel = String(level);
  });

  const nav = document.createElement("nav");
  nav.className = "post-toc block";
  nav.id = "post-toc";
  nav.setAttribute("aria-label", "文章目录");

  const title = document.createElement("h2");
  title.className = "post-toc-title";
  title.textContent = "文章目录";

  const list = document.createElement("ul");
  list.className = "post-toc-list";

  const isMobile = window.matchMedia("(max-width: 900px)").matches;
  let tocHeadings = headings;
  if (isMobile) {
    const minLevel = headings.reduce((acc, heading) => {
      const level = Number.parseInt(heading.tagName.slice(1), 10) || 1;
      return Math.min(acc, level);
    }, 9);
    tocHeadings = headings.filter((heading) => {
      const level = Number.parseInt(heading.tagName.slice(1), 10) || 1;
      return level === minLevel;
    });
  }

  tocHeadings.forEach((heading) => {
    const level = Number.parseInt(heading.tagName.slice(1), 10) || 1;
    const li = document.createElement("li");
    li.className = "post-toc-item";

    const link = document.createElement("a");
    link.className = `post-toc-link level-${Math.min(4, Math.max(1, level))}`;
    link.href = `#${heading.id}`;
    link.textContent = heading.textContent || "";
    link.addEventListener("click", (event) => {
      event.preventDefault();
      heading.scrollIntoView({ behavior: "smooth", block: "start" });
      if (history.replaceState) history.replaceState(null, "", `#${heading.id}`);
    });

    li.appendChild(link);
    list.appendChild(li);
  });

  nav.append(title, list);
  pageMain.insertBefore(nav, contentNode);
}

function bindResponsiveTocRefresh() {
  if (tocResizeBound) return;
  tocResizeBound = true;

  let timer = null;
  window.addEventListener(
    "resize",
    () => {
      if (timer) window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        const hasHeading = Boolean(contentNode?.querySelector("h1, h2, h3, h4"));
        if (hasHeading) buildPostToc();
      }, 140);
    },
    { passive: true }
  );
}

async function renderEncryptedBody(mi, encRef) {
  let decryptError = "";
  const payload = await loadEncryptedPayload(encRef);

  while (true) {
    const password = await showUnlockDialog(mi?.question || "请输入密码", decryptError);
    if (password == null) {
      contentNode.replaceChildren();
      clearPostToc();
      contentNode.appendChild(createEmptyTip("已取消解密。"));
      return;
    }

    try {
      const markdown = await decryptMarkdownBody(payload, password);
      contentNode.innerHTML = markdownToHtml(markdown);
      enhanceCodeBlocks(contentNode);
      renderMath(contentNode);
      buildPostToc();
      setupImageLightbox(document.querySelector("main") || document);
      renderTiffImages();
      // Append char count after successful decryption
      const chars = markdown.replace(/\s+/g, "");
      if (chars.length) {
        const sep = document.createTextNode(" · ");
        const cnt = document.createElement("span");
        cnt.textContent = `字数 ${chars.length}`;
        metaNode.appendChild(sep);
        metaNode.appendChild(cnt);
      }
      return;
    } catch (_error) {
      decryptError = "密码错误，或加密数据已损坏，请重试。";
    }
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
  bindResponsiveTocRefresh();

  const slug = getSlug();
  if (!slug) {
    titleNode.textContent = "缺少文章参数";
    contentNode.appendChild(createEmptyTip("请使用示例地址：blog-post.html?slug=示例文章标识"));
    return;
  }

  try {
    const entry = await findPostEntry(slug);
    if (!entry || !entry.file) {
      titleNode.textContent = "文章不存在";
      contentNode.appendChild(createEmptyTip(`未找到 slug=${slug} 的文章配置。`));
      return;
    }

    const raw = await loadMarkdown(entry.file);
    const { meta, body } = parseFrontMatter(raw);

    titleNode.textContent = meta.title || slug;

    const mi =
      parseMiMeta(meta.MI || meta.mi || "") ||
      (entry.miQuestion && entry.miId ? { question: entry.miQuestion, id: entry.miId } : null);
    const encRef = String(meta.encRef || entry.encRef || "").trim();
    const encrypted = Boolean((entry.encrypted || mi) && encRef);

    appendMeta(meta, encrypted ? mi : null, encrypted ? 0 : body.replace(/\s+/g, "").length);

    if (meta.hide_cover && meta.hide_cover !== "0") {
      if (heroNode) heroNode.style.display = "none";
    } else if (heroNode && meta.cover) {
      heroNode.src = resolveAssetUrl(meta.cover);
      heroNode.alt = `${meta.title || slug} 文章头图`;
      heroNode.draggable = false;
      heroNode.setAttribute("draggable", "false");
      if (!heroNode.dataset.dragLocked) {
        heroNode.addEventListener("dragstart", (event) => event.preventDefault());
        heroNode.dataset.dragLocked = "1";
      }
    }

    // Background image
    if (meta.bg_image) {
      var bgUrl = resolveAssetUrl(meta.bg_image);
      var bgMode = (meta.bg_repeat || '').trim() === 'repeat' ? 'repeat' : 'cover';
      document.body.style.backgroundImage = 'url(' + bgUrl + ')';
      document.body.style.backgroundSize = bgMode === 'cover' ? 'cover' : 'auto';
      document.body.style.backgroundRepeat = bgMode === 'repeat' ? 'repeat' : 'no-repeat';
      document.body.style.backgroundPosition = 'center';
      document.body.style.backgroundAttachment = 'fixed';
    }

    if (encrypted) {
      await renderEncryptedBody(mi, encRef);
    } else {
      contentNode.innerHTML = markdownToHtml(body);
      enhanceCodeBlocks(contentNode);
      renderMath(contentNode);
      buildPostToc();
      setupImageLightbox(document.querySelector("main") || document);
      renderTiffImages();
    }

    document.title = `${meta.title || slug} - 博客`;
  } catch (error) {
    console.error(error);
    titleNode.textContent = "文章加载失败";
    contentNode.replaceChildren();
    contentNode.appendChild(createEmptyTip("请检查 posts.json、Markdown 或加密文件路径。"));
  }
}

// --- TIFF image rendering ---
function renderTiffImages() {
  document.querySelectorAll('.markdown-content img[src*=".tif"], .markdown-content img[src*=".tiff"]').forEach(function (img) {
    var src = img.src || '';
    if (!src) return;
    var loader = document.createElement('span');
    loader.textContent = '⏳ TIFF 加载中...';
    loader.style.cssText = 'display:block;padding:12px;text-align:center;color:#888;';
    img.parentNode.insertBefore(loader, img);
    img.style.display = 'none';

    fetch(src).then(function (res) {
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return res.arrayBuffer();
    }).then(function (buf) {
      // Load tiff.js if needed
      if (typeof Tiff === 'undefined') {
        return new Promise(function (resolve, reject) {
          var s = document.createElement('script');
          s.src = 'https://cdn.jsdelivr.net/npm/tiff.js@1.0.0/tiff.min.js';
          s.onload = function () { resolve(buf); };
          s.onerror = function () { reject(new Error('tiff.js 加载失败')); };
          document.head.appendChild(s);
        });
      }
      return buf;
    }).then(function (buf) {
      try {
        var tiff = new Tiff({ buffer: buf });
        var canvas = tiff.toCanvas();
        img.src = canvas.toDataURL('image/png');
        img.style.display = '';
        if (loader.parentNode) loader.parentNode.removeChild(loader);
        tiff.close();
      } catch (e) {
        loader.textContent = '❌ TIFF 渲染失败';
        console.error(e);
      }
    }).catch(function (e) {
      loader.textContent = '❌ TIFF 加载失败: ' + e.message;
    });
  });
}

init();




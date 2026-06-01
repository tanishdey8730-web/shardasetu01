function showRoleCardsIfNeeded() {
  const user = window.ShardaAuth?.getUser?.();
  const adminCard = document.getElementById("home-admin-card");
  const teacherCard = document.getElementById("home-teacher-card");
  if (adminCard && user?.role === "admin") adminCard.hidden = false;
  if (teacherCard && (user?.role === "teacher" || user?.role === "admin")) teacherCard.hidden = false;
}

async function loadHomeContent() {
  try {
    const res = await fetch("/api/banners");
    if (!res.ok) return;
    const data = await res.json();
    renderHero(data.hero);
    renderPromoStrip(data.promoStrip);
    renderBanners(data.educationBanners);
    renderPartners(data.partnerLogos);
  } catch (_) {
    /* fallback: static HTML remains */
  }
}

function renderHero(hero) {
  if (!hero) return;
  const bg = document.getElementById("hero-bg");
  const img = document.getElementById("hero-side-img");
  if (bg && hero.image) bg.style.backgroundImage = `url('${hero.image}')`;
  if (img && hero.image) {
    img.src = hero.image;
    img.alt = hero.imageAlt || "Students learning";
  }
}

function renderPromoStrip(strip) {
  const root = document.getElementById("promo-strip");
  if (!root || !strip) return;
  root.innerHTML = `
    <div class="container promo-strip-inner">
      <h3>${escapeHtml(strip.headline)}</h3>
      <ul class="promo-items">
        ${strip.items.map((i) => `<li><span>${i.icon}</span> ${escapeHtml(i.text)}</li>`).join("")}
      </ul>
    </div>`;
}

function renderBanners(banners) {
  const grid = document.getElementById("banner-grid");
  if (!grid || !banners?.length) return;
  grid.innerHTML = banners
    .map(
      (b) => `
    <a class="edu-banner-card" href="${escapeAttr(b.link)}">
      <img src="${escapeAttr(b.image)}" alt="${escapeAttr(b.title)}" loading="lazy"/>
      <div class="edu-banner-overlay"></div>
      <div class="edu-banner-content">
        <span class="edu-banner-badge">${escapeHtml(b.badge)}</span>
        <h3>${escapeHtml(b.title)}</h3>
        <p>${escapeHtml(b.subtitle)}</p>
        <span class="edu-banner-cta">${escapeHtml(b.cta)} →</span>
      </div>
    </a>`
    )
    .join("");
}

function renderPartners(logos) {
  const root = document.getElementById("partner-logos");
  if (!root || !logos?.length) return;
  root.innerHTML = logos
    .map(
      (l) => `
    <div class="partner-logo">
      <div class="partner-logo-mark" style="background:${escapeAttr(l.color)}">${escapeHtml(l.name)}</div>
      <span>${escapeHtml(l.tagline)}</span>
    </div>`
    )
    .join("");
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
function escapeAttr(s) {
  return escapeHtml(s).replace(/"/g, "&quot;");
}

document.addEventListener("DOMContentLoaded", () => {
  showRoleCardsIfNeeded();
  loadHomeContent();
});

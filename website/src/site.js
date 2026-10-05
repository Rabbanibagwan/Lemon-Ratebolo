/** Progressive enhancement only — header/footer HTML is static for crawlers (PhonePe). */

function currentPage() {
  return document.body.dataset.page || "home";
}

function markCurrentNav() {
  const page = currentPage();
  document.querySelectorAll(".site-nav a[data-nav], .footer-links a[data-nav]").forEach((a) => {
    if (a.getAttribute("data-nav") === page) {
      a.setAttribute("aria-current", "page");
    } else {
      a.removeAttribute("aria-current");
    }
  });
}

function bindNavToggle() {
  const toggle = document.querySelector(".nav-toggle");
  const nav = document.getElementById("site-nav");
  if (!toggle || !nav) return;
  toggle.addEventListener("click", () => {
    const open = nav.classList.toggle("is-open");
    toggle.setAttribute("aria-expanded", open ? "true" : "false");
  });
}

function setFooterYear() {
  const el = document.querySelector("[data-footer-year]");
  if (el) el.textContent = String(new Date().getFullYear());
}

markCurrentNav();
bindNavToggle();
setFooterYear();

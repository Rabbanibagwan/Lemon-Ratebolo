const SITE = {
  brand: "LEMON MANDI",
  legal: "Rbolo Info Services Private Limited",
  gstin: "29AAMCR3486L1ZI",
  addressLines: [
    "MUJAWAR MOHALLA BABALESHWAR NAKA IBRAHIM ROZA VIJAYPUR,",
    "BIJAPUR - 586101",
  ],
  canonicalOrigin: "https://lemonmandi.ratebolo.com",
};

const NAV = [
  { href: "/", label: "Home", id: "home" },
  { href: "/about.html", label: "About", id: "about" },
  { href: "/features.html", label: "Features", id: "features" },
  { href: "/payment.html", label: "Payments", id: "payment" },
  { href: "/contact.html", label: "Contact", id: "contact" },
];

function currentPage() {
  return document.body.dataset.page || "home";
}

function renderHeader() {
  const page = currentPage();
  const nav = NAV.map(
    (item) =>
      `<a href="${item.href}"${item.id === page ? ' aria-current="page"' : ""}>${item.label}</a>`,
  ).join("");

  return `
    <header class="site-header">
      <div class="header-inner">
        <a class="brand" href="/" aria-label="Lemon Mandi home">
          <img class="brand-mark" src="/favicon.svg" width="42" height="42" alt="" />
          <span class="brand-text">
            <span class="brand-name">${SITE.brand}</span>
            <span class="brand-legal">${SITE.legal}</span>
          </span>
        </a>
        <button class="nav-toggle" type="button" aria-expanded="false" aria-controls="site-nav">Menu</button>
        <nav class="site-nav" id="site-nav" aria-label="Primary">
          ${nav}
          <a class="btn btn-primary" href="/contact.html">Get started</a>
        </nav>
      </div>
    </header>
  `;
}

function renderFooter() {
  return `
    <footer class="site-footer">
      <div class="footer-inner">
        <div>
          <div class="footer-brand">${SITE.brand}</div>
          <div class="footer-legal">${SITE.legal}</div>
          <div class="footer-legal footer-gstin">GSTIN: ${SITE.gstin}</div>
          <div class="footer-legal">${SITE.addressLines.join(" ")}</div>
        </div>
        <nav class="footer-links" aria-label="Footer">
          <a href="/about.html">About</a>
          <a href="/features.html">Features</a>
          <a href="/payment.html">Payment information</a>
          <a href="/privacy.html">Privacy Policy</a>
          <a href="/terms.html">Terms &amp; Conditions</a>
          <a href="/refund.html">Refund Policy</a>
          <a href="/contact.html">Contact</a>
        </nav>
        <p class="footer-legal">© ${new Date().getFullYear()} ${SITE.legal}. Lemon Mandi is a product of ${SITE.legal}.</p>
      </div>
    </footer>
  `;
}

function mountChrome() {
  const headerMount = document.getElementById("site-header");
  const footerMount = document.getElementById("site-footer");
  if (headerMount) headerMount.outerHTML = renderHeader();
  if (footerMount) footerMount.outerHTML = renderFooter();

  const toggle = document.querySelector(".nav-toggle");
  const nav = document.getElementById("site-nav");
  if (toggle && nav) {
    toggle.addEventListener("click", () => {
      const open = nav.classList.toggle("is-open");
      toggle.setAttribute("aria-expanded", open ? "true" : "false");
    });
  }
}

mountChrome();

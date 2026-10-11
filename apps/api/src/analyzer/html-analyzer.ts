import * as cheerio from "cheerio";

export interface SocialLink {
  platform: "facebook" | "instagram" | "linkedin" | "twitter" | "youtube" | "tiktok";
  url: string;
}

/** Everything observed on one HTML page. Pure data: no judgement about good or bad lives here. */
export interface PageSignals {
  title: string | null;
  metaDescription: string | null;
  hasViewport: boolean;
  /** Viewport tag includes width=device-width. */
  viewportResponsive: boolean;
  canonicalUrl: string | null;
  lang: string | null;
  headingCount: number;
  h1Count: number;
  /** A heading level was skipped, e.g. h1 followed directly by h3. */
  headingLevelSkipped: boolean;
  hasNav: boolean;
  images: { total: number; missingAlt: number; sampleUrls: string[] };
  /** Unique same-site links found on the page (absolute, no fragments). */
  internalLinks: string[];
  externalLinkCount: number;
  phones: string[];
  emails: string[];
  whatsappLinks: string[];
  contactPageUrl: string | null;
  hasContactForm: boolean;
  mapsLink: string | null;
  socialLinks: SocialLink[];
  bookingLink: string | null;
  hasServicesInfo: boolean;
  hasPricing: boolean;
  ctaTexts: string[];
  accessibility: { unlabeledInputs: number; emptyLinks: number };
  textLength: number;
}

const SOCIAL_HOSTS: [RegExp, SocialLink["platform"]][] = [
  [/(^|\.)facebook\.com$|(^|\.)fb\.com$/, "facebook"],
  [/(^|\.)instagram\.com$/, "instagram"],
  [/(^|\.)linkedin\.com$/, "linkedin"],
  [/(^|\.)twitter\.com$|^x\.com$/, "twitter"],
  [/(^|\.)youtube\.com$|^youtu\.be$/, "youtube"],
  [/(^|\.)tiktok\.com$/, "tiktok"],
];
const SHARE_PATH = /sharer|\/share|intent\/|dialog\/|plugins\//i;
const WHATSAPP_HOSTS = /(^|\.)wa\.me$|(^|\.)whatsapp\.com$/;
const CTA = /\b(book|call|contact|order|reserve|get (a )?(quote|started)|buy|shop|sign up|subscribe|whatsapp|enquire|inquire|schedule|request|free consultation)\b/i;
const BOOKING = /\b(book(ing)?|reserv\w*|appointments?|schedule|order (online|now))\b/i;
const CONTACT = /contact|get in touch|reach us/i;
const SERVICES = /\b(services?|menu|treatments?|products?|what we do|our work|packages|offerings)\b/i;
const PRICING = /(\bprices?\b|\bpricing\b|\bfrom\s+[$€£]|[$€£]\s?\d|\b\d[\d,.]*\s?(aed|usd|pkr|sar|gbp|eur|inr)\b|\brs\.?\s?\d)/i;
const EMAIL_RE = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi;
const PHONE_RE = /(?:\+|00)?\d[\d\s().-]{6,}\d/g;
const NON_PAGE_EXT = /\.(pdf|jpe?g|png|gif|webp|svg|zip|rar|docx?|xlsx?|pptx?|mp4|mp3|avi|css|js|xml|ico)$/i;

function absolute(href: string | undefined, base: string): URL | null {
  if (!href) return null;
  try {
    return new URL(href, base);
  } catch {
    return null;
  }
}

function digits(s: string): number {
  return s.replace(/\D/g, "").length;
}

function unique<T>(items: T[], limit: number): T[] {
  return [...new Set(items)].slice(0, limit);
}

export function analyzeHtml(html: string, pageUrl: string): PageSignals {
  const $ = cheerio.load(html);
  const base = absolute($("base[href]").first().attr("href"), pageUrl)?.toString() ?? pageUrl;
  const page = new URL(pageUrl);

  const meta = (name: string) => $(`meta[name="${name}" i]`).first().attr("content")?.trim() || null;
  const viewport = meta("viewport");

  // Visible text without scripts and styles.
  const $text = cheerio.load(html);
  $text("script, style, noscript, template, svg").remove();
  const text = $text("body").text().replace(/\s+/g, " ").trim();

  // Headings
  const levels = $("h1, h2, h3, h4, h5, h6")
    .map((_, el) => Number(el.tagName.slice(1)))
    .get();
  let skipped = false;
  for (let i = 1; i < levels.length; i++) if (levels[i]! - levels[i - 1]! > 1) skipped = true;

  // Links
  const anchors = $("a[href]")
    .map((_, el) => ({ href: $(el).attr("href") ?? "", text: $(el).text().replace(/\s+/g, " ").trim(), aria: $(el).attr("aria-label") ?? "", hasImgAlt: !!$(el).find("img[alt]:not([alt=''])").length }))
    .get();

  const internal: string[] = [];
  let external = 0;
  const phones: string[] = [];
  const emails: string[] = [];
  const whatsapp: string[] = [];
  const social: SocialLink[] = [];
  let maps: string | null = null;
  let contactPage: string | null = null;
  let booking: string | null = null;
  let emptyLinks = 0;

  for (const a of anchors) {
    const href = a.href.trim();
    const lower = href.toLowerCase();
    if (!a.text && !a.aria && !a.hasImgAlt && !lower.startsWith("#")) emptyLinks++;
    if (lower.startsWith("tel:")) {
      phones.push(decodeURIComponent(href.slice(4)).trim());
      continue;
    }
    if (lower.startsWith("mailto:")) {
      const addr = decodeURIComponent(href.slice(7).split("?")[0] ?? "").trim().toLowerCase();
      if (EMAIL_RE.test(addr)) emails.push(addr);
      EMAIL_RE.lastIndex = 0;
      continue;
    }
    if (lower.startsWith("whatsapp:")) {
      whatsapp.push(href);
      continue;
    }
    if (lower.startsWith("javascript:") || lower.startsWith("#") || lower.startsWith("data:")) continue;

    const url = absolute(href, base);
    if (!url || (url.protocol !== "http:" && url.protocol !== "https:")) continue;
    const host = url.hostname.toLowerCase();

    if (WHATSAPP_HOSTS.test(host)) whatsapp.push(url.toString());
    if (!maps && ((/(^|\.)google\.[a-z.]+$/.test(host) && url.pathname.startsWith("/maps")) || host === "maps.app.goo.gl" || (host === "goo.gl" && url.pathname.startsWith("/maps")))) {
      maps = url.toString();
    }
    for (const [re, platform] of SOCIAL_HOSTS) {
      if (re.test(host) && !SHARE_PATH.test(url.pathname) && url.pathname.length > 1) {
        social.push({ platform, url: url.toString() });
        break;
      }
    }

    const label = `${a.text} ${a.aria}`;
    if (!contactPage && (CONTACT.test(url.pathname) || CONTACT.test(a.text)) && host === page.hostname) contactPage = url.toString();
    if (!booking && (BOOKING.test(label) || BOOKING.test(url.pathname))) booking = url.toString();

    if (host === page.hostname) {
      url.hash = "";
      if (!NON_PAGE_EXT.test(url.pathname)) internal.push(url.toString());
    } else {
      external++;
    }
  }

  // Map embeds count as a maps link too.
  if (!maps) {
    const embed = $("iframe[src]")
      .map((_, el) => $(el).attr("src") ?? "")
      .get()
      .find((s) => /google\.[a-z.]+\/maps/i.test(s));
    if (embed) maps = absolute(embed, base)?.toString() ?? embed;
  }

  // Phones and emails written as plain text.
  for (const m of text.match(PHONE_RE) ?? []) {
    const d = digits(m);
    if (d >= 8 && d <= 15 && !/^\d{4}-\d{2}-\d{2}$/.test(m.trim())) phones.push(m.trim());
  }
  for (const m of text.match(EMAIL_RE) ?? []) {
    const lowerEmail = m.toLowerCase();
    if (!/\.(png|jpe?g|gif|webp|svg)$/.test(lowerEmail)) emails.push(lowerEmail);
  }

  // Buttons and calls to action
  const ctas: string[] = [];
  $("a, button, input[type=submit], input[type=button]").each((_, el) => {
    const t = ($(el).is("input") ? $(el).attr("value") : $(el).text())?.replace(/\s+/g, " ").trim() ?? "";
    if (t && t.length <= 60 && CTA.test(t)) ctas.push(t);
  });
  if (!booking) {
    $("button, input[type=submit]").each((_, el) => {
      const t = $(el).text() || $(el).attr("value") || "";
      if (!booking && BOOKING.test(t)) booking = "(button)";
    });
  }

  // Contact form: a form with an email/message field. We never submit it.
  const hasContactForm =
    $("form").filter((_, f) => !!$(f).find("textarea, input[type=email], input[name*=email i], input[name*=message i]").length).length > 0;

  // Navigation
  const navLinks = Math.max($("nav a").length, $("header a").length, $("[role=navigation] a").length);

  // Images
  const imgs = $("img").toArray();
  const missingAlt = imgs.filter((el) => $(el).attr("alt") === undefined).length;
  const sampleUrls = unique(
    imgs
      .map((el) => absolute($(el).attr("src"), base))
      .filter((u): u is URL => !!u && (u.protocol === "http:" || u.protocol === "https:"))
      .map((u) => u.toString()),
    5,
  );

  // Form inputs without labels
  const labelFor = new Set($("label[for]").map((_, el) => $(el).attr("for") ?? "").get());
  let unlabeled = 0;
  $("input, select, textarea").each((_, el) => {
    const $el = $(el);
    const type = ($el.attr("type") ?? "text").toLowerCase();
    if (["hidden", "submit", "button", "image", "reset"].includes(type)) return;
    const id = $el.attr("id");
    const labelled = $el.attr("aria-label") || $el.attr("aria-labelledby") || $el.attr("title") || (id && labelFor.has(id)) || $el.closest("label").length;
    if (!labelled) unlabeled++;
  });

  const navText = $("nav, header, h1, h2, h3").text();

  return {
    title: $("title").first().text().replace(/\s+/g, " ").trim() || null,
    metaDescription: meta("description"),
    hasViewport: viewport !== null,
    viewportResponsive: !!viewport && /width\s*=\s*device-width/i.test(viewport),
    canonicalUrl: absolute($("link[rel='canonical' i]").first().attr("href"), base)?.toString() ?? null,
    lang: $("html").attr("lang")?.trim() || null,
    headingCount: levels.length,
    h1Count: levels.filter((l) => l === 1).length,
    headingLevelSkipped: skipped,
    hasNav: navLinks >= 3,
    images: { total: imgs.length, missingAlt, sampleUrls },
    internalLinks: unique(internal, 30),
    externalLinkCount: external,
    phones: unique(phones, 5),
    emails: unique(emails, 5),
    whatsappLinks: unique(whatsapp, 3),
    contactPageUrl: contactPage,
    hasContactForm,
    mapsLink: maps,
    socialLinks: social.filter((s, i) => social.findIndex((o) => o.url === s.url) === i).slice(0, 8),
    bookingLink: booking,
    hasServicesInfo: SERVICES.test(navText) || SERVICES.test(anchors.map((a) => a.text).join(" ")),
    hasPricing: PRICING.test(text),
    ctaTexts: unique(ctas, 5),
    accessibility: { unlabeledInputs: unlabeled, emptyLinks },
    textLength: text.length,
  };
}

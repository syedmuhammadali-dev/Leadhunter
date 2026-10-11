import { describe, expect, it } from "vitest";
import { analyzeHtml } from "./html-analyzer.js";

const GOOD = `<!doctype html><html lang="en"><head>
<title>  Acme Dental  |  London </title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="description" content="Family dental care in London">
<link rel="canonical" href="/home">
</head><body>
<header><nav><a href="/">Home</a><a href="/services">Our Services</a><a href="/contact-us">Contact</a><a href="/about#team">About</a></nav></header>
<h1>Acme Dental</h1><h2>Treatments</h2><h3>Whitening</h3>
<p>Call us on +44 20 7946 0958 or email Hello@Acme-Dental.example. Check-ups from £45.</p>
<a href="tel:+442079460958">Call now</a>
<a href="mailto:hello@acme-dental.example?subject=Hi">Email us</a>
<a href="https://wa.me/442079460958">Chat on WhatsApp</a>
<a href="https://www.google.com/maps/place/Acme">Find us</a>
<a href="https://facebook.com/acmedental">FB</a><a href="https://www.instagram.com/acmedental/">IG</a>
<a href="https://facebook.com/sharer/sharer.php?u=x">Share</a>
<a href="/book">Book an appointment</a>
<a href="/brochure.pdf">Brochure</a><a href="https://other.example/x">Elsewhere</a>
<img src="/a.jpg" alt="Clinic"><img src="/b.jpg" alt=""><img src="https://cdn.example/c.png" alt="Team">
<form action="/send"><label for="n">Name</label><input id="n" name="name"><input type="email" aria-label="Email"><textarea aria-label="Message"></textarea><input type="submit" value="Send enquiry"></form>
<script>var phone = "999 999 9999";</script>
</body></html>`;

const POOR = `<html><head></head><body>
<div><img src="logo.png"><img src="team.jpg"></div>
<h3>Welcome</h3><h1>One</h1><h1>Two</h1>
<a href="#"> </a><a href="/x"></a>
<form><input name="q"><input type="text" name="other"></form>
</body></html>`;

describe("analyzeHtml on a well-built page", () => {
  const s = analyzeHtml(GOOD, "https://acme.example/index.html");

  it("reads technical basics", () => {
    expect(s.title).toBe("Acme Dental | London");
    expect(s.metaDescription).toBe("Family dental care in London");
    expect(s.hasViewport).toBe(true);
    expect(s.viewportResponsive).toBe(true);
    expect(s.canonicalUrl).toBe("https://acme.example/home");
    expect(s.lang).toBe("en");
  });

  it("detects contact methods and presence signals", () => {
    expect(s.phones).toContain("+442079460958");
    expect(s.phones.some((p) => p.includes("7946 0958"))).toBe(true);
    expect(s.phones.join()).not.toContain("999 999 9999"); // scripts are ignored
    expect(s.emails).toEqual(["hello@acme-dental.example"]);
    expect(s.whatsappLinks).toEqual(["https://wa.me/442079460958"]);
    expect(s.contactPageUrl).toBe("https://acme.example/contact-us");
    expect(s.hasContactForm).toBe(true);
    expect(s.mapsLink).toContain("google.com/maps");
    expect(s.socialLinks.map((l) => l.platform)).toEqual(["facebook", "instagram"]);
    expect(s.bookingLink).toBe("https://acme.example/book");
    expect(s.hasServicesInfo).toBe(true);
    expect(s.hasPricing).toBe(true);
    expect(s.ctaTexts).toEqual(expect.arrayContaining(["Call now", "Book an appointment"]));
  });

  it("measures structure, images and links", () => {
    expect(s.hasNav).toBe(true);
    expect(s.h1Count).toBe(1);
    expect(s.headingLevelSkipped).toBe(false);
    expect(s.images).toMatchObject({ total: 3, missingAlt: 0 });
    expect(s.images.sampleUrls).toContain("https://acme.example/a.jpg");
    expect(s.internalLinks).toEqual(expect.arrayContaining(["https://acme.example/services", "https://acme.example/about"]));
    expect(s.internalLinks.join()).not.toContain("brochure.pdf");
    expect(s.externalLinkCount).toBeGreaterThan(0);
    expect(s.accessibility).toEqual({ unlabeledInputs: 0, emptyLinks: 0 });
  });
});

describe("analyzeHtml on a poor page", () => {
  const s = analyzeHtml(POOR, "https://poor.example/");

  it("reports what is missing", () => {
    expect(s.title).toBeNull();
    expect(s.metaDescription).toBeNull();
    expect(s.hasViewport).toBe(false);
    expect(s.canonicalUrl).toBeNull();
    expect(s.lang).toBeNull();
    expect(s.hasNav).toBe(false);
    expect(s.phones).toEqual([]);
    expect(s.emails).toEqual([]);
    expect(s.whatsappLinks).toEqual([]);
    expect(s.contactPageUrl).toBeNull();
    expect(s.mapsLink).toBeNull();
    expect(s.socialLinks).toEqual([]);
    expect(s.ctaTexts).toEqual([]);
    expect(s.hasPricing).toBe(false);
    expect(s.hasServicesInfo).toBe(false);
  });

  it("finds structural and accessibility problems", () => {
    expect(s.h1Count).toBe(2);
    expect(s.headingLevelSkipped).toBe(false); // h3 -> h1 -> h1 goes up, which is allowed
    expect(s.images).toMatchObject({ total: 2, missingAlt: 2 });
    expect(s.accessibility.unlabeledInputs).toBe(2);
    expect(s.accessibility.emptyLinks).toBe(1); // href="#" is ignored, /x is empty
    expect(s.hasContactForm).toBe(false);
  });

  it("detects skipped heading levels", () => {
    expect(analyzeHtml("<h1>a</h1><h3>b</h3>", "https://x.example/").headingLevelSkipped).toBe(true);
  });

  it("copes with empty and malformed input", () => {
    expect(() => analyzeHtml("", "https://x.example/")).not.toThrow();
    expect(() => analyzeHtml("<div><p>unclosed <b>tags <a href='::bad::'>x", "https://x.example/")).not.toThrow();
    expect(analyzeHtml("", "https://x.example/").textLength).toBe(0);
  });
});

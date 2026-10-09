import { describe, expect, it } from "vitest";
import { mapCsvRows, matchHeader, normalizeHttpUrl, parseCsv, validateBusinessRow } from "@leadhunter/shared";
import { CsvProvider } from "./providers/csv.js";

describe("parseCsv", () => {
  it("parses quoted fields with commas, quotes and newlines", () => {
    const rows = parseCsv('name,notes\r\n"Smith, Jones & Co","He said ""hi""\nsecond line"\r\nPlain,ok\r\n');
    expect(rows).toEqual([
      ["name", "notes"],
      ["Smith, Jones & Co", 'He said "hi"\nsecond line'],
      ["Plain", "ok"],
    ]);
  });

  it("handles BOM, unicode, blank lines and a missing final newline", () => {
    const rows = parseCsv("﻿name,city\n\nCafé Zürich,Zürich\n\n日本料理,東京");
    expect(rows).toEqual([
      ["name", "city"],
      ["Café Zürich", "Zürich"],
      ["日本料理", "東京"],
    ]);
  });

  it("keeps empty cells and throws on an unterminated quote", () => {
    expect(parseCsv("a,b,c\n1,,3")).toEqual([["a", "b", "c"], ["1", "", "3"]]);
    expect(() => parseCsv('a,b\n"oops,1')).toThrow(/Unterminated/);
  });
});

describe("headers and URLs", () => {
  it("matches headers ignoring case, spaces and common aliases", () => {
    expect(matchHeader(" Review Count ")).toBe("reviewCount");
    expect(matchHeader("review_count")).toBe("reviewCount");
    expect(matchHeader("NAME")).toBe("name");
    expect(matchHeader("favourite colour")).toBeNull();
  });

  it("only accepts http(s) URLs", () => {
    expect(normalizeHttpUrl("example.com")).toBe("https://example.com/");
    expect(normalizeHttpUrl("http://example.com/a")).toBe("http://example.com/a");
    expect(normalizeHttpUrl("javascript:alert(1)")).toBeNull();
    expect(normalizeHttpUrl("ftp://example.com")).toBeNull();
    expect(normalizeHttpUrl("localhost")).toBeNull();
    expect(normalizeHttpUrl("")).toBeNull();
  });
});

describe("validateBusinessRow", () => {
  const base = { name: "Cafe One", category: "Cafe", country: "UK", city: "London" };

  it("accepts a minimal row and cleans optional fields", () => {
    const r = validateBusinessRow({ ...base, website: "cafeone.example", email: "Hi@CafeOne.example", rating: "4.5", reviewCount: "1,234" });
    expect(r).toMatchObject({ ok: true, value: { website: "https://cafeone.example/", email: "hi@cafeone.example", rating: 4.5, reviewCount: 1234 } });
  });

  it("reports every problem in a bad row", () => {
    const r = validateBusinessRow({ name: "", category: "Cafe", country: "UK", city: "", email: "nope", rating: "9", reviewCount: "-2", website: "javascript:x", facebook: "ftp://x.y" });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors).toEqual(
        expect.arrayContaining([
          "name is required",
          "city is required",
          "email is not a valid email address",
          "rating must be a number between 0 and 5",
          "reviewCount must be a whole number, 0 or more",
          "website is not a valid http(s) URL",
          "facebook is not a valid http(s) URL",
        ]),
      );
    }
  });
});

describe("mapCsvRows / CsvProvider", () => {
  it("rejects files with missing required columns", () => {
    const parsed = mapCsvRows(parseCsv("name,city\nA,B"));
    expect(parsed.fileErrors[0]).toMatch(/category, country/);
    expect(new CsvProvider("").fileErrors[0]).toMatch(/empty/);
  });

  it("splits valid and invalid rows with line numbers", () => {
    const csv = ["name,category,country,city,rating", "Good Place,Cafe,UK,London,4.2", "Bad Place,Cafe,UK,London,11", "Other,Gym,UK,Leeds,3"].join("\n");
    const p = new CsvProvider(csv);
    expect(p.totalRows).toBe(3);
    expect(p.valid.map((v) => v.line)).toEqual([2, 4]);
    expect(p.invalid).toEqual([{ line: 3, errors: ["rating must be a number between 0 and 5"] }]);
  });

  it("filters by country/city/category and respects limit", async () => {
    const csv = ["name,category,country,city", "A,Cafe,UK,London", "B,Cafe,UK,Leeds", "C,Gym,UK,London"].join("\n");
    const p = new CsvProvider(csv);
    const base = { country: "", city: "", category: "", limit: 50 };
    expect(await p.searchBusinesses({ ...base, city: "london" })).toHaveLength(2);
    expect(await p.searchBusinesses({ ...base, category: "Cafe", city: "London" })).toHaveLength(1);
    expect(await p.searchBusinesses({ ...base, limit: 1 })).toHaveLength(1);
  });
});

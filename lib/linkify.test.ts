import { describe, expect, it } from "vitest";

import { linkifyText } from "@/lib/linkify";

function links(text: string) {
  return linkifyText(text).filter((segment) => segment.type === "link");
}

describe("linkifyText", () => {
  it("returns a single text segment when there is no URL", () => {
    expect(linkifyText("大家晚上吃什么？")).toEqual([
      { type: "text", value: "大家晚上吃什么？", href: null },
    ]);
  });

  it("links a bare https URL", () => {
    expect(linkifyText("https://example.com")).toEqual([
      { type: "link", value: "https://example.com", href: "https://example.com" },
    ]);
  });

  it("keeps surrounding text as separate segments", () => {
    expect(linkifyText("看这个 https://example.com/a 很好玩")).toEqual([
      { type: "text", value: "看这个 ", href: null },
      { type: "link", value: "https://example.com/a", href: "https://example.com/a" },
      { type: "text", value: " 很好玩", href: null },
    ]);
  });

  it("stops at fullwidth punctuation", () => {
    const [link] = links("看这个https://example.com，很好玩");
    expect(link.value).toBe("https://example.com");
  });

  it("stops when Chinese prose is glued to the URL", () => {
    const [link] = links("链接https://example.com看看");
    expect(link.value).toBe("https://example.com");
  });

  it("trims trailing ASCII sentence punctuation", () => {
    const [link] = links("see https://example.com/a.");
    expect(link.value).toBe("https://example.com/a");
  });

  it("keeps balanced parens in Wikipedia-style URLs", () => {
    const [link] = links("(https://en.wikipedia.org/wiki/Foo_(bar))");
    expect(link.value).toBe("https://en.wikipedia.org/wiki/Foo_(bar)");
  });

  it("prefixes www. links with https for the href", () => {
    expect(links("www.baidu.com")[0]).toEqual({
      type: "link",
      value: "www.baidu.com",
      href: "https://www.baidu.com",
    });
  });

  it("keeps ports, queries, and fragments", () => {
    const [link] = links("dev at http://192.168.1.1:3000/a?b=c#d now");
    expect(link.value).toBe("http://192.168.1.1:3000/a?b=c#d");
  });

  it("links multiple URLs in one message", () => {
    const found = links("对比 https://a.example 和 https://b.example 吧");
    expect(found.map((segment) => segment.value)).toEqual([
      "https://a.example",
      "https://b.example",
    ]);
  });

  it("does not link javascript: or other schemes", () => {
    expect(links("javascript:alert(1) data:text/html;x")).toHaveLength(0);
  });

  it("drops URLs that exceed the safe length cap", () => {
    const long = `https://example.com/${"a".repeat(2100)}`;
    expect(links(`看 ${long}`)).toHaveLength(0);
  });
});

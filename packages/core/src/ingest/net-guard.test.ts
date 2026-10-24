import { describe, expect, it } from "vitest";
import { isPrivateAddress, isPrivateHostName, refusePrivateUrl } from "./net-guard.js";

describe("isPrivateAddress", () => {
  it.each([
    "127.0.0.1",
    "127.1.2.3",
    "10.0.0.1",
    "172.16.0.1",
    "172.31.255.255",
    "192.168.1.1",
    "169.254.169.254",
    "100.64.0.1",
    "0.0.0.0",
    "224.0.0.1",
    "255.255.255.255",
    "::",
    "::1",
    "fe80::1",
    "fc00::1",
    "fd12:3456::1",
    "ff02::1",
    "::ffff:127.0.0.1",
    "::ffff:7f00:1",
    "::ffff:a9fe:a9fe",
    "64:ff9b::7f00:1",
    "2002:7f00:1::1",
    "::127.0.0.1",
  ])("treats %s as private", (address) => {
    expect(isPrivateAddress(address)).toBe(true);
  });

  it.each([
    "8.8.8.8",
    "93.184.216.34",
    "172.32.0.1",
    "100.128.0.1",
    "2606:4700:4700::1111",
    "2a00:1450:4001:81b::200e",
    "::ffff:8.8.8.8",
  ])("treats %s as public", (address) => {
    expect(isPrivateAddress(address)).toBe(false);
  });

  it("treats text that is not an address as private", () => {
    expect(isPrivateAddress("not-an-ip")).toBe(true);
  });
});

describe("isPrivateHostName", () => {
  it.each([
    "localhost",
    "LOCALHOST.",
    "app.localhost",
    "printer.local",
    "db.internal",
    "router.lan",
    "intranet",
    "[::1]",
    "127.0.0.1",
    "169.254.169.254",
  ])("refuses %s", (host) => {
    expect(isPrivateHostName(host)).toBe(true);
  });

  it.each(["arxiv.org", "www.nature.com", "8.8.8.8", "[2606:4700:4700::1111]"])(
    "allows %s",
    (host) => {
      expect(isPrivateHostName(host)).toBe(false);
    },
  );
});

describe("refusePrivateUrl", () => {
  it("refuses schemes other than http and https", async () => {
    await expect(refusePrivateUrl("file:///etc/passwd", undefined)).rejects.toMatchObject({
      detail: { code: "URL_NOT_PUBLIC" },
    });
    await expect(refusePrivateUrl("ftp://example.org/x", undefined)).rejects.toMatchObject({
      detail: { code: "URL_NOT_PUBLIC" },
    });
  });

  it("refuses the decimal and hexadecimal spellings of 127.0.0.1", async () => {
    for (const url of ["http://2130706433/", "http://0x7f000001/", "http://0177.0.0.1/"]) {
      await expect(refusePrivateUrl(url, undefined)).rejects.toMatchObject({
        detail: { code: "URL_NOT_PUBLIC" },
      });
    }
  });

  it("refuses a public name that resolves to a private address", async () => {
    await expect(
      refusePrivateUrl("https://rebind.example.net/x", async () => ["93.184.216.34", "10.0.0.7"]),
    ).rejects.toMatchObject({ detail: { code: "URL_NOT_PUBLIC" } });
  });

  it("accepts a public name that resolves to public addresses", async () => {
    await expect(
      refusePrivateUrl("https://arxiv.org/pdf/1706.03762", async () => ["151.101.67.42"]),
    ).resolves.toBeUndefined();
  });

  it("lets the fetch report a name that does not resolve", async () => {
    await expect(
      refusePrivateUrl("https://nxdomain.example.net/", async () => {
        throw new Error("ENOTFOUND");
      }),
    ).resolves.toBeUndefined();
  });
});

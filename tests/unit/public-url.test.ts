import assert from "node:assert/strict";
import { test } from "node:test";
import {
  getPublicUrlError,
  isHttpUrl,
  isPrivateHostname,
  MAX_PUBLIC_URL_LENGTH,
  normalizeHttpUrlInput,
} from "../../src/lib/url/public-url.ts";

// ─── normalizeHttpUrlInput ───

test("normalizeHttpUrlInput retorna vazio para string vazia ou só espaços", () => {
  assert.equal(normalizeHttpUrlInput(""), "");
  assert.equal(normalizeHttpUrlInput("   "), "");
  assert.equal(normalizeHttpUrlInput("\t\n "), "");
});

test("normalizeHttpUrlInput adiciona https:// quando não há scheme", () => {
  assert.equal(normalizeHttpUrlInput("example.com"), "https://example.com");
  assert.equal(normalizeHttpUrlInput("example.com/path?q=1"), "https://example.com/path?q=1");
});

test("normalizeHttpUrlInput remove espaços das pontas antes de processar", () => {
  assert.equal(normalizeHttpUrlInput("  example.com  "), "https://example.com");
});

test("normalizeHttpUrlInput mantém URLs que já têm scheme", () => {
  assert.equal(normalizeHttpUrlInput("https://example.com"), "https://example.com");
  assert.equal(normalizeHttpUrlInput("http://example.com"), "http://example.com");
  assert.equal(normalizeHttpUrlInput("ftp://example.com"), "ftp://example.com");
  assert.equal(normalizeHttpUrlInput("HTTP://EXAMPLE.COM"), "HTTP://EXAMPLE.COM");
});

test("normalizeHttpUrlInput trata 'javascript:...' como com-scheme (não prefixa)", () => {
  assert.equal(normalizeHttpUrlInput("javascript:alert(1)"), "javascript:alert(1)");
});

// ─── isPrivateHostname ───

test("isPrivateHostname trata hostname vazio ou só espaços como privado", () => {
  assert.equal(isPrivateHostname(""), true);
  assert.equal(isPrivateHostname("   "), true);
});

test("isPrivateHostname bloqueia localhost em qualquer capitalização", () => {
  assert.equal(isPrivateHostname("localhost"), true);
  assert.equal(isPrivateHostname("LOCALHOST"), true);
  assert.equal(isPrivateHostname(" LocalHost "), true);
});

test("isPrivateHostname bloqueia faixas IPv4 privadas e reservadas", () => {
  for (const host of [
    "127.0.0.1",
    "127.255.255.254",
    "10.0.0.1",
    "10.255.255.255",
    "172.16.0.1",
    "172.31.255.255",
    "192.168.0.1",
    "192.168.255.255",
    "169.254.1.1",
    "0.0.0.0",
    "0.1.2.3",
    "100.64.0.1",
    "100.127.255.255",
  ]) {
    assert.equal(isPrivateHostname(host), true, `${host} deveria ser privado`);
  }
});

test("isPrivateHostname permite IPv4 públicos nas fronteiras das faixas", () => {
  for (const host of ["8.8.8.8", "172.15.0.1", "172.32.0.1", "100.63.0.1", "100.128.0.1", "11.0.0.1"]) {
    assert.equal(isPrivateHostname(host), false, `${host} deveria ser público`);
  }
});

test("isPrivateHostname bloqueia IPv6 loopback e link-local, com ou sem colchetes", () => {
  assert.equal(isPrivateHostname("::1"), true);
  assert.equal(isPrivateHostname("[::1]"), true);
  assert.equal(isPrivateHostname("::"), true);
  assert.equal(isPrivateHostname("fe80::1"), true);
  assert.equal(isPrivateHostname("[fe80::1]"), true);
  assert.equal(isPrivateHostname("fc00::1"), true);
  assert.equal(isPrivateHostname("fd00::1"), true);
});

test("isPrivateHostname bloqueia IPv4-mapeado-em-IPv6 em formato decimal", () => {
  assert.equal(isPrivateHostname("::ffff:127.0.0.1"), true);
  assert.equal(isPrivateHostname("::ffff:10.0.0.1"), true);
  assert.equal(isPrivateHostname("::ffff:192.168.1.1"), true);
  assert.equal(isPrivateHostname("[::ffff:127.0.0.1]"), true);
});

test("isPrivateHostname bloqueia IPv4-mapeado-em-IPv6 em formato hex (normalização WHATWG)", () => {
  assert.equal(isPrivateHostname("::ffff:7f00:1"), true); // 127.0.0.1
  assert.equal(isPrivateHostname("::ffff:a00:1"), true); // 10.0.0.1
  assert.equal(isPrivateHostname("::ffff:ac10:1"), true); // 172.16.0.1
  assert.equal(isPrivateHostname("::ffff:c0a8:101"), true); // 192.168.1.1
  assert.equal(isPrivateHostname("::ffff:a9fe:1"), true); // 169.254.0.1
});

test("isPrivateHostname permite domínios públicos", () => {
  assert.equal(isPrivateHostname("example.com"), false);
  assert.equal(isPrivateHostname("sub.domain.co.uk"), false);
  assert.equal(isPrivateHostname("localhost.evil.com"), false);
});

test("isPrivateHostname permite IPv6 público", () => {
  assert.equal(isPrivateHostname("2606:4700:4700::1111"), false);
  assert.equal(isPrivateHostname("[2606:4700:4700::1111]"), false);
});

test("isPrivateHostname bloqueia domínio que começa com 'fd' (falso positivo conhecido)", () => {
  // O pattern /^fd/i casa qualquer hostname iniciado por "fd", inclusive domínios
  // públicos como "fdexample.com". Comportamento atual documentado pelo teste.
  assert.equal(isPrivateHostname("fdexample.com"), true);
});

// ─── getPublicUrlError ───

test("getPublicUrlError rejeita entrada vazia ou só espaços", () => {
  assert.match(getPublicUrlError("") ?? "", /não pode ser vazia/);
  assert.match(getPublicUrlError("    ") ?? "", /não pode ser vazia/);
});

test("getPublicUrlError rejeita URL acima de 2048 caracteres", () => {
  const longUrl = `https://example.com/${"a".repeat(MAX_PUBLIC_URL_LENGTH)}`;
  assert.match(getPublicUrlError(longUrl) ?? "", /ultrapassa 2048 caracteres/);
});

test("getPublicUrlError aceita URL com exatamente 2048 caracteres", () => {
  const base = "https://example.com/";
  const url = base + "a".repeat(MAX_PUBLIC_URL_LENGTH - base.length);
  assert.equal(url.length, MAX_PUBLIC_URL_LENGTH);
  assert.equal(getPublicUrlError(url), null);
});

test("getPublicUrlError rejeita URL malformada", () => {
  assert.match(getPublicUrlError("https://") ?? "", /URL inválida/);
  assert.match(getPublicUrlError("http://exa mple.com") ?? "", /URL inválida/);
});

test("getPublicUrlError rejeita schemes não-HTTP", () => {
  assert.match(getPublicUrlError("ftp://example.com") ?? "", /Apenas HTTP e HTTPS/);
  assert.match(getPublicUrlError("file:///etc/passwd") ?? "", /Apenas HTTP e HTTPS/);
  assert.match(getPublicUrlError("javascript:alert(1)") ?? "", /Apenas HTTP e HTTPS/);
});

test("getPublicUrlError rejeita hosts privados e reservados", () => {
  for (const raw of ["localhost", "127.0.0.1", "10.0.0.5", "172.16.3.4", "192.168.1.1", "0.0.0.0", "[::1]"]) {
    assert.match(getPublicUrlError(raw) ?? "", /endereço restrito/, `${raw} deveria ser restrito`);
  }
});

test("getPublicUrlError rejeita IP ofuscado em decimal (2130706433 = 127.0.0.1)", () => {
  // O parser WHATWG normaliza o inteiro para 127.0.0.1, que é privado.
  assert.match(getPublicUrlError("http://2130706433/") ?? "", /endereço restrito/);
});

test("getPublicUrlError rejeita hostname sem ponto que não é IP literal", () => {
  assert.match(getPublicUrlError("intranet") ?? "", /domínio válido/);
  assert.match(getPublicUrlError("https://internal-server/path") ?? "", /domínio válido/);
});

test("getPublicUrlError aceita URLs HTTP/HTTPS públicas", () => {
  for (const raw of [
    "https://example.com",
    "example.com/path?q=1#frag",
    "http://sub.example.co.uk:8080/a/b",
    "https://user:pass@example.com/",
  ]) {
    assert.equal(getPublicUrlError(raw), null, `${raw} deveria ser aceita`);
  }
});

test("getPublicUrlError aceita IPv4 público literal", () => {
  assert.equal(getPublicUrlError("https://8.8.8.8/"), null);
});

test("getPublicUrlError aceita IPv6 público literal", () => {
  assert.equal(getPublicUrlError("https://[2606:4700:4700::1111]/"), null);
});

// ─── isHttpUrl ───

test("isHttpUrl aceita http e https", () => {
  assert.equal(isHttpUrl("https://example.com"), true);
  assert.equal(isHttpUrl("http://example.com/path"), true);
});

test("isHttpUrl rejeita outros schemes", () => {
  assert.equal(isHttpUrl("ftp://example.com"), false);
  assert.equal(isHttpUrl("file:///etc/passwd"), false);
  assert.equal(isHttpUrl("javascript:alert(1)"), false);
  assert.equal(isHttpUrl("mailto:a@b.com"), false);
});

test("isHttpUrl rejeita strings que não são URL", () => {
  assert.equal(isHttpUrl(""), false);
  assert.equal(isHttpUrl("not a url"), false);
  assert.equal(isHttpUrl("example.com"), false); // sem scheme, URL() lança
});

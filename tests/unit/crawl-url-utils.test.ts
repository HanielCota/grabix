import assert from "node:assert/strict";
import { test } from "node:test";
import {
  isFilteredUrl,
  isPrivateIp,
  isSameDomain,
  isSubdomain,
  normalizeUrl,
  resolveUrl,
  sanitizeUrl,
} from "../../src/lib/crawl/url-utils.ts";

// ─── resolveUrl ───

test("resolveUrl resolve URL relativa contra a base", () => {
  assert.equal(resolveUrl("/pagina", "https://example.com/dir/"), "https://example.com/pagina");
  assert.equal(resolveUrl("outra", "https://example.com/dir/"), "https://example.com/dir/outra");
  assert.equal(resolveUrl("../up", "https://example.com/dir/sub/"), "https://example.com/dir/up");
});

test("resolveUrl retorna URL absoluta inalterada", () => {
  assert.equal(resolveUrl("https://other.com/x", "https://example.com/"), "https://other.com/x");
});

test("resolveUrl aceita string vazia e resolve para a própria base", () => {
  assert.equal(resolveUrl("", "https://example.com/a"), "https://example.com/a");
});

test("resolveUrl retorna null para href inválido", () => {
  assert.equal(resolveUrl("http://[invalid", "https://example.com/"), null);
});

test("resolveUrl retorna null para base inválida com href relativo", () => {
  assert.equal(resolveUrl("/pagina", "not-a-url"), null);
});

// ─── normalizeUrl ───

test("normalizeUrl força https em URLs http", () => {
  assert.equal(normalizeUrl("http://example.com/page"), "https://example.com/page");
});

test("normalizeUrl remove parâmetros de tracking", () => {
  const url =
    "https://example.com/p?utm_source=google&utm_medium=cpc&utm_campaign=x&utm_term=t&utm_content=c&fbclid=abc&gclid=def&ref=r&source=s&manter=1";
  assert.equal(normalizeUrl(url), "https://example.com/p?manter=1");
});

test("normalizeUrl remove o hash", () => {
  assert.equal(normalizeUrl("https://example.com/p#secao"), "https://example.com/p");
});

test("normalizeUrl remove barra final exceto na raiz", () => {
  assert.equal(normalizeUrl("https://example.com/page/"), "https://example.com/page");
  assert.equal(normalizeUrl("https://example.com/"), "https://example.com/");
});

test("normalizeUrl preserva query strings não-tracking e porta", () => {
  assert.equal(normalizeUrl("https://example.com:8080/p?id=42"), "https://example.com:8080/p?id=42");
});

test("normalizeUrl retorna a entrada inalterada quando a URL é inválida", () => {
  assert.equal(normalizeUrl("not a url at all"), "not a url at all");
  assert.equal(normalizeUrl(""), "");
});

// ─── isSameDomain ───

test("isSameDomain ignora prefixo www e maiúsculas", () => {
  assert.equal(isSameDomain("https://www.example.com/a", "https://example.com/b"), true);
  assert.equal(isSameDomain("https://EXAMPLE.com/a", "https://example.com/b"), true);
});

test("isSameDomain rejeita domínios diferentes e subdomínios", () => {
  assert.equal(isSameDomain("https://other.com/", "https://example.com/"), false);
  assert.equal(isSameDomain("https://sub.example.com/", "https://example.com/"), false);
  assert.equal(isSameDomain("https://notexample.com/", "https://example.com/"), false);
});

test("isSameDomain retorna false para URLs inválidas", () => {
  assert.equal(isSameDomain("invalid", "https://example.com/"), false);
  assert.equal(isSameDomain("https://example.com/", "invalid"), false);
});

// ─── isSubdomain ───

test("isSubdomain reconhece subdomínio do domínio base", () => {
  assert.equal(isSubdomain("https://blog.example.com/", "https://example.com/"), true);
  assert.equal(isSubdomain("https://deep.blog.example.com/", "https://example.com/"), true);
});

test("isSubdomain retorna false para o mesmo domínio (incluindo www)", () => {
  assert.equal(isSubdomain("https://example.com/", "https://example.com/"), false);
  assert.equal(isSubdomain("https://www.example.com/", "https://example.com/"), false);
});

test("isSubdomain não confunde sufixo parecido com subdomínio", () => {
  assert.equal(isSubdomain("https://notexample.com/", "https://example.com/"), false);
  assert.equal(isSubdomain("https://example.com.evil.com/", "https://example.com/"), false);
});

test("isSubdomain retorna false para URLs inválidas", () => {
  assert.equal(isSubdomain("invalid", "https://example.com/"), false);
});

// ─── isFilteredUrl ───

test("isFilteredUrl filtra âncoras puras e protocolos não-navegáveis", () => {
  for (const url of [
    "#",
    "#secao",
    "mailto:a@b.com",
    "tel:+5511999999999",
    "javascript:void(0)",
    "data:image/png;base64,x",
  ]) {
    assert.equal(isFilteredUrl(url), true, url);
  }
});

test("isFilteredUrl filtra protocolos não-http parseáveis", () => {
  assert.equal(isFilteredUrl("ftp://example.com/file"), true);
  assert.equal(isFilteredUrl("file:///etc/passwd"), true);
});

test("isFilteredUrl filtra assets estáticos por extensão", () => {
  for (const url of [
    "https://example.com/app.css",
    "https://example.com/bundle.js",
    "https://example.com/mod.mjs",
    "https://example.com/font.woff2",
    "https://example.com/favicon.ico",
    "https://example.com/feed.xml",
    "https://example.com/data.json",
    "https://example.com/logo.svg",
    "https://example.com/bundle.js.map",
  ]) {
    assert.equal(isFilteredUrl(url), true, url);
  }
});

test("isFilteredUrl filtra extensões independente de maiúsculas e query string", () => {
  assert.equal(isFilteredUrl("https://example.com/APP.CSS"), true);
  assert.equal(isFilteredUrl("https://example.com/app.js?v=123"), true);
});

test("isFilteredUrl filtra páginas de autenticação por segmento de path", () => {
  for (const url of [
    "https://example.com/login",
    "https://example.com/auth/signin",
    "https://example.com/Sign-Up",
    "https://example.com/conta/logout",
    "https://example.com/forgot-password",
    "https://example.com/oauth/callback",
  ]) {
    assert.equal(isFilteredUrl(url), true, url);
  }
});

test("isFilteredUrl não filtra segmentos parecidos mas distintos", () => {
  assert.equal(isFilteredUrl("https://example.com/login-page"), false);
  assert.equal(isFilteredUrl("https://example.com/authority"), false);
});

test("isFilteredUrl aceita páginas normais http/https", () => {
  assert.equal(isFilteredUrl("https://example.com/videos"), false);
  assert.equal(isFilteredUrl("http://example.com/"), false);
});

test("isFilteredUrl filtra URLs inválidas", () => {
  assert.equal(isFilteredUrl("not a url"), true);
  assert.equal(isFilteredUrl(""), true);
});

// ─── sanitizeUrl ───

test("sanitizeUrl retorna URL normalizada para http/https públicos", () => {
  assert.equal(sanitizeUrl("https://example.com/page"), "https://example.com/page");
  assert.equal(sanitizeUrl("http://example.com"), "http://example.com/");
});

test("sanitizeUrl lança para URL malformada", () => {
  assert.throws(() => sanitizeUrl("not a url"), TypeError);
  assert.throws(() => sanitizeUrl(""), TypeError);
});

test("sanitizeUrl bloqueia protocolos não-http", () => {
  assert.throws(() => sanitizeUrl("ftp://example.com/"), /Blocked protocol: ftp:/);
  assert.throws(() => sanitizeUrl("file:///etc/passwd"), /Blocked protocol: file:/);
});

test("sanitizeUrl bloqueia localhost e 0.0.0.0", () => {
  assert.throws(() => sanitizeUrl("http://localhost:3000/"), /Blocked: localhost/);
  assert.throws(() => sanitizeUrl("http://0.0.0.0/"), /Blocked: localhost/);
});

test("sanitizeUrl bloqueia IPs privados", () => {
  for (const ip of [
    "127.0.0.1",
    "10.1.2.3",
    "172.16.0.1",
    "172.31.255.255",
    "192.168.0.1",
    "169.254.1.1",
    "100.64.0.1",
  ]) {
    assert.throws(() => sanitizeUrl(`http://${ip}/`), /Blocked: private IP/, ip);
  }
});

test("sanitizeUrl aceita IPs públicos fora das faixas privadas", () => {
  assert.equal(sanitizeUrl("http://172.15.0.1/"), "http://172.15.0.1/");
  assert.equal(sanitizeUrl("http://172.32.0.1/"), "http://172.32.0.1/");
  assert.equal(sanitizeUrl("http://100.128.0.1/"), "http://100.128.0.1/");
  assert.equal(sanitizeUrl("http://8.8.8.8/"), "http://8.8.8.8/");
});

// ─── isPrivateIp ───

test("isPrivateIp reconhece faixas privadas IPv4", () => {
  for (const ip of [
    "127.0.0.1",
    "10.255.255.255",
    "172.16.0.0",
    "172.31.0.0",
    "192.168.1.1",
    "169.254.0.1",
    "0.1.2.3",
    "100.64.0.0",
    "100.127.255.255",
  ]) {
    assert.equal(isPrivateIp(ip), true, ip);
  }
});

test("isPrivateIp reconhece IPv6 local/privado", () => {
  assert.equal(isPrivateIp("::1"), true);
  assert.equal(isPrivateIp("fc00::1"), true);
  assert.equal(isPrivateIp("fd00::1"), true);
  assert.equal(isPrivateIp("fe80::1"), true);
});

test("isPrivateIp rejeita IPs públicos nas bordas das faixas", () => {
  for (const ip of ["11.0.0.1", "172.15.0.1", "172.32.0.1", "192.167.1.1", "100.63.0.1", "100.128.0.1", "8.8.8.8"]) {
    assert.equal(isPrivateIp(ip), false, ip);
  }
});

test("isPrivateIp retorna false para hostnames comuns", () => {
  assert.equal(isPrivateIp("example.com"), false);
  assert.equal(isPrivateIp(""), false);
});

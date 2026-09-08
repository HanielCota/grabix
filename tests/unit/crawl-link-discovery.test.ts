import assert from "node:assert/strict";
import { test } from "node:test";
import { load } from "cheerio";
import { discoverLinks } from "../../src/lib/crawl/link-discovery.ts";

const BASE = "https://example.com/pagina";

function discover(html: string, baseUrl = BASE) {
  return discoverLinks(load(html), baseUrl);
}

// ─── Descoberta básica e classificação ───

test("descobre âncoras e resolve URLs relativas contra a base", () => {
  const results = discover(`<div><a href="/sobre">Sobre</a><a href="outra">Outra</a></div>`);
  const urls = results.map((r) => r.url);
  assert.ok(urls.includes("https://example.com/sobre"));
  assert.ok(urls.includes("https://example.com/outra"));
  assert.ok(results.every((r) => r.source === "anchor"));
  assert.ok(results.every((r) => r.discoveredFrom === BASE));
});

test("classifica links em video_platform, same_domain, subdomain e external", () => {
  const results = discover(`
    <div><a href="https://www.youtube.com/watch?v=abc">Video</a></div>
    <div><a href="https://example.com/interna">Interna</a></div>
    <div><a href="https://blog.example.com/post">Blog</a></div>
    <div><a href="https://outro-site.com/x">Parceiro</a></div>
  `);
  const byUrl = new Map(results.map((r) => [r.url, r]));
  assert.equal(byUrl.get("https://www.youtube.com/watch?v=abc")?.category, "video_platform");
  assert.equal(byUrl.get("https://example.com/interna")?.category, "same_domain");
  assert.equal(byUrl.get("https://blog.example.com/post")?.category, "subdomain");
  assert.equal(byUrl.get("https://outro-site.com/x")?.category, "external");
});

test("retorna lista vazia para página sem links e ignora âncoras sem href", () => {
  assert.deepEqual(discover("<p>Nada aqui</p>"), []);
  assert.deepEqual(discover(`<div><a>Sem href</a></div>`), []);
});

// ─── Filtros ───

test("filtra mailto, tel, javascript, assets e páginas de auth", () => {
  const results = discover(`
    <div>
      <a href="mailto:a@b.com">Email</a>
      <a href="tel:+5511999">Telefone</a>
      <a href="javascript:void(0)">JS</a>
      <a href="/app.css">CSS</a>
      <a href="/bundle.js">JS asset</a>
      <a href="/login">Login</a>
      <a href="/auth/signup">Cadastro</a>
      <a href="/conteudo-real">Conteúdo</a>
    </div>
  `);
  assert.deepEqual(
    results.map((r) => r.url),
    ["https://example.com/conteudo-real"],
  );
});

test("âncoras de fragmento (#secao) resolvem para a própria página e não são filtradas (limitação conhecida)", () => {
  // O filtro de "#" roda DEPOIS da resolução da URL, então href="#secao" vira
  // "https://example.com/pagina#secao" e passa pelo isFilteredUrl — o candidato
  // aponta para a própria página de origem.
  const results = discover(`<div><a href="#secao">Seção</a></div>`);
  assert.deepEqual(
    results.map((r) => r.url),
    ["https://example.com/pagina#secao"],
  );
});

test("filtra links de compartilhamento por domínio, path e classe", () => {
  const results = discover(`
    <div><a href="https://twitter.com/user/status/123">Tweet</a></div>
    <div><a href="https://www.facebook.com/sharer/sharer.php?u=https://example.com">Share</a></div>
    <div><a href="https://whatsapp.com/send?text=oi">Zap</a></div>
    <div><a href="https://example.com/compartilhe" class="social-share">Compartilhe</a></div>
    <div><a href="https://example.com/normal">Normal</a></div>
  `);
  // O domínio twitter.com está na lista de compartilhamento, então até um
  // /status/ (que seria video_platform) é descartado antes da classificação.
  assert.deepEqual(
    results.map((r) => r.url),
    ["https://example.com/normal"],
  );
});

test("subdomínios de domínios de compartilhamento não são filtrados (limitação conhecida)", () => {
  // A lista de share domains só cobre o host exato; api.whatsapp.com escapa.
  const results = discover(`<div><a href="https://api.whatsapp.com/send?text=oi">Zap</a></div>`);
  assert.deepEqual(
    results.map((r) => r.url),
    ["https://api.whatsapp.com/send?text=oi"],
  );
});

test("filtra âncoras com texto legal (privacidade, termos)", () => {
  const results = discover(`
    <div><a href="/privacidade">Política de Privacidade</a></div>
    <div><a href="/termos">Termos de Uso</a></div>
    <div><a href="/lgpd">LGPD</a></div>
    <div><a href="/conteudo">Ver conteúdo</a></div>
  `);
  assert.deepEqual(
    results.map((r) => r.url),
    ["https://example.com/conteudo"],
  );
});

// ─── Deduplicação ───

test("deduplica por URL normalizada ignorando parâmetros de tracking", () => {
  const results = discover(`
    <div><a href="https://example.com/p?utm_source=google&fbclid=abc">Um</a></div>
    <div><a href="https://example.com/p">Dois</a></div>
    <div><a href="http://example.com/p#ancora">Três</a></div>
  `);
  assert.equal(results.length, 1);
  assert.equal(results[0].url, "https://example.com/p");
});

test("na duplicata, o candidato de maior prioridade (botão interativo) vence a âncora simples", () => {
  const results = discover(`
    <div><a href="/videos">Link qualquer</a></div>
    <div><button data-href="https://example.com/videos">Assistir videos</button></div>
  `);
  assert.equal(results.length, 1);
  assert.equal(results[0].source, "button");
  assert.equal(results[0].interactive, true);
  assert.equal(results[0].priority, 1);
});

// ─── Navegação / regiões secundárias ───

test("marca links dentro de nav/header/footer como navegação", () => {
  const results = discover(`
    <nav><a href="/menu">Menu</a></nav>
    <footer><a href="/rodape">Rodapé</a></footer>
    <div><a href="/conteudo">Conteúdo</a></div>
  `);
  const byUrl = new Map(results.map((r) => [r.url, r]));
  assert.equal(byUrl.get("https://example.com/menu")?.isNavigation, true);
  assert.equal(byUrl.get("https://example.com/rodape")?.isNavigation, true);
  assert.equal(byUrl.get("https://example.com/conteudo")?.isNavigation, false);
});

test("marca links dentro de região de anúncio (classe ad-container) como navegação", () => {
  const results = discover(`<div class="ad-container"><a href="/promo">Promo</a></div>`);
  assert.equal(results.length, 1);
  assert.equal(results[0].isNavigation, true);
  assert.equal(results[0].priority, 5);
});

// ─── Botões e data attributes ───

test("extrai destino de botão com data-href como fonte button interativa", () => {
  const results = discover(`<div><button data-href="/curso">Ver curso</button></div>`);
  assert.equal(results.length, 1);
  const candidate = results[0];
  assert.equal(candidate.url, "https://example.com/curso");
  assert.equal(candidate.source, "button");
  assert.equal(candidate.interactive, true);
  assert.equal(candidate.discoveryReason, "interactive-destination");
  // same_domain + hub keyword ("curso") + fonte interativa → prioridade 1
  assert.equal(candidate.priority, 1);
});

test("elemento genérico com data-url é classificado como data_attr", () => {
  const results = discover(`<div><span data-url="/destino">Ir</span></div>`);
  assert.equal(results.length, 1);
  assert.equal(results[0].source, "data_attr");
  assert.equal(results[0].url, "https://example.com/destino");
});

// ─── onclick ───

test("extrai URLs de handlers onclick (location.href, window.open, router.push)", () => {
  const results = discover(`
    <div onclick="window.location.href='/aula-1'">Aula 1</div>
    <div onclick="window.open('https://example.com/aula-2')">Aula 2</div>
    <div onclick="router.push('/aula-3')">Aula 3</div>
  `);
  const urls = results.map((r) => r.url);
  assert.ok(urls.includes("https://example.com/aula-1"));
  assert.ok(urls.includes("https://example.com/aula-2"));
  assert.ok(urls.includes("https://example.com/aula-3"));
  assert.ok(results.every((r) => r.source === "onclick"));
  assert.ok(results.every((r) => r.interactive));
  assert.ok(results.every((r) => r.discoveryReason === "onclick-navigation"));
});

test("ignora handlers onclick gigantes (> 4000 caracteres)", () => {
  const longOnclick = `location.href='/curto';${"x".repeat(4100)}`;
  const results = discover(`<div onclick="${longOnclick}">Gigante</div>`);
  assert.deepEqual(results, []);
});

test("ignora onclick sem URL reconhecível", () => {
  const results = discover(`<div onclick="console.log('oi')">Log</div>`);
  assert.deepEqual(results, []);
});

// ─── data-settings ───

test("extrai URLs de data-settings JSON por chaves de URL", () => {
  const html = `<div data-settings="{&quot;url&quot;:&quot;/promo&quot;,&quot;titulo&quot;:&quot;oi&quot;}">Widget</div>`;
  const results = discover(html);
  assert.equal(results.length, 1);
  assert.equal(results[0].url, "https://example.com/promo");
  assert.equal(results[0].source, "data_settings");
  assert.equal(results[0].discoveryReason, "data-settings-link");
});

test("data-settings aninhado com youtube_url gera candidato de plataforma", () => {
  const html = `<div data-settings="{&quot;player&quot;:{&quot;youtube_url&quot;:&quot;https://www.youtube.com/watch?v=z9&quot;}}">Player</div>`;
  const results = discover(html);
  assert.equal(results.length, 1);
  assert.equal(results[0].category, "video_platform");
  assert.equal(results[0].discoveryReason, "player-config");
});

test("ignora data-settings com JSON inválido ou sem chaves de URL", () => {
  assert.deepEqual(discover(`<div data-settings="{invalido">X</div>`), []);
  assert.deepEqual(discover(`<div data-settings="{&quot;title&quot;:&quot;/promo&quot;}">X</div>`), []);
});

test("ignora URLs javascript: dentro de data-settings", () => {
  const html = `<div data-settings="{&quot;url&quot;:&quot;javascript:alert(1)&quot;}">X</div>`;
  assert.deepEqual(discover(html), []);
});

// ─── discoveryReason e prioridades ───

test("infere discoveryReason de âncoras: platform-reference, content-hub ou null", () => {
  const results = discover(`
    <div><a href="https://www.youtube.com/watch?v=abc">YouTube</a></div>
    <div><a href="/hub" aria-label="Galeria de videos"></a></div>
    <div><a href="/simples">Página simples</a></div>
  `);
  const byUrl = new Map(results.map((r) => [r.url, r]));
  assert.equal(byUrl.get("https://www.youtube.com/watch?v=abc")?.discoveryReason, "platform-reference");
  assert.equal(byUrl.get("https://example.com/hub")?.discoveryReason, "content-hub");
  assert.equal(byUrl.get("https://example.com/simples")?.discoveryReason, null);
});

test("usa aria-label como rótulo quando a âncora não tem texto", () => {
  const results = discover(`<div><a href="/x" aria-label="Assistir agora"></a></div>`);
  assert.equal(results.length, 1);
  assert.equal(results[0].anchorText, "Assistir agora");
});

test("resultados são ordenados por prioridade crescente", () => {
  const results = discover(`
    <div><a href="https://outro.com/x">Parceiro</a></div>
    <nav><a href="/menu">Menu</a></nav>
    <div><a href="/sobre">Sobre nós</a></div>
    <div><a href="https://www.youtube.com/watch?v=abc">Assistir video</a></div>
    <div><button data-href="/aulas">Aulas</button></div>
  `);
  assert.equal(results.length, 5);
  const priorities = results.map((r) => r.priority);
  assert.deepEqual(
    priorities,
    [...priorities].sort((a, b) => a - b),
  );
  // video_platform com keyword de hub → 1; botão interativo com hub → 1;
  // same_domain simples → 3; navegação → 5; externo simples → 6
  assert.deepEqual(priorities, [1, 1, 3, 5, 6]);
});

import assert from "node:assert/strict";
import { test } from "node:test";
import {
  benefits,
  faqs,
  landingContent,
  painPoints,
  productHighlights,
  productSignals,
  steps,
  supportedFormats,
} from "../../src/data/landing.ts";

// ─── landingContent ───

test("landingContent tem todos os campos obrigatórios como strings não vazias", () => {
  const campos = ["eyebrow", "headline", "description", "primaryCta", "secondaryCta"] as const;
  for (const campo of campos) {
    assert.equal(typeof landingContent[campo], "string", `${campo} deve ser string`);
    assert.ok(landingContent[campo].trim().length > 0, `${campo} não pode ser vazio`);
  }
});

test("landingContent: CTAs primário e secundário são distintos", () => {
  assert.notEqual(landingContent.primaryCta, landingContent.secondaryCta);
});

test("landingContent: headline e description não são idênticos", () => {
  assert.notEqual(landingContent.headline, landingContent.description);
});

// ─── painPoints ───

test("painPoints: lista não vazia, itens únicos e não vazios", () => {
  assert.ok(painPoints.length >= 2, "deve haver pelo menos 2 dores");
  const unicos = new Set(painPoints);
  assert.equal(unicos.size, painPoints.length, "dores devem ser únicas");
  for (const dor of painPoints) {
    assert.equal(typeof dor, "string");
    assert.ok(dor.trim().length > 10, "cada dor deve ser uma frase descritiva");
  }
});

// ─── steps / benefits ───

function validaCardsIcone(cards: ReadonlyArray<{ icon: unknown; title: string; description: string }>, nome: string) {
  assert.ok(cards.length >= 3, `${nome} deve ter pelo menos 3 itens`);
  const titulos = new Set<string>();
  const icones = new Set<unknown>();
  for (const card of cards) {
    assert.ok(card.icon, `${nome}: ícone deve estar definido`);
    assert.ok(
      typeof card.icon === "function" || typeof card.icon === "object",
      `${nome}: ícone deve ser um componente`,
    );
    assert.ok(card.title.trim().length > 0, `${nome}: título não pode ser vazio`);
    assert.ok(card.description.trim().length > 10, `${nome}: descrição deve ser descritiva`);
    titulos.add(card.title);
    icones.add(card.icon);
  }
  assert.equal(titulos.size, cards.length, `${nome}: títulos devem ser únicos`);
  assert.equal(icones.size, cards.length, `${nome}: ícones não devem se repetir`);
}

test("steps: exatamente 3 passos, todos completos e únicos", () => {
  assert.equal(steps.length, 3);
  validaCardsIcone(steps, "steps");
});

test("benefits: lista completa, todos completos e únicos", () => {
  assert.equal(benefits.length, 6);
  validaCardsIcone(benefits, "benefits");
});

// ─── faqs ───

test("faqs: perguntas únicas, terminadas em '?', com respostas não vazias", () => {
  assert.ok(faqs.length >= 3, "deve haver pelo menos 3 FAQs");
  const perguntas = new Set<string>();
  for (const faq of faqs) {
    assert.ok(faq.question.trim().endsWith("?"), `pergunta deve terminar em '?': ${faq.question}`);
    assert.ok(faq.answer.trim().length > 20, "resposta deve ser descritiva");
    assert.notEqual(faq.question, faq.answer, "resposta não pode repetir a pergunta");
    perguntas.add(faq.question);
  }
  assert.equal(perguntas.size, faqs.length, "perguntas devem ser únicas");
});

test("faqs: cobre temas essenciais (preço, instalação, privacidade)", () => {
  const texto = faqs
    .map((f) => `${f.question} ${f.answer}`)
    .join(" ")
    .toLowerCase();
  assert.match(texto, /grat/i, "deve falar sobre gratuidade");
  assert.match(texto, /instal/i, "deve falar sobre instalação");
  assert.match(texto, /privad|DRM|paywall/i, "deve falar sobre páginas privadas");
});

// ─── supportedFormats ───

test("supportedFormats: não vazio, únicos, uppercase alfanumérico", () => {
  assert.ok(supportedFormats.length > 0);
  const unicos = new Set(supportedFormats);
  assert.equal(unicos.size, supportedFormats.length, "formatos devem ser únicos");
  for (const formato of supportedFormats) {
    assert.match(formato, /^[A-Z0-9]+$/, `formato deve ser uppercase alfanumérico: ${formato}`);
  }
});

test("supportedFormats: inclui formatos-chave de imagem e vídeo", () => {
  for (const formato of ["JPG", "PNG", "MP4"]) {
    assert.ok((supportedFormats as readonly string[]).includes(formato), `deve incluir ${formato}`);
  }
});

// ─── productSignals / productHighlights ───

test("productSignals: labels e valores não vazios e labels únicos", () => {
  assert.ok(productSignals.length >= 1);
  const labels = new Set<string>();
  for (const sinal of productSignals) {
    assert.ok(sinal.label.trim().length > 0);
    assert.ok(sinal.value.trim().length > 0);
    labels.add(sinal.label);
  }
  assert.equal(labels.size, productSignals.length, "labels devem ser únicos");
});

test("productSignals: valor de exemplo de página é uma URL de domínio válida", () => {
  const pagina = productSignals.find((s) => s.label === "Página analisada");
  assert.ok(pagina, "deve existir o sinal 'Página analisada'");
  const url = new URL(`https://${pagina.value}`);
  assert.ok(url.hostname.includes("."), "hostname deve parecer um domínio");
  assert.ok(url.pathname.length > 1, "deve incluir um caminho");
});

test("productHighlights: textos únicos, não vazios, com ícones definidos", () => {
  assert.ok(productHighlights.length >= 1);
  const textos = new Set<string>();
  for (const destaque of productHighlights) {
    assert.ok(destaque.icon, "ícone deve estar definido");
    assert.ok(typeof destaque.icon === "function" || typeof destaque.icon === "object", "ícone deve ser um componente");
    assert.ok(destaque.text.trim().length > 0);
    textos.add(destaque.text);
  }
  assert.equal(textos.size, productHighlights.length, "textos devem ser únicos");
});

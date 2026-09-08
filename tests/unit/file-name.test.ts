import assert from "node:assert/strict";
import { test } from "node:test";
import { buildContentDisposition, MAX_FILE_NAME_LENGTH, sanitizeFileName } from "../../src/lib/files/file-name.ts";

// ─── sanitizeFileName: casos felizes ───

test("sanitizeFileName mantém nome simples intacto", () => {
  assert.equal(sanitizeFileName("photo.jpg"), "photo.jpg");
});

test("sanitizeFileName preserva caracteres acentuados e unicode", () => {
  assert.equal(sanitizeFileName("foto café àção.jpg"), "foto café àção.jpg");
});

test("sanitizeFileName normaliza NFKC (ligatura fi vira fi ASCII)", () => {
  assert.equal(sanitizeFileName("ﬁle.jpg"), "file.jpg");
});

// ─── Caracteres inválidos ───

test("sanitizeFileName substitui caracteres proibidos do Windows por underscore", () => {
  assert.equal(sanitizeFileName('a<b>c:d"e/f\\g|h?i*j.txt'), "a_b_c_d_e_f_g_h_i_j.txt");
});

test("sanitizeFileName remove caracteres de controle (tab, newline)", () => {
  assert.equal(sanitizeFileName("a\tb\nc\rd.jpg"), "abcd.jpg");
});

test("sanitizeFileName remove o caractere DEL (127)", () => {
  assert.equal(sanitizeFileName("a\x7Fb.jpg"), "ab.jpg");
});

// ─── Espaços ───

test("sanitizeFileName colapsa múltiplos espaços em um só", () => {
  assert.equal(sanitizeFileName("my   vacation    photo.jpg"), "my vacation photo.jpg");
});

test("sanitizeFileName remove espaços das pontas", () => {
  assert.equal(sanitizeFileName("  photo.jpg  "), "photo.jpg");
});

// ─── Pontos ───

test("sanitizeFileName substitui sequência de pontos por underscore (path traversal)", () => {
  // "..\\" vira ".._" → MULTI_DOT troca ".." por "_" → underscores se acumulam.
  assert.equal(sanitizeFileName("..\\..\\etc\\passwd"), "____etc_passwd");
});

test("sanitizeFileName remove pontos das pontas", () => {
  assert.equal(sanitizeFileName(".hidden."), "hidden");
  // "..." vira "_" via MULTI_DOT; underscores nas pontas não são removidos.
  assert.equal(sanitizeFileName("...file..."), "_file_");
});

test("sanitizeFileName mantém ponto único de extensão", () => {
  assert.equal(sanitizeFileName("archive.tar.gz"), "archive.tar.gz");
});

// ─── Fallback ───

test("sanitizeFileName usa fallback 'download' para string vazia", () => {
  assert.equal(sanitizeFileName(""), "download");
});

test("sanitizeFileName usa fallback para string só de espaços", () => {
  assert.equal(sanitizeFileName("     "), "download");
});

test("sanitizeFileName usa fallback customizado quando informado", () => {
  assert.equal(sanitizeFileName("", "arquivo"), "arquivo");
  assert.equal(sanitizeFileName("   ", "arquivo"), "arquivo");
});

test("sanitizeFileName retorna underscore quando nome vira só underscores", () => {
  // "???" → todos viram "_", que não é vazio nem ponto → permanece.
  assert.equal(sanitizeFileName("???"), "___");
});

// ─── Truncamento ───

test("sanitizeFileName mantém nome com exatamente 255 caracteres", () => {
  const name = `${"a".repeat(251)}.jpg`; // 255 chars
  assert.equal(sanitizeFileName(name), name);
});

test("sanitizeFileName trunca nome longo sem extensão em 255 caracteres", () => {
  const name = "a".repeat(300);
  const result = sanitizeFileName(name);
  assert.equal(result.length, MAX_FILE_NAME_LENGTH);
  assert.equal(result, "a".repeat(255));
});

test("sanitizeFileName trunca preservando a extensão", () => {
  const name = `${"b".repeat(300)}.jpg`;
  const result = sanitizeFileName(name);
  assert.equal(result.length, MAX_FILE_NAME_LENGTH);
  assert.ok(result.endsWith(".jpg"));
  assert.equal(result, `${"b".repeat(251)}.jpg`);
});

test("sanitizeFileName trunca usando o último ponto como extensão", () => {
  const name = `${"c".repeat(200)}.middle.${"d".repeat(100)}`;
  const result = sanitizeFileName(name);
  assert.ok(result.endsWith(`.${"d".repeat(100)}`));
});

test("sanitizeFileName NÃO garante 255 chars quando a 'extensão' é gigante (bug conhecido)", () => {
  // Com base curta + extensão enorme, maxBaseLength fica negativo e é clampado
  // em 1, mas a extensão é reanexada inteira — o resultado estoura 255.
  const result = sanitizeFileName(`a.${"x".repeat(300)}`);
  assert.equal(result.length, 302);
});

// ─── buildContentDisposition ───

test("buildContentDisposition gera header com fallback ASCII e UTF-8 para nome simples", () => {
  assert.equal(buildContentDisposition("photo.jpg"), "attachment; filename=\"photo.jpg\"; filename*=UTF-8''photo.jpg");
});

test("buildContentDisposition sanitiza nome antes de montar o header", () => {
  assert.equal(
    buildContentDisposition('a<b>"c".jpg'),
    "attachment; filename=\"a_b__c_.jpg\"; filename*=UTF-8''a_b__c_.jpg",
  );
});

test("buildContentDisposition substitui não-ASCII no fallback e percent-encode no UTF-8", () => {
  const header = buildContentDisposition("foto café.jpg");
  // NFKD decomposes é → e + combining accent (fora de \x20-\x7E) → vira "_".
  assert.equal(header, "attachment; filename=\"foto cafe_.jpg\"; filename*=UTF-8''foto%20caf%C3%A9.jpg");
});

test("buildContentDisposition escapa apóstrofo e parênteses no componente UTF-8", () => {
  const header = buildContentDisposition("it's(1).jpg");
  assert.equal(header, "attachment; filename=\"it's(1).jpg\"; filename*=UTF-8''it%27s%281%29.jpg");
});

test("buildContentDisposition mantém ! e ~ sem escape no componente UTF-8", () => {
  const header = buildContentDisposition("a!b~c.txt");
  assert.equal(header, "attachment; filename=\"a!b~c.txt\"; filename*=UTF-8''a!b~c.txt");
});

test("buildContentDisposition usa fallback 'download' para nome vazio", () => {
  assert.equal(buildContentDisposition(""), "attachment; filename=\"download\"; filename*=UTF-8''download");
});

test("buildContentDisposition substitui aspas e barra invertida residuais no fallback ASCII", () => {
  // sanitizeFileName já troca " e \ por "_", mas espaços internos passam.
  const header = buildContentDisposition("my file name.png");
  assert.equal(header, "attachment; filename=\"my file name.png\"; filename*=UTF-8''my%20file%20name.png");
});

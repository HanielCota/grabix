import { expect, test } from "@playwright/test";

test.describe("modo claro / tema da interface", () => {
  test("permite alternar entre modo escuro e modo claro pelo botão de tema", async ({ page }) => {
    await page.emulateMedia({ colorScheme: "dark" });
    await page.goto("/");

    // O botão de alternância de tema no cabeçalho deve estar visível
    const themeBtn = page.getByTitle(/Mudar para modo claro|Mudar para modo escuro/i).first();
    await expect(themeBtn).toBeVisible();

    // Inicialmente no modo escuro, o botão oferece mudar para claro
    await expect(themeBtn).toHaveAttribute("aria-label", "Mudar para modo claro");

    // Clica para mudar para o modo claro
    await themeBtn.click();

    // O elemento <html> deve receber a classe 'light' e atributo data-theme='light'
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    await expect(page.locator("html")).toHaveClass(/light/);

    // Verifica que a preferência foi gravada no localStorage
    const stored = await page.evaluate(() => localStorage.getItem("grabix-theme"));
    expect(stored).toBe("light");

    // Recarrega a página para testar se a preferência persiste
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");

    // Agora o botão deve oferecer retorno ao modo escuro
    const backToDarkBtn = page.getByTitle("Mudar para modo escuro").first();
    await expect(backToDarkBtn).toBeVisible();

    // Clica para voltar ao modo escuro
    await backToDarkBtn.click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    const storedDark = await page.evaluate(() => localStorage.getItem("grabix-theme"));
    expect(storedDark).toBe("dark");
  });
});

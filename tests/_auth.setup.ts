import { test as setup } from "@playwright/test";

setup("ログイン状態を保存", async ({ page }) => {
  await page.goto("/login");

  await page.pause();

  await page.context().storageState({
    path: "playwright/.auth/user.json",
  });
});

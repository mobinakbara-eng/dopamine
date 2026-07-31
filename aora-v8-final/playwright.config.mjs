import { defineConfig, devices } from "@playwright/test";

const baseURL=process.env.AORA_PREVIEW_URL||"http://127.0.0.1:4173";
export default defineConfig({
  testDir:"./tests",
  testMatch:/aora-(accessibility|four-role|unified-login|unified-release)\.spec\.mjs/,
  timeout:60000,
  expect:{timeout:15000},
  fullyParallel:false,
  workers:1,
  retries:0,
  reporter:[["line"],["json",{outputFile:"playwright-report.json"}]],
  use:{
    baseURL,
    headless:true,
    screenshot:"only-on-failure",
    trace:"off",
    video:"off",
    ignoreHTTPSErrors:false
  },
  webServer:process.env.AORA_PREVIEW_URL?undefined:{
    command:"python3 -m http.server 4173 --bind 127.0.0.1 -d dist",
    url:"http://127.0.0.1:4173",
    reuseExistingServer:!process.env.CI,
    timeout:30000
  },
  projects:[{name:"chromium",use:{...devices["Desktop Chrome"]}}]
});
